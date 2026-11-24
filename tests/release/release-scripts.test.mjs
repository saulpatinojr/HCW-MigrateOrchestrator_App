import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { allNames, assembleProvenance, attestedNames, attestationChecks, builtNames, bundleVerifyCommand, expectedAssets, main, provenanceName, provenanceOnlyNames, provenanceProblems, readProvenance, verifyProvenanceFile, checkFiles, decodeJsonValues, publish, releaseProblems, releaseNotes, verifyAttestations, verifyCommand, verifyRelease, versionOfTag, PROVENANCE, SBOM } from "../../scripts/release-publish.mjs";
import { atLeast, changelogProblems, changelogSection, check, notOnBranch, setVersion, startChangelogSection, workflowParity } from "../../scripts/check-release-version.mjs";
import { addComponent, assertBom, retitle } from "../../scripts/generate-sbom.mjs";

/**
 * Local, offline tests of the three release scripts (ADR-0034): they run the real code against a fake `gh`, so the logic
 * that decides whether a release becomes public is exercised before any real tag. They do not prove how GitHub behaves.
 */
const VERSION = "1.2.3";
const TAG = "v1.2.3";
const REPO = "owner/repo";
const WORKFLOW = ".github/workflows/release-cli.yml";
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const scratch = () => mkdtempSync(join(tmpdir(), "amo-release-test-"));
const CHANGELOG_TEXT = "# Changelog\n\n## Unreleased\n\n- a change not released yet\n\n## 1.2.3 — 2026-11-23\n\nWhat 1.2.3 changes, in plain words.\n\n- the entry for 1.2.3\n\n## 1.2.2 — 2026-11-01\n\nOlder.\n";
const changelogFile = () => { const f = join(scratch(), "CHANGELOG.md"); writeFileSync(f, CHANGELOG_TEXT); return f; };
const noPause = () => {};
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const bad = (stderr) => ({ status: 1, stdout: "", stderr });

/**
 * One line of a provenance file, in the shape actions/attest writes (read from the bundles GitHub holds for v0.4.3): a
 * Sigstore bundle around a signed in-toto statement. The signature here is a dummy: these tests never check one.
 */
