import type { MigrationRule, SupportState } from "@amo/domain";

/**
 * Parser for the Microsoft Learn "Move operation support" page (ADR-0021),
 * articles/azure-resource-manager/management/move-support-resources.md in MicrosoftDocs/azure-docs. Each provider has a
 * `## Microsoft.X` heading (some are lower-case, such as `## microsoft.aadiam`) and one or more tables:
 * | Resource type | Resource group | Subscription | Region move |
 * with cells like "Yes", "No", "Yes - with restrictions", "Pending", "Yes <br> Use Azure Resource Mover …".
 * The tables sit inside `> [!div class="mx-tableFixed"]` quote blocks, so every table line starts with "> ".
 */
export interface LearnMatrixRow {
  provider: string;
  resourceType: string; // fully qualified, lowercased
  resourceGroupMove: SupportState;
  subscriptionMove: SupportState;
  regionRelocation: SupportState;
  raw: { rg: string; sub: string; region: string };
  /**
   * Which table of its provider section the row came from: 0 for the first, 1 and up for a later table under the same
   * heading (Microsoft.Compute's Cloud Services (extended support) table, for example, repeats `virtualmachines`).
   */
  tableInSection?: number;
  /**
   * The first section note above the row's table that links move guidance ("See [App Service move guidance](…)"), with the
   * link as an absolute Learn address.
   * A plain "Yes" for resource group or subscription move under such a note reads as `conditional`, not `supported`.
   */
  guidance?: { text: string; url: string };
}

const stripMarkdown = (s: string): string =>
  s.replace(/\*\*|__|`/g, "").replace(/<[^>]+>/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

export function normalizeLearnCell(cell: string): SupportState {
  const c = stripMarkdown(cell).toLowerCase();
  if (!c || c === "-" || c === "n/a") return "unknown";
  if (/pending/.test(c)) return "unknown";
  const hasYes = /\byes\b/.test(c);
  const hasNo = /\bno\b/.test(c);
  if (hasYes && hasNo) return "conditional";
  if (hasYes) return c === "yes" ? "supported" : "conditional"; // any qualifier or footnote makes it conditional
  if (hasNo) return "unsupported";
  if (/^partial/.test(c)) return "conditional";
  return "unknown";
}

/** Removes one leading blockquote marker (">" and an optional space) so quoted tables and notes read like bare ones. */
const unquote = (line: string): string => line.replace(/^\s*> ?/, "");

const PROVIDER_HEADING = /^#+\s+(microsoft\.[a-z0-9.]+)\s*$/i;
const ANY_HEADING = /^#+\s/;
const NOTE_START = /^\[!(IMPORTANT|NOTE|WARNING|CAUTION|TIP)\]\s*$/i;
/**
 * A note links move guidance when it says "See [title](url)" (or "See the corresponding [title](url)") and that link's title
 * or address is about moving: Microsoft.Web's "See [App Service move guidance](…)". A note that only states a condition
 * (Microsoft.Sql) or links something else (the Azure Cache for Redis retirement FAQ) does not count.
 */
const GUIDANCE_LINK = /\bsee\s+(?:the\s+corresponding\s+)?\[([^\]]+)\]\(([^)\s]+)\)/gi;
const ABOUT_MOVING = /\bmov(e|ed|es|ing)\b|\brelocat|\bsubscription\b/i;

/** The folder of the move-support article on Learn; the page's relative links resolve against it. */
const ARTICLE_BASE = "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/";

/** A link on the page as an absolute Learn address: "/azure/…" is site-relative, "./x.md" and "../../x.md" article-relative. */
export function learnLinkToUrl(href: string): string {
  const target = href.startsWith("/azure/") ? `https://learn.microsoft.com/en-us${href}` : href;
  const url = new URL(target, ARTICLE_BASE);
  url.searchParams.delete("toc");
  url.pathname = url.pathname.replace(/\.md$/, "");
  return url.toString();
}

const guidanceIn = (notes: string[][]): LearnMatrixRow["guidance"] => {
  for (const lines of notes) {
    const text = lines.map((l) => l.replace(/^-\s*/, "")).filter(Boolean).join(" ");
    for (const [, title, href] of text.matchAll(GUIDANCE_LINK)) {
      if (ABOUT_MOVING.test(`${title} ${href}`)) return { text: stripMarkdown(text), url: learnLinkToUrl(href) };
    }
  }
  return undefined;
};

/**
 * Drops `<!-- … -->` comments in one pass from left to right. An unclosed `<!--` hides the rest of the text, as it does in a
 * browser. A scan rather than a regular expression, so that text with many unclosed openings is not read in time that grows
 * with the square of its length (CodeQL alert 27).
 */
function withoutHtmlComments(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf("<!--", from);
    if (open < 0) return out + text.slice(from);
    out += text.slice(from, open);
    const close = text.indexOf("-->", open + 4);
    if (close < 0) return out;
    from = close + 3;
  }
}

