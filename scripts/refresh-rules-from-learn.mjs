#!/usr/bin/env node
/**
 * Evidence Agent in CI (ADR-0021): fetch the Microsoft Learn move-support tables, diff them against rules/azure,
 * and write a change report the rules-refresh workflow attaches to a pull request. Never edits rules automatically.
 *
 * A disagreement a person has already looked at and decided to keep is listed in rules/reports/learn-diff-reviewed.json
 * with the reason. The report shows those in their own table with the reason, so that a new disagreement stands out and
 * the same rows are not reviewed again every week (issue 132). Nothing is hidden: every disagreement is still in the report.
 *
 * Usage: node scripts/refresh-rules-from-learn.mjs [--from <local-markdown-file>] [--out rules/reports] [--reviewed <json-file>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { escapeTableCell } from "./lib/escape-table-cell.mjs";
import { loadRules, defaultRulesDir, parseLearnMoveSupport, diffRulesAgainstMatrix } from "@amo/evidence-engine";

// The move-support tables live in this article in MicrosoftDocs/azure-docs (checked 2026-11-18; it answers 200). An include
// file that used to be listed first here answered 404 and was removed (CHANGELOG, 2026-11-18).
const SOURCES = [
  "https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/azure-resource-manager/management/move-support-resources.md",
];

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const outDir = flag("out") ?? "rules/reports";
const local = flag("from");
const reviewedFile = flag("reviewed") ?? "rules/reports/learn-diff-reviewed.json";

const FIELDS = ["resourceGroupMove", "subscriptionMove", "regionRelocation"];
// A decision is about one rule field with one pair of values. When the rule or Learn's cell changes to another value, the
// key no longer matches, and the row comes back as new: a decision never covers a difference nobody has looked at.
const reviewKey = (d) => `${d.ruleId}|${d.field}|${d.rule}|${d.learn}`;

/** Reads the reviewed decisions. A missing file means none; a file that cannot be read as the expected shape stops the run. */
function loadReviewed() {
  if (!existsSync(reviewedFile)) return [];
  const fail = (why) => { console.error(`${reviewedFile}: ${why}. No report was written.`); process.exit(1); };
  let parsed;
  try { parsed = JSON.parse(readFileSync(reviewedFile, "utf8")); } catch (e) { fail(`not valid JSON (${e.message})`); }
  if (!Array.isArray(parsed?.reviewed)) fail('expected an object with a "reviewed" list');
  const seen = new Set();
  parsed.reviewed.forEach((r, i) => {
    for (const k of ["ruleId", "field", "rule", "learn", "reason", "decidedIn", "decidedOn"]) {
      if (typeof r?.[k] !== "string" || !r[k].trim()) fail(`entry ${i + 1} needs a non-empty "${k}"`);
    }
    if (!FIELDS.includes(r.field)) fail(`entry ${i + 1} has an unknown field "${r.field}"`);
    if (seen.has(reviewKey(r))) fail(`entry ${i + 1} repeats ${reviewKey(r)}`);
    seen.add(reviewKey(r));
  });
  return parsed.reviewed;
}

async function fetchMarkdown() {
  if (local) return { text: readFileSync(local, "utf8"), source: local };
  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      if (res.ok) return { text: await res.text(), source: url };
      console.error(`${url} -> ${res.status}`);
    } catch (e) { console.error(`${url} -> ${e.message}`); }
  }
  throw new Error("no Learn source reachable; pass --from <file> to run offline");
}

