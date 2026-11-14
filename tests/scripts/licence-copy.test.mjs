import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLicenceCopy } from "../../scripts/lib/licence-copy.mjs";

const ROOT_LICENSE = join(process.cwd(), "LICENSE");

const withCopy = (bytes, fn) => {
  const dir = mkdtempSync(join(tmpdir(), "amo-licence-"));
  try {
    const copy = join(dir, "LICENSE");
    if (bytes !== null) writeFileSync(copy, bytes);
    fn(copy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("an exact copy of the root LICENSE passes", () => {
  withCopy(readFileSync(ROOT_LICENSE), (copy) => assertLicenceCopy(copy, ROOT_LICENSE, "pkg"));
});

test("a LICENSE that is only the MIT heading fails (the old startsWith check let it through)", () => {
  withCopy("MIT License\n", (copy) => assert.throws(() => assertLicenceCopy(copy, ROOT_LICENSE, "pkg"), /pkg LICENSE differs from the repository's root LICENSE/));
});

test("a LICENSE with a changed copyright line fails", () => {
  const changed = readFileSync(ROOT_LICENSE, "utf8").replace(/Copyright[^\n]*/, "Copyright (c) someone else");
  withCopy(changed, (copy) => assert.throws(() => assertLicenceCopy(copy, ROOT_LICENSE, "pkg"), /differs from the repository's root LICENSE/));
});

test("a missing LICENSE fails", () => {
  withCopy(null, (copy) => assert.throws(() => assertLicenceCopy(copy, ROOT_LICENSE, "pkg"), /pkg does not carry the MIT licence text/));
});

test("a missing root LICENSE fails with a clear message instead of comparing against nothing", () => {
  withCopy(readFileSync(ROOT_LICENSE), (copy) => assert.throws(() => assertLicenceCopy(copy, join(copy, "..", "NO-LICENSE"), "pkg"), /repository's LICENSE .* is missing/));
});
