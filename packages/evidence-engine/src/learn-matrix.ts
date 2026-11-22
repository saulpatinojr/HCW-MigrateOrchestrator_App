import type { MigrationRule, SupportState } from "@amo/domain";

/**
 * Parser for Microsoft Learn "Move operation support" tables (ADR-0021). Each include file has a table per provider:
 * | Resource type | Resource group | Subscription | Region move |
 * with cells like "Yes", "No", "Yes - with restrictions", "Pending", "Yes <br> Use Azure Resource Mover …".
 */
export interface LearnMatrixRow {
  provider: string;
  resourceType: string; // fully qualified, lowercased, without Learn's bracketed label
  /** Learn's label in brackets after the type, e.g. "managed" in "certificates (managed)"; absent on a plain row. */
  variant?: string;
  resourceGroupMove: SupportState;
  subscriptionMove: SupportState;
  regionRelocation: SupportState;
  raw: { rg: string; sub: string; region: string };
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

/**
 * Split a type cell such as "certificates (managed)" or "vpngateways (Virtual WAN)" into the type and its label. The label
 * runs from the first "(" to the closing ")" at the end of the cell, so a label holding its own brackets stays whole.
 */
function splitTypeLabel(cell: string): { type: string; variant?: string } {
  const m = cell.match(/^([^()]*?)\s*\((.*)\)$/);
  if (!m) return { type: cell };
  const variant = m[2].trim();
  return variant ? { type: m[1], variant } : { type: m[1] };
}

export function parseLearnMoveSupport(markdown: string): LearnMatrixRow[] {
  const rows: LearnMatrixRow[] = [];
  let provider = "";
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^#+\s+(Microsoft\.[A-Za-z0-9.]+)\s*$/);
    if (h) { provider = h[1]; continue; }
    if (!/^\|/.test(line) || /^\|\s*-{2,}/.test(line) || /resource type/i.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const { type, variant } = splitTypeLabel(stripMarkdown(cells[0]));
    const typeCell = type.replace(/\s*\/\s*/g, "/");
    if (!typeCell) continue;
    const fq = typeCell.toLowerCase().startsWith("microsoft.") ? typeCell : `${provider}/${typeCell}`;
    const [rg, sub, region = ""] = [cells[1], cells[2], cells[3] ?? ""];
    rows.push({ provider: fq.split("/")[0], resourceType: fq.toLowerCase(), ...(variant ? { variant } : {}), resourceGroupMove: normalizeLearnCell(rg), subscriptionMove: normalizeLearnCell(sub), regionRelocation: normalizeLearnCell(region), raw: { rg, sub, region } });
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
  /** Set when the Learn row compared carries a label, e.g. "Virtual WAN" for "vpngateways (Virtual WAN)". */
  learnVariant?: string;
}

/**
 * Compare the parsed matrix with the rule corpus. Region-move differences are reported but expected in places:
 * Learn's column describes Resource Mover, while rules also encode service-native relocation paths.
 * Learn can list one type on several rows, e.g. "certificates" and "certificates (managed)" under Microsoft.Web. A rule is
 * compared with the first unlabelled row for its type, or with the first labelled row when every row for it is labelled.
 */
export function diffRulesAgainstMatrix(rules: MigrationRule[], matrix: LearnMatrixRow[]): { diffs: MatrixDiff[]; uncovered: string[]; notInMatrix: string[] } {
  const byType = new Map<string, LearnMatrixRow>();
  for (const m of matrix) {
    const seen = byType.get(m.resourceType);
    if (!seen || (seen.variant !== undefined && m.variant === undefined)) byType.set(m.resourceType, m);
  }
  const diffs: MatrixDiff[] = [];
  const notInMatrix: string[] = [];
  const ruleTypes = new Set(rules.map((r) => r.resourceType.toLowerCase()));
  for (const r of rules) {
    const m = byType.get(r.resourceType.toLowerCase());
    if (!m) { notInMatrix.push(r.resourceType); continue; }
    for (const [field, learn, raw] of [["resourceGroupMove", m.resourceGroupMove, m.raw.rg], ["subscriptionMove", m.subscriptionMove, m.raw.sub], ["regionRelocation", m.regionRelocation, m.raw.region]] as const) {
      if (learn === "unknown") continue;
      if (r.support[field] !== learn) diffs.push({ ruleId: r.ruleId, resourceType: r.resourceType, field, rule: r.support[field], learn, learnRaw: raw, ...(m.variant !== undefined ? { learnVariant: m.variant } : {}) });
    }
  }
  const uncovered = [...new Set(matrix.filter((m) => !ruleTypes.has(m.resourceType) && m.resourceGroupMove !== "unknown").map((m) => m.resourceType))];
  return { diffs, uncovered, notInMatrix };
}