export function parseLearnMoveSupport(markdown: string): LearnMatrixRow[] {
  const rows: LearnMatrixRow[] = [];
  let provider = "";
  let tableInSection = -1;
  let notes: string[][] = []; // the notes since the last table or heading; the next table takes them
  let readingNote = false;
  let guidance: LearnMatrixRow["guidance"];
  // HTML comments are not rendered on Learn; the Microsoft.Maintenance section keeps an old, contradicting table in one.
  const visible = withoutHtmlComments(markdown);
  for (const rawLine of visible.split(/\r?\n/)) {
    const quoted = /^\s*>/.test(rawLine);
    const line = unquote(rawLine);
    if (ANY_HEADING.test(line)) {
      // Any heading ends the section; only a provider heading starts a new one.
      provider = PROVIDER_HEADING.exec(line)?.[1] ?? "";
      tableInSection = -1;
      notes = [];
      readingNote = false;
      guidance = undefined;
      continue;
    }
    if (quoted && NOTE_START.test(line.trim())) { notes.push([]); readingNote = true; continue; }
    if (readingNote) {
      // A quoted blank line (">") is a paragraph break inside the note; an unquoted line, a table or a [!div] ends it.
      if (quoted && !/^\|/.test(line) && !/^\[!div/i.test(line.trim())) { notes[notes.length - 1].push(line.trim()); continue; }
      readingNote = false;
    }
    if (!/^\|/.test(line)) continue;
    if (/resource type/i.test(line)) {
      // A table header: a new table in this section, which takes its guidance from the notes just above it.
      tableInSection += 1;
      guidance = guidanceIn(notes);
      notes = [];
      continue;
    }
    if (/^\|[\s:|-]+$/.test(line.trim())) continue; // separator row, with or without alignment colons
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const typeCell = stripMarkdown(cells[0]).replace(/\s*\/\s*/g, "/");
    if (!typeCell) continue;
    const qualified = typeCell.toLowerCase().startsWith("microsoft.");
    if (!qualified && !provider) continue; // a table outside any provider section
    const fq = qualified ? typeCell : `${provider}/${typeCell}`;
    const [rg, sub, region = ""] = [cells[1], cells[2], cells[3] ?? ""];
    // Guidance notes are about resource group and subscription moves, so they qualify those two columns only.
    const withGuidance = (s: SupportState): SupportState => (guidance && s === "supported" ? "conditional" : s);
    rows.push({
      provider: fq.split("/")[0],
      resourceType: fq.toLowerCase(),
      resourceGroupMove: withGuidance(normalizeLearnCell(rg)),
      subscriptionMove: withGuidance(normalizeLearnCell(sub)),
      regionRelocation: normalizeLearnCell(region),
      raw: { rg, sub, region },
      tableInSection: Math.max(tableInSection, 0),
      ...(guidance ? { guidance } : {}),
    });
  }
  return rows;
}

export interface MatrixDiff {
  ruleId: string;
  resourceType: string;
  field: "resourceGroupMove" | "subscriptionMove" | "regionRelocation";
  rule: SupportState;
  learn: SupportState;
  learnRaw: string;
  /** The guidance link from the section note when it is what made a plain "Yes" read as conditional. */
  learnGuidance?: string;
}

/**
 * Compare the parsed matrix with the rule corpus. Region-move differences are reported but expected in places:
 * Learn's column describes Resource Mover, while rules also encode service-native relocation paths.
 * When a type appears in more than one row (a later table in the same section repeats it), the first row is used.
 */
export function diffRulesAgainstMatrix(rules: MigrationRule[], matrix: LearnMatrixRow[]): { diffs: MatrixDiff[]; uncovered: string[]; notInMatrix: string[] } {
  const byType = new Map<string, LearnMatrixRow>();
  for (const m of matrix) if (!byType.has(m.resourceType)) byType.set(m.resourceType, m);
  const diffs: MatrixDiff[] = [];
  const notInMatrix: string[] = [];
  const ruleTypes = new Set(rules.map((r) => r.resourceType.toLowerCase()));
  for (const r of rules) {
    const m = byType.get(r.resourceType.toLowerCase());
    if (!m) { notInMatrix.push(r.resourceType); continue; }
    for (const [field, learn, raw] of [["resourceGroupMove", m.resourceGroupMove, m.raw.rg], ["subscriptionMove", m.subscriptionMove, m.raw.sub], ["regionRelocation", m.regionRelocation, m.raw.region]] as const) {
      if (learn === "unknown") continue;
      if (r.support[field] === learn) continue;
      const guided = m.guidance && field !== "regionRelocation" && learn === "conditional" && normalizeLearnCell(raw) === "supported";
      diffs.push({ ruleId: r.ruleId, resourceType: r.resourceType, field, rule: r.support[field], learn, learnRaw: raw, ...(guided ? { learnGuidance: m.guidance!.url } : {}) });
    }
  }
  const uncovered = [...byType.values()].filter((m) => !ruleTypes.has(m.resourceType) && m.resourceGroupMove !== "unknown").map((m) => m.resourceType);
  return { diffs, uncovered, notInMatrix };
}
