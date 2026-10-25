import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { noopLogger } from "@amo/observability";
import { StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import { configFromEnv, createEnterpriseApi, InMemoryRepository } from "./index.js";
import { hostAllowed, parseAllowedHosts } from "./host.js";

/**
 * DNS rebinding (review of pull request 79, finding F8): a web page on another site can make a browser send requests to
 * an address on the developer's own machine under that site's name, so the request carries a Host header the API does
 * not expect. When AMO_ALLOWED_HOSTS is set, any other Host value is refused before a route runs.
 */
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function start(env: Record<string, string> = {}): Promise<number> {
  const server = createEnterpriseApi(configFromEnv(env), { validator: null, credential: new StaticTokenCredential(), repository: new InMemoryRepository(), discovery: new FixtureDiscoveryProvider([]), logger: noopLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return (server.address() as { port: number }).port;
}
function get(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("AMO_ALLOWED_HOSTS is a list of host or host:port values, lower-cased, with nothing else", () => {
  assert.deepEqual(parseAllowedHosts(undefined), []);
  assert.deepEqual(parseAllowedHosts("  "), []);
  assert.deepEqual(parseAllowedHosts("localhost:8081, 127.0.0.1:8081,[::1]:8081,API.Example.com"), ["localhost:8081", "127.0.0.1:8081", "[::1]:8081", "api.example.com"]);
  for (const bad of ["*", "*.example.com", "http://localhost:8081", "localhost:8081/api", "localhost:8081,", "a b", "user@host", "localhost:80:80"]) {
    assert.throws(() => parseAllowedHosts(bad), /AMO_ALLOWED_HOSTS/, bad);
  }
});

test("hostAllowed compares the whole Host header, case-insensitively, and an empty list allows everything", () => {
  assert.equal(hostAllowed([], "anything.example"), true);
  assert.equal(hostAllowed(["localhost:8081"], "LOCALHOST:8081"), true);
  assert.equal(hostAllowed(["localhost:8081"], "localhost"), false);
  assert.equal(hostAllowed(["localhost:8081"], "localhost:8081.evil.example"), false);
  assert.equal(hostAllowed(["localhost:8081"], undefined), false);
});

test("with AMO_ALLOWED_HOSTS set, a request under another Host name is refused with 421 before any route runs", async () => {
  const port = await start({ AMO_ALLOWED_HOSTS: "localhost:8081,127.0.0.1:8081" });
  for (const path of ["/api/health", "/api/agents", "/api/assessments"]) {
    const refused = await get(port, path, "rebind.attacker.example:8081");
    assert.equal(refused.status, 421, path);
    assert.equal(JSON.parse(refused.body).error.code, "misdirected_request");
  }
  assert.equal((await get(port, "/api/health", "localhost:8081")).status, 200);
  assert.equal((await get(port, "/api/health", "127.0.0.1:8081")).status, 200);
});

test("without AMO_ALLOWED_HOSTS nothing changes: any Host is served (Azure sets none)", async () => {
  const port = await start();
  assert.equal((await get(port, "/api/health", "ca-example.azurecontainerapps.io")).status, 200);
});

test("an IP address as the Host is always served, because DNS rebinding needs a name (the image's own health check uses 127.0.0.1)", () => {
  const list = ["localhost:9000"];
  assert.equal(hostAllowed(list, "127.0.0.1:8081"), true);
  assert.equal(hostAllowed(list, "127.0.0.1"), true);
  assert.equal(hostAllowed(list, "[::1]:8081"), true);
  assert.equal(hostAllowed(list, "10.0.0.5:8081"), true);
  assert.equal(hostAllowed(list, "127.0.0.1.attacker.example:8081"), false);
  assert.equal(hostAllowed(list, "999.0.0.1:8081"), false);
  assert.equal(hostAllowed(list, "attacker.example"), false);
  assert.equal(hostAllowed(list, "[::1"), false);
});