function bundleLine(subjects, { predicateType = PROVENANCE, mediaType = "application/vnd.dev.sigstore.bundle.v0.3+json", type = "https://in-toto.io/Statement/v1" } = {}) {
  const statement = { _type: type, subject: subjects.map(([name, sha256]) => ({ name, digest: { sha256 } })), predicateType, predicate: {} };
  return JSON.stringify({ mediaType, verificationMaterial: { certificate: { rawBytes: "AA==" } }, dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64"), payloadType: "application/vnd.in-toto+json", signatures: [{ sig: "AA==" }] } });
}
/** The three bundles the attest job saves (binaries, packages, checksum files and SBOMs), for the files in `dir`. */
function bundleLines(dir, version = VERSION) {
  const a = expectedAssets(version);
  return [a.binaries, a.tarballs, [...a.checksums, a.sboms.cli, a.sboms.packages]].map((names) => bundleLine(names.map((n) => [n, sha(join(dir, n))])));
}
const writeProvenance = (dir, version = VERSION) => writeFileSync(join(dir, provenanceName(version)), `${bundleLines(dir, version).join("\n")}\n`);
/** A directory with the ten built files only: what the inventory job gathers, before anything is attested. */
function builtDir(version = VERSION) {
  const dir = join(scratch(), "release-files");
  mkdirSync(dir);
  for (const n of builtNames(version)) writeFileSync(join(dir, n), `content of ${n}\n`);
  return dir;
}
/** A directory with every file a release carries: the ten built files and a provenance file that names them. */
function releaseDir(version = VERSION) {
  const dir = builtDir(version);
  writeProvenance(dir, version);
  return dir;
}
/** The artifacts of the attest job as the next job downloads them: one folder per bundle, each with attestation.json. */
function savedBundles(lines) {
  const root = join(scratch(), "provenance-bundles");
  lines.forEach((line, i) => { mkdirSync(join(root, `provenance-bundle-${i + 1}`), { recursive: true }); writeFileSync(join(root, `provenance-bundle-${i + 1}`, "attestation.json"), `${line}\n`); });
  return root;
}

/** A fake GitHub: remembers the release, answers the calls release-publish.mjs makes, and records every call. */
function fakeGh({ existing = [], corrupt = null, failCreate = false, failPatch = false, lagReads = 0, staleList = false } = {}) {
  const calls = [];
  const state = { releases: [...existing], current: null, source: [], attestationFails: false, reads: 0 };
  const gh = (args) => {
    calls.push(args);
    const [a, b] = args;
    // staleList: the list answer lags and shows the draft without its assets (the by-id answer is the truth)
    if (a === "api" && b === "--paginate") return ok(JSON.stringify(staleList ? state.releases.map((r) => ({ ...r, assets: [] })) : state.releases));
    if (a === "release" && b === "create") {
      if (failCreate) return bad("HTTP 422");
      const files = args.filter((x) => allNames(versionOfTag(args[2])).includes(basename(x)));
      let assets = files.map((f) => ({ name: basename(f), state: "uploaded", digest: `sha256:${sha(f)}` }));
      if (corrupt?.drop) assets = assets.filter((x) => x.name !== corrupt.drop);
      if (corrupt?.extra) assets.push({ name: corrupt.extra, state: "uploaded" });
      if (corrupt?.digest) assets = assets.map((x) => (x.name === corrupt.digest ? { ...x, digest: `sha256:${"0".repeat(64)}` } : x));
      if (corrupt?.nullDigest) assets = assets.map((x) => (x.name === corrupt.nullDigest ? { ...x, digest: null } : x));
      if (corrupt?.state) assets = assets.map((x) => (x.name === corrupt.state ? { ...x, state: "starter" } : x));
      state.current = { id: 7, tag_name: args[2], draft: true, html_url: "https://example.test/r", assets };
      state.releases = [state.current];
      return ok();
    }
    if (a === "api" && b === "--method") {
      if (failPatch) return bad("HTTP 500");
      state.current.draft = false;
      return ok();
    }
    if (a === "api" && /releases\/7$/.test(b)) {
      state.reads++;
      if (state.current.draft && state.reads <= lagReads) {
        // GitHub still processing the uploads: assets not yet "uploaded", digests not yet known
        return ok(JSON.stringify({ ...state.current, assets: state.current.assets.map((x) => ({ ...x, state: "starter", digest: null })) }));
      }
      return ok(JSON.stringify(state.current));
    }
    if (a === "release" && b === "download") {
      const out = args[args.indexOf("--dir") + 1];
      mkdirSync(out, { recursive: true });
      for (const f of state.source) copyFileSync(f, join(out, basename(f)));
      return ok();
    }
    if (a === "attestation") return state.attestationFails ? bad("no matching attestation") : ok();
    return bad(`unexpected gh call ${args.join(" ")}`);
  };
  return { gh, calls, state };
}
const callsOf = (calls, a, b) => calls.filter((c) => c[0] === a && c[1] === b);

test("the expected file list is the contract: three binaries, three checksum files, two tarballs, two SBOMs, one provenance file", () => {
  assert.deepEqual(allNames(VERSION), [...builtNames(VERSION), "amo-1.2.3.intoto.jsonl"], "the provenance file is the eleventh, and the last");
  assert.equal(provenanceName("0.4.4"), "amo-0.4.4.intoto.jsonl");
  assert.ok(!attestationChecks(VERSION).some(([name]) => name.endsWith(".intoto.jsonl")), "the provenance file is the proof, not a subject of it");
  assert.deepEqual(builtNames(VERSION), ["amo-linux-x64", "amo-darwin-arm64", "amo-windows-x64.exe", "SHA256SUMS-linux-x64.txt", "SHA256SUMS-darwin-arm64.txt", "SHA256SUMS-windows-x64.txt", "hybridcloudworks-migration-core-1.2.3.tgz", "hybridcloudworks-migration-ui-1.2.3.tgz", "amo-cli-1.2.3.cdx.json", "hybridcloudworks-migration-packages-1.2.3.cdx.json"]);
  assert.equal(attestedNames(VERSION).length, 5, "binaries and tarballs get provenance and an SBOM attestation");
  assert.deepEqual(provenanceOnlyNames(VERSION), ["SHA256SUMS-linux-x64.txt", "SHA256SUMS-darwin-arm64.txt", "SHA256SUMS-windows-x64.txt", "amo-cli-1.2.3.cdx.json", "hybridcloudworks-migration-packages-1.2.3.cdx.json"], "checksum files and SBOMs get provenance (follow-up F7)");
  assert.equal(attestationChecks(VERSION).length, 10, "every release file is bound to the workflow, ref and commit");
  assert.equal(versionOfTag("v0.3.1"), "0.3.1");
  assert.throws(() => versionOfTag("0.3.1"), /not v followed/);
  assert.throws(() => versionOfTag("v0.3.1-rc.1"), /not v followed/);
});

test("check-files: complete passes; a missing, extra or empty file is named", () => {
  const dir = releaseDir();
  assert.deepEqual(checkFiles(dir, VERSION), []);
  rmSync(join(dir, "amo-cli-1.2.3.cdx.json"));
  writeFileSync(join(dir, "stray.txt"), "x");
  writeFileSync(join(dir, "amo-linux-x64"), "");
  const problems = checkFiles(dir, VERSION).join("\n");
  assert.match(problems, /amo-cli-1\.2\.3\.cdx\.json is missing/);
  assert.match(problems, /stray\.txt is not one of the 11 files/);
  assert.match(problems, /amo-linux-x64 is empty/);
  assert.match(checkFiles(join(dir, "nope"), VERSION).join("\n"), /is missing/);
});

test("check-files: the provenance file is required on a release, refused before it exists, and only under its exact name", async () => {
  // the inventory job (--stage built) holds the ten built files and nothing else
  const built = builtDir();
  assert.deepEqual(checkFiles(built, VERSION, builtNames(VERSION)), []);
  assert.match(checkFiles(built, VERSION).join("\n"), /amo-1\.2\.3\.intoto\.jsonl is missing/, "a release without its provenance file is refused");
  assert.equal(await main(["check-files", "--stage", "built", "--dir", built, "--version", VERSION]), 0);
  assert.equal(await main(["check-files", "--dir", built, "--version", VERSION]), 1, "the default is the whole release");
  await assert.rejects(main(["check-files", "--stage", "draft", "--dir", built, "--version", VERSION]), /--stage is built/);
  // a full release directory is refused by the inventory check: nothing may be there before it is attested
  const full = releaseDir();
  assert.deepEqual(checkFiles(full, VERSION), []);
  assert.match(checkFiles(full, VERSION, builtNames(VERSION)).join("\n"), /amo-1\.2\.3\.intoto\.jsonl is not one of the 10 files/);
  assert.equal(await main(["check-files", "--stage", "built", "--dir", full, "--version", VERSION]), 1);
  // a wrong name (another version, another ending), an extra file and an empty file are each named
  for (const wrong of ["amo-1.2.4.intoto.jsonl", "amo-1.2.3.intoto.json", "amo-1.2.3.sigstore.json", "provenance.intoto.jsonl"]) {
    const dir = builtDir();
    writeFileSync(join(dir, wrong), `${bundleLines(dir).join("\n")}\n`);
    const problems = checkFiles(dir, VERSION).join("\n");
    assert.match(problems, /amo-1\.2\.3\.intoto\.jsonl is missing/, wrong);
    assert.ok(problems.includes(`${wrong} is not one of the 11 files`), wrong);
  }
  const two = releaseDir();
  writeFileSync(join(two, "extra.intoto.jsonl"), "x");
  assert.match(checkFiles(two, VERSION).join("\n"), /extra\.intoto\.jsonl is not one of the 11 files/);
  const empty = builtDir();
  writeFileSync(join(empty, provenanceName(VERSION)), "");
  assert.match(checkFiles(empty, VERSION).join("\n"), /amo-1\.2\.3\.intoto\.jsonl is empty/);
});

test("the provenance file must be real: signed build-provenance bundles that name each built file by sha256, and nothing else", async () => {
  const dir = releaseDir();
  assert.deepEqual(await provenanceProblems(dir, VERSION), []);
  const good = bundleLines(dir);
  const file = join(dir, provenanceName(VERSION));
  const withLines = async (lines) => { writeFileSync(file, lines.join("\n")); return (await provenanceProblems(dir, VERSION)).join("\n"); };
  assert.match(await withLines(["   "]), /holds no bundle/, "a file with the right name and nothing in it");
  assert.match(await withLines(["not json"]), /line 1 is not a JSON object/);
  assert.match(await withLines([...good, "[]"]), /line 4 is not a JSON object/);
  assert.match(await withLines([JSON.stringify({ mediaType: "text/plain" })]), /line 1 is not a Sigstore bundle/);
  assert.match(await withLines([JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" })]), /no signed in-toto statement/);
  const unsigned = JSON.parse(good[0]);
  unsigned.dsseEnvelope.signatures = [];
  assert.match(await withLines([JSON.stringify(unsigned), good[1], good[2]]), /line 1 has no signature or no certificate/);
  assert.match(await withLines([bundleLine([["amo-linux-x64", "a".repeat(64)]], { type: "something else" })]), /does not hold an in-toto statement/);
  // an SBOM attestation is a real signed bundle, but it is not build provenance
  assert.match(await withLines([...good, bundleLine([["amo-linux-x64", sha(join(dir, "amo-linux-x64"))]], { predicateType: SBOM })]), /line 4 is a "https:\/\/cyclonedx\.org\/bom" statement, not build provenance/);
  assert.match(await withLines([bundleLine([])]), /names no file/);
  assert.match(await withLines([bundleLine([["amo-linux-x64", "short"]])]), /without a name or a sha256/);
  // one of the three bundles is missing: its files are named
  const partial = await withLines([good[0], good[2]]);
  assert.match(partial, /does not name hybridcloudworks-migration-core-1\.2\.3\.tgz/);
  assert.match(partial, /does not name hybridcloudworks-migration-ui-1\.2\.3\.tgz/);
  // the bundle of another build: right names, other bytes
  assert.match(await withLines([bundleLine(expectedAssets(VERSION).binaries.map((n) => [n, "0".repeat(64)])), good[1], good[2]]), /names amo-linux-x64 with sha256 0{64}, but the file here has [0-9a-f]{64}/);
  // a file the release does not carry
  assert.match(await withLines([...good, bundleLine([["other-tool", "b".repeat(64)]])]), /names other-tool, which is not one of the 10 built files/);
  // a built file changed after it was attested
  await withLines(good);
  writeFileSync(join(dir, "amo-cli-1.2.3.cdx.json"), "changed");
  assert.match((await provenanceProblems(dir, VERSION)).join("\n"), /names amo-cli-1\.2\.3\.cdx\.json with sha256/);
  rmSync(file);
  assert.match((await provenanceProblems(dir, VERSION)).join("\n"), /amo-1\.2\.3\.intoto\.jsonl is missing/);
  assert.equal(readProvenance(`${good.join("\n")}\n`).bundles, 3);
  assert.equal(readProvenance(`${good.join("\n")}\n`).subjects.length, 10);
});

test("assemble-provenance: the three saved bundles become one file, one bundle per line; it replaces nothing and writes nothing it cannot vouch for", async () => {
  const dir = builtDir();
  const lines = bundleLines(dir);
  // a bundle file as pretty-printed JSON would break "one bundle per line"; the saved files are one line each and are re-written compactly
  assert.deepEqual(await assembleProvenance({ bundles: savedBundles(lines), dir, version: VERSION }), []);
  const written = readFileSync(join(dir, provenanceName(VERSION)), "utf8");
  assert.equal(written, `${lines.join("\n")}\n`, "binaries, packages, then checksum files and SBOMs, in the order of the artifact names");
  assert.deepEqual(checkFiles(dir, VERSION), []);
  assert.match((await assembleProvenance({ bundles: savedBundles(lines), dir, version: VERSION }))[0], /already exists; it is never replaced/);
  // nothing saved, a folder that does not exist, or a saved file that is not a provenance bundle: no file is written
  for (const [bundles, expected] of [[savedBundles([]), /is not a directory of saved bundles/], [join(scratch(), "nope"), /is not a directory/], [savedBundles(["{}"]), /is not a Sigstore bundle/], [savedBundles([lines[0], bundleLine([["amo-linux-x64", "c".repeat(64)]], { predicateType: SBOM })]), /not build provenance/]]) {
    const target = builtDir();
    const problems = await assembleProvenance({ bundles, dir: target, version: VERSION });
    assert.match(problems.join("\n"), expected);
    assert.ok(!existsSync(join(target, provenanceName(VERSION))), "no file is left behind");
  }
  const emptyRoot = join(scratch(), "empty");
  mkdirSync(emptyRoot);
  assert.match((await assembleProvenance({ bundles: emptyRoot, dir: builtDir(), version: VERSION })).join("\n"), /holds no bundle/);
  // a bundle is missing (two of three saved): the file is written, and refused by name
  const partial = builtDir();
  assert.match((await assembleProvenance({ bundles: savedBundles([lines[0], lines[1]]), dir: partial, version: VERSION })).join("\n"), /does not name SHA256SUMS-linux-x64\.txt/);
  // through the command line: the same bundles are accepted for the same bytes, and refused once a built file differs
  assert.equal(await main(["assemble-provenance", "--bundles", savedBundles(lines), "--dir", builtDir(), "--version", VERSION]), 0);
  const changed = builtDir();
  writeFileSync(join(changed, "amo-darwin-arm64"), "another build");
  assert.equal(await main(["assemble-provenance", "--bundles", savedBundles(lines), "--dir", changed, "--version", VERSION]), 1);
  await assert.rejects(main(["assemble-provenance", "--dir", changed, "--version", VERSION]), /needs --bundles/);
});

test("verify-provenance: every built file is verified against the provenance file alone, with the strict flags", async () => {
  const dir = releaseDir();
  const { gh, calls, state } = fakeGh();
  const digest = "e".repeat(40);
  const args = { dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: `refs/tags/${TAG}`, sourceDigest: digest };
  assert.deepEqual(await verifyProvenanceFile(args, gh, noPause), []);
  assert.equal(calls.length, 10, "one check per built file");
  for (const c of calls) {
    assert.equal(c[c.indexOf("--bundle") + 1], join(dir, "amo-1.2.3.intoto.jsonl"));
    assert.equal(c[c.indexOf("--predicate-type") + 1], PROVENANCE);
    assert.equal(c[c.indexOf("--signer-workflow") + 1], `${REPO}/${WORKFLOW}`);
    assert.equal(c[c.indexOf("--source-ref") + 1], `refs/tags/${TAG}`);
    assert.equal(c[c.indexOf("--source-digest") + 1], digest);
    assert.equal(c[c.indexOf("--signer-digest") + 1], digest);
    assert.ok(c.includes("--deny-self-hosted-runners"));
  }
  assert.deepEqual(calls.map((c) => basename(c[2])), builtNames(VERSION));
  assert.deepEqual(bundleVerifyCommand("f", "b.intoto.jsonl", "o/r", "w.yml", "r", "d").slice(0, 5), ["attestation", "verify", "f", "--bundle", "b.intoto.jsonl"]);
  // gh refuses: retried, then reported per file
  state.attestationFails = true;
  const refused = await verifyProvenanceFile(args, gh, noPause);
  assert.equal(refused.length, 10);
  assert.match(refused[0], /amo-1\.2\.3\.intoto\.jsonl does not prove amo-linux-x64 came from \.github\/workflows\/release-cli\.yml on refs\/tags\/v1\.2\.3 at eeeeeeeeeeee: no matching attestation/);
  assert.equal(calls.length, 10 + 30, "three tries per file");
  // a file whose content is wrong is refused before gh is asked anything
  const none = fakeGh();
  writeFileSync(join(dir, provenanceName(VERSION)), "{}\n");
  assert.match((await verifyProvenanceFile(args, none.gh, noPause)).join("\n"), /is not a Sigstore bundle/);
  rmSync(join(dir, provenanceName(VERSION)));
  assert.match((await verifyProvenanceFile(args, none.gh, noPause)).join("\n"), /amo-1\.2\.3\.intoto\.jsonl is missing/);
  assert.equal(none.calls.length, 0);
});

test("attestations are verified for provenance and SBOM, bound to this workflow, this ref and this commit", () => {
  const dir = releaseDir();
  const { gh, calls } = fakeGh();
  const digest = "a".repeat(40);
  const problems = verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: `refs/tags/${TAG}`, sourceDigest: digest }, gh, noPause);
  assert.deepEqual(problems, []);
  assert.equal(calls.length, 15, "five files with two predicates each, five with provenance only");
  for (const c of calls) {
    assert.equal(c[c.indexOf("--signer-workflow") + 1], `${REPO}/${WORKFLOW}`);
    assert.equal(c[c.indexOf("--source-ref") + 1], `refs/tags/${TAG}`);
    assert.equal(c[c.indexOf("--source-digest") + 1], digest);
    assert.equal(c[c.indexOf("--repo") + 1], REPO);
    assert.equal(c[c.indexOf("--signer-digest") + 1], digest, "the workflow that signed must be the one at this commit");
    assert.ok(c.includes("--deny-self-hosted-runners"));
  }
  assert.equal(calls.filter((c) => c.includes(PROVENANCE)).length, 10, "every one of the ten files has provenance");
  assert.equal(calls.filter((c) => c.includes(SBOM)).length, 5);
  for (const name of provenanceOnlyNames(VERSION)) {
    const mine = calls.filter((c) => c[2].endsWith(name));
    assert.equal(mine.length, 1, `${name}: exactly one check`);
    assert.ok(mine[0].includes(PROVENANCE) && !mine[0].includes(SBOM), `${name}: provenance only`);
  }
  // a checksum file or SBOM without an attestation is refused, and named
  const missing = fakeGh();
  missing.state.attestationFails = true;
  const refused = verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d".repeat(40) }, missing.gh, noPause);
  assert.ok(refused.some((p) => /attestation of SHA256SUMS-linux-x64\.txt/.test(p)) && refused.some((p) => /attestation of amo-cli-1\.2\.3\.cdx\.json/.test(p)));
  assert.deepEqual(verifyCommand("f", "o/r", SBOM, "w.yml", "refs/tags/v1.0.0", "d").slice(0, 3), ["attestation", "verify", "f"]);
});

test("a failed attestation check is retried, then reported with the file, the predicate and the ref", () => {
  const dir = releaseDir();
  const { gh, calls, state } = fakeGh();
  state.attestationFails = true;
  const problems = verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: "refs/heads/main", sourceDigest: "b".repeat(40) }, gh, noPause);
  assert.equal(problems.length, 15);
  assert.match(problems[0], /no https:\/\/slsa\.dev\/provenance\/v1 attestation of amo-linux-x64 from \.github\/workflows\/release-cli\.yml on refs\/heads\/main at bbbbbbbbbbbb: no matching attestation/);
  assert.equal(calls.length, 45, "three tries per check");
  rmSync(join(dir, "amo-linux-x64"));
  assert.match(verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, fakeGh().gh, noPause)[0], /amo-linux-x64 is missing/);
});

