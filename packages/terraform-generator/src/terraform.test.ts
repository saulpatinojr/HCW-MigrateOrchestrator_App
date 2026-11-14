import { test } from "node:test";
import assert from "node:assert/strict";
import type { Assessment, ResourceDecisionRecord } from "@amo/domain";
import { computeNewId, stateImpactEntries, generateStateImpact, generateHcpFiles, buildArgumentManifest, checkArguments, FileSchemaSource, McpSchemaSource } from "./index.js";

const SUB = "00000000-0000-0000-0000-000000000001";
const dec = (p: Partial<ResourceDecisionRecord>): ResourceDecisionRecord => ({ displayName: "x", resourceType: "Microsoft.Storage/storageAccounts", resourceId: `/subscriptions/${SUB}/resourceGroups/rg-a/providers/Microsoft.Storage/storageAccounts/stx`, disposition: "native-move", recommendedTool: "arm-move", infrastructureDisposition: "move-with-resource", kind: null, ...p } as ResourceDecisionRecord);
const asm = (intent: Partial<Assessment["intent"]>, decisions: ResourceDecisionRecord[]): Assessment => ({ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", applicationVersion: "0.3.0", intent: { desiredOperation: "resource-group-move", destinationSubscriptionId: null, destinationResourceGroup: null, ...intent } as Assessment["intent"], decisions } as Assessment);

test("new ID computed for RG move when destination RG known; template otherwise", () => {
  const a = asm({ destinationResourceGroup: "rg-b" }, []);
  assert.deepEqual(computeNewId(`/subscriptions/${SUB}/resourceGroups/rg-a/providers/Microsoft.Storage/storageAccounts/stx`, a), { id: `/subscriptions/${SUB}/resourceGroups/rg-b/providers/Microsoft.Storage/storageAccounts/stx`, template: false });
  const t = computeNewId(`/subscriptions/${SUB}/resourceGroups/rg-a/providers/x/y/z`, asm({ desiredOperation: "subscription-move" }, []));
  assert.equal(t.template, true);
  assert.ok(t.id?.includes("__DESTINATION_SUBSCRIPTION_ID__"));
  assert.ok(!t.id?.includes("${"), "placeholders must never be HCL interpolation sequences");
});

test("state impact classifies arm-move, recreate, retain and unknown; removed blocks never destroy", () => {
  const a = asm({ destinationResourceGroup: "rg-b" }, [
    dec({ displayName: "stx" }),
    dec({ displayName: "func", resourceType: "Microsoft.Web/sites", kind: "functionapp,linux", disposition: "recreate-and-migrate", recommendedTool: "application-deployment", infrastructureDisposition: "recreate" }),
    dec({ displayName: "zone", resourceType: "Microsoft.Network/privateDnsZones", disposition: "retain", recommendedTool: "none" }),
    dec({ displayName: "q", resourceType: "Microsoft.Quantum/workspaces", disposition: "unknown-requires-validation", recommendedTool: "none" }),
  ]);
  const e = stateImpactEntries(a);
  assert.equal(e[0].kind, "id-changes-same-resource");
  assert.equal(e[1].kind, "new-resource-recreated");
  assert.equal(e[1].terraformType, "azurerm_linux_function_app");
  assert.equal(e[2].kind, "no-change");
  assert.equal(e[3].kind, "no-change"); // recommendedTool none → no-change wins before unknown; acceptable
  const files = generateStateImpact(a);
  assert.ok(files["state-impact/removed.tf"].includes("destroy = false"));
  assert.ok(files["state-impact/imports.tf"].includes("rg-b"));
  assert.ok(files["state-impact/state-mv.sh"].includes("DRY-RUN"));
});

test("HCP files: manual apply and WIF, no secrets", () => {
  const f = generateHcpFiles(asm({}, []));
  assert.ok(f["hcp/workspace.tf"].includes("auto_apply        = false"));
  assert.ok(f["hcp/workspace.tf"].includes("TFC_AZURE_PROVIDER_AUTH"));
  assert.ok(!/client_secret/i.test(f["hcp/workspace.tf"]));
});

test("argument manifest + schema check find an unknown argument", async () => {
  const manifest = buildArgumentManifest({ "modules/x/main.tf": `resource "azurerm_storage_account" "a" {\n  name                     = "x"\n  bogus_argument           = 1\n  identity {\n    type = "SystemAssigned"\n  }\n}\n` });
  assert.deepEqual(manifest.resources.azurerm_storage_account, ["bogus_argument", "identity", "name"]);
  const schema = { provider_schemas: { "registry.terraform.io/hashicorp/azurerm": { resource_schemas: { azurerm_storage_account: { block: { attributes: { name: {} }, block_types: { identity: {} } } } } } } };
  const issues = await checkArguments(manifest, new FileSchemaSource(schema));
  assert.deepEqual(issues, [{ resourceType: "azurerm_storage_account", argument: "bogus_argument", problem: "unknown-argument" }]);
  const mcp = new McpSchemaSource(async (t) => t !== "azurerm_storage_account" ? null : "## Argument Reference\n\n* `name` - (Required) x\n* `identity` - (Optional) block\n");
  assert.equal((await checkArguments(manifest, mcp)).length, 1);
  assert.equal((await checkArguments({ ...manifest, resources: { azurerm_nope: ["a"] } }, mcp))[0].problem, "unknown-resource-type");
});
