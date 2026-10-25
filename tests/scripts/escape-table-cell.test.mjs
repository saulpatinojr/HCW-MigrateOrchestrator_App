import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeTableCell } from "../../scripts/lib/escape-table-cell.mjs";

test("escapeTableCell escapes pipes", () => {
  assert.equal(escapeTableCell("a|b"), "a\\|b");
});

test("escapeTableCell escapes backslashes first, so a backslash before a pipe cannot cancel the pipe's escape (CodeQL alert 7)", () => {
  assert.equal(escapeTableCell("a\\|b"), "a\\\\\\|b");
  assert.equal(escapeTableCell("C:\\temp"), "C:\\\\temp");
});
