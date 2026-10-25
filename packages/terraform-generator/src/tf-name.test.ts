import { test } from "node:test";
import assert from "node:assert/strict";
import { tfName } from "./tf-name.js";

test("tfName keeps its documented behaviour", () => {
  assert.equal(tfName("My App-1"), "my_app_1");
  assert.equal(tfName("__x__"), "x");
  assert.equal(tfName("123web"), "r123web");
  assert.equal(tfName("___"), "resource");
  assert.equal(tfName("!!!"), "resource");
  assert.equal(tfName(""), "resource");
  assert.equal(tfName("a__b"), "a__b");
  assert.equal(tfName("  vm  01  "), "vm_01");
});

test("tfName stays fast on a crafted name (CodeQL js/polynomial-redos, alerts 3 and 4)", () => {
  // A long run of underscores in the middle of a name: the old trailing-underscore expression ("_+$") rescanned the rest of the run from every underscore in it.
  for (const crafted of ["a" + "_".repeat(100_000) + "b", "a" + "_".repeat(100_000) + "-" + "b", "a" + "_".repeat(50_000) + "b" + "_".repeat(50_000) + "c"]) {
    const t0 = performance.now();
    tfName(crafted);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `tfName took ${Math.round(ms)} ms on a ${crafted.length}-character name`);
  }
});
