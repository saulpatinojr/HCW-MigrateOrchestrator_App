import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, createLogger } from "./index.js";

test("redact masks connection strings, SAS tokens and JWTs", () => {
  const s = "DefaultEndpointsProtocol=https;AccountKey=abc123SECRET==;sig=abcdefghijklmnopqrstuvwxyz0123 token=eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu";
  const r = redact(s);
  assert.ok(!r.includes("abc123SECRET"));
  assert.ok(!r.includes("abcdefghijklmnopqrstuvwxyz0123"));
  assert.ok(!r.includes("eyJhbGciOiJIUzI1NiIs"));
});

test("logger never emits nested objects (no raw rows)", () => {
  const out: unknown[] = [];
  const log = createLogger({}, (r) => out.push(r));
  log.info("x", { row: { a: 1 }, id: "abc" });
  assert.equal((out[0] as { attrs: Record<string, unknown> }).attrs.row, "[object]");
});

// AMO-13: every value below is invented. The JWT and the key body are built from harmless words, not taken from anywhere.
const b64url = (s: string): string => Buffer.from(s).toString("base64url");
const fakeJwt = (): string =>
  [b64url('{"alg":"HS256","typ":"JWT"}'), b64url('{"sub":"fake-user","note":"not a real token"}'), b64url("fake-signature-bytes-0123456789")].join(".");
// The header is joined from pieces on purpose: the repository's own secret scan (tests/security/no-secrets.test.mjs)
// fails on the whole header written out in one piece, and these tests must not trip it.
const pemHeader = (label = "PRIVATE KEY"): string => "-----BEGIN " + label + "-----";
const fakePem = (label = "PRIVATE KEY"): string => {
  const body = Buffer.from("this is not a real key, only filler text ".repeat(6)).toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
};

test("redact removes a JWT completely, with no key name in front of it", () => {
  const jwt = fakeJwt();
  assert.ok(jwt.startsWith("eyJ"));
  const r = redact(`request failed for ${jwt} at step 3`);
  assert.equal(r, "request failed for [REDACTED] at step 3");
  assert.ok(!r.includes("eyJ"));
});

test("redact removes a JWT after Bearer and after a colon", () => {
  const jwt = fakeJwt();
  assert.equal(redact(`Authorization: Bearer ${jwt}`), "Authorization: Bearer [REDACTED]");
  assert.equal(redact(`jwt:${jwt}`), "jwt:[REDACTED]");
});

test("redact removes an unsigned JWT (empty signature part)", () => {
  const [h, p] = fakeJwt().split(".");
  assert.equal(redact(`id=${h}.${p}.`), "id=[REDACTED]");
});

