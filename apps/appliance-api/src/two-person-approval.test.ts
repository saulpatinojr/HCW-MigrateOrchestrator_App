import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { noopLogger } from "@amo/observability";
import { EntraTokenValidator, StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import { ALLOW_SELF_APPROVAL_VAR, configFromEnv, countableApprovals, createEnterpriseApi, InMemoryRepository, parseAllowSelfApproval, type ApprovalRecord } from "./index.js";

/**
 * Two-person rule (ADR-0031, F-05 of issue 83). An approval recorded by the person who then asks to execute does not count,
 * unless AMO_ALLOW_SELF_APPROVAL=true. The default is the secure one. Real request handler, real tokens, over HTTP; the Azure
 * calls go to a fake fetch that counts them.
 */
const TENANT = "11111111-2222-3333-4444-555555555555";
const SUB = "00000000-0000-4000-8000-000000000001";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (roles: string[], oid: string) => { const h = b64({ alg: "RS256", kid: "k1" }); const p = b64({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: "api://amo", oid, sub: "s", roles, nbf: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600 }); return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`; };
const alice = mint(["Migration.Execute"], "aaaaaaaa-0000-4000-8000-00000000000a");
const bob = mint(["Migration.Execute"], "bbbbbbbb-0000-4000-8000-00000000000b");

interface Harness { call: (path: string, token: string, body?: unknown) => Promise<{ status: number; body: { reason?: string; operationId?: string | null } }>; repo: InMemoryRepository; armCalls: string[] }
const closers: Array<() => void> = [];
after(() => { for (const c of closers) c(); });

async function start(env: Record<string, string>): Promise<Harness> {
  const armCalls: string[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    if (url.includes("discovery/v2.0/keys")) return new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
    armCalls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response("{}", { status: 202, headers: { "azure-asyncoperation": "https://op" } });
  }) as unknown as typeof fetch;
  const repo = new InMemoryRepository();
  const cfg = configFromEnv({ AMO_ENTRA_TENANT_ID: TENANT, AMO_ENTRA_CLIENT_ID: "amo", AMO_ENTRA_AUDIENCE: "api://amo", ...env });
  const server = createEnterpriseApi(cfg, { validator: new EntraTokenValidator({ tenantId: TENANT, audiences: ["api://amo"], fetchImpl: fakeFetch }), credential: new StaticTokenCredential(), repository: repo, discovery: new FixtureDiscoveryProvider([]), fetchImpl: fakeFetch, logger: noopLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call: Harness["call"] = async (path, token, body) => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: (await r.json()) as { reason?: string; operationId?: string | null } };
  };
  return { call, repo, armCalls };
}

const col = (name: string) => ({ subscriptionId: SUB, resourceGroup: "rg-mover", name });
const approve = (h: Harness, token: string, operation: string, targetKey: string) => h.call("/api/approvals", token, { operation, targetKey });
const run = (h: Harness, token: string, action: string, name: string) => h.call(`/api/execution/resource-mover/${action}`, token, { collection: col(name), moveResourceIds: ["/r1"] });

// ---- configuration -------------------------------------------------------------------------------------------------------

test("AMO_ALLOW_SELF_APPROVAL: off by default, true and false accepted, anything else stops the API", () => {
  for (const off of [undefined, "", "  ", "false", "FALSE"]) assert.equal(parseAllowSelfApproval(off), false, JSON.stringify(off));
  for (const on of ["true", "TRUE", " true "]) assert.equal(parseAllowSelfApproval(on), true, JSON.stringify(on));
  for (const bad of ["yes", "1", "on", "enabled", "tru", "truee", "0"]) {
    assert.throws(() => parseAllowSelfApproval(bad), (e: Error) => e.message.includes(ALLOW_SELF_APPROVAL_VAR) && /^refusing to start/.test(e.message), bad);
    assert.throws(() => configFromEnv({ [ALLOW_SELF_APPROVAL_VAR]: bad }), new RegExp(ALLOW_SELF_APPROVAL_VAR), `configFromEnv ${bad}`);
  }
  assert.equal(configFromEnv({}).allowSelfApproval, false, "the default is the secure one");
  assert.equal(configFromEnv({ [ALLOW_SELF_APPROVAL_VAR]: "true" }).allowSelfApproval, true);
});

// ---- the policy function, and mutation checks on it ------------------------------------------------------------------------

const rec = (approvedBy: string, operation = "production-deploy"): ApprovalRecord => ({ id: `${approvedBy}-${operation}`, operation, targetKey: "mc", approvedBy, approvedAt: "2026-10-25T00:00:00Z", note: null });

/** The behaviour table every implementation must satisfy. Returns the ids of the failing rows (empty: correct). */
function violations(impl: typeof countableApprovals): string[] {
  const bad: string[] = [];
  const check = (name: string, ok: boolean) => { if (!ok) bad.push(name); };
  const ids = (r: { counted: ApprovalRecord[] }) => r.counted.map((x) => x.approvedBy).sort().join(",");
  const a = rec("oid-a"), b = rec("oid-b");
  check("own approval is set aside", ids(impl([a], "oid-a", false)) === "" && impl([a], "oid-a", false).setAside === 1);
  check("another person's approval counts", ids(impl([b], "oid-a", false)) === "oid-b" && impl([b], "oid-a", false).setAside === 0);
  check("only the other person's counts when both exist", ids(impl([a, b], "oid-a", false)) === "oid-b" && impl([a, b], "oid-a", false).setAside === 1);
  check("the comparison ignores case", ids(impl([rec("OID-A")], "oid-a", false)) === "");
  check("self-approval mode counts everything", ids(impl([a, b], "oid-a", true)) === "oid-a,oid-b");
  check("self-approval mode says when it used the caller's own approval", impl([a], "oid-a", true).usedOwnApproval === true && impl([b], "oid-a", true).usedOwnApproval === false);
  check("two-person mode never reports using the caller's own approval", impl([a, b], "oid-a", false).usedOwnApproval === false);
  check("no approvals, nothing counted", impl([], "oid-a", false).counted.length === 0);
  return bad;
}

test("countableApprovals satisfies the behaviour table", () => {
  assert.deepEqual(violations(countableApprovals), []);
});

test("mutation check: every plausible wrong implementation is caught by the behaviour table", () => {
  type Impl = typeof countableApprovals;
  const mutants: Record<string, Impl> = {
    "counts everything (rule removed)": (records) => ({ counted: [...records], setAside: 0, usedOwnApproval: false }),
    "inverted comparison (only own approvals count)": (records, actor) => { const counted = records.filter((r) => r.approvedBy.toLowerCase() === actor.toLowerCase()); return { counted, setAside: records.length - counted.length, usedOwnApproval: false }; },
    "case-sensitive comparison": (records, actor, allow) => { if (allow) return countableApprovals(records, actor, true); const counted = records.filter((r) => r.approvedBy !== actor); return { counted, setAside: records.length - counted.length, usedOwnApproval: false }; },
    "opt-out ignored (always two-person)": (records, actor) => countableApprovals(records, actor, false),
    "opt-out inverted": (records, actor, allow) => countableApprovals(records, actor, !allow),
    "sets everything aside": () => ({ counted: [], setAside: 0, usedOwnApproval: false }),
    "forgets to say it used its own approval": (records, actor, allow) => ({ ...countableApprovals(records, actor, allow), usedOwnApproval: false }),
  };
  for (const [name, impl] of Object.entries(mutants)) assert.notDeepEqual(violations(impl), [], `the mutant "${name}" went unnoticed`);
});

// ---- over HTTP: the default ------------------------------------------------------------------------------------------------

test("default: the person who recorded an approval cannot execute with it; nothing reaches Azure", async () => {
  const h = await start({});
  assert.equal((await approve(h, alice, "production-deploy", "mc-own")).status, 201);
  const r = await run(h, alice, "initiateMove", "mc-own");
  assert.equal(r.status, 403);
  assert.match(String(r.body.reason), /two-person rule/);
  assert.equal(h.armCalls.filter((c) => c.includes("moveCollections")).length, 0, "no call to Azure was made");
  const event = h.repo.events.find((e) => e.event === "execution.resource-mover.initiateMove");
  assert.equal((event?.details as { ownApprovalsSetAside: number }).ownApprovalsSetAside, 1, "the refusal says why in the audit log");
});

test("default: a second person's approval lets the first person execute initiateMove (production-deploy) and commit (data-cutover)", async () => {
  const h = await start({});
  assert.equal((await approve(h, bob, "production-deploy", "mc-two")).status, 201);
  const move = await run(h, alice, "initiateMove", "mc-two");
  assert.equal(move.status, 202);
  assert.ok(move.body.operationId);
  // commit needs its own approval, and alice's own does not help
  assert.equal((await approve(h, alice, "data-cutover", "mc-two")).status, 201);
  assert.equal((await run(h, alice, "commit", "mc-two")).status, 403, "her own data-cutover approval does not count");
  assert.equal((await approve(h, bob, "data-cutover", "mc-two")).status, 201);
  assert.equal((await run(h, alice, "commit", "mc-two")).status, 202);
});

test("default: with both people's approvals on record, the other person's is the one that counts", async () => {
  const h = await start({});
  await approve(h, alice, "production-deploy", "mc-both");
  await approve(h, bob, "production-deploy", "mc-both");
  assert.equal((await run(h, alice, "initiateMove", "mc-both")).status, 202, "bob's approval counts for alice");
  assert.equal((await run(h, bob, "initiateMove", "mc-both")).status, 202, "alice's approval counts for bob");
  const only = await start({});
  await approve(only, alice, "production-deploy", "mc-x");
  assert.equal((await run(only, bob, "initiateMove", "mc-x")).status, 202, "alice's approval counts for bob");
});

test("default: prepare and discard need no approval, so the rule does not touch them", async () => {
  const h = await start({});
  assert.equal((await run(h, alice, "prepare", "mc-free")).status, 202);
  assert.equal((await run(h, alice, "discard", "mc-free")).status, 202);
});

// ---- over HTTP: the explicit opt-out ----------------------------------------------------------------------------------------

test("AMO_ALLOW_SELF_APPROVAL=true: one person may approve and execute, and the audit log says so", async () => {
  const h = await start({ [ALLOW_SELF_APPROVAL_VAR]: "true" });
  assert.equal((await approve(h, alice, "production-deploy", "mc-lab")).status, 201);
  assert.equal((await run(h, alice, "initiateMove", "mc-lab")).status, 202);
  const event = h.repo.events.find((e) => e.event === "execution.resource-mover.initiateMove");
  assert.equal((event?.details as { selfApproval: boolean }).selfApproval, true);
  // a second person's approval used by someone else is not flagged as self-approval
  await approve(h, bob, "production-deploy", "mc-lab2");
  await run(h, alice, "initiateMove", "mc-lab2");
  const other = h.repo.events.filter((e) => e.event === "execution.resource-mover.initiateMove").pop();
  assert.equal((other?.details as { selfApproval: boolean }).selfApproval, false);
});

test("the opt-out never makes an unapproved execution pass", async () => {
  const h = await start({ [ALLOW_SELF_APPROVAL_VAR]: "true" });
  assert.equal((await run(h, alice, "initiateMove", "mc-none")).status, 403);
  assert.equal((await run(h, alice, "commit", "mc-none")).status, 403);
});
