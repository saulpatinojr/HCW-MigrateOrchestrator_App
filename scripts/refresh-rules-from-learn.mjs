#!/usr/bin/env node
/**
 * Evidence Agent in CI (ADR-0021): fetch the Microsoft Learn move-support tables, diff them against rules/azure,
 * and write a change report the rules-refresh workflow attaches to a pull request. Never edits rules automatically.
 *
 * Usage: node scripts/refresh-rules-from-learn.mjs [--from <local-markdown-file>] [--out rules/reports]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const { diffs, uncovered, notInMatrix, notTypes } = diffRulesAgainstMatrix(loaded.rules, matrix);
// A page that parses but matches few rule types has probably lost most of its tables to a layout change: say so loudly.
const mostlyMissing = notInMatrix.length * 2 > loaded.rules.length;
const warning = mostlyMissing ? `Warning: ${notInMatrix.length} of ${loaded.rules.length} rule types were not found on the page; the page layout has probably changed, so the disagreements below are incomplete.` : "";
if (warning) console.error(`warning: ${warning}`);
// A plain "Yes" under a section note that links move guidance is shown as "Yes, with guidance (<link>)".
const learnCell = (d) => (d.learnGuidance ? `Yes, with guidance (${d.learnGuidance})` : d.learnRaw.slice(0, 80));
mkdirSync(outDir, { recursive: true });
const retrievedOn = new Date().toISOString().slice(0, 10);
const report = { retrievedOn, source, matrixRows: matrix.length, rulesChecked: loaded.rules.length, diffs, uncoveredTypesInMatrix: uncovered, ruleTypesNotInMatrix: notInMatrix, learnRowsNotAType: notTypes };
writeFileSync(join(outDir, "learn-diff.json"), JSON.stringify(report, null, 2) + "\n");
const md = [
  `# Learn move-support diff — ${retrievedOn}`, "", ...(warning ? [`> **${warning}**`, ""] : []), `Source: ${source} · matrix rows: ${matrix.length} · rules checked: ${loaded.rules.length}`, "",
  `## Disagreements (${diffs.length})`, "", "| Rule | Field | Rule says | Learn says | Learn cell |", "|---|---|---|---|---|",
  ...diffs.map((d) => `| ${d.ruleId} | ${d.field} | ${d.rule} | ${d.learn} | ${escapeTableCell(learnCell(d))}${d.learnVariant ? ` (Learn row labelled "${escapeTableCell(d.learnVariant.slice(0, 60))}")` : ""} |`),
  "", `## Resource types in the matrix without a rule (${uncovered.length})`, "", ...uncovered.slice(0, 200).map((u) => `- ${u}`),
  "", `## Rule types not found in the matrix (${notInMatrix.length})`, "", ...notInMatrix.map((u) => `- ${u}`),
  "", `## Learn rows that name a product, not a resource type (${notTypes.length})`, "",
  ...(notTypes.length ? ["These rows are left out of the comparison above; a resource type never contains a space.", "", ...notTypes.map((u) => `- ${u}`)] : []),
  "", "Region-move disagreements are expected where a rule encodes a service-native relocation path rather than Resource Mover support. Review each row; update `scripts/author-rules.mjs`, bump `ruleVersion`, set `retrievedOn`, regenerate and re-snapshot.", "",
].join("\n");
writeFileSync(join(outDir, "learn-diff.md"), md);
console.log(`diffs=${diffs.length} uncovered=${uncovered.length} notInMatrix=${notInMatrix.length} notTypes=${notTypes.length} -> ${outDir}/learn-diff.md`);
process.exit(0);
