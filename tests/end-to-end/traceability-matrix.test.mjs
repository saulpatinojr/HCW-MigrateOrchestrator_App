import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missingPaths, pathSpans } from "./doc-paths.mjs";

/**
 * docs/traceability-matrix.md maps requirement IDs to code, tests and docs, and it drifted after the repository split
 * (ticket #47): rows named docs/security/threat-model.md, docs/demo/user-guide.md, infrastructure/coder,
 * docs/deployment/coder.md and docs/website-integration/routes.md, none of which exist here. It is held to the same rule
 * as the ledger, and stricter: there is no row-level "downstream" excuse, so each path that lives in
 * saulpatinojr/HCW-MigrateOrchestrator_AddOn must carry *(downstream)* and each deleted one *(retired)* right after it.
 */
const matrix = readFileSync("docs/traceability-matrix.md", "utf8");
const ledger = readFileSync("docs/requirements-ledger.md", "utf8");

test("every repository path named in the traceability matrix exists (or is marked downstream or retired)", () => {
  const missing = missingPaths(matrix);
  assert.deepEqual(missing, [], `matrix paths that do not exist and carry no marker:\n${missing.join("\n")}`);
});

test("the matrix is a real table and explains the markers", () => {
  assert.ok(pathSpans(matrix).length > 30, "expected the matrix to name many paths");
  assert.match(matrix, /\*\(downstream\)\*/);
  assert.match(matrix, /\*\(retired\)\*/);
});

test("the matrix and the ledger agree on the requirement IDs", () => {
  const ids = (text) => new Set([...text.matchAll(/^\| (R-\d+(?:, R-\d+)*) \|/gm)].flatMap((m) => m[1].split(", ")));
  const inMatrix = ids(matrix);
  const inLedger = ids(ledger);
  const unknown = [...inMatrix].filter((id) => !inLedger.has(id));
  assert.deepEqual(unknown, [], "matrix rows for requirements that are not in the ledger");
});

test("the matrix test itself notices the rows ticket #47 found", () => {
  const stale = "| R-05 | x | y | `docs/security/threat-model.md` |\n| R-26 | `infrastructure/coder` | z | `docs/deployment/coder.md` *(retired)* |";
  assert.deepEqual(missingPaths(stale), ["line 1: docs/security/threat-model.md", "line 2: infrastructure/coder"]);
  assert.deepEqual(missingPaths("| R-05 | x | y | `docs/security/threat-model.md` *(downstream)* |"), []);
});
