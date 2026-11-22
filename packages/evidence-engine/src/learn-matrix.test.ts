import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLearnMoveSupport, normalizeLearnCell, diffRulesAgainstMatrix, loadRules, defaultRulesDir } from "./index.js";

const FIXTURE = `## Microsoft.Compute

| Resource type | Resource group | Subscription | Region move |
| ------------- | ----------- | ---------- | ----------- |
| availabilitysets | **Yes** | **Yes** | Yes |
| disks | **Yes** | **Yes** | Yes <br><br> Use [Azure Resource Mover](../../resource-mover/tutorial-move-region-virtual-machines.md) to move Azure VMs and related disks. |
| virtualmachinescalesets | **Yes** | **Yes** | No |

## Microsoft.Storage

| Resource type | Resource group | Subscription | Region move |
| ------------- | ----------- | ---------- | ----------- |
| storageaccounts | **Yes** | **Yes** | No <br><br> [Move an Azure Storage account to another region](../../storage/common/storage-account-move.md) |
| storageaccounts / something | Pending | Pending | No |
| storageaccounts / tableservices | Yes | Yes | No |
`;

test("normalizes Learn cells", () => {
  assert.equal(normalizeLearnCell("**Yes**"), "supported");
  assert.equal(normalizeLearnCell("No"), "unsupported");
  assert.equal(normalizeLearnCell("Yes - with restrictions"), "conditional");
  assert.equal(normalizeLearnCell("Pending"), "unknown");
  assert.equal(normalizeLearnCell("Yes <br> Use Resource Mover"), "conditional");
});

test("parses provider sections and fully qualifies types", () => {
  const rows = parseLearnMoveSupport(FIXTURE);
  assert.equal(rows.length, 6);
  assert.equal(rows[4].resourceType, "microsoft.storage/storageaccounts/something");
  assert.equal(rows[0].resourceType, "microsoft.compute/availabilitysets");
  assert.equal(rows[3].resourceType, "microsoft.storage/storageaccounts");
  assert.equal(rows[3].regionRelocation, "unsupported");
  assert.equal(rows[2].regionRelocation, "unsupported");
});

test("diff against the real corpus surfaces disagreements and uncovered types without false alarms on agreement", () => {
  const loaded = loadRules(defaultRulesDir());
  const { diffs, uncovered } = diffRulesAgainstMatrix(loaded.rules, parseLearnMoveSupport(FIXTURE));
  assert.ok(!diffs.some((d) => d.ruleId === "azure.storage.storageaccounts"), "storage rule agrees with fixture");
  assert.ok(!diffs.some((d) => d.ruleId === "azure.compute.virtualmachinescalesets"));
  assert.ok(uncovered.includes("microsoft.storage/storageaccounts/tableservices"));
  assert.ok(!uncovered.includes("microsoft.storage/storageaccounts/something"), "pending rows are not actionable");
});

// Some Learn rows add a label in brackets after the type, e.g. "certificates (managed)" next to a plain "certificates"
// row, or "vpngateways (Virtual WAN)" with no plain row. Row shapes copied from move-support-resources.md, read 2026-11-22.
const LABELLED = `## Microsoft.Network

| Resource type | Resource group | Subscription | Region move |
| ------------- | ----------- | ---------- | ----------- |
| frontdoors (This row is for Front Door Classic tier only. For Front Door Standard/Premium, refer to [Microsoft.Cdn/profiles](#microsoftcdn))| No | No | No |
| vpngateways (Virtual WAN) | No | No | No |

## Microsoft.Web

| Resource type | Resource group | Subscription | Region move |
| ------------- | ----------- | ---------- | ----------- |
| certificates (managed) | No | No | No |
| certificates | No | **Yes** | No |
| sites | **Yes** | **Yes** | No |
| staticsites (preview) | **Yes** | **Yes** | No |
| staticsites (classic) | No | No | No |
`;