test("redact removes a whole PEM private key block, whatever its type, and keeps the text around it", () => {
  for (const label of ["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "ENCRYPTED PRIVATE KEY", "OPENSSH PRIVATE KEY"]) {
    const pem = fakePem(label);
    const r = redact(`before\n${pem}\nafter`);
    assert.equal(r, "before\n[REDACTED]\nafter", label);
    assert.ok(!r.includes("BEGIN") && !r.includes("END"), label);
  }
});

test("redact removes an old encrypted PEM key whose header lines contain a colon and a dash", () => {
  const body = Buffer.from("filler text, not a key ".repeat(8)).toString("base64");
  const pem = `${pemHeader("RSA PRIVATE KEY")}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00112233445566778899AABBCCDDEEFF\n\n${body}\n-----END RSA PRIVATE KEY-----`;
  assert.equal(redact(`key ${pem} done`), "key [REDACTED] done");
});

test("redact removes a PEM key that was cut off before its END line", () => {
  const cut = fakePem().split("-----END")[0];
  const r = redact(cut);
  assert.equal(r, "[REDACTED]");
});

test("redact keeps the key name and hides the value for password, secret, token and pwd", () => {
  assert.equal(redact("password=hunter2 next"), "password=[REDACTED] next");
  assert.equal(redact("PWD: fake-value-1, rest"), "PWD: [REDACTED], rest");
  assert.equal(redact("client_secret=fakeSecretValue;x=1"), "client_secret=[REDACTED];x=1");
  assert.equal(redact("token = fake-token-value"), "token = [REDACTED]");
});

test("redact keeps AccountKey= and SharedAccessSignature= and hides the value", () => {
  assert.equal(
    redact("DefaultEndpointsProtocol=https;AccountName=fakeaccount;AccountKey=ZmFrZWtleQ==;EndpointSuffix=core.windows.net"),
    "DefaultEndpointsProtocol=https;AccountName=fakeaccount;AccountKey=[REDACTED];EndpointSuffix=core.windows.net",
  );
  assert.equal(redact("SharedAccessSignature=fakevalue123;Other=1"), "SharedAccessSignature=[REDACTED];Other=1");
});

test("redact keeps sig= and hides a SAS signature value", () => {
  const url = "https://fakeaccount.blob.core.windows.net/c/b?sv=2024-01-01&sig=ZmFrZXNpZ25hdHVyZTAxMjM0NTY3ODk%3D&se=2030";
  const r = redact(url);
  assert.ok(r.includes("sig=[REDACTED]"));
  assert.ok(!r.includes("ZmFrZXNpZ25hdHVyZTAxMjM0NTY3ODk"));
  assert.equal(redact("sig=short"), "sig=short", "a value under 20 characters is not treated as a signature");
});

test("redact handles a mixed line and leaves ordinary text alone", () => {
  const jwt = fakeJwt();
  const line = `user=alice ok; password=hunter2; AccountKey=ZmFrZQ==; auth=${jwt}; sig=ZmFrZXNpZ25hdHVyZTAxMjM0NTY3ODk=; done in 42ms`;
  assert.equal(
    redact(line),
    "user=alice ok; password=[REDACTED]; AccountKey=[REDACTED]; auth=[REDACTED]; sig=[REDACTED]; done in 42ms",
  );
  const plain = "migrated 12 resources from rg-app-prod to westus3 in 3.2s";
  assert.equal(redact(plain), plain);
  assert.equal(redact(""), "");
});

test("redact is idempotent: redacting twice gives the same text", () => {
  const once = redact(`password=hunter2 ${fakeJwt()} ${fakePem()}`);
  assert.equal(redact(once), once);
});

test("redact stays fast on 100k-character hostile input", () => {
  const n = 100_000;
  const inputs: Record<string, string> = {
    "repeated PEM header (the CodeQL example)": pemHeader().repeat(Math.ceil(n / 27)),
    "repeated PEM header with a body but no footer": (pemHeader() + "AAAA\n").repeat(Math.ceil(n / 32)),
    "repeated eyJ": "eyJ".repeat(Math.ceil(n / 3)),
    "repeated -eyJ": "-eyJ".repeat(Math.ceil(n / 4)),
    "JWT headers with no payload": "eyJaaaaaaaaaaaa.".repeat(Math.ceil(n / 16)),
    "repeated sig=": "sig=".repeat(n / 4),
    "repeated AccountKey=": "AccountKey=".repeat(Math.ceil(n / 11)),
    "repeated password=": "password=".repeat(Math.ceil(n / 9)),
    "key name then endless spaces": "token" + " ".repeat(n),
    "repeated key name and spaces": "password   ".repeat(Math.ceil(n / 11)),
    "one long plain word": "a".repeat(n),
    "one long base64 run": "A".repeat(n) + "=",
  };
  for (const [name, input] of Object.entries(inputs)) {
    const t0 = performance.now();
    redact(input);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${name}: took ${ms.toFixed(0)} ms`);
  }
});

test("createLogger redacts a JWT and a PEM key in the message and in attributes", () => {
  const out: Array<{ msg: string; attrs: Record<string, unknown> }> = [];
  const log = createLogger({}, (r) => out.push(r));
  log.error(`failed with ${fakeJwt()}`, { key: fakePem(), id: "abc" });
  assert.equal(out[0].msg, "failed with [REDACTED]");
  assert.equal(out[0].attrs.key, "[REDACTED]");
  assert.equal(out[0].attrs.id, "abc");
});
