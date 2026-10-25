import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { noopLogger } from "@amo/observability";
import { EntraTokenValidator, StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import type { NormalizedResource } from "@amo/domain";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_MESSAGE } from "./route-levels.js";
import { assertProductionConfig, configFromEnv, principalFromClaims, createEnterpriseApi, InMemoryRepository, PostgresRepository, SCHEMA_SQL } from "./index.js";

const TENANT = "11111111-2222-3333-4444-555555555555";
const SUB = "00000000-0000-4000-8000-000000000001";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (roles: string[], oid = "oid-1") => { const h = b64({ alg: "RS256", kid: "k1" }); const p = b64({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: "api://amo", oid, sub: "s", roles, nbf: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600 }); return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`; };
const armCalls: string[] = [];
/** Level names must never appear in a 403 body (ADR-0031). */
const LEVEL_WORDS = /sign-in|discovery|validation|artifact-generation|planning|controlled-execution|destructive-execution/i;
const fakeFetch = (async (url: string, init?: RequestInit) => {
  if (url.includes("discovery/v2.0/keys")) return new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
  armCalls.push(`${init?.method ?? "GET"} ${url}`);
  if (url.includes("validateMoveResources")) return { status: 204, ok: true, headers: new Headers() };
  return new Response("{}", { status: 202, headers: { "azure-asyncoperation": "https://op" } });
}) as unknown as typeof fetch;
const res = (name: string, type: string): NormalizedResource => { const id = `/subscriptions/${SUB}/resourceGroups/rg/providers/${type}/${name}`; return { key: id.toLowerCase(), resourceId: id, name, type, provider: type.split("/")[0], resourceGroup: "rg", location: "eastus", subscriptionName: null, subscriptionId: SUB, kind: null, sku: null, status: null, tags: {}, parsedId: { valid: true, issues: [], fullType: type, name, subscriptionId: SUB, resourceGroup: "rg" }, provenance: [], warnings: [], sourceRow: 0 }; };
const repo = new InMemoryRepository();
// These tests drive one principal through approve-then-execute, so they opt out of the two-person rule explicitly
// (AMO_ALLOW_SELF_APPROVAL, ADR-0031). The rule itself, and the default, are tested in two-person-approval.test.ts.
const cfg = configFromEnv({ AMO_ENTRA_TENANT_ID: TENANT, AMO_ENTRA_CLIENT_ID: "amo", AMO_ENTRA_AUDIENCE: "api://amo", AMO_ALLOW_SELF_APPROVAL: "true" });
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

test("app roles map to levels, the highest role wins, and anything else is no principal (ticket #46, ADR-0031)", () => {
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Read"] })?.grantedLevel, "discovery", "the lowest role keeps the old discovery access, now only by assignment");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Plan"] })?.grantedLevel, "planning");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Execute"] })?.grantedLevel, "controlled-execution");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Execute.Destructive"] })?.grantedLevel, "destructive-execution");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Plan", "Migration.Execute"] })?.grantedLevel, "controlled-execution");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Read", "Migration.Plan"] })?.grantedLevel, "planning", "Plan beats Read");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Read", "Migration.Execute"] })?.grantedLevel, "controlled-execution", "Execute beats Read");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Migration.Plan", "Migration.Read", "Migration.Execute.Destructive", "Migration.Execute"] })?.grantedLevel, "destructive-execution", "order in the claim does not matter");
  assert.equal(principalFromClaims({ oid: "o", roles: ["Other.Role", "Migration.Execute.Destructive", "Migration.Plan"] })?.grantedLevel, "destructive-execution");
  // No role is not "discovery": it is no principal.
  assert.equal(principalFromClaims({ oid: "o", roles: [] }), null);
  assert.equal(principalFromClaims({ oid: "o" }), null);
  assert.equal(principalFromClaims({ roles: ["Migration.Plan"] }), null, "a role without an object id is still refused");
  // Wrong role: other app roles, other casing, look-alikes, and the scope claim name used as a role.
  for (const wrong of ["Reader", "Migration.Reader", "migration.read", "MIGRATION.READ", "Migration.Read ", "Migration.Readonly", "migration.plan", "MIGRATION.PLAN", "Migration.Plan ", " Migration.Plan", "Migration.Planner", "Migration.Execute.Destructive.Extra", "access_as_user", ""]) {
    assert.equal(principalFromClaims({ oid: "o", roles: [wrong] }), null, JSON.stringify(wrong));
  }
  // A roles claim that is not an array of strings must not match by substring or by coercion.
  for (const odd of ["Migration.Plan", "xMigration.Planx", { 0: "Migration.Plan" }, [["Migration.Plan"]], [{ toString: () => "Migration.Plan" }], null, 7]) {
    assert.equal(principalFromClaims({ oid: "o", roles: odd }), null, JSON.stringify(odd));
  }
});

test("a valid token with no role, or the wrong role, is refused with 403 on every protected route (ticket #46, ADR-0031)", async () => {
  const before = (await repo.listAssessments("roleless-oid")).length;
  const eventsBefore = repo.events.length;
  const col = { subscriptionId: SUB, resourceGroup: "rg-mover", name: "mc-roleless" };
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/api/me"],
    ["GET", "/api/scopes"],
    ["GET", "/api/assessments"],
    ["POST", "/api/assessments", { scope: { kind: "subscription", id: SUB } }],
    ["GET", "/api/assessments/00000000-0000-4000-8000-000000000001"],
    ["POST", "/api/assessments/00000000-0000-4000-8000-000000000001/validate-move", { targetResourceGroupId: "/x" }],
    ["POST", "/api/approvals", { operation: "production-deploy", targetKey: "mc-roleless" }],
    ["POST", "/api/execution/resource-mover/prepare", { collection: col, moveResourceIds: ["/r1"] }],
    ["POST", "/api/execution/resource-mover/commit", { collection: col, moveResourceIds: ["/r1"] }],
    ["GET", "/api/operations/mc-roleless"],
    ["GET", "/api/no-such-route"],
  ];
  const tokens: Array<[string, string[]]> = [["no roles claim value", []], ["an unrelated role", ["Reader"]], ["a look-alike role in other casing", ["migration.plan"]], ["a look-alike role with a suffix", ["Migration.Plan.ReadOnly"]]];
  for (const [what, roles] of tokens) {
    const token = mint(roles, "roleless-oid");
    for (const [method, path, body] of routes) {
      const r = await call(path, token, method, body);
      assert.equal(r.status, 403, `${what}: ${method} ${path}`);
      const j = (await r.json()) as { error: { code: string; message: string }; level?: unknown; oid?: unknown };
      assert.equal(j.error.code, "forbidden");
      assert.match(j.error.message, /no application role assigned/);
      assert.equal(j.level, undefined, "no level is disclosed to a roleless caller");
    }
  }
  assert.equal((await repo.listAssessments("roleless-oid")).length, before, "nothing was created for the roleless caller");
  assert.equal(repo.events.length, eventsBefore, "no audit-worthy action was taken for the roleless caller");
  // Still 401 (not 403) without a valid token, and the public routes stay public.
  assert.equal((await call("/api/me", null)).status, 401);
  assert.equal((await call("/api/health", null)).status, 200);
});

test("a valid role is accepted: each role reaches /api/me with its level (ticket #46)", async () => {
  for (const [role, level] of [["Migration.Read", "discovery"], ["Migration.Plan", "planning"], ["Migration.Execute", "controlled-execution"], ["Migration.Execute.Destructive", "destructive-execution"]] as const) {
    const r = await call("/api/me", mint([role], `holder-${role}`));
    assert.equal(r.status, 200, role);
    const j = (await r.json()) as { level: string; roles: string[] };
    assert.equal(j.level, level);
    assert.deepEqual(j.roles, [role]);
  }
  const created = await call("/api/assessments", mint(["Migration.Plan"], "planner-2"), "POST", { scope: { kind: "subscription", id: SUB } });
  assert.equal(created.status, 201);
  // An extra, unrelated role next to a valid one does not take the valid one away.
  assert.equal((await call("/api/me", mint(["Reader", "Migration.Plan"], "mixed"))).status, 200);
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

test("Migration.Read is assess-only: allowed routes answer, validation, approvals, execution and operations answer 403 (ADR-0031)", async () => {
  const reader = mint(["Migration.Read"], "reader-oid");
  const eventsBefore = repo.events.length;
  // Allowed: sign-in identity, scope list, create and list and read your own assessment.
  const me = await call("/api/me", reader);
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { level: string }).level, "discovery");
  // /api/scopes needs a server whose fake Azure answers the subscription query, as in the scopes test above.
  const scopesFetch = (async (url: string, init?: RequestInit) => {
    if (url.includes("discovery/v2.0/keys")) return new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
    if (String(init?.body).includes("resourcecontainers")) return new Response(JSON.stringify({ data: [{ subscriptionId: SUB, name: "Home", tenantId: TENANT }] }), { status: 200 });
    return new Response("{}", { status: 202 });
  }) as unknown as typeof fetch;
  const s3 = createEnterpriseApi(cfg, { validator: new EntraTokenValidator({ tenantId: TENANT, audiences: ["api://amo"], fetchImpl: scopesFetch }), credential: new StaticTokenCredential(), repository: new InMemoryRepository(), discovery: new FixtureDiscoveryProvider([]), fetchImpl: scopesFetch, logger: noopLogger });
  await new Promise<void>((r) => s3.listen(0, r));
  try {
    const sc = await fetch(`http://127.0.0.1:${(s3.address() as { port: number }).port}/api/scopes`, { headers: { authorization: `Bearer ${reader}` } });
    assert.equal(sc.status, 200);
    assert.equal(((await sc.json()) as { subscriptions: unknown[] }).subscriptions.length, 1);
  } finally { s3.close(); }
  const created = await call("/api/assessments", reader, "POST", { scope: { kind: "subscription", id: SUB } });
  assert.equal(created.status, 201);
  const { assessmentId } = (await created.json()) as { assessmentId: string };
  assert.equal((await call("/api/assessments", reader)).status, 200);
  assert.equal((await call(`/api/assessments/${assessmentId}`, reader)).status, 200);
  assert.equal((await call(`/api/assessments/${assessmentId}`, mint(["Migration.Read"], "other-reader"))).status, 404, "another reader cannot see it");
  assert.equal((await call("/api/assessments", reader, "POST", {})).status, 400, "a malformed request is still a 400, not a 403");
  // Forbidden: everything that needs validation, planning or execution.
  const col = { subscriptionId: SUB, resourceGroup: "rg-mover", name: "mc-reader" };
  // Pre-record the approvals initiateMove (production-deploy) and commit (data-cutover) need, by someone who may, so those
  // rows are refused for the reader's LEVEL and not merely because no approval exists (they passed for the wrong reason before).
  const approver = mint(["Migration.Execute"], "approver-oid");
  for (const operation of ["production-deploy", "data-cutover"]) assert.equal((await call("/api/approvals", approver, "POST", { operation, targetKey: "mc-reader" })).status, 201, operation);
  const eventsAfterApprovals = repo.events.length;
  const armBefore = armCalls.length;
  const forbidden: Array<[string, string, unknown?]> = [
    ["POST", `/api/assessments/${assessmentId}/validate-move`, { targetResourceGroupId: `/subscriptions/${SUB}/resourceGroups/rg2` }],
    ["POST", "/api/approvals", { operation: "production-deploy", targetKey: "mc-reader" }],
    ["POST", "/api/execution/resource-mover/prepare", { collection: col, moveResourceIds: ["/r1"] }],
    ["POST", "/api/execution/resource-mover/initiateMove", { collection: col, moveResourceIds: ["/r1"] }],
    ["POST", "/api/execution/resource-mover/commit", { collection: col, moveResourceIds: ["/r1"] }],
    ["POST", "/api/execution/resource-mover/discard", { collection: col, moveResourceIds: ["/r1"] }],
    ["GET", "/api/execution/resource-mover/unknown"],
    ["GET", "/api/operations/mc-reader"],
  ];
  const notRefused: string[] = [];
  for (const [method, path, body] of forbidden) {
    const r = await call(path, reader, method, body);
    const text = await r.text();
    let j: { accepted?: boolean; operationId?: unknown; error?: { code: string; message: string } } = {};
    try { j = JSON.parse(text); } catch { /* reported below */ }
    // One soft check per row, so a failing row is named and no row can hide behind another one failing first.
    const problems: string[] = [];
    if (r.status !== 403) problems.push(`status ${r.status}`);
    if (j.error?.code !== "forbidden" || j.error?.message !== FORBIDDEN_MESSAGE) problems.push("not the one generic forbidden body from the route table");
    if (j.accepted !== undefined || j.operationId) problems.push("an execution result or operation was returned");
    if (LEVEL_WORDS.test(text)) problems.push("a level is named");
    if (problems.length) notRefused.push(`${method} ${path}: ${problems.join("; ")}`);
  }
  assert.deepEqual(notRefused, [], "every row must be refused for the reader's level; each row is listed so none can pass for another reason");
  assert.equal(armCalls.length, armBefore, "no Azure call was made on behalf of a reader");
  // The reader's assessment was created. Nothing was approved, validated, executed or even audited as an attempt, because the
  // table refuses before the gate runs.
  const added = repo.events.slice(eventsBefore, eventsAfterApprovals);
  assert.ok(added.some((e) => e.event === "assessment.created"));
  assert.deepEqual(repo.events.slice(eventsAfterApprovals), [], "a refused reader leaves no event behind");
});

