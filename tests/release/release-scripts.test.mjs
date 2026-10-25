import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { allNames, attestedNames, checkFiles, decodeJsonValues, publish, releaseProblems, releaseNotes, verifyAttestations, verifyCommand, verifyRelease, versionOfTag, PROVENANCE, SBOM } from "../../scripts/release-publish.mjs";
import { atLeast, check, notOnBranch, setVersion, workflowParity } from "../../scripts/check-release-version.mjs";
import { addComponent, assertBom, retitle } from "../../scripts/generate-sbom.mjs";

/**
 * Local, offline tests of the three release scripts (ADR-0032): they run the real code against a fake `gh`, so the logic
 * that decides whether a release becomes public is exercised before any real tag. They do not prove how GitHub behaves.
 */
const VERSION = "1.2.3";
const TAG = "v1.2.3";
const REPO = "owner/repo";
const WORKFLOW = ".github/workflows/release-cli.yml";
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const scratch = () => mkdtempSync(join(tmpdir(), "amo-release-test-"));
const noPause = () => {};
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const bad = (stderr) => ({ status: 1, stdout: "", stderr });

function releaseDir(version = VERSION) {
  const dir = join(scratch(), "release-files");
  mkdirSync(dir);
  for (const n of allNames(version)) writeFileSync(join(dir, n), `content of ${n}\n`);
  return dir;
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

test("the expected file list is the contract: three binaries, three checksum files, two tarballs, two SBOMs", () => {
  assert.deepEqual(allNames(VERSION), ["amo-linux-x64", "amo-darwin-arm64", "amo-windows-x64.exe", "SHA256SUMS-linux-x64.txt", "SHA256SUMS-darwin-arm64.txt", "SHA256SUMS-windows-x64.txt", "hybridcloudworks-migration-core-1.2.3.tgz", "hybridcloudworks-migration-ui-1.2.3.tgz", "amo-cli-1.2.3.cdx.json", "hybridcloudworks-migration-packages-1.2.3.cdx.json"]);
  assert.equal(attestedNames(VERSION).length, 5, "binaries and tarballs are attested; checksum files and SBOMs are not subjects");
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
  assert.match(problems, /stray\.txt is not one of the 10 files/);
  assert.match(problems, /amo-linux-x64 is empty/);
  assert.match(checkFiles(join(dir, "nope"), VERSION).join("\n"), /is missing/);
});

test("attestations are verified for provenance and SBOM, bound to this workflow, this ref and this commit", () => {
  const dir = releaseDir();
  const { gh, calls } = fakeGh();
  const digest = "a".repeat(40);
  const problems = verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: `refs/tags/${TAG}`, sourceDigest: digest }, gh, noPause);
  assert.deepEqual(problems, []);
  assert.equal(calls.length, 10, "five files, two predicates each");
  for (const c of calls) {
    assert.equal(c[c.indexOf("--signer-workflow") + 1], `${REPO}/${WORKFLOW}`);
    assert.equal(c[c.indexOf("--source-ref") + 1], `refs/tags/${TAG}`);
    assert.equal(c[c.indexOf("--source-digest") + 1], digest);
    assert.equal(c[c.indexOf("--repo") + 1], REPO);
    assert.equal(c[c.indexOf("--signer-digest") + 1], digest, "the workflow that signed must be the one at this commit");
    assert.ok(c.includes("--deny-self-hosted-runners"));
  }
  assert.equal(calls.filter((c) => c.includes(PROVENANCE)).length, 5);
  assert.equal(calls.filter((c) => c.includes(SBOM)).length, 5);
  assert.deepEqual(verifyCommand("f", "o/r", SBOM, "w.yml", "refs/tags/v1.0.0", "d").slice(0, 3), ["attestation", "verify", "f"]);
});

