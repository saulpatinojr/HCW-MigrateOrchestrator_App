import { test } from "node:test";
import assert from "node:assert/strict";
import type { MigrationRule } from "@amo/domain";
import { parseLearnMoveSupport, normalizeLearnCell, diffRulesAgainstMatrix, loadRules, defaultRulesDir } from "./index.js";

// The live page (articles/azure-resource-manager/management/move-support-resources.md, read 2026-11-18) puts every table
// inside a `> [!div class="mx-tableFixed"]` quote block, so each table line starts with "> ". This fixture keeps that layout.
const FIXTURE = `## Microsoft.Compute

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | availabilitysets | **Yes** | **Yes** | Yes |
> | disks | **Yes** | **Yes** | Yes <br><br> Use [Azure Resource Mover](../../resource-mover/tutorial-move-region-virtual-machines.md) to move Azure VMs and related disks. |
> | virtualmachinescalesets | **Yes** | **Yes** | No |

## Microsoft.Storage

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | storageaccounts | **Yes** | **Yes** | No <br><br> [Move an Azure Storage account to another region](../../storage/common/storage-account-move.md) |
> | storageaccounts / something | Pending | Pending | No |
> | storageaccounts / tableservices | Yes | Yes | No |
`;

// A provider section with two tables, the second after a note and without a heading of its own: the shape of the live
// Microsoft.Compute section, whose Cloud Services (extended support) table repeats "virtualmachines" with Region move "No".
const TWO_TABLE_SECTION = `## Microsoft.Compute

> [!IMPORTANT]
> See [guidance for moving virtual machines to resource groups or subscriptions](./move-limitations/virtual-machines-move-limitations.md) to learn more.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | virtualmachines | **Yes** | **Yes** | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move-region-virtual-machines.md) to move Azure Virtual Machines. |


> [!IMPORTANT]
> Specific operations can help to move Cloud Services (extended support) deployment model resources across subscriptions. See the corresponding [move guidance](./move-limitations/cloud-services-extended-support.md) to learn more.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | domainnames | **Yes** | No | No |
> | virtualmachines | **Yes** | **Yes** | No |
> | domainnames | No | No | No |
`;

// Links on the page are relative to the article; rows carry them as absolute Learn addresses.
const MGMT = "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management";

const rule = (ruleId: string, resourceType: string, support: Omit<MigrationRule["support"], "crossTenant">): MigrationRule =>
  ({ ruleId, resourceType, support: { ...support, crossTenant: "unknown" } }) as unknown as MigrationRule;

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

test("a table inside a quote block parses the same as a bare table", () => {
  const quoted = parseLearnMoveSupport(FIXTURE);
  const bare = parseLearnMoveSupport(FIXTURE.replace(/^> ?/gm, ""));
  assert.equal(quoted.length, 6, "quoted rows are read");
  assert.deepEqual(quoted, bare);
  // ">" with no space after it, as the live Microsoft.RecoveryServices section writes its note.
  const tight = parseLearnMoveSupport("## Microsoft.RecoveryServices\n\n>| Resource type | Resource group | Subscription | Region move |\n>| --- | --- | --- | --- |\n>| vaults | **Yes** | **Yes** | No |\n");
  assert.equal(tight.length, 1);
  assert.equal(tight[0].resourceType, "microsoft.recoveryservices/vaults");
});

test("provider headings match case-insensitively, so rows are not attributed to the section above", () => {
  const rows = parseLearnMoveSupport(`## Microsoft.AAD

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | domainservices | No | No |  No |

## microsoft.aadiam

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | tenants | **Yes** | **Yes** | No |
`);
  assert.deepEqual(rows.map((r) => r.resourceType), ["microsoft.aad/domainservices", "microsoft.aadiam/tenants"]);
  assert.equal(rows[1].provider.toLowerCase(), "microsoft.aadiam");
});

test("a heading that is not a provider ends the section, so later rows are not attributed to the provider above", () => {
  const rows = parseLearnMoveSupport(`## Microsoft.Web

| Resource type | Resource group | Subscription | Region move |
| --- | --- | --- | --- |
| sites | **Yes** | **Yes** | No |

## Next steps

| Resource type | Resource group | Subscription | Region move |
| --- | --- | --- | --- |
| something | Yes | Yes | No |
`);
  assert.deepEqual(rows.map((r) => r.resourceType), ["microsoft.web/sites"]);
});

test("a second table in the same provider section is numbered, and the first row for a type wins the diff", () => {
  const rows = parseLearnMoveSupport(TWO_TABLE_SECTION);
  const vms = rows.filter((r) => r.resourceType === "microsoft.compute/virtualmachines");
  assert.equal(vms.length, 2, "the parser keeps both rows");
  assert.equal(rows.length, 4);
  assert.deepEqual(vms.map((r) => r.tableInSection), [0, 1]);
  assert.equal(vms[0].regionRelocation, "conditional");
  assert.equal(vms[1].regionRelocation, "unsupported");

  const { diffs, uncovered } = diffRulesAgainstMatrix(
    [rule("t.vm", "Microsoft.Compute/virtualMachines", { resourceGroupMove: "conditional", subscriptionMove: "conditional", regionRelocation: "conditional" })],
    rows,
  );
  assert.deepEqual(diffs, [], "region move is read from the virtual machines table, not the Cloud Services one");
  assert.deepEqual(uncovered, ["microsoft.compute/domainnames"], "a type is listed once");
  assert.equal(rows.find((r) => r.resourceType === "microsoft.compute/domainnames")?.raw.rg, "**Yes**", "find, like the diff, meets the first row");
});