test("publish: draft first, every file attached, checked, and only then made public", async () => {
  const dir = releaseDir();
  const { gh, calls } = fakeGh();
  assert.deepEqual(await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause), []);
  const order = calls.map((c) => (c[0] === "release" ? `release ${c[1]}` : c[1] === "--method" ? "publish" : c[1] === "--paginate" ? "list" : "read"));
  assert.deepEqual(order, ["list", "release create", "list", "read", "publish", "read"], "the draft is re-read by id before it is made public");
  const create = callsOf(calls, "release", "create")[0];
  for (const flag of ["--draft", "--verify-tag", "--notes-file"]) assert.ok(create.includes(flag), flag);
  assert.ok(!create.includes("--generate-notes"), "one source of notes, no flag combination to get wrong on a real tag");
  assert.ok(!create.includes("--clobber") && !create.includes("--latest"));
  assert.equal(create.filter((x) => allNames(VERSION).includes(basename(x))).length, 11, "all files in the one create call");
  assert.ok(create.some((x) => basename(x) === "amo-1.2.3.intoto.jsonl"), "the provenance file is attached in the same call, never uploaded later");
  const patch = callsOf(calls, "api", "--method")[0];
  assert.deepEqual(patch.slice(1, 4), ["--method", "PATCH", "repos/owner/repo/releases/7"]);
  assert.ok(patch.includes("draft=false"));
});

