import { test } from "node:test";
import assert from "node:assert/strict";
import { StaticTokenCredential } from "@amo/azure-auth";
import { demoPrincipal, type Principal } from "@amo/authorization";
import { ResourceMoverClient } from "./index.js";

const col = { subscriptionId: "00000000-0000-0000-0000-000000000001", resourceGroup: "rg-mover", name: "mc1" };
const calls: string[] = [];
const fake = (async (url: string, init?: RequestInit) => { calls.push(`${init?.method ?? "GET"} ${url}`); return new Response(JSON.stringify({ value: [] }), { status: 202, headers: { "azure-asyncoperation": "https://op/1" } }); }) as unknown as typeof fetch;
const client = new ResourceMoverClient(new StaticTokenCredential(), fake);

test("demo principal can never run mover actions", async () => {
  const r = await client.run(demoPrincipal("d"), col, "prepare", ["/r1"]);
  assert.equal(r.accepted, false);
  assert.equal(calls.length, 0);
});

test("initiateMove requires controlled-execution and an explicit approval; discard needs only the level", async () => {
  const p: Principal = { id: "e", edition: "enterprise", grantedLevel: "controlled-execution", approvals: new Set() };
  assert.equal((await client.run(p, col, "initiateMove", ["/r1"])).accepted, false);
  assert.equal(calls.length, 0);
  p.approvals.add("production-deploy:mc1");
  const r = await client.run(p, col, "initiateMove", ["/r1"]);
  assert.equal(r.accepted, true);
  assert.ok(calls[0].includes("/moveCollections/mc1/initiateMove"));
  assert.equal((await client.run(p, col, "discard", ["/r1"])).accepted, true);
  const planner: Principal = { ...p, grantedLevel: "planning" };
  assert.equal((await client.run(planner, col, "discard", ["/r1"])).accepted, false);
});

test("commit requires data-cutover approval", async () => {
  const p: Principal = { id: "e", edition: "enterprise", grantedLevel: "controlled-execution", approvals: new Set(["production-deploy:mc1"]) };
  assert.equal((await client.run(p, col, "commit", ["/r1"])).accepted, false);
  p.approvals.add("data-cutover:mc1");
  assert.equal((await client.run(p, col, "commit", ["/r1"])).accepted, true);
});

test("pollOperation maps ARM async statuses and keeps retry-after", async () => {
  const { pollOperation, isTerminal } = await import("./operations.js");
  const base = { id: "o1", kind: "resource-mover.prepare", targetKey: "mc1", operationUrl: "https://op/1", status: "InProgress" as const, startedBy: "e", startedAt: "t", updatedAt: "t", retryAfterSeconds: 10, error: null };
  const mk = (status: number, body: unknown, ra?: string) => (async () => (status === 202 ? { status, ok: false, headers: new Headers(ra ? { "retry-after": ra } : {}), json: async () => ({}) } : new Response(JSON.stringify(body), { status, headers: ra ? { "retry-after": ra } : {} }))) as unknown as typeof fetch;
  assert.equal((await pollOperation(new StaticTokenCredential(), base, mk(202, {}, "30"))).retryAfterSeconds, 30);
  const ok = await pollOperation(new StaticTokenCredential(), base, mk(200, { status: "Succeeded" }));
  assert.equal(ok.status, "Succeeded");
  const failed = await pollOperation(new StaticTokenCredential(), base, mk(200, { status: "Failed", error: { code: "MoveResourceValidationFailed", message: "x" } }));
  assert.equal(failed.status, "Failed");
  assert.ok(failed.error?.includes("MoveResourceValidationFailed"));
  assert.ok(isTerminal("Failed") && !isTerminal("InProgress"));
});