test("strips a trailing bracketed label from the type cell and keeps it as variant", () => {
  const rows = parseLearnMoveSupport(LABELLED);
  assert.deepEqual(rows.map((r) => [r.resourceType, r.variant]), [
    ["microsoft.network/frontdoors", "This row is for Front Door Classic tier only. For Front Door Standard/Premium, refer to Microsoft.Cdn/profiles"],
    ["microsoft.network/vpngateways", "Virtual WAN"],
    ["microsoft.web/certificates", "managed"],
    ["microsoft.web/certificates", undefined],
    ["microsoft.web/sites", undefined],
    ["microsoft.web/staticsites", "preview"],
    ["microsoft.web/staticsites", "classic"],
  ]);
  assert.ok(rows.every((r) => !/[()\s]/.test(r.resourceType)), "no label, bracket or space is left in a resource type");
  assert.ok(!("variant" in rows[3]), "a plain row has no variant key, so its JSON shape is unchanged");
  assert.equal(rows[0].provider, "Microsoft.Network");
});

test("the diff compares a rule with the unlabelled row, else the first labelled row, and lists each type once", () => {
  const [base] = loadRules(defaultRulesDir()).rules;
  type State = typeof base.support.resourceGroupMove;
  const rule = (resourceType: string, rg: State, sub: State, region: State): typeof base =>
    ({ ...base, ruleId: `test.${resourceType}`, resourceType, support: { ...base.support, resourceGroupMove: rg, subscriptionMove: sub, regionRelocation: region } });
  const rules = [
    rule("Microsoft.Web/certificates", "unsupported", "supported", "unsupported"), // agrees with the plain row only
    rule("Microsoft.Network/vpnGateways", "unsupported", "unsupported", "unsupported"), // only a labelled row exists
    rule("Microsoft.Web/staticSites", "supported", "supported", "unsupported"), // two labelled rows: the first one counts
  ];
  const { diffs, uncovered, notInMatrix } = diffRulesAgainstMatrix(rules, parseLearnMoveSupport(LABELLED));
  assert.deepEqual(diffs, [], "the managed-certificate row must not override the plain certificates row");
  assert.deepEqual(notInMatrix, [], "a type found only in a labelled row is still in the matrix");
  assert.deepEqual(uncovered, ["microsoft.network/frontdoors", "microsoft.web/sites"]);
});

test("each type without a rule is listed once, even when Learn lists it on several rows", () => {
  const { uncovered } = diffRulesAgainstMatrix([], parseLearnMoveSupport(LABELLED));
  assert.deepEqual(uncovered, ["microsoft.network/frontdoors", "microsoft.network/vpngateways", "microsoft.web/certificates", "microsoft.web/sites", "microsoft.web/staticsites"]);
});

test("when Learn lists a type on two plain rows, the diff uses the first", () => {
  // The live page lists Microsoft.Compute virtualmachines twice: the main table, then the Cloud Services table.
  const twice = `## Microsoft.Compute

| Resource type | Resource group | Subscription | Region move |
| ------------- | ----------- | ---------- | ----------- |
| virtualmachines | **Yes** | **Yes** | **Yes** <br/><br/> Use Azure Resource Mover to move Azure Virtual Machines. |
| virtualmachines | **Yes** | **Yes** | No |
`;
  const vm = loadRules(defaultRulesDir()).rules.find((r) => r.resourceType === "Microsoft.Compute/virtualMachines");
  assert.ok(vm, "the corpus has a virtual machine rule");
  const rule = { ...vm, support: { ...vm.support, regionRelocation: "unsupported" as const } };
  const { diffs } = diffRulesAgainstMatrix([rule], parseLearnMoveSupport(twice));
  assert.deepEqual(diffs.map((d) => [d.field, d.learn]), [["regionRelocation", "conditional"]], "compared with the first row, not the last");
  assert.ok(!("learnVariant" in diffs[0]), "a diff from a plain row has no learnVariant key");
});

test("a diff against a labelled row names the label", () => {
  const [base] = loadRules(defaultRulesDir()).rules;
  const rules = [{ ...base, ruleId: "test.vpngateways", resourceType: "Microsoft.Network/vpnGateways", support: { ...base.support, resourceGroupMove: "supported" as const, subscriptionMove: "unsupported" as const, regionRelocation: "unsupported" as const } }];
  const { diffs } = diffRulesAgainstMatrix(rules, parseLearnMoveSupport(LABELLED));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "resourceGroupMove");
  assert.equal(diffs[0].learnVariant, "Virtual WAN");
});