test("publish refuses a release that already exists (draft or public) and changes nothing", async () => {
  for (const draft of [true, false]) {
    const dir = releaseDir();
    const { gh, calls } = fakeGh({ existing: [{ id: 3, tag_name: TAG, draft, assets: [] }] });
    const problems = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause);
    assert.match(problems[0], new RegExp(`already has ${draft ? "a draft" : "a public release"}.*never replaced`));
    assert.equal(callsOf(calls, "release", "create").length, 0);
    assert.equal(callsOf(calls, "api", "--method").length, 0);
  }
});

test("publish never makes the release public when the draft is wrong", async () => {
  const cases = [
    [{ drop: "amo-cli-1.2.3.cdx.json" }, /asset amo-cli-1\.2\.3\.cdx\.json is not on the release/],
    [{ extra: "surprise.bin" }, /surprise\.bin is on the release but is not one of the 11/],
    [{ extra: "amo-1.2.4.intoto.jsonl" }, /amo-1\.2\.4\.intoto\.jsonl is on the release but is not one of the 11/],
    [{ drop: "amo-1.2.3.intoto.jsonl" }, /asset amo-1\.2\.3\.intoto\.jsonl is not on the release/],
    [{ digest: "amo-1.2.3.intoto.jsonl" }, /amo-1\.2\.3\.intoto\.jsonl on the release has digest sha256:0{64}/],
    [{ digest: "amo-linux-x64" }, /amo-linux-x64 on the release has digest sha256:0{64}/],
    [{ state: "hybridcloudworks-migration-core-1.2.3.tgz" }, /in state "starter"/],
  ];
  for (const [corrupt, expected] of cases) {
    const { gh, calls } = fakeGh({ corrupt });
    const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause);
    assert.match(problems.join("\n"), expected);
    assert.match(problems.at(-1), /draft stays unpublished/);
    assert.equal(callsOf(calls, "api", "--method").length, 0, "no PATCH, so the release stays a draft");
  }
});

