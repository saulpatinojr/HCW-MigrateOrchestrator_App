import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { allNames, BINARIES } from "../../scripts/release-publish.mjs";

/**
 * The release pipeline (release-cli.yml, publish-npm.yml; ADR-0034) first runs for real on a v* tag, and a v* tag can never
 * be moved or deleted, so what the workflows must and must not do is written down here. These are static checks of the
 * files (no YAML library; the files share one style). They do not prove how GitHub runs them: that needs the dry run and
 * then a real tag (docs/release/README.md).
 */
const DIR = ".github/workflows";
const text = (name) => readFileSync(`${DIR}/${name}`, "utf8").replaceAll("\r\n", "\n"); // a Windows checkout has CRLF
/** The file without comment-only lines, so a comment may name what the workflow no longer does. */
const code = (name) => text(name).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".yml")).sort();
const RELEASE = "release-cli.yml";
const NPM = "publish-npm.yml";
const TAG_ONLY = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')";
const ATTEST_SHA = "1e69f48acb82d1966a394da916b4c1698aa569d6";

/** Map job name to its text: a job starts at two spaces and a name inside the top-level `jobs:` block. */
function jobs(body) {
  // comment lines between jobs belong to no job
  const rest = (body.split("\njobs:\n")[1] ?? "").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const pieces = rest.split(/^(?=  [A-Za-z0-9_-]+:\s*$)/m).filter((p) => p.trim());
  return Object.fromEntries(pieces.map((p) => [p.split(":", 1)[0].trim(), p]));
}
const head = (job) => job.split("    steps:")[0];
const steps = (job) => job.split(/^(?=      - )/m).slice(1);
/** The `permissions:` entries of a job (not the workflow's). */
function grants(job) {
  const m = head(job).match(/^ {4}permissions:\n((?: {6}.*\n)+)/m);
  return m ? [...m[1].matchAll(/^ {6}([a-z-]+: (?:read|write))/gm)].map((x) => x[1]).sort() : [];
}
const needs = (job) => (head(job).match(/^ {4}needs: (.*)$/m)?.[1] ?? "").replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);

