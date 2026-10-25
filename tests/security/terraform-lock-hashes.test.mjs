import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * infrastructure/terraform/appliance-azure/.terraform.lock.hcl records, for each provider, one "h1:" checksum per platform
 * it was locked for. Five platforms are locked on purpose (linux and macOS on both CPU types, and Windows), so the same
 * lock file verifies on a laptop and in CI. A tool that regenerates the file on one platform, which is how Dependabot
 * could update it, may keep only the checksum for that platform. CI runs `init -lockfile=readonly` on Linux only, so it
 * would still pass and a Mac or Windows user would then be told the provider does not match the lock file. This test
 * makes that visible on the pull request instead (follow-up from the review of PR 78, ticket 83).
 *
 * What this does NOT prove: the lock file does not say which platform each "h1:" checksum belongs to, so this counts them
 * and cannot tell that a particular platform (for example darwin_arm64) is missing. It is a tripwire for the known failure
 * (five checksums collapsing to one), not a proof. The real check needs the provider registry: run
 * `terraform providers lock` with the five -platform flags in CI and fail on a `git diff`; that is listed as open on
 * ticket 83. A version bump legitimately changes every checksum, so pinning the checksums in this test was rejected.
 */
const LOCK = "infrastructure/terraform/appliance-azure/.terraform.lock.hcl";
const PLATFORMS = 5;

/** provider address -> number of distinct h1: checksums in its block */
export function h1CountsByProvider(text) {
  const counts = {};
  for (const m of text.matchAll(/^provider "([^"]+)" \{\n([\s\S]*?)^\}/gm)) {
    counts[m[1]] = new Set([...m[2].matchAll(/"(h1:[A-Za-z0-9+/=]+)"/g)].map((h) => h[1])).size;
  }
  return counts;
}

test("every provider in the committed lock file has a checksum for each of the five platforms", () => {
  const counts = h1CountsByProvider(readFileSync(LOCK, "utf8").replaceAll("\r\n", "\n")); // a Windows checkout has CRLF
  assert.deepEqual(Object.keys(counts).sort(), ["registry.terraform.io/hashicorp/azuread", "registry.terraform.io/hashicorp/azurerm"]);
  for (const [provider, n] of Object.entries(counts)) {
    assert.ok(n >= PLATFORMS, `${provider} has ${n} h1: checksums in ${LOCK}, expected at least ${PLATFORMS}; regenerate with: terraform -chdir=infrastructure/terraform/appliance-azure providers lock -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=windows_amd64`);
  }
});

test("the checker notices a lock file that kept only one platform", () => {
  const regenerated = 'provider "registry.terraform.io/hashicorp/azurerm" {\n  version = "4.1.0"\n  hashes = [\n    "h1:AAAA=",\n    "zh:BBBB",\n  ]\n}\n';
  assert.deepEqual(h1CountsByProvider(regenerated), { "registry.terraform.io/hashicorp/azurerm": 1 });
});
