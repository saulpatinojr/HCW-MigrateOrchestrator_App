import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestResourcesCsv, resourceIdFromPortalLink, parseCsv, parseResourceId, looksLikeFormula, csvSafe } from "./index.js";

const SUB = "11111111-2222-3333-4444-555555555555";
const header = "NAME,TYPE,RESOURCE GROUP,LOCATION,SUBSCRIPTION,SUBSCRIPTION ID,RESOURCE ID,TAGS";
const vmId = `/subscriptions/${SUB}/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm-app-01`;

test("parses a BOM-prefixed, quoted portal export", () => {
  const csv = `\uFEFF${header}\r\n"vm-app-01",microsoft.compute/virtualmachines,rg-app,"East US",Prod,${SUB},${vmId},"env: prod; app: billing"\r\n`;
  const r = ingestResourcesCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.resources.length, 1);
  const vm = r.resources[0];
  assert.equal(vm.type, "Microsoft.Compute/virtualMachines");
  assert.equal(vm.location, "eastus");
  assert.deepEqual(vm.tags, { env: "prod", app: "billing" });
  assert.equal(vm.parsedId.valid, true);
});

test("sniffs semicolon delimiter and rejects missing required columns", () => {
  const p = parseCsv("NAME;LOCATION\nx;y\n");
  assert.equal(p.delimiter, ";");
  const r = ingestResourcesCsv("NAME;LOCATION\nx;y\n");
  assert.ok(r.errors[0].includes("type"));
});

test("detects duplicates and formula injection", () => {
  const csv = `${header}\nvm1,Microsoft.Compute/virtualMachines,rg,eastus,s,${SUB},${vmId},\nvm1,Microsoft.Compute/virtualMachines,rg,eastus,s,${SUB},${vmId},\n=cmd|' /C calc'!A0,Microsoft.Compute/disks,rg,eastus,s,${SUB},/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Compute/disks/d1,\n`;
  const r = ingestResourcesCsv(csv);
  assert.equal(r.duplicateCount, 1);
  assert.equal(r.resources.length, 2);
  assert.ok(r.resources[1].warnings.some((w) => w.includes("formula")));
  assert.ok(csvSafe("=1+1").startsWith("'"));
  assert.equal(looksLikeFormula("-12"), false);
});

test("resource id parsing handles child resources and resource groups", () => {
  const sub = parseResourceId(`/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/sn`);
  assert.equal(sub.fullType, "Microsoft.Network/virtualNetworks/subnets");
  assert.equal(sub.name, "sn");
  assert.ok(sub.parentId?.endsWith("/virtualNetworks/vnet"));
  const rg = parseResourceId(`/subscriptions/${SUB}/resourceGroups/rg`);
  assert.equal(rg.fullType, "Microsoft.Resources/resourceGroups");
  assert.equal(parseResourceId("not-an-id").valid, false);
});

test("enforces byte and row limits", () => {
  assert.ok(ingestResourcesCsv("a,b", { maxBytes: 1 }).errors.length > 0);
  const rows = Array.from({ length: 12 }, (_, i) => `r${i},Microsoft.Compute/disks`).join("\n");
  const r = ingestResourcesCsv(`NAME,TYPE\n${rows}`, { maxRows: 5 });
  assert.ok(r.warnings.some((w) => w.includes("row limit")));
});

test("missing Resource ID column is a labelled limitation, not an error", () => {
  const r = ingestResourcesCsv("NAME,TYPE,LOCATION\nvm,Microsoft.Compute/virtualMachines,eastus\n");
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.includes("no Resource ID column")));
  assert.equal(r.resources[0].resourceId, null);
});

test("portal export without a Resource ID column derives ids from the RESOURCE LINK column", () => {
  const sub = "00000000-0000-0000-0000-000000000001";
  const csv = [
    "NAME,TYPE,RESOURCE GROUP,LOCATION,SUBSCRIPTION,RESOURCE LINK",
    `"hcw-sample-vnet","Virtual network","rg-hcw-sample","Central US","sub-hcw-sample","https://portal.azure.com#resource/subscriptions/${sub}/resourceGroups/rg-hcw-sample/providers/Microsoft.Network/virtualNetworks/hcw-sample-vnet"`,
    `"hcw sample ag","Action group","rg-hcw-sample","Global","sub-hcw-sample","https://portal.azure.com/#@hcw-sample.example/resource/subscriptions/${sub}/resourceGroups/rg-hcw-sample/providers/microsoft.insights/actiongroups/hcw%20sample%20ag"`,
    `"hcw-sample-odd","Storage account","rg-hcw-sample","Central US","sub-hcw-sample","https://portal.azure.com/#home"`,
  ].join("\n");
  const r = ingestResourcesCsv(csv);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.includes("derived from the 'RESOURCE LINK' column")));
  assert.ok(!r.warnings.some((w) => w.includes("cannot be discovered")));
  assert.ok(!r.missingColumns.includes("resourceLink"), "the link column is a fallback, never reported missing");
  assert.ok(r.warnings.some((w) => w === "column 'subscriptionId' not present in export; derived from the resource id of 2 of 3 rows, the rest labelled missing"));
  const [vnet, ag, odd] = r.resources;
  assert.equal(vnet.resourceId, `/subscriptions/${sub}/resourceGroups/rg-hcw-sample/providers/Microsoft.Network/virtualNetworks/hcw-sample-vnet`);
  assert.equal(vnet.type, "Microsoft.Network/virtualNetworks", "type taken from the derived id, not the portal display name");
  assert.equal(vnet.subscriptionId, sub);
  assert.ok(vnet.provenance.some((p) => p.normalizedHeader === "resourceId" && p.transformation === "derived-from-resource-link"));
  assert.equal(ag.resourceId, `/subscriptions/${sub}/resourceGroups/rg-hcw-sample/providers/microsoft.insights/actiongroups/hcw sample ag`);
  assert.equal(ag.type, "Microsoft.Insights/actionGroups");
  assert.equal(odd.resourceId, null);
  assert.ok(odd.warnings.some((w) => w.includes("not a portal resource link")));
});

test("resourceIdFromPortalLink reads both portal link shapes and rejects anything else", () => {
  const id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-hcw-sample/providers/Microsoft.Web/sites/hcw-sample-app";
  assert.equal(resourceIdFromPortalLink(`https://portal.azure.com#resource${id}`), id);
  assert.equal(resourceIdFromPortalLink(`https://portal.azure.com/#@hcw-sample.example/resource${id}/`), id);
  assert.equal(resourceIdFromPortalLink(id), id);
  assert.equal(resourceIdFromPortalLink("https://portal.azure.com/#blade/HubsExtension/BrowseAll"), null);
  assert.equal(resourceIdFromPortalLink(`https://portal.azure.com/#blade/x/subscriptions/${id.slice(15)}`), null, "only a portal resource link counts");
  assert.equal(resourceIdFromPortalLink(`https://portal.azure.com#resource${id}?tab=overview`), id);
  const t = Date.now(); resourceIdFromPortalLink("#".repeat(200000)); resourceIdFromPortalLink("/".repeat(200000)); resourceIdFromPortalLink("#resource/subscriptions/".repeat(10000));
  assert.ok(Date.now() - t < 1000, "linear on hostile input");
  assert.equal(resourceIdFromPortalLink(""), null);
  assert.equal(resourceIdFromPortalLink(null), null);
});
