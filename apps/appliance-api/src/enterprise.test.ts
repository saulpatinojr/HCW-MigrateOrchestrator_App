import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { noopLogger } from "@amo/observability";
import { EntraTokenValidator, StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import type { NormalizedResource } from "@amo/domain";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertProductionConfig, configFromEnv, principalFromClaims, createEnterpriseApi, InMemoryRepository, PostgresRepository, SCHEMA_SQL } from "./index.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const SUB = "00000000-0000-4000-8000-000000000001";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (roles: string[], oid = "oid-1") => { const h = b64({ alg: "RS256", kid: "k1" }); const p = b64({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: "api://amo", oid, sub: "s", roles, nbf: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600 }); return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`; };
const armCalls: string[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  if (url.includes("discovery/v2.0/keys")) return new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
  armCalls.push(`${init?.method ?? "GET"} ${url}`);
  if (url.includes("validateMoveResources")) return { status: 204, ok: true, headers: new Headers() };
  return new Response("{}", { status: 202, headers: { "azure-asyncoperation": "https://op" } });
}) as unknown as typeof fetch;
const res = (name: string, type: string): NormalizedResource => { const id = `/subscriptions/${SUB}/resourceGroups/rg/providers/${type}/${name}`; return { key: id.toLowerCase(), resourceId: id, name, type, provider: type.split("/")[0], resourceGroup: "rg", location: "eastus", subscriptionName: null, subscriptionId: SUB, kind: null, sku: null, status: null, tags: {}, parsedId: { valid: true, issues: [], fullType: type, name, subscriptionId: SUB, resourceGroup: "rg" }, provenance: [], warnings: [], sourceRow: 0 }; };
const repo = new InMemoryRepository();
const cfg = configFromEnv({ AMO_ENTRA_TENANT_ID: TENANT, AMO_ENTRA_CLIENT_ID: "amo", AMO_ENTRA_AUDIENCE: "api://amo" });
const server = createEnterpriseApi(cfg, { validator: new EntraTokenValidator({ tenantId: TENANT, audiences: ["api://amo"], fetchImpl: fakeFetch }), credential: new StaticTokenCredential(), repository: repo, discovery: new FixtureDiscoveryProvider([res("vm1", "Microsoft.Compute/virtualMachines"), res("st1", "Microsoft.Storage/storageAccounts")]), fetchImpl: fakeFetch, logger: noopLogger });
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.close());
const call = (path: string, token: string | null, method = "GET", body?: unknown) => fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

test("refuses to start with a client secret in the environment; roles map to levels", () => {
  assert.throws(() => configFromEnv({ AMO_CLIENT_SECRET: "x" }), /client secret/);
  assert.equal(principalFromClaims(null), null);
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Plan"] })?.grantedLevel, "planning");
});

test("refuses a certificate path or a user name identity (ticket #50); existing refusals unchanged", () => {
  assert.throws(() => configFromEnv({ AZURE_CLIENT_CERTIFICATE_PATH: "/certs/app.pem" }), /AZURE_CLIENT_CERTIFICATE_PATH.*not supported/);
  assert.throws(() => configFromEnv({ AZURE_USERNAME: "someone@example.test" }), /AZURE_USERNAME.*not supported/);
  assert.throws(() => configFromEnv({ AZURE_USERNAME: "" }), /AZURE_USERNAME/, "presence alone is refused");
  for (const k of ["AZURE_CLIENT_SECRET", "AMO_CLIENT_SECRET", "AZURE_CLIENT_CERTIFICATE_PASSWORD", "AZURE_PASSWORD"]) assert.throws(() => configFromEnv({ [k]: "x" }), /client secret/, k);
  assert.doesNotThrow(() => configFromEnv({ AMO_ENTRA_TENANT_ID: "t", AZURE_CLIENT_ID: "c" }));
});

test("production refuses to start without Entra configuration (ticket #51)", () => {
  const prod = { NODE_ENV: "production" };
  assert.throws(() => assertProductionConfig(configFromEnv({}), prod), /missing AMO_ENTRA_TENANT_ID and AMO_ENTRA_CLIENT_ID/);
  assert.throws(() => assertProductionConfig(configFromEnv({ AMO_ENTRA_TENANT_ID: "t" }), prod), /missing AMO_ENTRA_CLIENT_ID/);
  assert.throws(() => assertProductionConfig(configFromEnv({ AMO_ENTRA_CLIENT_ID: "c" }), prod), /missing AMO_ENTRA_TENANT_ID/);
  assert.throws(() => assertProductionConfig(configFromEnv({ AMO_ENTRA_TENANT_ID: "", AMO_ENTRA_CLIENT_ID: "" }), prod), /missing/, "empty counts as missing");
  assert.throws(() => assertProductionConfig(configFromEnv({ AMO_DISCOVERY_FIXTURE: "1" }), prod), /missing/, "fixture mode does not excuse missing sign-in");
  const ok = { AMO_ENTRA_TENANT_ID: TENANT, AMO_ENTRA_CLIENT_ID: "amo" };
  assert.doesNotThrow(() => assertProductionConfig(configFromEnv(ok), prod));
  assert.doesNotThrow(() => assertProductionConfig(configFromEnv({}), {}), "outside production an unconfigured API still starts; routes stay 401");
});