test("publish: a draft asset with no sha256 digest is a problem, never a skipped check (review F2)", async () => {
  for (const nullDigest of ["amo-linux-x64", "hybridcloudworks-migration-ui-1.2.3.tgz"]) {
    const { gh, calls } = fakeGh({ corrupt: { nullDigest } });
    const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause);
    assert.ok(problems.some((p) => p.startsWith(`asset ${nullDigest} has no sha256 digest`)), problems.join("\n"));
    assert.match(problems.at(-1), /draft stays unpublished/);
    assert.equal(callsOf(calls, "api", "--method").length, 0, "never made public");
    assert.equal(calls.filter((c) => c[0] === "api" && /releases\/7$/.test(c[1])).length, 10, "re-read by id a bounded number of times, then stopped");
  }
  const dir = releaseDir();
  const odd = await releaseProblems({ draft: true, assets: allNames(VERSION).map((n) => ({ name: n, state: "uploaded", digest: n === "amo-linux-x64" ? "md5:abc" : `sha256:${sha(join(dir, n))}` })) }, dir, VERSION, { draft: true });
  assert.match(odd.join(), /amo-linux-x64 has no sha256 digest/, "a digest that is not sha256 counts as missing");
});

test("publish: the draft is judged from GET /releases/{id}, retried while GitHub is still processing, not from the list (review F2)", async () => {
  // the list lags (it shows the draft without assets) and the first by-id reads show assets not yet uploaded, no digests
  const { gh, calls } = fakeGh({ lagReads: 3, staleList: true });
  assert.deepEqual(await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause), []);
  const byId = calls.filter((c) => c[0] === "api" && /releases\/7$/.test(c[1]));
  assert.equal(byId.length, 3 + 1 + 1, "three lagging reads, one good read, then the read-back after publishing");
  assert.equal(callsOf(calls, "api", "--method").length, 1);
  // the same lag that never ends is bounded and never publishes
  const never = fakeGh({ lagReads: 1000, staleList: true });
  const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW, changelog: changelogFile() }, never.gh, noPause);
  assert.match(problems.join("\n"), /in state "starter"/);
  assert.equal(callsOf(never.calls, "api", "--method").length, 0);
  assert.equal(never.calls.filter((c) => c[0] === "api" && /releases\/7$/.test(c[1])).length, 10);
});

test("publish reports a failed create, a failed publish and incomplete input without publishing", async () => {
  const dir = releaseDir();
  assert.match((await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW, changelog: changelogFile() }, fakeGh({ failCreate: true }).gh, noPause))[0], /could not create the draft release/);
  const patchFail = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW, changelog: changelogFile() }, fakeGh({ failPatch: true }).gh, noPause);
  assert.match(patchFail[0], /could not make release v1\.2\.3 public/);
  assert.match(patchFail[1], /draft stays unpublished/);
  rmSync(join(dir, "amo-windows-x64.exe"));
  const { gh, calls } = fakeGh();
  const missing = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause);
  assert.match(missing.join("\n"), /amo-windows-x64\.exe is missing[\s\S]*nothing was published/);
  assert.equal(calls.length, 0, "no call to GitHub at all");
});

test("publish refuses, before any call to GitHub, a release without its provenance file or with one that is not about these files", async () => {
  const refusals = [
    [(dir) => rmSync(join(dir, "amo-1.2.3.intoto.jsonl")), /amo-1\.2\.3\.intoto\.jsonl is missing/],
    [(dir) => writeFileSync(join(dir, "amo-1.2.3.intoto.jsonl"), ""), /amo-1\.2\.3\.intoto\.jsonl is empty/],
    [(dir) => writeFileSync(join(dir, "amo-1.2.3.intoto.jsonl"), "placeholder\n"), /is not a JSON object/],
    [(dir) => writeFileSync(join(dir, "amo-1.2.3.intoto.jsonl"), `${bundleLines(dir)[0]}\n`), /does not name hybridcloudworks-migration-core-1\.2\.3\.tgz/],
    [(dir) => writeFileSync(join(dir, "amo-linux-x64"), "rebuilt after it was attested"), /names amo-linux-x64 with sha256/],
    [(dir) => { rmSync(join(dir, "amo-1.2.3.intoto.jsonl")); writeFileSync(join(dir, "amo-1.2.4.intoto.jsonl"), `${bundleLines(dir).join("\n")}\n`); }, /amo-1\.2\.4\.intoto\.jsonl is not one of the 11 files/],
    [(dir) => writeFileSync(join(dir, "second.intoto.jsonl"), `${bundleLines(dir).join("\n")}\n`), /second\.intoto\.jsonl is not one of the 11 files/],
  ];
  for (const [spoil, expected] of refusals) {
    const dir = releaseDir();
    spoil(dir);
    const { gh, calls } = fakeGh();
    const problems = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW, changelog: changelogFile() }, gh, noPause);
    assert.match(problems.join("\n"), expected);
    assert.equal(problems.at(-1), "nothing was published");
    assert.equal(calls.length, 0, "no call to GitHub at all");
  }
});