test("a failed attestation check is retried, then reported with the file, the predicate and the ref", () => {
  const dir = releaseDir();
  const { gh, calls, state } = fakeGh();
  state.attestationFails = true;
  const problems = verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: "refs/heads/main", sourceDigest: "b".repeat(40) }, gh, noPause);
  assert.equal(problems.length, 10);
  assert.match(problems[0], /no https:\/\/slsa\.dev\/provenance\/v1 attestation of amo-linux-x64 from \.github\/workflows\/release-cli\.yml on refs\/heads\/main at bbbbbbbbbbbb: no matching attestation/);
  assert.equal(calls.length, 30, "three tries per check");
  rmSync(join(dir, "amo-linux-x64"));
  assert.match(verifyAttestations({ dir, version: VERSION, repo: REPO, workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, fakeGh().gh, noPause)[0], /amo-linux-x64 is missing/);
});

test("publish: draft first, every file attached, checked, and only then made public", async () => {
  const dir = releaseDir();
  const { gh, calls } = fakeGh();
  assert.deepEqual(await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW }, gh, noPause), []);
  const order = calls.map((c) => (c[0] === "release" ? `release ${c[1]}` : c[1] === "--method" ? "publish" : c[1] === "--paginate" ? "list" : "read"));
  assert.deepEqual(order, ["list", "release create", "list", "read", "publish", "read"], "the draft is re-read by id before it is made public");
  const create = callsOf(calls, "release", "create")[0];
  for (const flag of ["--draft", "--verify-tag", "--notes-file"]) assert.ok(create.includes(flag), flag);
  assert.ok(!create.includes("--generate-notes"), "one source of notes, no flag combination to get wrong on a real tag");
  assert.ok(!create.includes("--clobber") && !create.includes("--latest"));
  assert.equal(create.filter((x) => allNames(VERSION).includes(basename(x))).length, 10, "all files in the one create call");
  const patch = callsOf(calls, "api", "--method")[0];
  assert.deepEqual(patch.slice(1, 4), ["--method", "PATCH", "repos/owner/repo/releases/7"]);
  assert.ok(patch.includes("draft=false"));
});

test("publish refuses a release that already exists (draft or public) and changes nothing", async () => {
  for (const draft of [true, false]) {
    const dir = releaseDir();
    const { gh, calls } = fakeGh({ existing: [{ id: 3, tag_name: TAG, draft, assets: [] }] });
    const problems = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW }, gh, noPause);
    assert.match(problems[0], new RegExp(`already has ${draft ? "a draft" : "a public release"}.*never replaced`));
    assert.equal(callsOf(calls, "release", "create").length, 0);
    assert.equal(callsOf(calls, "api", "--method").length, 0);
  }
});

test("publish never makes the release public when the draft is wrong", async () => {
  const cases = [
    [{ drop: "amo-cli-1.2.3.cdx.json" }, /asset amo-cli-1\.2\.3\.cdx\.json is not on the release/],
    [{ extra: "surprise.bin" }, /surprise\.bin is on the release but is not one of the 10/],
    [{ digest: "amo-linux-x64" }, /amo-linux-x64 on the release has digest sha256:0{64}/],
    [{ state: "hybridcloudworks-migration-core-1.2.3.tgz" }, /in state "starter"/],
  ];
  for (const [corrupt, expected] of cases) {
    const { gh, calls } = fakeGh({ corrupt });
    const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW }, gh, noPause);
    assert.match(problems.join("\n"), expected);
    assert.match(problems.at(-1), /draft stays unpublished/);
    assert.equal(callsOf(calls, "api", "--method").length, 0, "no PATCH, so the release stays a draft");
  }
});