test("the server process exits non-zero with a clear message in production without Entra configuration (ticket #51)", () => {
  const server = fileURLToPath(new URL("./server.js", import.meta.url));
  const r = spawnSync(process.execPath, [server], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", PORT: "0" }, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to start in production.*AMO_ENTRA_TENANT_ID and AMO_ENTRA_CLIENT_ID/);
});

test("unauthenticated requests fail closed; health is public", async () => {
  assert.equal((await call("/api/health", null)).status, 200);
  assert.equal((await call("/api/assessments", null)).status, 401);
  assert.equal((await call("/api/me", "garbage")).status, 401);
});

test("discovery → assessment → validate-move evidence → ownership isolation", async () => {
  const planner = mint(["Migration.Plan"]);
  const created = await call("/api/assessments", planner, "POST", { scope: { kind: "subscription", id: SUB }, intent: { desiredOperation: "resource-group-move", destinationResourceGroup: "rg2" } });
  assert.equal(created.status, 201);
  const { assessmentId } = (await created.json()) as { assessmentId: string };
  const got = (await (await call(`/api/assessments/${assessmentId}`, planner)).json()) as { assessment: { authenticated: boolean; decisions: Array<{ confidence: { band: string } }> } };
  assert.equal(got.assessment.authenticated, false, "fixture provider is not authenticated");
  const vm = await call(`/api/assessments/${assessmentId}/validate-move`, planner, "POST", { targetResourceGroupId: `/subscriptions/${SUB}/resourceGroups/rg2` });
  assert.equal(vm.status, 200);
  const vmBody = (await vm.json()) as { results: Array<{ ok: boolean }> };
  assert.equal(vmBody.results[0].ok, true);
  assert.ok(armCalls.some((c) => c.includes("validateMoveResources")));
  const after = (await (await call(`/api/assessments/${assessmentId}`, planner)).json()) as { assessment: { decisions: Array<{ evidence: Array<{ state: string }> }> } };
  assert.ok(after.assessment.decisions.some((d) => d.evidence.some((e) => e.state === "observed-from-azure-api")));
  assert.equal((await call(`/api/assessments/${assessmentId}`, mint(["Migration.Plan"], "other-user"))).status, 404);
});

test("execution: planner cannot approve or execute; executor needs a recorded approval; discard is the rollback path", async () => {
  const planner = mint(["Migration.Plan"]);
  const exec = mint(["Migration.Execute"], "exec-oid");
  const col = { subscriptionId: SUB, resourceGroup: "rg-mover", name: "mc1" };
  assert.equal((await call("/api/approvals", planner, "POST", { operation: "production-deploy", targetKey: "mc1" })).status, 403);
  const refused = await call("/api/execution/resource-mover/initiateMove", exec, "POST", { collection: col, moveResourceIds: ["/r1"] });
  assert.equal(refused.status, 403);
  assert.equal((await call("/api/approvals", exec, "POST", { operation: "production-deploy", targetKey: "mc1", note: "CAB-123" })).status, 201);
  const accepted = await call("/api/execution/resource-mover/initiateMove", exec, "POST", { collection: col, moveResourceIds: ["/r1"] });
  assert.equal(accepted.status, 202);
  assert.equal((await call("/api/execution/resource-mover/discard", exec, "POST", { collection: col, moveResourceIds: ["/r1"] })).status, 202);
  assert.ok(repo.events.some((e) => e.event === "approval.granted") && repo.events.some((e) => e.event === "execution.resource-mover.initiateMove"));
});

test("PostgresRepository issues the expected SQL against a fake client", async () => {
  const log: Array<{ text: string; params?: unknown[] }> = [];
  const fake = { async query(text: string, params?: unknown[]) { log.push({ text, params }); return { rows: text.startsWith("SELECT owner_oid") ? [{ owner_oid: "o", body: { id: "x" } }] : [] }; } };
  const r = new PostgresRepository(fake);
  await r.init();
  assert.equal(log[0].text, SCHEMA_SQL);
  await r.recordApproval({ id: "a", operation: "dns-change", targetKey: "t", approvedBy: "o", approvedAt: "now", note: null });
  assert.ok(log[1].text.startsWith("INSERT INTO approvals"));
  assert.equal((await r.getAssessment("x"))?.ownerOid, "o");
});

test("PostgreSQL: Entra token password provider is wired for Azure hosts; passwords in URLs are refused", async () => {
  const { repositoryFromEnv, POSTGRES_ENTRA_SCOPE } = await import("./repository.js");
  const scopes: string[] = [];
  const cred = { kind: "static-test" as const, async getToken(scope: string) { scopes.push(scope); return { token: "db-token", expiresOn: Date.now() + 60000 }; } };
  let captured: { password?: () => Promise<string>; ssl?: unknown } | null = null;
  const repo = await repositoryFromEnv({ DATABASE_URL: "postgres://id-amo@psql-amo.postgres.database.azure.com:5432/amo?sslmode=require" }, cred, (cfg) => { captured = cfg; return { async query() { return { rows: [] }; } }; });
  assert.ok(repo);
  assert.ok(captured!.password && captured!.ssl);
  assert.equal(await captured!.password!(), "db-token");
  assert.equal(scopes[0], POSTGRES_ENTRA_SCOPE);
  await assert.rejects(repositoryFromEnv({ DATABASE_URL: "postgres://u:pw@psql-x.postgres.database.azure.com/amo" }, cred), /must not embed a password/);
  await assert.rejects(repositoryFromEnv({ DATABASE_URL: "postgres://u@psql-x.postgres.database.azure.com/amo" }, null), /TokenCredential/);
});

test("scopes endpoint lists delegated subscriptions and cross-tenant intent is derived automatically", async () => {
  const home = TENANT;
  const subsFetch = (async (url: string, init?: RequestInit) => {
    if (url.includes("discovery/v2.0/keys")) return new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
    if (String(init?.body).includes("resourcecontainers")) return new Response(JSON.stringify({ data: [{ subscriptionId: SUB, name: "Home", tenantId: home }, { subscriptionId: "99999999-0000-4000-8000-000000000009", name: "Customer", tenantId: "22222222-2222-4222-8222-222222222222" }] }), { status: 200 });
    return new Response("{}", { status: 202 });
  }) as unknown as typeof fetch;
  const s2 = createEnterpriseApi(cfg, { validator: new EntraTokenValidator({ tenantId: TENANT, audiences: ["api://amo"], fetchImpl: subsFetch }), credential: new StaticTokenCredential(), repository: new InMemoryRepository(), discovery: new FixtureDiscoveryProvider([res("id1", "Microsoft.ManagedIdentity/userAssignedIdentities")]), fetchImpl: subsFetch, logger: noopLogger });
  await new Promise<void>((r) => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${(s2.address() as { port: number }).port}`;
  try {
    const tok = mint(["Migration.Plan"]);
    const sc = (await (await fetch(`${b2}/api/scopes`, { headers: { authorization: `Bearer ${tok}` } })).json()) as { delegatedCount: number };
    assert.equal(sc.delegatedCount, 1);
    const created = await fetch(`${b2}/api/assessments`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ scope: { kind: "subscription", id: SUB }, destinationSubscriptionId: "99999999-0000-4000-8000-000000000009" }) });
    const { assessmentId } = (await created.json()) as { assessmentId: string };
    const a = (await (await fetch(`${b2}/api/assessments/${assessmentId}`, { headers: { authorization: `Bearer ${tok}` } })).json()) as { assessment: { intent: { desiredOperation: string; sameTenant: boolean }; decisions: Array<{ disposition: string; identityDisposition: string }> } };
    assert.equal(a.assessment.intent.desiredOperation, "cross-tenant-migration");
    assert.equal(a.assessment.intent.sameTenant, false);
    assert.equal(a.assessment.decisions[0].identityDisposition, "reconstruct");
  } finally { s2.close(); }
});

test("accepted mover actions are recorded as operations and listable", async () => {
  const exec = mint(["Migration.Execute"], "exec-oid-2");
  const col = { subscriptionId: SUB, resourceGroup: "rg-mover", name: "mc2" };
  await call("/api/approvals", exec, "POST", { operation: "production-deploy", targetKey: "mc2" });
  const r = (await (await call("/api/execution/resource-mover/initiateMove", exec, "POST", { collection: col, moveResourceIds: ["/r1"] })).json()) as { operationId: string | null };
  assert.ok(r.operationId);
  const ops = (await (await call("/api/operations/mc2", exec)).json()) as Array<{ status: string; kind: string }>;
  assert.equal(ops[0].status, "InProgress");
  assert.equal(ops[0].kind, "resource-mover.initiateMove");
});
