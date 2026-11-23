import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultIntent, type NormalizedResource } from "@amo/domain";
import { loadRules, defaultRulesDir } from "@amo/evidence-engine";
import { SAMPLE_PROFILE } from "@amo/landing-zone";
import { classifyResource, planWaves, summarize, UNAUTHENTICATED_CONFIDENCE_CAP, type ClassifyContext } from "./index.js";

const rules = loadRules(defaultRulesDir());
const SUB = "11111111-2222-3333-4444-555555555555";
function res(type: string, name: string, extra: Partial<NormalizedResource> = {}): NormalizedResource {
  const id = `/subscriptions/${SUB}/resourceGroups/rg/providers/${type}/${name}`;
  return { key: id.toLowerCase(), resourceId: id, name, type, provider: type.split("/")[0], resourceGroup: "rg", location: "eastus", subscriptionName: "s", subscriptionId: SUB, kind: null, sku: null, status: null, tags: {}, parsedId: { valid: true, issues: [], fullType: type, name, subscriptionId: SUB, resourceGroup: "rg" }, provenance: [{ normalizedHeader: "name", normalizedValue: name, transformation: "trim", evidence: "observed-from-csv" }], warnings: [], sourceRow: 2, ...extra };
}
function ctx(intent: Partial<Parameters<typeof defaultIntent>[0]> = {}, authenticated = false): ClassifyContext {
  return { edition: authenticated ? "enterprise" : "demo", authenticated, intent: defaultIntent({ destinationRegion: "westus3", sameTenant: true, ...intent }), profile: SAMPLE_PROFILE, rules, dependencies: new Map(), sequence: new Map(), today: "2026-10-03" };
}

test("storage account region relocation is recreate-and-migrate with a separate data path", () => {
  const d = classifyResource(res("Microsoft.Storage/storageAccounts", "stapp01"), ctx());
  assert.equal(d.disposition, "recreate-and-migrate");
  assert.equal(d.dataDisposition, "sync-and-cutover");
  // The HCW organizational overlay (rules/organization/hcw-standards.json, precedence 100) prefers Storage Mover over AzCopy.
  assert.equal(d.recommendedTool, "azure-storage-mover");
  assert.equal(d.ruleId, "org.hcw.storage.storageaccounts.region");
  assert.ok(d.alternativeMethods.includes("azcopy"));
  assert.ok(d.reasonCodes.includes("REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED"));
  assert.ok(d.secondaryActions.some((s) => s.startsWith("Data path")));
  assert.equal(d.humanApprovalRequired, true);
});

test("VM region relocation uses Resource Mover; ASR never appears as the migration tool", () => {
  const d = classifyResource(res("Microsoft.Compute/virtualMachines", "vm1"), ctx());
  assert.equal(d.recommendedTool, "azure-resource-mover");
  assert.notEqual(d.recommendedTool, "azure-site-recovery");
  assert.ok(d.secondaryActions.some((s) => s.includes("This is DR, not migration")));
});

test("same-subscription resource-group move of a VM is native", () => {
  const d = classifyResource(res("Microsoft.Compute/virtualMachines", "vm1"), ctx({ desiredOperation: "resource-group-move" }));
  assert.equal(d.disposition, "native-move");
  assert.equal(d.recommendedTool, "arm-move");
});

test("cross-tenant managed identity is recreate-only with identity reconstruction", () => {
  const d = classifyResource(res("Microsoft.ManagedIdentity/userAssignedIdentities", "id1"), ctx({ sameTenant: false }));
  assert.equal(d.desiredOperation, "cross-tenant-migration");
  assert.equal(d.disposition, "recreate-only");
  assert.equal(d.identityDisposition, "reconstruct");
  assert.ok(d.crossTenantImplications.length > 0);
});

test("unknown type yields unknown-requires-validation, never a fabricated disposition", () => {
  const d = classifyResource(res("Microsoft.Quantum/workspaces", "q1"), ctx());
  assert.equal(d.disposition, "unknown-requires-validation");
  assert.ok(d.reasonCodes.includes("NO_RULE_FOR_TYPE"));
  assert.equal(d.confidence.band, "low");
});

test("unauthenticated confidence is capped; authenticated is not", () => {
  const rg = res("Microsoft.Resources/resourceGroups", "rg");
  assert.ok(classifyResource(rg, ctx()).confidence.score <= UNAUTHENTICATED_CONFIDENCE_CAP);
  assert.ok(classifyResource(rg, ctx({}, true)).confidence.score > UNAUTHENTICATED_CONFIDENCE_CAP);
});

test("private DNS zone region relocation is retain (global resource)", () => {
  const d = classifyResource(res("Microsoft.Network/privateDnsZones", "privatelink.blob.core.windows.net"), ctx());
  assert.equal(d.disposition, "retain");
  assert.ok(d.reasonCodes.includes("GLOBAL_RESOURCE"));
});

test("downtime tolerance 'none' blocks patterns that imply downtime", () => {
  const d = classifyResource(res("Microsoft.Storage/storageAccounts", "st"), ctx({ downtimeTolerance: "none", rtoHours: 1 }));
  assert.ok(d.blockers.some((b) => b.includes("Downtime tolerance")));
  assert.equal(d.rtoCompatibility, "unsupported");
});

test("waves and summary", () => {
  const ds = [res("Microsoft.Network/virtualNetworks", "vnet"), res("Microsoft.Storage/storageAccounts", "st"), res("Microsoft.Compute/virtualMachines", "vm"), res("Microsoft.Quantum/workspaces", "q")].map((r) => classifyResource(r, ctx()));
  const plan = planWaves(ds);
  assert.equal(plan.waves[0].resourceKeys.length, 1);
  assert.ok(plan.waves.find((w) => w.number === 6)?.resourceKeys.length === 1);
  const s = summarize(ds, "demo", false);
  assert.equal(s.resourceCount, 4);
  assert.equal(s.unknownCount, 1);
  assert.ok(s.disclaimers[0].includes("Migration Explorer"));
});

test("per-operation confidence differs by support state", () => {
  const d = classifyResource(res("Microsoft.Web/serverFarms", "asp"), ctx());
  const c = d.confidenceByOperation;
  assert.ok(c["region-relocation"].score < c["resource-group-move"].score || c["resource-group-move"].band !== "low");
  assert.equal(c["disaster-recovery"].band, "low");
  // Disks: resource group move supported, cross-tenant unsupported. (Virtual machines were the example until their resource
  // group move became conditional on 2026-11-22; a conditional operation loses 0.1, more than an unsupported one's 0.05.)
  const disk = classifyResource(res("Microsoft.Compute/disks", "disk"), ctx({}, true)); // authenticated: cap would otherwise equalise them
  assert.ok(disk.confidenceByOperation["cross-tenant-migration"].score < disk.confidenceByOperation["resource-group-move"].score);
});

test("an application-group tag key named like a built-in object member reads only the resource's own tags", () => {
  const plain = classifyResource(res("Microsoft.Storage/storageAccounts", "st1"), ctx({ applicationGroupTagKey: "constructor" }));
  assert.equal(plain.applicationGroup, null, "no tag called constructor: no application group");
  const tags: Record<string, string> = {};
  Object.defineProperty(tags, "constructor", { value: "billing", enumerable: true, writable: true, configurable: true });
  const tagged = classifyResource(res("Microsoft.Storage/storageAccounts", "st2", { tags }), ctx({ applicationGroupTagKey: "constructor" }));
  assert.equal(tagged.applicationGroup, "billing");
});
