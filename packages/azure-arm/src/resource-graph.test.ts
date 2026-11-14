import { test } from "node:test";
import assert from "node:assert/strict";
import { StaticTokenCredential } from "@amo/azure-auth";
import { ResourceGraphDiscoveryProvider, MoveValidator, toNormalized } from "./index.js";

const SUB = "00000000-0000-0000-0000-000000000001";
const row = (name: string, type: string) => ({ id: `/subscriptions/${SUB}/resourceGroups/rg/providers/${type}/${name}`, name, type, location: "eastus", resourceGroup: "rg", subscriptionId: SUB, kind: null, sku: { name: "Standard_LRS" }, tags: { app: "x" } });

test("Resource Graph pages with $skipToken and labels evidence as observed-from-azure-api", async () => {
  const bodies: unknown[] = [];
  const fake = (async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body)); bodies.push(b);
    if (!b.options.$skipToken) return new Response(JSON.stringify({ data: [row("a", "Microsoft.Storage/storageAccounts")], $skipToken: "t2" }), { status: 200 });
    return new Response(JSON.stringify({ data: [row("b", "Microsoft.Compute/virtualMachines")] }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = new ResourceGraphDiscoveryProvider(new StaticTokenCredential(), fake);
  const r = await p.discover({ kind: "subscription", id: SUB });
  assert.equal(r.resources.length, 2);
  assert.equal(bodies.length, 2);
  assert.equal(r.resources[0].provenance[0].evidence, "observed-from-azure-api");
  assert.equal(r.resources[0].sku, "Standard_LRS");
  assert.equal(p.authenticated, true);
});

test("403 is reported as a permission gap, not an exception", async () => {
  const fake = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
  const r = await new ResourceGraphDiscoveryProvider(new StaticTokenCredential(), fake).discover({ kind: "subscription", id: SUB });
  assert.equal(r.resources.length, 0);
  assert.ok(r.permissionGaps[0].includes("Reader"));
});

test("toNormalized derives parent for child types", () => {
  const n = toNormalized({ ...row("db", "Microsoft.Sql/servers/databases"), id: `/subscriptions/${SUB}/resourceGroups/rg/providers/Microsoft.Sql/servers/srv/databases/db` });
  assert.ok(n.parsedId.parentId?.endsWith("/servers/srv"));
});

test("validateMoveResources follows 202→Location polling and parses 409 details", async () => {
  let calls = 0;
  const fake = (async (url: string) => {
    calls++;
    if (url.includes("validateMoveResources")) return new Response("", { status: 202, headers: { location: "https://poll/1", "retry-after": "0" } });
    return new Response(JSON.stringify({ error: { code: "ResourceMoveValidationFailed", message: "x", details: [{ code: "ResourceMoveNotSupported", message: "App Service plan in different webspace", target: "/subscriptions/.../serverFarms/asp" }] } }), { status: 409 });
  }) as unknown as typeof fetch;
  const v = new MoveValidator(new StaticTokenCredential(), fake, "https://management.azure.com", async () => {});
  const r = await v.validate(`/subscriptions/${SUB}/resourceGroups/rg`, ["/x"], `/subscriptions/${SUB}/resourceGroups/rg2`);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "ResourceMoveNotSupported");
  assert.equal(r.evidence[0].state, "observed-from-azure-api");
  assert.equal(calls, 2);
  const ok = new MoveValidator(new StaticTokenCredential(), (async () => ({ status: 204, ok: true, headers: new Headers() })) as unknown as typeof fetch);
  assert.equal((await ok.validate("/s/rg", ["/x"], "/s/rg2")).ok, true);
});

test("scope inventory marks Lighthouse-delegated subscriptions and derives tenant relationship", async () => {
  const { ScopeInventory } = await import("./scopes.js");
  const home = "11111111-1111-4111-8111-111111111111";
  const fake = (async () => new Response(JSON.stringify({ data: [{ subscriptionId: "s1", name: "Home", tenantId: home }, { subscriptionId: "s2", name: "Customer", tenantId: "22222222-2222-4222-8222-222222222222", managedBy: "/subscriptions/s1" }] }), { status: 200 })) as unknown as typeof fetch;
  const subs = await new ScopeInventory(new StaticTokenCredential(), home, fake).listSubscriptions();
  assert.equal(subs[0].delegated, false);
  assert.equal(subs[1].delegated, true);
  assert.deepEqual(ScopeInventory.relationship(subs[1], subs[0]), { sameTenant: false, sameSubscription: false });
  assert.deepEqual(ScopeInventory.relationship(subs[0], subs[0]), { sameTenant: true, sameSubscription: true });
  assert.equal(ScopeInventory.relationship(undefined, subs[0]).sameTenant, null);
});
