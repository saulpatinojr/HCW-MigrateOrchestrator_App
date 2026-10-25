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

// [VERIFY] Source paths in MicrosoftDocs/azure-docs. The support tables are maintained as include files; adjust if moved.
const SOURCES = [
  "https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/includes/azure-resource-manager/move-support-resources.md",
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
const loaded = loadRules(defaultRulesDir());
const { diffs, uncovered, notInMatrix } = diffRulesAgainstMatrix(loaded.rules, matrix);
mkdirSync(outDir, { recursive: true });
const retrievedOn = new Date().toISOString().slice(0, 10);
const report = { retrievedOn, source, matrixRows: matrix.length, rulesChecked: loaded.rules.length, diffs, uncoveredTypesInMatrix: uncovered, ruleTypesNotInMatrix: notInMatrix };
writeFileSync(join(outDir, "learn-diff.json"), JSON.stringify(report, null, 2) + "\n");
const md = [
  `# Learn move-support diff — ${retrievedOn}`, "", `Source: ${source} · matrix rows: ${matrix.length} · rules checked: ${loaded.rules.length}`, "",
  `## Disagreements (${diffs.length})`, "", "| Rule | Field | Rule says | Learn says | Learn cell |", "|---|---|---|---|---|",
  ...diffs.map((d) => `| ${d.ruleId} | ${d.field} | ${d.rule} | ${d.learn} | ${escapeTableCell(d.learnRaw.slice(0, 80))} |`),
  "", `## Resource types in the matrix without a rule (${uncovered.length})`, "", ...uncovered.slice(0, 200).map((u) => `- ${u}`),
  "", `## Rule types not found in the matrix (${notInMatrix.length})`, "", ...notInMatrix.map((u) => `- ${u}`),
  "", "Region-move disagreements are expected where a rule encodes a service-native relocation path rather than Resource Mover support. Review each row; update `scripts/author-rules.mjs`, bump `ruleVersion`, set `retrievedOn`, regenerate and re-snapshot.", "",
].join("\n");
writeFileSync(join(outDir, "learn-diff.md"), md);
console.log(`diffs=${diffs.length} uncovered=${uncovered.length} notInMatrix=${notInMatrix.length} -> ${outDir}/learn-diff.md`);
process.exit(0);