test("a plain Yes under a section note that links move guidance reads as conditional, and the diff names the guidance", () => {
  const rows = parseLearnMoveSupport(TWO_TABLE_SECTION);
  const vm = rows[0];
  assert.equal(vm.raw.rg, "**Yes**");
  assert.equal(vm.resourceGroupMove, "conditional");
  assert.equal(vm.subscriptionMove, "conditional");
  assert.equal(vm.guidance?.url, `${MGMT}/move-limitations/virtual-machines-move-limitations`);
  assert.match(vm.guidance?.text ?? "", /guidance for moving virtual machines/);
  assert.equal(rows[1].guidance?.url, `${MGMT}/move-limitations/cloud-services-extended-support`, "each table takes the note just above it");
  assert.equal(rows[1].subscriptionMove, "unsupported", "a No stays a No under guidance");

  const { diffs } = diffRulesAgainstMatrix(
    [rule("t.vm", "Microsoft.Compute/virtualMachines", { resourceGroupMove: "supported", subscriptionMove: "conditional", regionRelocation: "conditional" })],
    rows,
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "resourceGroupMove");
  assert.equal(diffs[0].learn, "conditional");
  assert.equal(diffs[0].learnGuidance, `${MGMT}/move-limitations/virtual-machines-move-limitations`);
});

test("a section note with no guidance link leaves a plain Yes as supported", () => {
  const rows = parseLearnMoveSupport(`## Microsoft.Sql

> [!IMPORTANT]
> A database and server must be in the same resource group. When you move a SQL server, all of its databases move also.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | servers | **Yes** | **Yes** | **Yes** |
`);
  assert.equal(rows[0].resourceGroupMove, "supported");
  assert.equal(rows[0].guidance, undefined);
});

test("a linked note that is not about moving is not guidance, and does not hide the guidance note above it", () => {
  // The live Microsoft.Cache section: a networking move note, then a retirement note, then the table.
  const cache = `## Microsoft.Cache

> [!IMPORTANT]
> If the Azure Cache for Redis instance is configured with a virtual network, the instance can't be moved to a different subscription. See [Networking move limitations](./move-limitations/networking-move-limitations.md) to learn more.

> [!NOTE]
> Azure Cache for Redis is being retired. For more information, see [Azure Cache for Redis retirement FAQ](/azure/azure-cache-for-redis/retirement-faq).

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | redis | **Yes** | **Yes** | No |
`;
  assert.equal(parseLearnMoveSupport(cache)[0].guidance?.url, `${MGMT}/move-limitations/networking-move-limitations`);
  const retirementOnly = cache.replace(/> \[!IMPORTANT\]\n> If the Azure Cache[^\n]*\n\n/, "");
  const [redis] = parseLearnMoveSupport(retirementOnly);
  assert.equal(redis.guidance, undefined);
  assert.equal(redis.resourceGroupMove, "supported");
});

test("diff against the real corpus surfaces disagreements and uncovered types without false alarms on agreement", () => {
  const loaded = loadRules(defaultRulesDir());
  const { diffs, uncovered } = diffRulesAgainstMatrix(loaded.rules, parseLearnMoveSupport(FIXTURE));
  assert.ok(!diffs.some((d) => d.ruleId === "azure.storage.storageaccounts"), "storage rule agrees with fixture");
  // A plain "Yes, Yes" row against a rule that says supported, supported. (Scale sets were the example until their rule became
  // conditional on 2026-11-22, under the guidance note that this fixture leaves out.)
  assert.ok(!diffs.some((d) => d.ruleId === "azure.compute.availabilitysets" && d.field !== "regionRelocation"));
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
  // Only the region column is under test. Resource group and subscription are pinned to match the fixture's plain "Yes", so the
  // test does not depend on the corpus: the real rule says "conditional" for both since #136.
  const rule = { ...vm, support: { ...vm.support, resourceGroupMove: "supported" as const, subscriptionMove: "supported" as const, regionRelocation: "unsupported" as const } };
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

test("a table inside an HTML comment is not on the rendered page and is skipped", () => {
  // The live Microsoft.Maintenance section keeps an old table inside <!-- -->, with values the visible table contradicts.
  const rows = parseLearnMoveSupport(`## Microsoft.Maintenance

<!-- > [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | maintenanceconfigurations | **Yes** | **Yes** | **Yes**. [Learn more](../../virtual-machines/x.md) |
> | updates | No | No | No | -->

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | maintenanceconfigurations | No | No | No |
> | updates | No | No | No |
`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.resourceGroupMove, r.tableInSection]), [["unsupported", 0], ["unsupported", 0]]);
});

