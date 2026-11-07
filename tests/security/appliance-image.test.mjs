import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The shape of the appliance image (infrastructure/docker/Dockerfile.appliance) and of the publish workflow that builds it.
// Why these lines are pinned: on 2026-11-05 the website's Docker Scout check refused the downstream lab image on
// CVE-2026-109518 in Debian 12's apt 2.6.1, and this image was built on the same Debian 12 base. The remedy, the same one the
// lab image took (HCW-MigrateOrchestrator_AddOn 0.3.3), has two parts, and a reviewed change is needed to drop either: the base
// is Debian 13 (node:26-trixie-slim), pinned by tag and digest together so Dependabot keeps moving it; and the final stage
// applies Debian's security updates itself with download retries off, `--error-on=any` on the update, and a per-run
// PUBLISH_CACHE_BUST that publish-images.yml passes, so no publish run reuses an older upgrade layer. Static checks of the two
// files only; a docker build proves the apt version inside.

const dockerfile = readFileSync("infrastructure/docker/Dockerfile.appliance", "utf8").replace(/\r\n/g, "\n");
const workflow = readFileSync(".github/workflows/publish-images.yml", "utf8").replace(/\r\n/g, "\n");

/** Instructions with their continuation lines joined and comment lines dropped. */
function instructionsOf(text) {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n")
    .replace(/\\\n\s*/g, " ")
    .split("\n")
    .filter((l) => l.trim() !== "");
}
const instructions = instructionsOf(dockerfile);
const stages = instructions.reduce((acc, line) => {
  if (/^FROM\s/.test(line)) acc.push([]);
  if (acc.length) acc[acc.length - 1].push(line);
  return acc;
}, []);
const finalStage = stages[stages.length - 1];

test("both stages build on node:26-trixie-slim (Debian 13), pinned by tag and digest, the same image in each", () => {
  const froms = instructions.filter((l) => /^FROM\s/.test(l));
  assert.equal(froms.length, 2, "a build stage and a final stage");
  for (const from of froms) {
    assert.match(from, /^FROM node:26-trixie-slim@sha256:[0-9a-f]{64}( AS build)?$/, `Debian 13 base, tag and digest together: ${from}`);
  }
  assert.equal(new Set(froms.map((f) => f.split(/\s+/)[1])).size, 1, "both stages name the same tag and digest");
  assert.doesNotMatch(dockerfile.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"), /bookworm/, "no Debian 12 base left");
});

test("the final stage applies Debian's security updates with retries off, a strict update and a per-run cache bust", () => {
  const argIndex = finalStage.findIndex((l) => l === "ARG PUBLISH_CACHE_BUST=");
  assert.ok(argIndex > 0, "the final stage declares ARG PUBLISH_CACHE_BUST= (empty default: a local build caches as usual)");
  const run = finalStage.find((l) => /^RUN\s.*apt-get/.test(l));
  assert.ok(run, "the final stage has one RUN that drives apt-get");
  assert.ok(finalStage.indexOf(run) > argIndex, "the ARG is declared before the RUN that names it");
  const steps = run.replace(/^RUN\s+/, "").split(/\s*&&\s*/);
  assert.deepEqual(steps, [
    `printf 'upgrade run: %s\\n' "\${PUBLISH_CACHE_BUST}"`,
    "apt-get -o Acquire::Retries=0 update --error-on=any",
    "apt-get -o Acquire::Retries=0 upgrade -y --no-install-recommends",
    "apt-get clean",
    "rm -rf /var/lib/apt/lists/*",
  ]);
  const copyIndex = finalStage.findIndex((l) => /^COPY --from=build/.test(l));
  assert.ok(finalStage.indexOf(run) < copyIndex, "the upgrade runs before the application files are copied in");
  assert.equal(instructions.filter((l) => /^RUN\s.*apt-get/.test(l)).length, 1, "no other RUN uses apt-get (an install elsewhere would need the same shape)");
});

test("publish-images.yml passes a per-run PUBLISH_CACHE_BUST to every build of the image", () => {
  const builds = workflow.split(/^ {6}- /m).filter((s) => /uses:\s*docker\/build-push-action@/.test(s));
  assert.equal(builds.length, 2, "the rehearsal build and the tag build");
  for (const step of builds) {
    assert.match(step, /^ {10}build-args: PUBLISH_CACHE_BUST=\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/m, "a per-run value on each build");
  }
});

test("the checks above fail on a mutated file (the tests would notice)", () => {
  const bookworm = instructionsOf(dockerfile.replaceAll("node:26-trixie-slim", "node:26-bookworm-slim")).filter((l) => /^FROM\s/.test(l));
  assert.ok(bookworm.every((f) => !/^FROM node:26-trixie-slim@/.test(f)), "a Debian 12 base would be caught");
  const retriesOn = instructionsOf(dockerfile.replaceAll("-o Acquire::Retries=0 ", "")).find((l) => /^RUN\s.*apt-get/.test(l));
  assert.doesNotMatch(retriesOn, /Acquire::Retries=0/, "dropping retries-off changes the RUN the test compares");
  const noBust = workflow.replaceAll("          build-args: PUBLISH_CACHE_BUST=${{ github.run_id }}-${{ github.run_attempt }}\n", "");
  assert.doesNotMatch(noBust, /PUBLISH_CACHE_BUST=\$\{\{ github\.run_id \}\}/, "a workflow without the cache bust would be caught");
});
