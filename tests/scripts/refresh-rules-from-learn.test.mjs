import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs scripts/refresh-rules-from-learn.mjs offline (--from a local file), the same way the rules-refresh workflow runs
// it against Microsoft Learn. Needs the build (`npm test` builds first) because the script imports @amo/evidence-engine.
const run = (markdown) => {
  const dir = mkdtempSync(join(tmpdir(), "amo-learn-refresh-"));
  try {
    const from = join(dir, "page.md");
    const out = join(dir, "out");
    writeFileSync(from, markdown);
    const res = spawnSync(process.execPath, ["scripts/refresh-rules-from-learn.mjs", "--from", from, "--out", out], { encoding: "utf8" });
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
  // azure.compute.virtualmachines in rules/azure says resource group move is supported; under the note Learn's Yes is conditional.
  const { status, md } = run(`## Microsoft.Compute

> [!IMPORTANT]
> See [guidance for moving virtual machines to resource groups or subscriptions](./move-limitations/virtual-machines-move-limitations.md) to learn more.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | virtualmachines | **Yes** | **Yes** | **Yes** <br/><br/> Use Azure Resource Mover. |
`);
  assert.equal(status, 0);
  assert.match(md, /\| azure\.compute\.virtualmachines \| resourceGroupMove \| supported \| conditional \| Yes, with guidance \(https:\/\/learn\.microsoft\.com\/en-us\/azure\/azure-resource-manager\/management\/move-limitations\/virtual-machines-move-limitations\) \|/);
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
