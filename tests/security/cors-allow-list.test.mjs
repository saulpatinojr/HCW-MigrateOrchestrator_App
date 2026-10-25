import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * ADR-0033: the appliance API allows cross-origin browser calls only from the exact origins in AMO_ALLOWED_ORIGINS (empty
 * by default, no wildcard, no credentials). The behaviour over HTTP is asserted against the real request handler in
 * apps/appliance-api/src/cors.test.ts. This file guards what a behaviour test cannot see, by reading files:
 *  - the source never grows a wildcard, a credentials header or a place that copies the Origin header into a response
 *    without an exact match against the list (the usual "quick fix"), and the only CORS code is the one reviewed module;
 *  - the setting is documented where an operator looks, with its rules, and no document suggests a wildcard;
 *  - every file that names the variable names it the way the code does.
 * Historical records (the ADRs, the changelog, VALIDATION.md, the plan files) may discuss wildcards and are skipped.
 */
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const read = (f) => readFileSync(f, "utf8");
const apiSource = tracked.filter((f) => /^apps\/appliance-api\/src\/.*\.ts$/.test(f) && !f.endsWith(".test.ts"));
const HISTORICAL = [/^docs\/adr\//, /^docs\/governance\//, /^CHANGELOG\.md$/, /^VALIDATION\.md$/, /^WORKING-PLAN\.md$/, /^REFACTOR_APP\.md$/];
const operatorDocs = tracked.filter((f) => f.endsWith(".md") && !HISTORICAL.some((rx) => rx.test(f)));

/** Sentences that tell a reader to allow every origin. */
const WILDCARD_ADVICE = [
  /\b(set|use|add|put|allow|enable|configure)\b[^.\n]{0,60}(AMO_ALLOWED_ORIGINS|allowed[- ]origins?|cors)[^.\n]{0,40}(=|to|as)\s*`?\*`?(\s|$|[.,;`])/i,
  /\ballow (all|any|every) origins?\b/i,
  /Access-Control-Allow-Origin:\s*\*/i,
];
const adviceIn = (text) => text.split("\n").flatMap((line, i) => (WILDCARD_ADVICE.some((rx) => rx.test(line)) ? [`line ${i + 1}: ${line.trim().slice(0, 140)}`] : []));

test("the API source has one CORS module, no wildcard, no credentials header and no unchecked echo of Origin", () => {
  assert.ok(apiSource.includes("apps/appliance-api/src/cors.ts"), "the reviewed CORS module");
  const hits = [];
  for (const f of apiSource) {
    const text = read(f);
    const isCors = f.endsWith("/cors.ts");
    if (!isCors && /access-control-|req\.headers\.origin|headers\[["']origin/i.test(text.replace(/^.*\bcors\b.*$/gim, ""))) hits.push(`${f}: CORS headers or the Origin header outside src/cors.ts`);
    // the one allowed use of a "*" literal is the refusal of a wildcard entry: entry.includes("*")
    if (/["'`]\*["'`]/.test(text.replaceAll('.includes("*")', "")) && /origin|cors/i.test(text)) hits.push(`${f}: a "*" literal in a file that deals with origins`);
    if (/allow-credentials/i.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) hits.push(`${f}: Access-Control-Allow-Credentials in code`);
  }
  assert.deepEqual(hits, [], "ADR-0033: exact-match allow-list only; reopen the decision with a new ADR before widening it");
  // the only place the request's Origin reaches a response header is guarded by an exact membership test
  const cors = read("apps/appliance-api/src/cors.ts");
  const code = cors.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const echo = code.indexOf('setHeader("access-control-allow-origin", origin)');
  const guard = code.indexOf("!allowed.includes(origin)");
  assert.ok(guard > 0 && echo > guard, "Access-Control-Allow-Origin is set only after the exact list match");
  assert.equal([...code.matchAll(/setHeader\("access-control-allow-origin"/g)].length, 1, "one place sets it");
  assert.doesNotMatch(code, /allow-credentials/i);
});

test("the handler answers the preflight before the authentication guard, and only for /api/ paths", () => {
  const index = read("apps/appliance-api/src/index.ts");
  const cors = index.indexOf("applyCors(cfg.allowedOrigins, req, res)");
  const guard = index.indexOf("deps.validator.validate(");
  assert.ok(cors > 0 && guard > cors, "applyCors comes first");
  assert.match(index, /url\.pathname\.startsWith\("\/api\/"\) && applyCors\(/);
});

test("the variable is documented where an operator looks, with its rules, and the example files carry it", () => {
  const guide = read("docs/deployment/enterprise.md");
  assert.match(guide, /AMO_ALLOWED_ORIGINS/);
  assert.match(guide, /ADR-0033/);
  assert.match(guide, /comma-separated list of exact origins/);
  assert.match(guide, /no path, no trailing slash/);
  assert.match(guide, /wildcard/i, "it says a wildcard is refused");
  assert.match(guide, /no cookies or other\s+credentials are ever allowed/);
  assert.match(guide, /untested/i, "the Static Web Apps option stays marked untested");
  assert.match(guide, /45 seconds/);
  assert.match(read(".env.example"), /^AMO_ALLOWED_ORIGINS=$/m, "empty by default");
  assert.match(read("docker-compose.appliance.yml"), /AMO_ALLOWED_ORIGINS: "\$\{AMO_ALLOWED_ORIGINS:-\}"/);
  const code = read("apps/appliance-api/src/cors.ts");
  assert.match(code, /ALLOWED_ORIGINS_VAR = "AMO_ALLOWED_ORIGINS"/);
});

test("every operator document that names the variable names it exactly, and none advises a wildcard", () => {
  const mentions = operatorDocs.filter((f) => /AMO_ALLOWED_ORIGIN/.test(read(f)));
  assert.ok(mentions.includes("docs/deployment/enterprise.md"));
  for (const f of mentions) assert.ok(!/AMO_ALLOWED_ORIGIN(?!S\b)/.test(read(f)), `${f}: a misspelt variable name`);
  const hits = operatorDocs.flatMap((f) => adviceIn(read(f)).map((h) => `${f} ${h}`));
  assert.deepEqual(hits, [], "no document may suggest allowing every origin");
});

test("the wildcard detector notices wildcard advice and leaves the statement that a wildcard is refused alone", () => {
  assert.equal(adviceIn("Set AMO_ALLOWED_ORIGINS to `*` while testing.").length, 1);
  assert.equal(adviceIn("Allow all origins on the API.").length, 1);
  assert.equal(adviceIn("Access-Control-Allow-Origin: *").length, 1);
  assert.equal(adviceIn("A wildcard (`*`), `null` or a malformed entry makes the API refuse to start.").length, 0);
});
