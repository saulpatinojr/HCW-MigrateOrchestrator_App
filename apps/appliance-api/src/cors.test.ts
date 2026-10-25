import { test, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { request, type IncomingHttpHeaders, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { noopLogger } from "@amo/observability";
import { EntraTokenValidator, StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import { ALLOWED_ORIGINS_VAR, CORS_HEADERS, CORS_MAX_AGE_SECONDS, CORS_METHODS, configFromEnv, createEnterpriseApi, InMemoryRepository, parseAllowedOrigins } from "./index.js";

/**
 * CORS allow-list (ADR-0033, ticket #44). Everything here talks to the real request handler over node:http, with the
 * Origin header set by hand (the global fetch is not used: it is a browser-style API and would not prove the header was
 * sent). The owner's decision: AMO_ALLOWED_ORIGINS is a comma-separated list of exact origins, empty by default (no CORS
 * headers at all), no wildcard, no credentials, preflight answered before authentication and only for listed origins.
 */
const TENANT = "11111111-2222-3333-4444-555555555555";
const APP = "https://app.example.test";
const LOCAL = "http://localhost:5174";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (roles: string[]) => { const h = b64({ alg: "RS256", kid: "k1" }); const p = b64({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: "api://amo", oid: "oid-cors", sub: "s", roles, nbf: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 600 }); return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`; };
const fakeFetch = (async (url: string) => {
  if (url.includes("discovery/v2.0/keys")) return new Response(JSON.stringify({ keys: [{ kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e }] }), { status: 200 });
  return new Response("{}", { status: 202 });
}) as unknown as typeof fetch;

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function start(allowed: string | undefined): Promise<string> {
  const env: Record<string, string> = { AMO_ENTRA_TENANT_ID: TENANT, AMO_ENTRA_CLIENT_ID: "amo", AMO_ENTRA_AUDIENCE: "api://amo" };
  if (allowed !== undefined) env.AMO_ALLOWED_ORIGINS = allowed;
  const server = createEnterpriseApi(configFromEnv(env), { validator: new EntraTokenValidator({ tenantId: TENANT, audiences: ["api://amo"], fetchImpl: fakeFetch }), credential: new StaticTokenCredential(), repository: new InMemoryRepository(), discovery: new FixtureDiscoveryProvider([]), fetchImpl: fakeFetch, logger: noopLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

interface Answer { status: number; headers: IncomingHttpHeaders; body: string }
/** One raw HTTP request with exactly the headers given. */
function call(base: string, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const corsHeaders = (a: Answer) => Object.keys(a.headers).filter((h) => h.startsWith("access-control-"));
const varies = (a: Answer) => String(a.headers.vary ?? "").split(",").map((x) => x.trim().toLowerCase());
const bearer = (roles = ["Migration.Plan"]) => ({ authorization: `Bearer ${mint(roles)}` });

// ---- configuration -------------------------------------------------------------------------------------------------------

test("AMO_ALLOWED_ORIGINS: unset, empty or blank means no origins; exact origins are accepted", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(""), []);
  assert.deepEqual(parseAllowedOrigins("  "), []);
  assert.deepEqual(parseAllowedOrigins(APP), [APP]);
  assert.deepEqual(parseAllowedOrigins(` ${APP} , ${LOCAL} ,${APP}`), [APP, LOCAL], "spaces around entries are ignored and a repeated entry counts once");
  assert.deepEqual(parseAllowedOrigins("https://app.example.test:8443,http://127.0.0.1:3000"), ["https://app.example.test:8443", "http://127.0.0.1:3000"]);
  assert.deepEqual(parseAllowedOrigins("http://localhost:5174,http://127.0.0.1:3000,http://[::1]:3000,http://localhost:8080"), ["http://localhost:5174", "http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost:8080"], "plain http is accepted for the three loopback hosts only");
  assert.deepEqual(parseAllowedOrigins("https://localhost:5174"), ["https://localhost:5174"], "https is fine for any host");
  assert.equal(configFromEnv({}).allowedOrigins.length, 0, "the default is empty");
  assert.deepEqual(configFromEnv({ AMO_ALLOWED_ORIGINS: APP }).allowedOrigins, [APP]);
});

test("AMO_ALLOWED_ORIGINS: a wildcard, null, a path, a trailing slash or any malformed entry is refused, naming the variable", () => {
  const refused: Array<[string, RegExp]> = [
    ["*", /wildcard/],
    ["https://*.example.test", /wildcard/],
    [`${APP},*`, /wildcard/],
    ["null", /"null"/],
    ["NULL", /"null"/],
    [`${APP}/`, /not an exact origin.*write it as https:\/\/app\.example\.test/],
    [`${APP}/app`, /not an exact origin/],
    [`${APP}?x=1`, /not an exact origin/],
    ["https://APP.example.test", /not an exact origin.*write it as https:\/\/app\.example\.test/],
    ["https://app.example.test:443", /not an exact origin.*write it as https:\/\/app\.example\.test/],
    ["http://app.example.test:80", /not an exact origin/],
    ["http://app.example.test", /http:\/\/ for a host that is not loopback.*use https:\/\//],
    ["http://app.example.test:8080", /not loopback/],
    ["http://localhost.evil.test:3000", /not loopback/],
    ["http://127.0.0.2:3000", /not loopback/],
    ["http://0.0.0.0:3000", /not loopback/],
    ["http://10.0.0.5:8080", /not loopback/],
    [`${APP},http://app.example.test:8080`, /not loopback/],
    ["https://user@app.example.test", /not an exact origin/],
    ["app.example.test", /not a URL/],
    ["ftp://app.example.test", /must start with https/],
    [`${APP},,${LOCAL}`, /is empty/],
    [`${APP},`, /is empty/],
    ["https://", /not a URL/],
  ];
  for (const [value, why] of refused) {
    assert.throws(() => parseAllowedOrigins(value), (e: Error) => e.message.includes(ALLOWED_ORIGINS_VAR) && why.test(e.message) && /^refusing to start/.test(e.message), `${JSON.stringify(value)}`);
    assert.throws(() => configFromEnv({ AMO_ALLOWED_ORIGINS: value }), new RegExp(ALLOWED_ORIGINS_VAR), `configFromEnv ${JSON.stringify(value)}`);
  }
});

test("the server process exits non-zero with a message naming AMO_ALLOWED_ORIGINS when it is malformed", () => {
  const server = fileURLToPath(new URL("./server.js", import.meta.url));
  for (const value of ["*", "https://app.example.test/"]) {
    const r = spawnSync(process.execPath, [server], { env: { PATH: process.env.PATH ?? "", PORT: "0", AMO_ALLOWED_ORIGINS: value }, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 1, value);
    assert.match(r.stderr, /refusing to start: AMO_ALLOWED_ORIGINS entry/, value);
  }
});

// ---- behaviour over HTTP -------------------------------------------------------------------------------------------------

test("default (variable unset or empty): no CORS header of any kind, no Vary, preflight not answered, behaviour as before", async () => {
  for (const setting of [undefined, ""]) {
    const base = await start(setting);
    const probes: Answer[] = [
      await call(base, "GET", "/api/health", { origin: APP }),
      await call(base, "GET", "/api/agents", { origin: APP }),
      await call(base, "GET", "/api/me", { origin: APP }),
      await call(base, "GET", "/api/me", { origin: APP, ...bearer() }),
      await call(base, "GET", "/api/nope", { origin: APP }),
      await call(base, "OPTIONS", "/api/health", { origin: APP, "access-control-request-method": "GET" }),
      await call(base, "OPTIONS", "/api/assessments", { origin: APP, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" }),
      await call(base, "GET", "/api/health"),
    ];
    for (const a of probes) {
      assert.deepEqual(corsHeaders(a), [], `no Access-Control-* header (setting ${JSON.stringify(setting)})`);
      assert.ok(!("vary" in a.headers), "no Vary header either: nothing about the response depends on Origin");
    }
    assert.deepEqual(probes.map((a) => a.status), [200, 200, 401, 200, 401, 200, 401, 200], "the statuses are what they were before CORS existed: a preflight is not special-cased");
    assert.equal(JSON.parse(probes[0].body).ok, true);
  }
});

test("an allowed origin gets exactly that origin back, Vary: Origin, and no credentials header, on every kind of answer", async () => {
  const base = await start(`${APP},${LOCAL}`);
  const answers: Array<[string, Answer]> = [
    ["health", await call(base, "GET", "/api/health", { origin: APP })],
    ["agents", await call(base, "GET", "/api/agents", { origin: LOCAL })],
    ["401 without a token", await call(base, "GET", "/api/me", { origin: APP })],
    ["200 with a token", await call(base, "GET", "/api/me", { origin: APP, ...bearer() })],
    ["unknown route (401: the guard comes first)", await call(base, "GET", "/api/nope", { origin: APP })],
  ];
  assert.deepEqual(answers.map(([, a]) => a.status), [200, 200, 401, 200, 401]);
  for (const [what, a] of answers) {
    const origin = what === "agents" ? LOCAL : APP;
    assert.equal(a.headers["access-control-allow-origin"], origin, `${what}: the exact origin, not a wildcard`);
    assert.ok(varies(a).includes("origin"), `${what}: Vary: Origin`);
    assert.ok(!("access-control-allow-credentials" in a.headers), `${what}: credentials are never allowed (bearer tokens, not cookies)`);
    assert.ok(!("access-control-allow-methods" in a.headers) && !("access-control-max-age" in a.headers), `${what}: preflight-only headers stay out of ordinary answers`);
  }
  // the API's own headers survive next to the CORS ones
  assert.equal(answers[0][1].headers["cache-control"], "no-store");
  assert.equal(answers[0][1].headers["x-content-type-options"], "nosniff");
  assert.equal(JSON.parse(answers[0][1].body).ok, true, "/api/health answers as before");
});

test("a disallowed origin, a look-alike or a missing Origin gets no CORS headers (Vary: Origin stays) and the request still needs a token", async () => {
  const base = await start(`${APP},${LOCAL}`);
  const lookalikes = ["https://evil.example.test", `${APP}.evil.test`, "https://app.example.test:8443", "http://app.example.test", "https://APP.EXAMPLE.TEST", `${APP}/`, "null", "*", "https://sub.app.example.test", "http://localhost:5175", "http://localhost"];
  for (const origin of lookalikes) {
    const health = await call(base, "GET", "/api/health", { origin });
    assert.deepEqual(corsHeaders(health), [], `${origin}: nothing granted`);
    assert.ok(varies(health).includes("origin"), `${origin}: Vary: Origin so a cache cannot hand this answer to an allowed origin`);
    assert.equal(health.status, 200);
    const me = await call(base, "GET", "/api/me", { origin });
    assert.equal(me.status, 401, `${origin}: the request still needs a token`);
    assert.deepEqual(corsHeaders(me), []);
    assert.equal((await call(base, "GET", "/api/me", { origin, ...bearer() })).status, 200, "the server does not use Origin to refuse a valid token: CORS only tells the browser what a page may read");
  }
  const none = await call(base, "GET", "/api/health");
  assert.deepEqual(corsHeaders(none), []);
  assert.ok(varies(none).includes("origin"));
  assert.equal(none.status, 200);
});

test("preflight from an allowed origin is answered 204 before authentication, with the exact origin, methods, headers and a modest max age", async () => {
  const base = await start(`${APP},${LOCAL}`);
  for (const origin of [APP, LOCAL]) {
    for (const path of ["/api/assessments", "/api/approvals", "/api/execution/resource-mover/initiateMove", "/api/health", "/api/me"]) {
      const a = await call(base, "OPTIONS", path, { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" });
      assert.equal(a.status, 204, `${origin} ${path}: no token needed for a preflight`);
      assert.equal(a.body, "");
      assert.equal(a.headers["access-control-allow-origin"], origin);
      assert.equal(a.headers["access-control-allow-methods"], CORS_METHODS);
      assert.equal(a.headers["access-control-allow-headers"], CORS_HEADERS);
      assert.equal(a.headers["access-control-max-age"], CORS_MAX_AGE_SECONDS);
      assert.ok(varies(a).includes("origin"));
      assert.ok(!("access-control-allow-credentials" in a.headers));
    }
  }
  assert.equal(CORS_METHODS, "GET, POST, OPTIONS", "the methods the API really uses");
  assert.equal(CORS_HEADERS, "Authorization, Content-Type");
  assert.ok(Number(CORS_MAX_AGE_SECONDS) > 0 && Number(CORS_MAX_AGE_SECONDS) <= 3600, "modest");
  assert.doesNotMatch(CORS_METHODS + CORS_HEADERS, /\*|DELETE|PUT|PATCH/);
});

test("preflight from a disallowed origin gets no CORS headers and no special treatment; OPTIONS without a request method is not a preflight", async () => {
  const base = await start(APP);
  const pre = { "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" };
  const denied = await call(base, "OPTIONS", "/api/assessments", { origin: "https://evil.example.test", ...pre });
  assert.equal(denied.status, 401, "not answered as a preflight: it meets the auth guard like any request");
  assert.deepEqual(corsHeaders(denied), []);
  assert.ok(varies(denied).includes("origin"));
  const deniedHealth = await call(base, "OPTIONS", "/api/health", { origin: "https://evil.example.test", ...pre });
  assert.equal(deniedHealth.status, 200, "/api/health keeps answering as it did");
  assert.deepEqual(corsHeaders(deniedHealth), []);
  const noOrigin = await call(base, "OPTIONS", "/api/assessments", pre);
  assert.equal(noOrigin.status, 401);
  assert.deepEqual(corsHeaders(noOrigin), []);
  // an OPTIONS request from an allowed origin that asks for no method is not a preflight: it falls through to the normal handler
  const plain = await call(base, "OPTIONS", "/api/assessments", { origin: APP });
  assert.equal(plain.status, 401);
  assert.equal(plain.headers["access-control-allow-origin"], APP);
  assert.ok(!("access-control-allow-methods" in plain.headers));
});

test("authentication is still enforced after a preflight: the real request needs the Entra token, with or without CORS", async () => {
  const base = await start(APP);
  const pre = await call(base, "OPTIONS", "/api/assessments", { origin: APP, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" });
  assert.equal(pre.status, 204);
  const body = JSON.stringify({ scope: { kind: "subscription", id: "00000000-0000-4000-8000-000000000001" }, intent: {} });
  const noToken = await call(base, "POST", "/api/assessments", { origin: APP, "content-type": "application/json" }, body);
  assert.equal(noToken.status, 401);
  assert.equal(noToken.headers["access-control-allow-origin"], APP, "the browser can read the 401");
  const badToken = await call(base, "POST", "/api/assessments", { origin: APP, "content-type": "application/json", authorization: "Bearer not.a.token" }, body);
  assert.equal(badToken.status, 401);
  const wrongRole = await call(base, "POST", "/api/approvals", { origin: APP, "content-type": "application/json", ...bearer(["Migration.Plan"]) }, JSON.stringify({ operation: "production-deploy", targetKey: "x" }));
  assert.equal(wrongRole.status, 403, "authorization levels are unchanged by CORS");
  const real = await call(base, "POST", "/api/assessments", { origin: APP, "content-type": "application/json", ...bearer() }, body);
  assert.equal(real.status, 201);
  assert.equal(real.headers["access-control-allow-origin"], APP);
  for (const [method, path] of [["GET", "/api/me"], ["GET", "/api/scopes"], ["GET", "/api/assessments"], ["POST", "/api/assessments"], ["POST", "/api/approvals"], ["GET", "/api/operations/x"]] as const) {
    const r = await call(base, method, path, { origin: APP, "content-type": "application/json" }, method === "POST" ? "{}" : undefined);
    assert.equal(r.status, 401, `${method} ${path} without a token`);
  }
});

test("the Origin header is never reflected unvalidated, and there is no wildcard anywhere", async () => {
  const base = await start(`${APP},${LOCAL}`);
  const answers = [
    await call(base, "GET", "/api/health", { origin: "https://evil.example.test" }),
    await call(base, "OPTIONS", "/api/health", { origin: "https://evil.example.test", "access-control-request-method": "GET" }),
    await call(base, "GET", "/api/health", { origin: APP }),
    await call(base, "OPTIONS", "/api/health", { origin: APP, "access-control-request-method": "GET" }),
  ];
  for (const a of answers) {
    for (const [name, value] of Object.entries(a.headers)) {
      if (name.startsWith("access-control-")) assert.ok(String(value) !== "*" && !String(value).includes("evil"), `${name}: ${value}`);
    }
  }
  assert.equal(answers[0].headers["access-control-allow-origin"], undefined);
  assert.equal(answers[2].headers["access-control-allow-origin"], APP);
});