const { text, source } = await fetchMarkdown();
const matrix = parseLearnMoveSupport(text);
if (matrix.length === 0) {
  // A page the parser cannot read would otherwise produce a report saying "0 disagreements", which looks like agreement.
  console.error(`parsed 0 rows from ${source}: the page layout has probably changed. No report was written.`);
  process.exit(1);
}
const loaded = loadRules(defaultRulesDir());
const { diffs: found, uncovered, notInMatrix, notTypes } = diffRulesAgainstMatrix(loaded.rules, matrix);
const reviewedEntries = loadReviewed();
const reviewedByKey = new Map(reviewedEntries.map((r) => [reviewKey(r), r]));
const diffs = found.map((d) => {
  const r = reviewedByKey.get(reviewKey(d));
  return r ? { ...d, reviewed: { reason: r.reason, decidedIn: r.decidedIn, decidedOn: r.decidedOn } } : d;
});
const fresh = diffs.filter((d) => !d.reviewed);
const kept = diffs.filter((d) => d.reviewed);
// A decision whose disagreement is gone (the rule or Learn changed): shown so that the list gets tidied, never dropped silently.
const foundKeys = new Set(found.map(reviewKey));
const unused = reviewedEntries.filter((r) => !foundKeys.has(reviewKey(r)));
// A page that parses but matches few rule types has probably lost most of its tables to a layout change: say so loudly.
const mostlyMissing = notInMatrix.length * 2 > loaded.rules.length;
const warning = mostlyMissing ? `Warning: ${notInMatrix.length} of ${loaded.rules.length} rule types were not found on the page; the page layout has probably changed, so the disagreements below are incomplete.` : "";
if (warning) console.error(`warning: ${warning}`);
// A plain "Yes" under a section note that links move guidance is shown as "Yes, with guidance (<link>)".
const learnCell = (d) => (d.learnGuidance ? `Yes, with guidance (${d.learnGuidance})` : d.learnRaw.slice(0, 80));
const row = (d) => `${d.ruleId} | ${d.field} | ${d.rule} | ${d.learn} | ${escapeTableCell(learnCell(d))}${d.learnVariant ? ` (Learn row labelled "${escapeTableCell(d.learnVariant.slice(0, 60))}")` : ""}`;
mkdirSync(outDir, { recursive: true });
const retrievedOn = new Date().toISOString().slice(0, 10);
const report = { retrievedOn, source, matrixRows: matrix.length, rulesChecked: loaded.rules.length, newDiffs: fresh.length, reviewedDiffs: kept.length, diffs, reviewedNoLongerFound: unused, uncoveredTypesInMatrix: uncovered, ruleTypesNotInMatrix: notInMatrix, learnRowsNotAType: notTypes };
writeFileSync(join(outDir, "learn-diff.json"), JSON.stringify(report, null, 2) + "\n");
const md = [
  `# Learn move-support diff — ${retrievedOn}`, "", ...(warning ? [`> **${warning}**`, ""] : []), `Source: ${source} · matrix rows: ${matrix.length} · rules checked: ${loaded.rules.length}`, "",
  fresh.length
    ? `**${fresh.length} new ${fresh.length === 1 ? "disagreement needs" : "disagreements need"} a decision.** ${kept.length} more ${kept.length === 1 ? "was" : "were"} reviewed earlier and kept, with the reason beside each.`
    : `**Nothing new to decide.** ${kept.length ? `All ${diffs.length} disagreements were reviewed earlier and kept, with the reason beside each.` : "The rules and Learn agree on every type both have."}`,
  "",
  `## Disagreements (${diffs.length})`, "",
  `### New, not yet reviewed (${fresh.length})`, "",
  ...(fresh.length ? ["| Rule | Field | Rule says | Learn says | Learn cell |", "|---|---|---|---|---|", ...fresh.map((d) => `| ${row(d)} |`)] : ["None."]),
  "", `### Reviewed and kept as they are (${kept.length})`, "",
  ...(kept.length ? [
    "A person compared each of these with Learn and decided the rule stays. The decisions are in `rules/reports/learn-diff-reviewed.json`; a row comes back as new when the rule or Learn's cell changes.", "",
    "| Rule | Field | Rule says | Learn says | Learn cell | Why the rule stays | Decided |", "|---|---|---|---|---|---|---|",
    ...kept.map((d) => `| ${row(d)} | ${escapeTableCell(d.reviewed.reason)} | ${escapeTableCell(d.reviewed.decidedOn)}, ${escapeTableCell(d.reviewed.decidedIn)} |`),
  ] : ["None."]),
  ...(unused.length ? [
    "", `### Earlier decisions that no longer match a disagreement (${unused.length})`, "",
    "The rule or Learn has changed since these were decided. Remove each from `rules/reports/learn-diff-reviewed.json` once you have confirmed that.", "",
    ...unused.map((r) => `- ${escapeTableCell(r.ruleId)} ${r.field}: rule \`${escapeTableCell(r.rule)}\`, Learn \`${escapeTableCell(r.learn)}\` (decided ${escapeTableCell(r.decidedOn)})`),
  ] : []),
  "", `## Resource types in the matrix without a rule (${uncovered.length})`, "", ...uncovered.slice(0, 200).map((u) => `- ${u}`),
  "", `## Rule types not found in the matrix (${notInMatrix.length})`, "", ...notInMatrix.map((u) => `- ${u}`),
  "", `## Learn rows that name a product, not a resource type (${notTypes.length})`, "",
  ...(notTypes.length ? ["These rows are left out of the comparison above; a resource type never contains a space.", "", ...notTypes.map((u) => `- ${u}`)] : []),
  "", "Region-move disagreements are expected where a rule encodes a service-native relocation path rather than Resource Mover support. Review each new row. To accept it: update `scripts/author-rules.mjs`, bump `ruleVersion`, set `retrievedOn`, regenerate and re-snapshot. To keep the rule: add the row to `rules/reports/learn-diff-reviewed.json` with the reason and a link to where it was decided.", "",
].join("\n");
writeFileSync(join(outDir, "learn-diff.md"), md);
console.log(`rows=${matrix.length} diffs=${diffs.length} new=${fresh.length} reviewed=${kept.length} unusedDecisions=${unused.length} uncovered=${uncovered.length} notInMatrix=${notInMatrix.length} notTypes=${notTypes.length} -> ${outDir}/learn-diff.md`);
process.exit(0);
