import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules, defaultRulesDir } from "@amo/evidence-engine";

// Runs scripts/refresh-rules-from-learn.mjs offline (--from a local file), the same way the rules-refresh workflow runs
// it against Microsoft Learn. Needs the build (`npm test` builds first) because the script imports @amo/evidence-engine.
// `reviewed` is the text of a reviewed-decisions file for this run; without it the script reads the repository's own
// rules/reports/learn-diff-reviewed.json, as the workflow does.
const run = (markdown, reviewed) => {
  const dir = mkdtempSync(join(tmpdir(), "amo-learn-refresh-"));
  try {
    const from = join(dir, "page.md");
    const out = join(dir, "out");
    writeFileSync(from, markdown);
    const extra = [];
    if (reviewed !== undefined) {
      writeFileSync(join(dir, "reviewed.json"), reviewed);
      extra.push("--reviewed", join(dir, "reviewed.json"));
    }
    const res = spawnSync(process.execPath, ["scripts/refresh-rules-from-learn.mjs", "--from", from, "--out", out, ...extra], { encoding: "utf8" });
    let report;
    let md;
    try { report = JSON.parse(readFileSync(join(out, "learn-diff.json"), "utf8")); } catch { report = undefined; }
    try { md = readFileSync(join(out, "learn-diff.md"), "utf8"); } catch { md = undefined; }
    return { status: res.status, stderr: res.stderr, report, md };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("a page the parser reads no rows from fails the run, so a broken parse cannot look like agreement", () => {
  const { status, stderr, report } = run("## Microsoft.Compute\n\nThe tables moved somewhere else.\n");
  assert.notEqual(status, 0);
  assert.match(stderr, /0 rows/);
  assert.equal(report, undefined, "no report is written that says 0 disagreements");
});

test("a quoted table, as on the live Learn page, produces a report with rows", () => {
  const { status, report } = run(`## Microsoft.Storage

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | storageaccounts | **Yes** | **Yes** | No |
`);
  assert.equal(status, 0);
  assert.equal(report.matrixRows, 1);
});

test("a plain Yes under a guidance note is reported as 'Yes, with guidance' with the absolute Learn link", () => {
  // azure.compute.disks in rules/azure says resource group move is supported; under the note Learn's Yes is conditional.
  const { status, md } = run(`## Microsoft.Compute

> [!IMPORTANT]
> See [guidance for moving virtual machines to resource groups or subscriptions](./move-limitations/virtual-machines-move-limitations.md) to learn more.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | disks | **Yes** | **Yes** | **Yes** <br/><br/> Use Azure Resource Mover. |
`);
  assert.equal(status, 0);
  assert.match(md, /\| azure\.compute\.disks \| resourceGroupMove \| supported \| conditional \| Yes, with guidance \(https:\/\/learn\.microsoft\.com\/en-us\/azure\/azure-resource-manager\/management\/move-limitations\/virtual-machines-move-limitations\) \|/);
});

test("a page that matches few of the rule types gets a warning at the top of the report", () => {
  const { status, md, stderr } = run(`## Microsoft.Storage

| Resource type | Resource group | Subscription | Region move |
| --- | --- | --- | --- |
| storageaccounts | Yes | Yes | No |
`);
  assert.equal(status, 0);
  assert.match(md, /Warning: .* rule types were not found/);
  assert.match(stderr, /warning/i);
});

test("the script's sources no longer include the include-file URL that answers 404", () => {
  const src = readFileSync("scripts/refresh-rules-from-learn.mjs", "utf8");
  const sources = src.match(/const SOURCES = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert.ok(!/\/includes\//.test(sources));
  assert.match(sources, /\/articles\/azure-resource-manager\/management\/move-support-resources\.md/);
});

// Issue 132: the tables on the live page sit inside one quote block. If Learn ever nests them in a second one, the report
// must still read them; before this test the parser removed one ">" only and such a page read as 0 rows.
test("a table quoted twice still produces a report with rows", () => {
  const { status, report } = run(`## Microsoft.Storage

> > [!div class="mx-tableFixed"]
> > | Resource type | Resource group | Subscription | Region move |
> > | ------------- | ----------- | ---------- | ----------- |
> > | storageaccounts | **Yes** | **Yes** | No |
`);
  assert.equal(status, 0);
  assert.equal(report.matrixRows, 1);
});

// azure.compute.disks says "supported" for all three moves, so this page disagrees with it twice: once on the resource
// group move and once on the subscription move.
const DISKS_PAGE = `## Microsoft.Compute

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | disks | No | Yes - with restrictions | **Yes** |
`;
const decision = (over = {}) => JSON.stringify({ reviewed: [{ ruleId: "azure.compute.disks", field: "resourceGroupMove", rule: "supported", learn: "unsupported", reason: "Checked by hand | example reason.", decidedIn: "https://example.invalid/decision", decidedOn: "2026-01-02", ...over }] });

test("a reviewed disagreement is shown with its reason, apart from the new ones", () => {
  const { status, report, md } = run(DISKS_PAGE, decision());
  assert.equal(status, 0);
  assert.equal(report.diffs.length, 2, "nothing is hidden: both disagreements are in the report");
  assert.equal(report.newDiffs, 1);
  assert.equal(report.reviewedDiffs, 1);
  assert.deepEqual(report.reviewedNoLongerFound, []);
  const [fresh, kept] = md.split("### Reviewed and kept as they are (1)");
  assert.match(fresh, /\*\*1 new disagreement needs a decision\.\*\*/);
  assert.match(fresh, /### New, not yet reviewed \(1\)[\s\S]*\| azure\.compute\.disks \| subscriptionMove \| supported \| conditional \|/);
  assert.doesNotMatch(fresh, /\| azure\.compute\.disks \| resourceGroupMove \|/);
  // The pipe in the reason is escaped, so it cannot split the table row.
  assert.match(kept, /\| azure\.compute\.disks \| resourceGroupMove \| supported \| unsupported \| No \| Checked by hand \\\| example reason\. \| 2026-01-02, https:\/\/example\.invalid\/decision \|/);
});

test("without any reviewed decision every disagreement is new", () => {
  const { status, report, md } = run(DISKS_PAGE, JSON.stringify({ reviewed: [] }));
  assert.equal(status, 0);
  assert.equal(report.newDiffs, 2);
  assert.equal(report.reviewedDiffs, 0);
  assert.match(md, /\*\*2 new disagreements need a decision\.\*\*/);
});

test("a decision stops covering a row when the rule or Learn's value changes, and the report says the decision is unused", () => {
  // The decision was made when Learn said "conditional"; the page now says "No" (unsupported), which nobody has reviewed.
  const { status, report, md } = run(DISKS_PAGE, decision({ learn: "conditional" }));
  assert.equal(status, 0);
  assert.equal(report.newDiffs, 2);
  assert.equal(report.reviewedDiffs, 0);
  assert.equal(report.reviewedNoLongerFound.length, 1);
  assert.match(md, /### Earlier decisions that no longer match a disagreement \(1\)[\s\S]*- azure\.compute\.disks resourceGroupMove/);
});

test("a reviewed-decisions file that cannot be read stops the run instead of treating every row as new or as reviewed", () => {
  for (const [text, why] of [["{ not json", /not valid JSON/], [JSON.stringify({ decisions: [] }), /"reviewed" list/], [decision({ reason: " " }), /non-empty "reason"/], [decision({ field: "tenantMove" }), /unknown field/]]) {
    const { status, stderr, report } = run(DISKS_PAGE, text);
    assert.notEqual(status, 0);
    assert.match(stderr, why);
    assert.equal(report, undefined, "no report is written");
  }
});

test("every decision in the repository's reviewed file names a real rule and the value that rule has today", () => {
  // An entry whose rule has since changed would sit in the file unused; this fails in the pull request that changes the rule.
  const { reviewed } = JSON.parse(readFileSync("rules/reports/learn-diff-reviewed.json", "utf8"));
  const rules = new Map(loadRules(defaultRulesDir()).rules.map((r) => [r.ruleId, r]));
  assert.ok(reviewed.length > 0);
  for (const r of reviewed) {
    const rule = rules.get(r.ruleId);
    assert.ok(rule, `${r.ruleId} is not a rule`);
    assert.equal(rule.support[r.field], r.rule, `${r.ruleId} ${r.field}`);
    assert.notEqual(r.rule, r.learn, `${r.ruleId} ${r.field} is not a disagreement`);
    assert.match(r.decidedIn, /^https:\/\/github\.com\/saulpatinojr\/HCW-MigrateOrchestrator_App\/(pull|issues)\/\d+/);
    assert.match(r.decidedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("the committed report was written by this script: its counts add up and every reviewed row carries a reason", () => {
  const report = JSON.parse(readFileSync("rules/reports/learn-diff.json", "utf8"));
  assert.ok(report.matrixRows > 700, "the live page has more than 700 rows (issue 132)");
  assert.equal(report.newDiffs + report.reviewedDiffs, report.diffs.length);
  assert.equal(report.diffs.filter((d) => d.reviewed?.reason).length, report.reviewedDiffs);
});