test("verify-release: downloads the public release, compares files and digests, then verifies the attestations", async () => {
  const dir = releaseDir();
  const out = join(scratch(), "released");
  const { gh, state, calls } = fakeGh();
  state.source = allNames(VERSION).map((n) => join(dir, n));
  state.releases = [{ id: 7, tag_name: TAG, draft: false, assets: allNames(VERSION).map((n) => ({ name: n, state: "uploaded", digest: `sha256:${sha(join(dir, n))}` })) }];
  assert.deepEqual(await verifyRelease({ repo: REPO, tag: TAG, out, workflow: WORKFLOW, sourceRef: `refs/tags/${TAG}`, sourceDigest: "c".repeat(40) }, gh, noPause), []);
  assert.equal(readdirSync(out).length, 11);
  assert.equal(callsOf(calls, "attestation", "verify").length, 25, "fifteen checks against GitHub's store, then ten against the downloaded provenance file");
  assert.equal(callsOf(calls, "attestation", "verify").filter((c) => c.includes("--bundle")).length, 10);
  // a public release without the provenance file (or with a stray one) fails the check
  const before = fakeGh();
  before.state.source = builtNames(VERSION).map((n) => join(dir, n));
  before.state.releases = [{ id: 7, tag_name: TAG, draft: false, assets: builtNames(VERSION).map((n) => ({ name: n, state: "uploaded", digest: `sha256:${sha(join(dir, n))}` })) }];
  const lacking = (await verifyRelease({ repo: REPO, tag: TAG, out: join(scratch(), "lacking"), workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, before.gh, noPause)).join("\n");
  assert.match(lacking, /amo-1\.2\.3\.intoto\.jsonl is missing/);
  assert.match(lacking, /asset amo-1\.2\.3\.intoto\.jsonl is not on the release/);
  assert.equal(callsOf(before.calls, "attestation", "verify").length, 0);
  // a downloaded file that differs from the digest GitHub reports is caught before any attestation is trusted
  writeFileSync(join(dir, "amo-linux-x64"), "tampered");
  const tampered = await verifyRelease({ repo: REPO, tag: TAG, out: join(scratch(), "again"), workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, gh, noPause);
  assert.match(tampered.join("\n"), /amo-linux-x64 on the release has digest/);
  // a draft is not a public release
  state.releases[0].draft = true;
  assert.match((await verifyRelease({ repo: REPO, tag: TAG, out: join(scratch(), "d"), workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, gh, noPause)).join("\n"), /still a draft/);
});

test("release notes say how to verify a download and name the SBOMs", () => {
  const notes = releaseNotes(TAG, REPO, WORKFLOW, changelogSection(CHANGELOG_TEXT, "1.2.3"));
  for (const predicate of [PROVENANCE, SBOM]) {
    const example = `gh attestation verify hybridcloudworks-migration-core-1.2.3.tgz --repo owner/repo --predicate-type ${predicate} --source-ref refs/tags/v1.2.3 --signer-workflow owner/repo/${WORKFLOW} --deny-self-hosted-runners`;
    assert.ok(notes.includes(example), `both examples use the strict flags of the pipeline: ${predicate}`);
  }
  assert.ok(notes.includes("https://github.com/owner/repo/blob/v1.2.3/docs/release/README.md"), "a link, not a bare path");
  assert.match(notes, /amo-cli-1\.2\.3\.cdx\.json/);
  assert.ok(notes.includes(`gh attestation verify hybridcloudworks-migration-core-1.2.3.tgz --repo owner/repo --bundle amo-1.2.3.intoto.jsonl --source-ref refs/tags/v1.2.3 --signer-workflow owner/repo/${WORKFLOW} --deny-self-hosted-runners`), "the provenance file and how to use it");
  assert.match(notes, /https:\/\/github\.com\/owner\/repo\/blob\/v1\.2\.3\/CHANGELOG\.md/);
  assert.ok(notes.startsWith("## What changed in v1.2.3\n\nWhat 1.2.3 changes, in plain words."), "the page opens with the version's summary");
  assert.ok(!notes.includes("a change not released yet") && !notes.includes("Older."), "only this version's section");
  assert.throws(() => releaseNotes(TAG, REPO, WORKFLOW, null), /no CHANGELOG\.md summary/);
});

test("publish refuses a release whose CHANGELOG has no section or no summary for the version, and creates nothing", async () => {
  for (const text of ["# Changelog\n\n## Unreleased\n\n- x\n", "# Changelog\n\n## 1.2.3 — 2026-11-23\n\n<!-- summary -->\n\n- only entries\n"]) {
    const f = join(scratch(), "CHANGELOG.md");
    writeFileSync(f, text);
    const never = fakeGh();
    const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW, changelog: f }, never.gh, noPause);
    assert.match(problems.join("\n"), /no section with a summary for 1\.2\.3/);
    assert.ok(problems.includes("nothing was published"));
    assert.equal(never.calls.length, 0, "gh was never called");
  }
});

test("gh api --paginate output (one array per page, back to back) is decoded", () => {
  assert.deepEqual(decodeJsonValues('[{"a":"]"}]\n[{"b":1}]'), [[{ a: "]" }], [{ b: 1 }]]);
  assert.deepEqual(decodeJsonValues("[]"), [[]]);
  assert.throws(() => decodeJsonValues("[{"), /unterminated/);
});

// ---- check-release-version.mjs ------------------------------------------------------------------------------------------

function fixture(versions = {}) {
  const root = scratch();
  const v = { pkg: "1.2.3", manifest: "1.2.3", lock: "1.2.3", lockRoot: "1.2.3", ...versions };
  writeFileSync(join(root, "CHANGELOG.md"), CHANGELOG_TEXT);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", version: v.pkg }));
  writeFileSync(join(root, "repository.manifest.json"), JSON.stringify({ version: v.manifest }));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ version: v.lock, packages: { "": { version: v.lockRoot } } }));
  return root;
}
const git = (root, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test("version guard: agreeing versions pass; every disagreement is named", () => {
  assert.deepEqual(check(fixture()).problems, []);
  assert.equal(check(fixture()).version, "1.2.3");
  for (const [override, where] of [[{ pkg: "1.2.4" }, "package.json"], [{ manifest: "1.2.4" }, "repository.manifest.json"], [{ lock: "1.2.4" }, "package-lock.json version"], [{ lockRoot: "1.2.4" }, "package-lock.json root package"]]) {
    const { problems } = check(fixture(override));
    assert.match(problems.join("\n"), new RegExp(`the version differs between files.*${where} says 1\\.2\\.4`), where);
  }
  assert.match(check(fixture({ pkg: "1.2.3-rc.1", manifest: "1.2.3-rc.1", lock: "1.2.3-rc.1", lockRoot: "1.2.3-rc.1" })).problems.join(), /not a plain X\.Y\.Z/);
  assert.match(check(scratch()).problems.join("\n"), /cannot read package\.json/);
});

test("version guard: the tag must be v + the version, in any accepted spelling", () => {
  assert.deepEqual(check(fixture(), { tag: "v1.2.3" }).problems, []);
  assert.deepEqual(check(fixture(), { tag: "refs/tags/v1.2.3" }).problems, []);
  assert.match(check(fixture(), { tag: "v1.2.4" }).problems.join(), /tag v1\.2\.4 does not match the package version 1\.2\.3/);
  assert.match(check(fixture(), { tag: "1.2.3" }).problems.join(), /not "v" followed by X\.Y\.Z/);
  assert.match(check(fixture(), { tag: "v1.2" }).problems.join(), /not "v" followed/);
  assert.match(check(fixture(), { tag: "v1.2.3", rehearse: true }).problems.join(), /either a tag or --rehearse/);
});

test("version guard: the commit must be on main; a dry run takes the tag to be v + the version and warns when it exists", () => {
  const root = fixture();
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  const onMain = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "-b", "side");
  writeFileSync(join(root, "extra.txt"), "x");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "two");
  const offMain = git(root, "rev-parse", "HEAD");
  assert.equal(notOnBranch(root, onMain, "main"), null);
  assert.match(notOnBranch(root, offMain, "main"), /is not on main: release only commits that reached the protected branch/);
  assert.match(notOnBranch(root, "0".repeat(40), "main"), /could not compare/);
  assert.deepEqual(check(root, { tag: "v1.2.3", ancestorOf: "main", sha: onMain }).problems, []);
  assert.match(check(root, { tag: "v1.2.3", ancestorOf: "main", sha: offMain }).problems.join(), /not on main/);
  const dry = check(root, { rehearse: true, ancestorOf: "main", sha: onMain });
  assert.deepEqual(dry.problems, []);
  assert.equal(dry.tag, "v1.2.3");
  assert.deepEqual(dry.warnings, []);
  git(root, "tag", "v1.2.3", onMain);
  assert.match(check(root, { rehearse: true, ancestorOf: "main", sha: onMain }).warnings.join(), /already exists, so a real tag run for this version would be refused/);
  assert.deepEqual(check(root, { ancestorOf: "main", sha: offMain }).problems, [], "without a tag or --rehearse the ancestry is not checked");
});

