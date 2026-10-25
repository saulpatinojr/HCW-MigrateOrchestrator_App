import { test } from "node:test";
import assert from "node:assert/strict";
import { embedsPassword } from "./database-url.js";

test("embedsPassword finds a password in the address or in an option, and nothing else", () => {
  assert.equal(embedsPassword("postgres://u:pw@psql-x.postgres.database.azure.com/amo"), true);
  assert.equal(embedsPassword("postgres://u:pw@psql-x.postgres.database.azure.com:5432/amo?sslmode=require"), true);
  assert.equal(embedsPassword("postgres://psql-x.postgres.database.azure.com/amo?user=u&password=pw"), true);
  assert.equal(embedsPassword("postgres://u@psql-x.postgres.database.azure.com/amo"), false);
  assert.equal(embedsPassword("postgres://id-amo@psql-amo.postgres.database.azure.com:5432/amo?sslmode=require"), false);
  assert.equal(embedsPassword("postgres://psql-x.postgres.database.azure.com:5432/amo"), false);
  assert.equal(embedsPassword("postgres://u:@host/amo"), false);
  assert.equal(embedsPassword(""), false);
});

test("embedsPassword answers like the expression it replaced, on ordinary and awkward values", () => {
  // The expression CodeQL flagged (alert 1). It is kept here only as the reference answer; it is never run on large input.
  const reference = (url: string): boolean => /password=|:\/\/[^/]*:[^@]+@/.test(url);
  const samples = [
    "postgres://u:pw@h/amo", "postgres://u:p@ss@h/amo", "postgres://u:p/w@h/amo", "postgres://u:@h/amo", "postgres://u::@h/amo",
    "postgres://:pw@h/amo", "postgres://:@h", "postgres://h:5432/amo", "postgres://h:5432/amo?x=a@b", "postgres://h/amo?x=a:b@c",
    "postgres://u@h:5432/amo", "postgres://u@h:5432", "postgres://u:pw@", "postgres://u:", "postgres://", "://", "://:", "://::@", "://a:b@",
    "http://a:b@c/redirect=https://d:e@f", "postgres://u:pw@h/amo?sslmode=require", "postgres://h/amo?password=x", "no scheme here: at all @",
  ];
  for (const s of samples) assert.equal(embedsPassword(s), reference(s), `different answer for ${JSON.stringify(s)}`);
});

test("embedsPassword stays fast on a crafted value (CodeQL js/polynomial-redos, alert 1)", () => {
  // Many colons after "://": the old expression rescanned the rest of the value from every colon.
  for (const crafted of ["://" + ":".repeat(100_000), "://" + ":".repeat(100_000) + "x", "://" + "a:".repeat(50_000), "://".repeat(30_000) + ":"]) {
    const t0 = performance.now();
    embedsPassword(crafted);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `embedsPassword took ${Math.round(ms)} ms on a ${crafted.length}-character value`);
  }
});
