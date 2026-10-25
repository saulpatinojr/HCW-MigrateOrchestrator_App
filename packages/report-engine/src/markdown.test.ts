import { test } from "node:test";
import assert from "node:assert/strict";
import { esc } from "./markdown.js";

test("esc hides pipes and line breaks from the table", () => {
  assert.equal(esc("a|b"), "a\\|b");
  assert.equal(esc("a\nb"), "a b");
});

test("esc escapes backslashes first, so a backslash before a pipe cannot cancel the pipe's escape (CodeQL alert 6)", () => {
  // The text a, backslash, pipe, b must not come out as a, backslash, backslash, pipe, b with the pipe unescaped:
  // a renderer reads the two backslashes as one literal backslash and the pipe as a column break.
  assert.equal(esc("a\\|b"), "a\\\\\\|b");
  assert.equal(esc("C:\\temp"), "C:\\\\temp");
  assert.equal(esc("ends with a backslash \\"), "ends with a backslash \\\\");
});