test("a note with more than one paragraph is read whole", () => {
  const rows = parseLearnMoveSupport(`## Microsoft.HDInsight

> [!IMPORTANT]
> You can move clusters to a new subscription or resource group.
>
> See [cluster move guidance](./move-limitations/hdinsight.md) to learn more.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | clusters | **Yes** | **Yes** | No |
`);
  assert.equal(rows[0].guidance?.url, `${MGMT}/move-limitations/hdinsight`);
  assert.equal(rows[0].resourceGroupMove, "conditional");
});

test("a bulleted note with no space after '>' is read, and links elsewhere on Learn resolve to absolute addresses", () => {
  // The live Microsoft.RecoveryServices note; its second bullet is about region moves and does not replace the first.
  const rows = parseLearnMoveSupport(`## Microsoft.RecoveryServices

>[!IMPORTANT]
>- See [Recovery Services vault move guidance](../../backup/backup-azure-move-recovery-services-vault.md?toc=/azure/azure-resource-manager/toc.json) to learn more.
>- See [Relocate Azure Backup to another region](../../backup/azure-backup-move-vaults-across-regions.md?toc=/azure/azure-resource-manager/toc.json) to learn more.

> [!div class="mx-tableFixed"]
> | Resource type | Resource group | Subscription | Region move |
> | ------------- | ----------- | ---------- | ----------- |
> | vaults | **Yes** | **Yes** | No |
`);
  assert.equal(rows[0].guidance?.url, "https://learn.microsoft.com/en-us/azure/backup/backup-azure-move-recovery-services-vault");
  assert.equal(rows[0].resourceGroupMove, "conditional");
  const site = parseLearnMoveSupport("## Microsoft.VisualStudio\n\n> [!IMPORTANT]\n> See [Manage billing](/azure/devops/organizations/billing/change-azure-subscription?toc=/azure/azure-resource-manager/toc.json) to learn how to change the subscription for Azure DevOps.\n\n| Resource type | Resource group | Subscription | Region move |\n| --- | --- | --- | --- |\n| account | Yes | Yes | No |\n");
  assert.equal(site[0].guidance?.url, "https://learn.microsoft.com/en-us/azure/devops/organizations/billing/change-azure-subscription");
});

test("a link that is not introduced by 'See' is not guidance, even in a note that mentions moving", () => {
  const rows = parseLearnMoveSupport(`## Microsoft.Example

> [!NOTE]
> As you can see, this service is being retired. Read the [retirement FAQ](./faq.md) before you move anything.

| Resource type | Resource group | Subscription | Region move |
| --- | --- | --- | --- |
| things | Yes | Yes | No |
`);
  assert.equal(rows[0].guidance, undefined);
  assert.equal(rows[0].resourceGroupMove, "supported");
});

test("a separator row with alignment colons is not read as a resource type", () => {
  const rows = parseLearnMoveSupport("## Microsoft.Storage\n\n| Resource type | Resource group | Subscription | Region move |\n| :--- | :---: | ---: | --- |\n| storageaccounts | Yes | Yes | No |\n");
  assert.deepEqual(rows.map((r) => r.resourceType), ["microsoft.storage/storageaccounts"]);
});

test("an unclosed HTML comment hides the rest of the page, as a browser does", () => {
  const rows = parseLearnMoveSupport(`## Microsoft.Storage

| Resource type | Resource group | Subscription | Region move |
| --- | --- | --- | --- |
| storageaccounts | Yes | Yes | No |
<!-- an old note that was never closed
| blobservices | Yes | Yes | No |
`);
  assert.deepEqual(rows.map((r) => r.resourceType), ["microsoft.storage/storageaccounts"]);
});

test("removing HTML comments takes time in proportion to the page, even with many unclosed openings (CodeQL alert 27)", { timeout: 5000 }, () => {
  // A regex that searches for "-->" from every "<!--" takes time in the square of the length: 40,000 openings took 3.6 s.
  const started = performance.now();
  assert.deepEqual(parseLearnMoveSupport("<!--".repeat(200_000)), []);
  assert.ok(performance.now() - started < 2000, "200,000 unclosed openings are read in well under two seconds");
});

test("a malformed or off-site link in a guidance note neither throws nor counts as guidance (found by the property tests)", () => {
  const page = (href: string) => `## Microsoft.X\n\n> [!IMPORTANT]\n> See [move guidance](${href}) to learn more.\n\n| Resource type | Resource group | Subscription | Region move |\n| --- | --- | --- | --- |\n| things | Yes | Yes | No |\n`;
  for (const href of ["http://[", "javascript:alert(1", "//evil.example/move", "https://learn.microsoft.com.evil.example/x", "http://learn.microsoft.com/x"]) {
    const [row] = parseLearnMoveSupport(page(href));
    assert.equal(row.guidance, undefined, href);
    assert.equal(row.resourceGroupMove, "supported", href);
  }
  const [learn] = parseLearnMoveSupport(page("./move-limitations/x.md"));
  assert.equal(learn.guidance?.url, "https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/x");
});