test("every workflow pins every action to a full commit SHA with a version comment", () => {
  for (const name of ALL) {
    for (const m of text(name).matchAll(/^\s*(?:- )?uses:\s*(\S+)(.*)$/gm)) {
      const [, target, rest] = m;
      if (target.startsWith("./")) continue;
      assert.match(target, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${target} is not pinned to a commit`);
      assert.match(rest, /#\s*v\d+(\.\d+){0,2}\b/, `${name}: ${target} has no version comment`);
    }
  }
});

test("no workflow grants write at the top level, installs a floating npm, or overwrites a published file", () => {
  for (const name of ALL) {
    const top = code(name).split("\njobs:\n")[0];
    const block = `${top}\n`.match(/^permissions:\n((?: {2}\S.*\n)+)/m);
    assert.ok(block, `${name}: no top-level permissions block`);
    assert.deepEqual(block[1].trim().split("\n").map((l) => l.trim()), ["contents: read"], `${name}: top-level permissions must be exactly contents: read`);
    const c = code(name);
    assert.doesNotMatch(c, /@latest\b/, `${name}: a floating @latest`);
    assert.doesNotMatch(c, /npm install -g|npm i -g/, `${name}: a global npm install`);
    assert.doesNotMatch(c, /--clobber/, `${name}: --clobber overwrites a published file`);
    assert.doesNotMatch(c, /pull_request_target/, name);
  }
});

test("release-cli: one ordered path, check first, every build waits for it", () => {
  const j = jobs(text(RELEASE));
  assert.deepEqual(Object.keys(j), ["check", "sea", "packages", "inventory", "attest", "verify-attestations", "release", "post-release"]);
  assert.deepEqual(needs(j.check), []);
  assert.deepEqual(needs(j.sea), ["check"]);
  assert.deepEqual(needs(j.packages), ["check"]);
  assert.deepEqual(needs(j.inventory), ["check", "sea", "packages"]);
  assert.deepEqual(needs(j.attest), ["check", "inventory"]);
  assert.deepEqual(needs(j["verify-attestations"]), ["check", "attest"]);
  assert.deepEqual(needs(j.release), ["check", "inventory", "attest", "verify-attestations"]);
  assert.deepEqual(needs(j["post-release"]), ["check", "release"]);
  assert.match(text(RELEASE), /^on:\n {2}push:\n {4}tags: \["v\*"\]\n {2}workflow_dispatch:/m);
  assert.match(text(RELEASE), /^concurrency:\n {2}group: release-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false$/m);
});

test("release-cli: the tag guard runs before anything is built, on the same checks for a dry run", () => {
  const check = jobs(text(RELEASE)).check;
  assert.match(check, /fetch-depth: 0/, "the ancestry check needs the full history");
  assert.match(check, /if \[ "\$EVENT_NAME" = "push" \]; then mode=\(--tag "\$REF_NAME"\); else mode=\(--rehearse\); fi/);
  assert.match(check, /node scripts\/check-release-version\.mjs "\$\{mode\[@\]\}" --ancestor-of origin\/main/);
  assert.match(steps(check)[0], /if: github\.event_name != 'push' && github\.ref != 'refs\/heads\/main'/, "a manual run off main fails at once");
  assert.match(steps(check)[0], /exit 1/);
  assert.match(check, /outputs:\n {6}version: \$\{\{ steps\.guard\.outputs\.version \}\}/);
});

test("release-cli: permissions are per job, write only where it is used", () => {
  const j = jobs(text(RELEASE));
  for (const name of ["check", "sea", "packages", "inventory"]) assert.deepEqual(grants(j[name]), [], `${name} needs only the top-level contents: read`);
  assert.deepEqual(grants(j.attest), ["attestations: write", "contents: read", "id-token: write"]);
  assert.deepEqual(grants(j["verify-attestations"]), ["attestations: read", "contents: read"]);
  assert.deepEqual(grants(j.release), ["attestations: read", "contents: write"]);
  assert.deepEqual(grants(j["post-release"]), ["attestations: read", "contents: read"]);
  const writers = Object.entries(j).filter(([, body]) => /contents: write/.test(head(body))).map(([n]) => n);
  assert.deepEqual(writers, ["release"], "exactly one job can write to the repository");
  assert.doesNotMatch(code(RELEASE).split("\njobs:\n")[0], /write/, "no write at the workflow level");
});

test("release-cli: exactly one job creates the release, as a draft, through the script; no third-party release action", () => {
  const body = text(RELEASE);
  const c = code(RELEASE);
  assert.doesNotMatch(c, /softprops\/action-gh-release|actions\/create-release|ncipollo|gh release (create|upload|edit)/, "creating or editing a release belongs to scripts/release-publish.mjs");
  const touching = Object.entries(jobs(body)).filter(([, b]) => /release-publish\.mjs publish /.test(b)).map(([n]) => n);
  assert.deepEqual(touching, ["release"]);
  const script = readFileSync("scripts/release-publish.mjs", "utf8");
  const create = script.indexOf('"release", "create"');
  const verifyDraft = script.indexOf("await settleDraft(repo, draft.id");
  const patch = script.indexOf('"PATCH"');
  assert.ok(create > 0 && create < verifyDraft && verifyDraft < patch, "create, then check the draft, then make it public, in that order");
  assert.match(script, /"--draft", "--verify-tag"/);
  assert.doesNotMatch(script, /--clobber|"upload"|"delete"/, "no replacing, no deleting");
});

test("release-cli: release and post-release run only for a pushed v* tag, never for a manual run", () => {
  const j = jobs(text(RELEASE));
  for (const name of ["release", "post-release"]) assert.ok(head(j[name]).includes(`if: ${TAG_ONLY}`), `${name} must be tag-only`);
  for (const name of ["check", "sea", "packages", "inventory", "attest", "verify-attestations"]) assert.doesNotMatch(j[name], /release-publish\.mjs (publish|verify-release)/, `${name} must not publish`);
  assert.match(head(j.attest), /if: github\.event_name == 'push' \|\| inputs\.attest/);
  assert.match(head(j["verify-attestations"]), /if: github\.event_name == 'push' \|\| inputs\.attest/);
  assert.match(text(RELEASE), /inputs:\n {6}attest:\n(?: {8}.*\n)*? {8}default: false/, "the permanent signing log is opt-in for a dry run");
});

test("release-cli: provenance and CycloneDX SBOM attestations for the binaries and the tarballs, verified strictly", () => {
  const attest = jobs(text(RELEASE)).attest;
  const uses = steps(attest).filter((s) => /uses: actions\/attest@/.test(s));
  assert.equal(uses.length, 5, "provenance and SBOM for binaries and for tarballs, and provenance for the checksum files and SBOMs");
  const metadata = uses.filter((s) => s.includes("release-files/SHA256SUMS-linux-x64.txt"));
  assert.equal(metadata.length, 1, "review F7: the checksum files and the SBOMs are attested subjects");
  for (const f of ["SHA256SUMS-darwin-arm64.txt", "SHA256SUMS-windows-x64.txt", "amo-cli-${{ needs.check.outputs.version }}.cdx.json", "hybridcloudworks-migration-packages-${{ needs.check.outputs.version }}.cdx.json"]) assert.ok(metadata[0].includes(`release-files/${f}`), f);
  assert.doesNotMatch(metadata[0], /sbom-path:/, "provenance only for those files");
  for (const s of uses) assert.ok(s.includes(`actions/attest@${ATTEST_SHA} # v4.2.2`));
  assert.equal(uses.filter((s) => /sbom-path:/.test(s)).length, 2);
  for (const bin of BINARIES) assert.equal(uses.filter((s) => s.includes(`release-files/${bin}`)).length, 2, `${bin}: provenance and SBOM`);
  assert.equal(uses.filter((s) => s.includes("release-files/hybridcloudworks-migration-*.tgz")).length, 2);
  assert.match(attest, /amo-cli-\$\{\{ needs\.check\.outputs\.version \}\}\.cdx\.json/);
  assert.match(attest, /hybridcloudworks-migration-packages-\$\{\{ needs\.check\.outputs\.version \}\}\.cdx\.json/);
  assert.doesNotMatch(code(RELEASE), /attest-build-provenance/, "one attestation action, the newest stable");
  // The job that can sign (id-token) and write attestations runs none of the repository's own scripts and does not even check
  // the repository out: it only downloads the files and calls the pinned attest action (review of pull request 79, F6).
  assert.doesNotMatch(attest, /^\s*run:/m, "the attest job must run no script");
  assert.doesNotMatch(attest, /actions\/checkout@|scripts\/|setup-node@/, "the attest job must not check out or run repository code");
  for (const name of ["verify-attestations", "release"]) {
    const job = jobs(text(RELEASE))[name];
    assert.match(job, /SOURCE_REF: "\$\{\{ github\.ref \}\}"/, `${name}: bound to the ref (refs/tags/<tag> on a release)`);
    assert.match(job, /SOURCE_DIGEST: "\$\{\{ github\.sha \}\}"/, `${name}: bound to the commit`);
    assert.match(job, /verify-attestations .*--workflow \.github\/workflows\/release-cli\.yml --source-ref "\$SOURCE_REF" --source-digest "\$SOURCE_DIGEST"/s);
  }
  const script = readFileSync("scripts/release-publish.mjs", "utf8");
  for (const flag of ["--signer-workflow", "--source-ref", "--source-digest", "--predicate-type"]) assert.ok(script.includes(`"${flag}"`), flag);
  assert.match(script, /PROVENANCE = "https:\/\/slsa\.dev\/provenance\/v1"/);
  assert.match(script, /SBOM = "https:\/\/cyclonedx\.org\/bom"/);
});

test("release-cli: the SBOMs are generated in the packages job, and the gate runs on the packed tarballs", () => {
  const packages = jobs(text(RELEASE)).packages;
  assert.match(packages, /generate-sbom\.mjs cli --version "\$VERSION"/);
  assert.match(packages, /generate-sbom\.mjs packages --version "\$VERSION" --tarballs dist-tarballs/);
  assert.match(packages, /npm run packages:verify -- --tarballs dist-tarballs --version "\$VERSION"/);
});

test("release-cli: a post-release job re-runs packages:verify against the RELEASED tarballs", () => {
  const post = jobs(text(RELEASE))["post-release"];
  assert.match(post, /release-publish\.mjs verify-release --repo "\$GH_REPO" --tag "\$TAG" --out released/);
  assert.match(post, /npm run packages:verify -- --tarballs released --version "\$VERSION"/);
  const order = [post.indexOf("verify-release"), post.indexOf("packages:verify")];
  assert.ok(order[0] > 0 && order[0] < order[1], "the downloaded files are checked before the gate uses them");
  assert.match(post, /- run: npm ci/, "the gate needs the TypeScript compiler from the lockfile");
});

test("release-cli: the files it builds are exactly the files the script expects (the names the downstream edition pins)", () => {
  const body = text(RELEASE);
  assert.match(body, /os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  const build = readFileSync("scripts/build-sea.sh", "utf8");
  assert.match(build, /NAME="amo-\$OS-\$ARCH"/);
  assert.match(build, /SHA256SUMS-\$OS-\$ARCH\.txt/);
  assert.deepEqual(BINARIES, ["amo-linux-x64", "amo-darwin-arm64", "amo-windows-x64.exe"], "ubuntu-latest, macos-latest (arm64) and windows-latest");
  const assemble = readFileSync("scripts/assemble-packages.mjs", "utf8");
  assert.match(assemble, /CORE_NAME = "@hybridcloudworks\/migration-core"/);
  assert.match(assemble, /UI_NAME = "@hybridcloudworks\/migration-ui"/);
  assert.equal(allNames("0.3.1").filter((n) => n.endsWith(".tgz")).join(), "hybridcloudworks-migration-core-0.3.1.tgz,hybridcloudworks-migration-ui-0.3.1.tgz", "the tarball names npm pack writes, which the downstream edition pins by URL");
  assert.match(body, /part-sea-\$\{\{ matrix\.os \}\}/);
  assert.match(body, /pattern: "part-\*", merge-multiple: true/);
});

test("release-cli: nothing is published or released by a dry run; the notes name no CI-skip marker", () => {
  const c = code(RELEASE);
  for (const [name, body] of Object.entries(jobs(text(RELEASE)))) {
    if (name === "release" || name === "post-release") continue;
    assert.doesNotMatch(body.replace(/^\s*#.*$/gm, ""), /gh release|npm publish|release-publish\.mjs publish/, `${name} may publish`);
  }
  assert.doesNotMatch(c, /npm publish/);
  assert.doesNotMatch(readFileSync("scripts/release-publish.mjs", "utf8"), /\[(skip|no) ?ci\]|ci skip|skip[ -]actions|actions[ -]skip/i);
});

test("publish-npm: verify (read only) then publish (tag only, the only job with id-token); npm is not installed from @latest", () => {
  const j = jobs(text(NPM));
  assert.deepEqual(Object.keys(j), ["verify", "release-ready", "publish"]);
  assert.deepEqual(needs(j["release-ready"]), ["verify"]);
  assert.deepEqual(needs(j.publish), ["verify", "release-ready"], "review F5: nothing is published before the release is verified");
  assert.deepEqual(grants(j.verify), []);
  assert.deepEqual(grants(j["release-ready"]), ["attestations: read", "contents: read"]);
  assert.ok(head(j["release-ready"]).includes(TAG_ONLY) && /vars\.NPM_TRUSTED_PUBLISHING == 'ready'/.test(head(j["release-ready"])));
  assert.deepEqual(grants(j.publish), ["contents: read", "id-token: write"]);
  assert.ok(head(j.publish).includes(TAG_ONLY), "a manual run never publishes");
  assert.match(head(j.publish), /vars\.NPM_TRUSTED_PUBLISHING == 'ready'/);
  assert.match(head(j.verify), /if: vars\.NPM_TRUSTED_PUBLISHING == 'ready'/);
  assert.equal([...code(NPM).matchAll(/npm publish/g)].length, 2, "two publishes, both in the publish job");
  assert.doesNotMatch(j.verify, /npm publish/);
  assert.doesNotMatch(code(NPM), /npm install|@latest/, "the npm that ships with Node 26 is used and its version is checked, not replaced");
  for (const body of [j.verify, j.publish]) assert.match(body, /check-release-version\.mjs .*--require-npm 11\.5\.1/);
  assert.match(j.verify, /--ancestor-of origin\/main/);
  assert.match(j.verify, /fetch-depth: 0/);
  assert.match(steps(j.verify)[0], /if: github\.event_name != 'push' && github\.ref != 'refs\/heads\/main'/);
  assert.match(text(NPM), /^concurrency:\n {2}group: publish-npm-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false$/m);
  // F5: what is published is the released, attested tarball, checked by digest, behind a GitHub Environment
  assert.match(head(j.publish), /environment: npm-publish/);
  assert.match(j["release-ready"], /release-publish\.mjs verify-release --repo "\$GH_REPO" --tag "\$TAG" --out released/);
  assert.match(j["release-ready"], /--workflow \.github\/workflows\/release-cli\.yml --source-ref "\$SOURCE_REF" --source-digest "\$SOURCE_DIGEST"/);
  assert.match(j["release-ready"], /gh release view "\$TAG"/, "it waits for the public release");
  assert.match(j.publish, /name: released-tarballs/, "what was verified against the release is what is published");
  assert.match(j.publish, /npm publish "tarballs\/hybridcloudworks-migration-core-\$\{VERSION\}\.tgz" --access public --provenance/);
  assert.match(j.publish, /npm publish "tarballs\/hybridcloudworks-migration-ui-\$\{VERSION\}\.tgz" --access public --provenance/);
  assert.match(j.publish, /= "\$CORE_SHA256"/, "the digest is compared again before publishing");
  assert.match(j.publish, /= "\$UI_SHA256"/);
  assert.doesNotMatch(j.publish, /dist-packages|working-directory/, "nothing built in this workflow is published");
  assert.doesNotMatch(j["release-ready"], /npm publish|id-token/);
  assert.ok(j.publish.indexOf("migration-core") < j.publish.indexOf("migration-ui"), "core first");
});

test("the release workflows use no dependency cache (a poisoned cache would reach the artifacts that are signed)", () => {
  for (const name of [RELEASE, NPM]) {
    const setups = steps(text(name)).filter((s) => /uses: actions\/setup-node@/.test(s));
    assert.ok(setups.length >= 2, `${name}: expected the setup-node steps`);
    for (const s of setups) {
      assert.match(s, /package-manager-cache: false/, `${name}: setup-node must switch automatic caching off`);
      assert.doesNotMatch(s, /(?<![-\w])cache: /, `${name}: setup-node must not enable a cache`);
    }
    assert.doesNotMatch(code(name), /actions\/cache@/, name);
  }
});

test("publish-images: the same tag, version and main check runs before an image can be built (review F8)", () => {
  const name = "publish-images.yml";
  const j = jobs(text(name));
  assert.deepEqual(Object.keys(j), ["check", "rehearse", "build-scan-publish"]);
  assert.deepEqual(needs(j["build-scan-publish"]), ["check"]);
  assert.deepEqual(needs(j.rehearse), ["check"]);
  assert.match(head(j.check), /if: vars\.DOCKERHUB_ENABLED == 'true'/, "inert while DOCKERHUB_ENABLED is unset, like the build");
  assert.match(j.check, /fetch-depth: 0/);
  assert.match(j.check, /check-release-version\.mjs "\$\{mode\[@\]\}" --ancestor-of origin\/main/);
  assert.match(j.check, /mode=\(--tag "\$REF_NAME"\); else mode=\(--rehearse\)/);
  assert.match(steps(j.check)[0], /if: github\.event_name != 'push' && github\.ref != 'refs\/heads\/main'/, "a manual run off main stops at once");
  assert.deepEqual(grants(j.check), []);
});

test("release-cli: attestation checks also pin the signer commit and refuse self-hosted runners (review F10)", () => {
  const script = readFileSync("scripts/release-publish.mjs", "utf8");
  assert.match(script, /"--signer-digest", sourceDigest/);
  assert.match(script, /"--deny-self-hosted-runners"/);
});

test("publish-images: no expression is expanded inside a run script, and the build job does not keep the checkout credentials (review F11)", () => {
  const body = code("publish-images.yml");
  assert.doesNotMatch(body, /^\s*run:[^\n]*\$\{\{/m, "a ${{ }} expression inside a run line: pass it through env instead");
  const j = jobs(text("publish-images.yml"))["build-scan-publish"];
  const checkout = steps(j).find((s) => /uses: actions\/checkout@/.test(s));
  assert.match(checkout, /persist-credentials: false/);
  assert.match(j, /env: \{ DIGEST: "\$\{\{ steps\.build\.outputs\.digest \}\}" \}\n\s+run: echo "\$\{IMAGE\}@\$\{DIGEST\}"/);
});

test("publish-images: one build, pushed by digest, that digest scanned, and only then tagged and attested (follow-up of issue 83)", () => {
  const j = jobs(text("publish-images.yml"))["build-scan-publish"];
  const c = code("publish-images.yml");
  assert.equal([...j.matchAll(/docker\/build-push-action@/g)].length, 1, "the image is built once on the tag path");
  assert.equal([...c.matchAll(/docker\/build-push-action@/g)].length, 2, "and once more, local only, in the rehearsal");
  assert.doesNotMatch(j, /load: true|:rehearsal\b/, "the tag path has no separate local build that is scanned instead of the pushed one");
  const build = j.indexOf("push-by-digest=true,name-canonical=true,push=true");
  const scan = j.indexOf("aquasecurity/trivy-action@");
  const tag = j.indexOf("docker buildx imagetools create");
  const attest = j.indexOf("actions/attest-build-provenance@");
  assert.ok(build > 0 && build < scan && scan < tag && tag < attest, "build by digest, scan, tag, attest, in that order");
  assert.match(j, /image-ref: "\$\{\{ env\.IMAGE \}\}@\$\{\{ steps\.build\.outputs\.digest \}\}"/, "the scan reads the pushed digest");
  assert.doesNotMatch(j, /^\s+tags: \$\{\{ steps\.meta\.outputs\.tags \}\}/m, "the build itself pushes no tag");
  assert.match(j, /docker buildx imagetools create "\$\{args\[@\]\}" "\$\{IMAGE\}@\$\{DIGEST\}"/);
});

/** The push gate: the one condition under which an image may reach Docker Hub. */
const PUSH_GATE = `vars.DOCKERHUB_ENABLED == 'true' && ${TAG_ONLY}`;

test("publish-images: the Docker Hub login, the push and the attestation run only behind the push gate (run 40254017571)", () => {
  const j = jobs(text("publish-images.yml"));
  const publish = j["build-scan-publish"];
  assert.ok(head(publish).includes(`if: ${PUSH_GATE}`), "the publish job is gated by DOCKERHUB_ENABLED and a refs/tags/v* push");
  // every step that logs in, pushes, tags or attests lives in the gated job and in no other
  const risky = /docker\/login-action@|push-by-digest|push: true|push-to-registry|imagetools create|attest-build-provenance@|DOCKERHUB_OIDC_CONNECTIONID|docker login/;
  for (const [name, body] of Object.entries(j)) {
    if (name === "build-scan-publish") continue;
    assert.doesNotMatch(body, risky, `job ${name} must not log in to, push to or attest for a registry`);
  }
  assert.equal(steps(publish).filter((s) => /docker\/login-action@/.test(s)).length, 2, "the two logins (push, then tag) are both in the gated job");
  // a manual run is never a tag push, so the gate cannot select the dispatch path
  assert.doesNotMatch(PUSH_GATE, /workflow_dispatch/);
  assert.match(head(publish), /github\.event_name == 'push'/);
});

test("publish-images: id-token and attestations are granted only to the gated publish job, never to the manual run (least privilege)", () => {
  const j = jobs(text("publish-images.yml"));
  assert.deepEqual(grants(j["build-scan-publish"]), ["attestations: write", "contents: read", "id-token: write"]);
  assert.deepEqual(grants(j.rehearse), ["contents: read"]);
  assert.deepEqual(grants(j.check), []);
  assert.doesNotMatch(code("publish-images.yml").split("\njobs:\n")[0], /id-token|attestations/, "the workflow level grants neither");
  assert.equal([...code("publish-images.yml").matchAll(/id-token: write/g)].length, 1, "id-token: write appears once");
});

test("publish-images: a manual run builds and scans locally, with no login, no push and no tag (run 40254017571)", () => {
  const j = jobs(text("publish-images.yml"));
  assert.ok(head(j.rehearse).includes("github.event_name == 'workflow_dispatch'"));
  assert.doesNotMatch(head(j.rehearse), /startsWith\(github\.ref, 'refs\/tags\//, "the rehearsal is not the tag path");
  const build = steps(j.rehearse).find((s) => /docker\/build-push-action@/.test(s));
  assert.match(build, /load: true/);
  assert.match(build, /push: false/);
  assert.doesNotMatch(build, /outputs:|push: true|provenance: true|sbom: true/);
  assert.match(j.rehearse, /aquasecurity\/trivy-action@[0-9a-f]{40} # v[\d.]+\n\s+with: \{ image-ref: "\$\{\{ env\.IMAGE \}\}:rehearsal", exit-code: "1", severity: "HIGH,CRITICAL", ignore-unfixed: true \}/, "the same scan settings as the tag path");
  assert.doesNotMatch(j.rehearse, /secrets\.|vars\.DOCKERHUB_CONNECTION|docker\/login-action|id-token/);
});

test("publish-images: the push-gate checks fail on a mutation (the tests would notice)", () => {
  const body = text("publish-images.yml");
  const publishGate = (b) => head(jobs(b)["build-scan-publish"]).includes(`if: ${PUSH_GATE}`);
  assert.ok(publishGate(body));
  // dropping the tag condition, or the enable variable, from the publish job is caught
  assert.ok(!publishGate(body.replace(" && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')", "")));
  assert.ok(!publishGate(body.replace("vars.DOCKERHUB_ENABLED == 'true' && github.event_name == 'push'", "github.event_name == 'push'")));
  // a login step moved into the rehearsal is caught by the same pattern the test above uses
  const login = /docker\/login-action@/;
  const moved = body.replace("      - name: Say what this run did", "      - uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0\n      - name: Say what this run did");
  assert.match(jobs(moved).rehearse, login);
  assert.doesNotMatch(jobs(body).rehearse, login);
  // id-token granted to the rehearsal is caught
  const widened = body.replace("      contents: read # the checkout, and nothing else\n", "      contents: read # the checkout, and nothing else\n      id-token: write\n");
  assert.notEqual(widened, body);
  assert.notDeepEqual(grants(jobs(widened).rehearse), ["contents: read"]);
});

test("the workflows do not call a tag permanent without the ruleset caveat (review F3)", () => {
  for (const name of [RELEASE, NPM, "publish-images.yml"]) {
    assert.doesNotMatch(text(name), /can never be moved|cannot be moved or deleted/, `${name}: the ruleset has an admin bypass, so say "blocked"`);
  }
  assert.match(text(RELEASE), /blocked from being moved or deleted \(the "Protect release tags" ruleset; repository admins can bypass it or switch it off\)/);
});
