import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exists, expandBraces, missingPaths, pathSpans } from "./doc-paths.mjs";

/**
 * docs/requirements-ledger.md points at code, tests and docs. Paths drift when files move (the split, ADR-0027, and the
 * azure-arm package did exactly that), so every path-looking `code span` in the ledger tables must exist in this repository,
 * with only these declared exceptions:
 *  - a path directly followed by *(downstream)* or *(retired)* (the legend is at the top of the ledger);
 *  - a path in a row that says "downstream" and sits under a lab-only prefix (the older row-level convention);
 *  - the names of files the bundle generator writes into every bundle (they are outputs, not repository files).
 * docs/traceability-matrix.md is checked the same way by traceability-matrix.test.mjs (ticket #47).
 */
const LAB_PREFIXES = ["apps/lab-api", "apps/lab-web", "apps/ui-harness", "infrastructure/coder", "coder-template.yml", "playwright.config.ts", "tests/e2e/"];
const BUNDLE_FILES = ["VALIDATION-STATUS.md"];

test("every repository path named in the requirements ledger exists (or is marked downstream or retired)", () => {
  const generated = readFileSync("packages/artifact-generator/src/bundle.ts", "utf8");
  for (const f of BUNDLE_FILES) assert.ok(generated.includes(f), `${f} is no longer written by the bundle generator`);
  const missing = missingPaths(readFileSync("docs/requirements-ledger.md", "utf8"), (p, { row }) => BUNDLE_FILES.includes(p) || (/downstream/i.test(row) && LAB_PREFIXES.some((x) => p.startsWith(x))));
  assert.deepEqual(missing, [], `ledger paths that do not exist:\n${missing.join("\n")}`);
});

test("the ledger test itself notices a missing path", () => {
  assert.equal(exists("packages/does-not-exist/src/x.ts"), false);
  assert.equal(exists("packages/azure-arm/src/scopes.ts"), true);
  assert.deepEqual(expandBraces("a/{b,c}.ts"), ["a/b.ts", "a/c.ts"]);
  assert.equal(pathSpans("| R-x | `packages/nope/x.ts` *(downstream)* and `packages/also/nope.ts` |").map((s) => s.marker).join(","), "downstream,");
});