test("a role that is too low is refused before the body is read and before the repository is touched, with no level named (ADR-0031)", async () => {
  const raw = (path: string, token: string, method: string, body: string) => fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body });
  const reader = mint(["Migration.Read"], "reader-3");
  const planner = mint(["Migration.Plan"], "planner-3");
  const eventsBefore = repo.events.length;
  // A broken JSON body would be a 500 if it were parsed first; a missing assessment would be a 404 if the repository were read first.
  for (const [token, path] of [[reader, "/api/approvals"], [planner, "/api/approvals"], [reader, "/api/execution/resource-mover/commit"], [planner, "/api/execution/resource-mover/initiateMove"], [reader, "/api/assessments/0f8fad5b-d9cb-469f-a165-70867728950e/validate-move"]] as const) {
    const r = await raw(path, token, "POST", "{not json");
    assert.equal(r.status, 403, path);
    const text = await r.text();
    assert.equal((JSON.parse(text) as { error: { message: string } }).error.message, FORBIDDEN_MESSAGE);
    assert.ok(!LEVEL_WORDS.test(text), text);
  }
  assert.equal((await call("/api/assessments/0f8fad5b-d9cb-469f-a165-70867728950e/validate-move", reader, "POST", { targetResourceGroupId: "/x" })).status, 403, "403 and not 404 for an assessment that does not exist");
  // The planner may validate: for the same missing assessment the answer is 404, which proves the 403 above came from the level.
  assert.equal((await call("/api/assessments/0f8fad5b-d9cb-469f-a165-70867728950e/validate-move", planner, "POST", { targetResourceGroupId: "/x" })).status, 404);
  assert.equal(repo.events.length, eventsBefore);
});

test("the 403 for a caller with no role names no level either (ADR-0031)", async () => {
  const r = await call("/api/approvals", mint([], "roleless-4"), "POST", { operation: "production-deploy", targetKey: "x" });
  assert.equal(r.status, 403);
  assert.ok(!LEVEL_WORDS.test(await r.text()));
});
