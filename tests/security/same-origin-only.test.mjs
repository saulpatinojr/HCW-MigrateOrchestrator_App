import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * ADR-0031: the appliance web UI and API are same-origin only and the API has no CORS support. The HTTP behaviour (no
 * `Access-Control-*` header on any response, preflight included) is asserted against the real handler in
 * apps/appliance-api/src/enterprise.test.ts. This file guards the other two ways the decision can rot:
 *  - someone adds CORS code (often a wildcard "quick fix") to the API source, or
 *  - a document tells an operator to configure CORS or an allowed-origins list that does not exist (ticket #44).
 * Historical or downstream-planning records are not instructions to an operator of this API and are skipped: the ADRs, the
 * changelog, VALIDATION.md, WORKING-PLAN.md (it plans the downstream lab pane), REFACTOR_APP.md and the governance reports.
 */
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const apiSource = tracked.filter((f) => /^apps\/appliance-api\/src\/.*\.ts$/.test(f) && !f.endsWith(".test.ts"));
const HISTORICAL = [/^docs\/adr\//, /^docs\/governance\//, /^CHANGELOG\.md$/, /^VALIDATION\.md$/, /^WORKING-PLAN\.md$/, /^REFACTOR_APP\.md$/];
const operatorDocs = tracked.filter((f) => f.endsWith(".md") && !HISTORICAL.some((rx) => rx.test(f)));

/** Sentences that tell a reader to set up CORS or an allowed-origins list, or name a setting that does not exist. */
const INSTRUCTION = [
  /\bAMO_ALLOWED_ORIGINS\b/,
  /\b(add|set|configure|enable|allow|whitelist|list|register)\b[^.\n]{0,80}\b(cors|allowed[- ]origins?|origin allow-?list|access-control-allow-origin)\b/i,
];
const instructionsIn = (text) => text.split("\n").flatMap((line, i) => (INSTRUCTION.some((rx) => rx.test(line)) ? [`line ${i + 1}: ${line.trim().slice(0, 140)}`] : []));

test("the API source contains no CORS code and no wildcard origin", () => {
  assert.ok(apiSource.length >= 3, `expected the appliance-api sources, found ${apiSource.join(", ")}`);
  const hits = [];
  for (const f of apiSource) {
    const text = readFileSync(f, "utf8");
    if (/access-control-|\bcors\b|allowed[_ -]?origins?/i.test(text)) hits.push(`${f}: CORS code or setting`);
    if (/["']origin["']\s*\]|headers\.origin|req\.headers\[["']origin/i.test(text)) hits.push(`${f}: reads the request Origin header`);
  }
  assert.deepEqual(hits, [], "ADR-0031: same-origin only. Reopen the decision with a new ADR before adding CORS.");
});

test("no operator document tells anyone to configure CORS or an allowed-origins list", () => {
  assert.ok(operatorDocs.includes("docs/deployment/enterprise.md"), "the enterprise deployment guide must be checked");
  const hits = operatorDocs.flatMap((f) => instructionsIn(readFileSync(f, "utf8")).map((h) => `${f} ${h}`));
  assert.deepEqual(hits, [], "documents must say the API is same-origin only (ADR-0031), not promise a CORS setting");
});

test("the enterprise guide says the API is same-origin only and points at ADR-0031", () => {
  const text = readFileSync("docs/deployment/enterprise.md", "utf8");
  assert.match(text, /same origin/i);
  assert.match(text, /ADR-0031/);
  assert.match(text, /\/api\/\*/, "it names the path routing");
});

test("the detector notices the sentence that ticket #44 removed, and ignores a statement that there is no CORS", () => {
  assert.equal(instructionsIn("Add the web origin to the API's allowed origins when hosted separately.").length, 1);
  assert.equal(instructionsIn("Set AMO_ALLOWED_ORIGINS to the web address.").length, 1);
  assert.equal(instructionsIn("Enable CORS on the API for the web host.").length, 1);
  assert.equal(instructionsIn("The API has no CORS support on purpose: it sends no `Access-Control-*` headers and has no allowed-origins setting.").length, 0);
});