test("version guard: --set-version writes all four places so they cannot drift apart, and refuses a non-version", () => {
  const root = fixture();
  setVersion(root, "1.3.0");
  assert.deepEqual(check(root).problems, []);
  assert.equal(check(root).version, "1.3.0");
  assert.equal(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages[""].version, "1.3.0");
  assert.throws(() => setVersion(root, "1.3"), /not a plain X\.Y\.Z/);
  assert.throws(() => setVersion(root, "v1.3.0"), /not a plain X\.Y\.Z/);
  const cli = spawnSync(process.execPath, ["scripts/check-release-version.mjs", "--root", root, "--set-version", "1.4.0"], { encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.equal(check(root).version, "1.4.0");
});

test("version guard: npm must be new enough for trusted publishing", () => {
  assert.equal(atLeast("11.5.1", "11.5.1"), true);
  assert.equal(atLeast("11.17.0", "11.5.1"), true);
  assert.equal(atLeast("11.5.0", "11.5.1"), false);
  assert.equal(atLeast("10.9.2", "11.5.1"), false);
  assert.deepEqual(check(fixture(), { requireNpm: "11.5.1", npmVersion: "11.6.0" }).problems, []);
  assert.match(check(fixture(), { requireNpm: "11.5.1", npmVersion: "10.9.2" }).problems.join(), /npm 10\.9\.2 is older than 11\.5\.1.*rather than installing npm@latest/);
  assert.match(check(fixture(), { requireNpm: "11.5.1", npmVersion: "" }).problems.join(), /could not read the npm version/);
});

test("the guard accepts this repository as it is", () => {
  const { problems, version } = check(process.cwd());
  assert.deepEqual(problems, []);
  assert.equal(version, JSON.parse(readFileSync("package.json", "utf8")).version);
});

// ---- generate-sbom.mjs --------------------------------------------------------------------------------------------------

test("sbom: the root is retitled to the artifact, a component is added, and a wrong tree is refused", () => {
  const bom = { bomFormat: "CycloneDX", specVersion: "1.5", metadata: { component: { "bom-ref": "folder@1.0.0", name: "folder", version: "1.0.0" } }, components: [{ "bom-ref": "@amo/domain@0.1.0", name: "domain", version: "0.1.0" }], dependencies: [{ ref: "folder@1.0.0", dependsOn: ["@amo/domain@0.1.0"] }] };
  retitle(bom, { name: "amo", version: VERSION, description: "d" });
  addComponent(bom, { "bom-ref": "node@26.0.0", type: "platform", name: "node", version: "26.0.0" });
  assert.equal(bom.metadata.component.name, "amo");
  assert.equal(bom.metadata.component.purl, "pkg:generic/amo@1.2.3");
  assert.deepEqual(bom.dependencies[0], { ref: "amo@1.2.3", dependsOn: ["@amo/domain@0.1.0", "node@26.0.0"] });
  assert.equal(assertBom(bom, { rootName: "amo", rootVersion: VERSION, mustContain: ["@amo/domain", "node"] }), bom);
  assert.throws(() => assertBom(bom, { rootName: "amo", rootVersion: VERSION, mustContain: ["react"] }), /does not list react; it describes the wrong tree/);
  assert.throws(() => assertBom(bom, { rootName: "amo", rootVersion: "9.9.9", mustContain: [] }), /expected amo@9\.9\.9/);
  assert.throws(() => assertBom({ bomFormat: "SPDX" }, { rootName: "a", rootVersion: "1", mustContain: [] }), /not a CycloneDX/);
});

test("the three release scripts exist", () => {
  for (const f of ["release-publish", "check-release-version", "generate-sbom"]) assert.ok(existsSync(`scripts/${f}.mjs`), f);
});

test("version guard: a tag on an older commit is refused when .github/workflows changed since (a GITHUB_TOKEN could not create its release), before any attestation (review F1)", () => {
  const root = fixture();
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/a.yml"), "name: a\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  const first = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "docs.md"), "x");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "two: not a workflow");
  const second = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, ".github/workflows/a.yml"), "name: a changed\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "three: a workflow");
  const tip = git(root, "rev-parse", "HEAD");
  // the tip is always fine
  assert.equal(workflowParity(root, tip, "main"), null);
  assert.deepEqual(check(root, { tag: "v1.2.3", ancestorOf: "main", sha: tip }).problems, []);
  // an older commit on main is an ancestor, but .github/workflows differs from the tip: refused
  assert.equal(notOnBranch(root, first, "main"), null, "ancestry alone would have accepted it");
  const refused = check(root, { tag: "v1.2.3", ancestorOf: "main", sha: first }).problems.join("\n");
  assert.match(refused, /is not the tip of main \(.{12}\) and \.github\/workflows differs between them: a GITHUB_TOKEN cannot create a release/);
  assert.match(refused, /Tag the tip of main/);
  assert.match(check(root, { rehearse: true, ancestorOf: "main", sha: first }).problems.join(), /\.github\/workflows differs/, "the dry run applies the same rule");
  // after the last workflow change, an older commit that has the same workflows as the tip is accepted
  writeFileSync(join(root, "later.md"), "y");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "four: not a workflow");
  assert.equal(workflowParity(root, tip, "main"), null, "workflows identical to the tip's, so the release can be created");
  assert.deepEqual(check(root, { tag: "v1.2.3", ancestorOf: "main", sha: tip }).problems, []);
  assert.match(workflowParity(root, second, "main"), /differs/, "this one predates the workflow change");
  // an unresolvable ref or commit is a problem, not a pass
  assert.match(workflowParity(root, tip, "origin/nope"), /could not resolve origin\/nope/);
  assert.match(workflowParity(root, "0".repeat(40), "main"), /could not compare/);
  // without --ancestor-of nothing is compared (the version check alone)
  assert.deepEqual(check(root, { tag: "v1.2.3", sha: first }).problems, []);
});

// ---- the React peers installed by the gate and the SBOM are exact (review of pull request 79, F4) --------------------------

