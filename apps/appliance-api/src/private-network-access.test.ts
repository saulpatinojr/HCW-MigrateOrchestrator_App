import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders, type Server } from "node:http";
import { noopLogger } from "@amo/observability";
import { StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import { configFromEnv, createEnterpriseApi, InMemoryRepository } from "./index.js";

/**
 * Private Network Access preflight answer (issue 83, F9; ADR-0033 addendum). Chrome sends
 * `Access-Control-Request-Private-Network: true` on a preflight from a public page to a private or loopback address and wants
 * `Access-Control-Allow-Private-Network: true` back. The API answers it only on a preflight from an allowed origin that asked.
 */
const APP = "https://app.example.test";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function start(env: Record<string, string>): Promise<string> {
  const server = createEnterpriseApi(configFromEnv({ AMO_ENTRA_TENANT_ID: "11111111-2222-3333-4444-555555555555", AMO_ENTRA_CLIENT_ID: "amo", ...env }), { validator: null, credential: new StaticTokenCredential(), repository: new InMemoryRepository(), discovery: new FixtureDiscoveryProvider([]), logger: noopLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

interface Answer { status: number; headers: IncomingHttpHeaders }
function call(base: string, method: string, path: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
const corsHeaders = (a: Answer) => Object.keys(a.headers).filter((h) => h.startsWith("access-control-"));

test("preflight from an allowed origin answers Access-Control-Allow-Private-Network: true only when the browser asked", async () => {
  const base = await start({ AMO_ALLOWED_ORIGINS: APP });
  const asked = await call(base, "OPTIONS", "/api/assessments", { origin: APP, "access-control-request-method": "POST", "access-control-request-private-network": "true" });
  assert.equal(asked.status, 204);
  assert.equal(asked.headers["access-control-allow-private-network"], "true");
  assert.equal(asked.headers["access-control-allow-origin"], APP);
  assert.match(String(asked.headers.vary), /Access-Control-Request-Private-Network/i);
  const notAsked = await call(base, "OPTIONS", "/api/assessments", { origin: APP, "access-control-request-method": "POST" });
  assert.equal(notAsked.status, 204);
  assert.ok(!("access-control-allow-private-network" in notAsked.headers), "not asked, not answered");
  const other = await call(base, "OPTIONS", "/api/assessments", { origin: APP, "access-control-request-method": "POST", "access-control-request-private-network": "false" });
  assert.ok(!("access-control-allow-private-network" in other.headers), "only the exact value true counts");
});

test("a disallowed origin, a non-preflight request and the default configuration never get the Private Network answer", async () => {
  const listed = await start({ AMO_ALLOWED_ORIGINS: APP });
  const evil = await call(listed, "OPTIONS", "/api/assessments", { origin: "https://evil.example.test", "access-control-request-method": "POST", "access-control-request-private-network": "true" });
  assert.ok(!("access-control-allow-private-network" in evil.headers));
  assert.deepEqual(corsHeaders(evil), []);
  const get = await call(listed, "GET", "/api/health", { origin: APP, "access-control-request-private-network": "true" });
  assert.ok(!("access-control-allow-private-network" in get.headers), "only a preflight is answered");
  const none = await start({});
  const def = await call(none, "OPTIONS", "/api/assessments", { origin: APP, "access-control-request-method": "POST", "access-control-request-private-network": "true" });
  assert.deepEqual(corsHeaders(def), [], "empty list: no CORS headers at all");
});