test("publish: a draft asset with no sha256 digest is a problem, never a skipped check (review F2)", async () => {
  for (const nullDigest of ["amo-linux-x64", "hybridcloudworks-migration-ui-1.2.3.tgz"]) {
    const { gh, calls } = fakeGh({ corrupt: { nullDigest } });
    const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW }, gh, noPause);
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
  assert.deepEqual(await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW }, gh, noPause), []);
  const byId = calls.filter((c) => c[0] === "api" && /releases\/7$/.test(c[1]));
  assert.equal(byId.length, 3 + 1 + 1, "three lagging reads, one good read, then the read-back after publishing");
  assert.equal(callsOf(calls, "api", "--method").length, 1);
  // the same lag that never ends is bounded and never publishes
  const never = fakeGh({ lagReads: 1000, staleList: true });
  const problems = await publish({ repo: REPO, tag: TAG, dir: releaseDir(), workflow: WORKFLOW }, never.gh, noPause);
  assert.match(problems.join("\n"), /in state "starter"/);
  assert.equal(callsOf(never.calls, "api", "--method").length, 0);
  assert.equal(never.calls.filter((c) => c[0] === "api" && /releases\/7$/.test(c[1])).length, 10);
});

test("publish reports a failed create, a failed publish and incomplete input without publishing", async () => {
  const dir = releaseDir();
  assert.match((await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW }, fakeGh({ failCreate: true }).gh, noPause))[0], /could not create the draft release/);
  const patchFail = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW }, fakeGh({ failPatch: true }).gh, noPause);
  assert.match(patchFail[0], /could not make release v1\.2\.3 public/);
  assert.match(patchFail[1], /draft stays unpublished/);
  rmSync(join(dir, "amo-windows-x64.exe"));
  const { gh, calls } = fakeGh();
  const missing = await publish({ repo: REPO, tag: TAG, dir, workflow: WORKFLOW }, gh, noPause);
  assert.match(missing.join("\n"), /amo-windows-x64\.exe is missing[\s\S]*nothing was published/);
  assert.equal(calls.length, 0, "no call to GitHub at all");
});

test("verify-release: downloads the public release, compares files and digests, then verifies the attestations", async () => {
  const dir = releaseDir();
  const out = join(scratch(), "released");
  const { gh, state, calls } = fakeGh();
  state.source = allNames(VERSION).map((n) => join(dir, n));
  state.releases = [{ id: 7, tag_name: TAG, draft: false, assets: allNames(VERSION).map((n) => ({ name: n, state: "uploaded", digest: `sha256:${sha(join(dir, n))}` })) }];
  assert.deepEqual(await verifyRelease({ repo: REPO, tag: TAG, out, workflow: WORKFLOW, sourceRef: `refs/tags/${TAG}`, sourceDigest: "c".repeat(40) }, gh, noPause), []);
  assert.equal(readdirSync(out).length, 10);
  assert.equal(callsOf(calls, "attestation", "verify").length, 10);
  // a downloaded file that differs from the digest GitHub reports is caught before any attestation is trusted
  writeFileSync(join(dir, "amo-linux-x64"), "tampered");
  const tampered = await verifyRelease({ repo: REPO, tag: TAG, out: join(scratch(), "again"), workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, gh, noPause);
  assert.match(tampered.join("\n"), /amo-linux-x64 on the release has digest/);
  // a draft is not a public release
  state.releases[0].draft = true;
  assert.match((await verifyRelease({ repo: REPO, tag: TAG, out: join(scratch(), "d"), workflow: WORKFLOW, sourceRef: "r", sourceDigest: "d" }, gh, noPause)).join("\n"), /still a draft/);
});

test("release notes say how to verify a download and name the SBOMs", () => {
  const notes = releaseNotes(TAG, REPO, WORKFLOW);
  for (const predicate of [PROVENANCE, SBOM]) {
    const example = `gh attestation verify hybridcloudworks-migration-core-1.2.3.tgz --repo owner/repo --predicate-type ${predicate} --source-ref refs/tags/v1.2.3 --signer-workflow owner/repo/${WORKFLOW} --deny-self-hosted-runners`;
    assert.ok(notes.includes(example), `both examples use the strict flags of the pipeline: ${predicate}`);
  }
  assert.ok(notes.includes("https://github.com/owner/repo/blob/v1.2.3/docs/release/README.md"), "a link, not a bare path");
  assert.match(notes, /amo-cli-1\.2\.3\.cdx\.json/);
  assert.match(notes, /https:\/\/github\.com\/owner\/repo\/blob\/v1\.2\.3\/CHANGELOG\.md/);
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