test("the clean-consumer gate and the SBOM install the React peers at the exact locked versions, never a range", async () => {
  const { lockedVersion, lockedSpecs, CONSUMER_PEERS, CONSUMER_TYPES } = await import("../../scripts/lib/locked-versions.mjs");
  const specs = lockedSpecs([...CONSUMER_PEERS, ...CONSUMER_TYPES]);
  assert.equal(specs.length, 4);
  for (const spec of specs) assert.match(spec, /^(@types\/)?react(-dom)?@\d+\.\d+\.\d+$/, spec);
  // the locked versions satisfy what the UI package asks of its consumer
  const peers = JSON.parse(readFileSync("packages/ui/package.json", "utf8")).peerDependencies;
  const atLeastRange = (version, range) => {
    const [, major, minor = "0"] = /\^(\d+)\.(\d+)/.exec(range) ?? [];
    const [vMajor, vMinor] = version.split(".").map(Number);
    return vMajor === Number(major) && vMinor >= Number(minor);
  };
  for (const name of CONSUMER_PEERS) assert.ok(atLeastRange(lockedVersion(name), peers[name]), `${name} ${lockedVersion(name)} satisfies ${peers[name]}`);
  // a lockfile without an exact version is a failure, not a silent fallback to a range
  const root = scratch();
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/react": { version: "^19.0.0" }, "node_modules/react-dom": { version: "19.x" } } }));
  assert.throws(() => lockedVersion("react", root), /no exact version for react/);
  assert.throws(() => lockedVersion("react-dom", root), /no exact version for react-dom/);
  assert.throws(() => lockedVersion("@types/react", root), /no exact version for @types\/react/);
  // and neither script spells a floating range for them
  for (const file of ["scripts/generate-sbom.mjs", "scripts/verify-packed-consumer.mjs"]) {
    const text = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(text, /["'`](react|react-dom|@types\/react[\w-]*)@[\^~*]|@latest\b/, `${file}: a floating dependency range`);
    for (const line of text.split("\n").filter((l) => /"install"/.test(l))) assert.doesNotMatch(line, /["'`](react|react-dom|@types\/react[\w-]*)["'`]/, `${file}: a bare package name in an install (it would take the newest)`);
    assert.match(text, /lockedSpecs\(/, `${file}: installs from the lockfile`);
  }
});

test("a release run needs a CHANGELOG section with a summary for its version; a plain check does not", () => {
  const root = fixture({ pkg: "1.2.4", manifest: "1.2.4", lock: "1.2.4", lockRoot: "1.2.4" });
  assert.deepEqual(check(root).problems, [], "without a tag or --rehearse the CHANGELOG is not read");
  assert.match(check(root, { tag: "v1.2.4" }).problems.join(), /no section "## 1\.2\.4 — YYYY-MM-DD"/);
  assert.match(check(root, { rehearse: true }).problems.join(), /no section "## 1\.2\.4/);
  assert.deepEqual(check(fixture(), { tag: "v1.2.3" }).problems, []);
  assert.match(changelogProblems(scratch(), "1.2.3").join(), /cannot read CHANGELOG\.md/);
});

test("changelogSection finds a version's section by its heading and ignores look-alikes", () => {
  const text = "## 1.2.3 — 2026-11-23 (title)\n\nThe summary.\n\n- entry\n\n### sub\n\n## Before\n\n### Monorepo 1.0.0 — 2026-10-03\n";
  const s = changelogSection(text, "1.2.3");
  assert.equal(s.date, "2026-11-23");
  assert.equal(s.summary, "The summary.", "the first paragraph under the heading");
  assert.ok(s.body.includes("### sub") && !s.body.includes("Before"), "runs to the next level-2 heading");
  assert.equal(changelogSection(text, "1.0.0"), null, "a level-3 'Monorepo' heading is not a release");
  assert.equal(changelogSection("## 1.2.30 — 2026-11-23\n\nx\n", "1.2.3"), null, "1.2.3 is not 1.2.30");
});

test("--set-version moves the Unreleased entries into a new dated section and leaves the summary to write", () => {
  const root = fixture();
  setVersion(root, "1.3.0", "2026-12-01");
  const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.match(text, /## Unreleased\n\n## 1\.3\.0 — 2026-12-01\n\n<!-- summary:[^\n]*-->\n\n- a change not released yet\n/);
  assert.match(changelogProblems(root, "1.3.0").join(), /still has the comment/, "a release cannot go out until the summary is written");
  assert.throws(() => startChangelogSection(text, "1.3.0", "2026-12-02"), /already has a section for 1\.3\.0/);
  assert.throws(() => startChangelogSection("# Changelog\n", "1.3.0", "2026-12-02"), /no "## Unreleased" heading/);
});

test("this repository's CHANGELOG has a section with a summary for the version in package.json", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url)); // a real path on Windows too, and with spaces in folder names
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(changelogProblems(root, version), []);
});

test("a CHANGELOG problem stops --set-version before any file is written", () => {
  const root = fixture();
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## 1.2.3 — 2026-11-23\n\nSummary.\n");
  assert.throws(() => setVersion(root, "1.3.0", "2026-12-01"), /no "## Unreleased" heading/);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "1.2.3", "package.json is untouched");
});

test("the summary is the first plain paragraph under the heading, and the placeholder comment is never accepted", () => {
  const sec = (body) => changelogSection(`## 1.2.3 — 2026-11-23\n\n${body}\n`, "1.2.3");
  assert.equal(sec("What changed.\n\n- entry").summary, "What changed.");
  assert.equal(sec("<!-- note -->\nWhat changed, under a comment.\n\n- entry").summary, "What changed, under a comment.");
  for (const body of ["- entry\n\nLater paragraph.", "### Added\n\n- x", "* x", "1. x", "---", "> quoted", "   "]) assert.equal(sec(body).summary, "", JSON.stringify(body));
  // A paragraph moved in from Unreleased does not count while the placeholder is still there.
  const root = fixture();
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\nReported by someone.\n\n- entry\n");
  setVersion(root, "1.3.0", "2026-12-01");
  assert.match(changelogProblems(root, "1.3.0").join(), /still has the comment/);
});

test("--set-version keeps Windows line endings", () => {
  const text = startChangelogSection("# Changelog\r\n\r\n## Unreleased\r\n\r\n- x\r\n", "1.3.0", "2026-12-01");
  assert.ok(!/[^\r]\n/.test(text), "no bare \\n line ending was added");
  assert.equal(changelogSection(text, "1.3.0").date, "2026-12-01");
});

test("comments are removed in one pass: an unclosed <!-- hides the rest, and many openings stay fast (CodeQL alert 29)", () => {
  assert.equal(changelogSection("## 1.2.3 — 2026-11-23\n\n<!-- never closed\nLooks like a summary.\n", "1.2.3").summary, "");
  assert.equal(changelogSection("## 1.2.3 — 2026-11-23\n\n<!-- a --><!-- b -->\nSummary.\n", "1.2.3").summary, "Summary.");
  const started = performance.now();
  changelogSection(`## 1.2.3 — 2026-11-23\n\n${"<!--".repeat(200_000)}\n`, "1.2.3");
  assert.ok(performance.now() - started < 2000, "200,000 unclosed openings are read in well under two seconds");
});
