import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { connect } from "node:net";
import type { Server } from "node:http";
import { noopLogger } from "@amo/observability";
import { StaticTokenCredential } from "@amo/azure-auth";
import { FixtureDiscoveryProvider } from "@amo/azure-discovery";
import { configFromEnv, createEnterpriseApi, InMemoryRepository } from "./index.js";
import { installFatalHandlers, type FatalProcess } from "./fatal.js";

/**
 * A request target such as "//" cannot be parsed by `new URL`. The parse used to sit outside the handler's try, so one
 * unauthenticated "GET //" threw out of an async handler and ended the process (review of pull request 79). The target is
 * sent over a raw socket because an HTTP client library would normalise or refuse it.
 */
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });
async function start(env: Record<string, string> = {}): Promise<number> {
  const server = createEnterpriseApi(configFromEnv(env), { validator: null, credential: new StaticTokenCredential(), repository: new InMemoryRepository(), discovery: new FixtureDiscoveryProvider([]), logger: noopLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return (server.address() as { port: number }).port;
}

/** One raw HTTP/1.1 request; the request line is written byte for byte. */
function raw(port: number, requestLine: string, headers: string[] = []): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write([requestLine, "Host: 127.0.0.1", ...headers, "Connection: close", "", ""].join("\r\n")));
    const chunks: Buffer[] = [];
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("error", reject);
    socket.on("close", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const [head, ...rest] = text.split("\r\n\r\n");
      const lines = head.split("\r\n");
      const headersOut: Record<string, string> = {};
      for (const l of lines.slice(1)) { const i = l.indexOf(":"); if (i > 0) headersOut[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
      const body = rest.join("\r\n\r\n");
      resolve({ status: Number(lines[0].split(" ")[1] ?? 0), headers: headersOut, body: headersOut["transfer-encoding"] === "chunked" ? unchunk(body) : body });
    });
  });
}

/** Decode a chunked body: "<hex size>\r\n<data>\r\n" repeated, ended by a zero-size chunk. */
function unchunk(body: string): string {
  let out = "";
  let rest = body;
  for (;;) {
    const eol = rest.indexOf("\r\n");
    if (eol < 0) return out;
    const size = parseInt(rest.slice(0, eol), 16);
    if (!size) return out;
    out += rest.slice(eol + 2, eol + 2 + size);
    rest = rest.slice(eol + 2 + size + 2);
  }
}

const MALFORMED = ["//", "///", "//[", "//%", "//a b", "//[::1"];

test("a request target that cannot be parsed answers 400 bad_request, and the server keeps serving", async () => {
  const port = await start();
  for (const target of MALFORMED) {
    if (target.includes(" ")) continue; // a space would end the request line; covered by the HTTP parser itself
    const answer = await raw(port, `GET ${target} HTTP/1.1`);
    assert.equal(answer.status, 400, `GET ${target}`);
    assert.equal(JSON.parse(answer.body).error.code, "bad_request");
    assert.equal(answer.headers["content-type"], "application/json");
    assert.equal(answer.headers["x-content-type-options"], "nosniff");
    assert.ok(!Object.keys(answer.headers).some((h) => h.startsWith("access-control-")), "no CORS headers when none are configured");
    // the process is alive and the next request is served normally
    const health = await raw(port, "GET /api/health HTTP/1.1");
    assert.equal(health.status, 200, `/api/health after GET ${target}`);
    assert.equal(JSON.parse(health.body).ok, true);
  }
  for (const method of ["POST", "OPTIONS", "DELETE"]) {
    assert.equal((await raw(port, `${method} // HTTP/1.1`)).status, 400, method);
  }
  assert.equal((await raw(port, "GET /api/health HTTP/1.1")).status, 200);
});

test("the 400 is readable by an allowed origin and carries no CORS headers for any other (ADR-0033: errors included)", async () => {
  const app = "https://app.example.test";
  const port = await start({ AMO_ALLOWED_ORIGINS: app });
  const allowed = await raw(port, "GET // HTTP/1.1", [`Origin: ${app}`]);
  assert.equal(allowed.status, 400);
  assert.equal(allowed.headers["access-control-allow-origin"], app);
  assert.match(allowed.headers.vary ?? "", /Origin/i);
  assert.ok(!("access-control-allow-credentials" in allowed.headers));
  const other = await raw(port, "GET // HTTP/1.1", ["Origin: https://evil.example.test"]);
  assert.equal(other.status, 400);
  assert.ok(!("access-control-allow-origin" in other.headers), "a disallowed origin is not reflected");
  assert.match(other.headers.vary ?? "", /Origin/i);
  const none = await raw(port, "GET // HTTP/1.1");
  assert.equal(none.status, 400);
  assert.ok(!("access-control-allow-origin" in none.headers));
  // a malformed target is never answered as a preflight, even from an allowed origin
  const pre = await raw(port, "OPTIONS // HTTP/1.1", [`Origin: ${app}`, "Access-Control-Request-Method: POST"]);
  assert.equal(pre.status, 400);
  assert.ok(!("access-control-allow-methods" in pre.headers));
  assert.equal((await raw(port, "GET /api/health HTTP/1.1", [`Origin: ${app}`])).status, 200);
});

test("the last-resort guard logs one content-free line and exits non-zero; it does not swallow the error", () => {
  const proc = Object.assign(new EventEmitter(), { stderr: { write(t: string) { written.push(t); } }, exit(code: number) { exits.push(code); } });
  const written: string[] = [];
  const exits: number[] = [];
  installFatalHandlers(proc as unknown as FatalProcess);
  assert.equal(proc.listenerCount("uncaughtException"), 1);
  assert.equal(proc.listenerCount("unhandledRejection"), 1);
  proc.emit("uncaughtException", new Error("secret-ish message with a token abc.def.ghi"));
  proc.emit("unhandledRejection", "another secret-ish reason");
  assert.deepEqual(exits, [1, 1]);
  assert.equal(written.length, 2);
  for (const line of written) {
    assert.doesNotMatch(line, /secret-ish|abc\.def|stack|at /i, "content-free: no message, reason or stack");
    assert.match(line, /"msg":"fatal: unhandled error, exiting"/);
    assert.ok(line.endsWith("\n"));
  }
  assert.match(written[0], /"kind":"uncaughtException"/);
  assert.match(written[1], /"kind":"unhandledRejection"/);
});
