#!/usr/bin/env node
/**
 * The steps of release-cli.yml that talk to GitHub about a release, kept in a script so that tests can run them
 * (ADR-0034). A pushed v* tag is blocked from being moved or deleted (repository admins can bypass the ruleset), so the steps that decide whether the files are really
 * the attested ones, and whether a release becomes public, must not be untested shell inside a workflow. Node standard
 * library only; it calls the GitHub CLI (`gh`), authenticated by GH_TOKEN in the workflow.
 *
 *   check-files           the directory holds exactly the files a release carries, none empty (`--stage built` for the
 *                         ten files the build makes, before the provenance file exists; the default is all eleven)
 *   verify-attestations   `gh attestation verify` the provenance and the CycloneDX SBOM of every binary and tarball, and the
 *                         provenance of the checksum files and the two SBOMs (so all ten files are bound, not only five),
 *                         and insist that each came from THIS workflow file, on THIS ref, at THIS commit. Without those three,
 *                         "some attestation for this file exists in this repository" would be enough, and a dry-run
 *                         attestation of the same bytes would satisfy a real release.
 *   assemble-provenance   write amo-<version>.intoto.jsonl from the three build-provenance bundles the attest job saved (one
 *                         signed bundle per line), and refuse it unless it names every one of the ten files by sha256 and
 *                         nothing else (ADR-0035). It is a copy of what GitHub's attestation store already holds, attached
 *                         to the release so that the proof travels with the download.
 *   verify-provenance     `gh attestation verify --bundle` each of the ten files against that file alone, with the same
 *                         strict flags, after checking the file's content.
 *   publish               create the GitHub Release as a DRAFT with every file, check that the draft holds exactly those
 *                         files (names, upload state and the sha256 GitHub reports), and only then make it public. A
 *                         release that already exists for the tag (draft or public) is never touched and no file is ever
 *                         replaced. Until the last step succeeds nobody but the repository's writers can see a release, so
 *                         a failure never leaves a public, half-filled release next to the permanent tag.
 *   verify-release        after publication: download the public release, check it holds exactly those files with the
 *                         digests GitHub reports, and verify the attestations of what was downloaded, from GitHub's store
 *                         and from the downloaded provenance file. The workflow then
 *                         runs `npm run packages:verify` against the downloaded tarballs.
 *
 * Exit 0 on success, 1 with one line per problem (GitHub `::error::` annotations under Actions).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection } from "./check-release-version.mjs";

export const PROVENANCE = "https://slsa.dev/provenance/v1";
export const SBOM = "https://cyclonedx.org/bom";
export const BINARIES = ["amo-linux-x64", "amo-darwin-arm64", "amo-windows-x64.exe"];
export const CHECKSUM_FILES = ["SHA256SUMS-linux-x64.txt", "SHA256SUMS-darwin-arm64.txt", "SHA256SUMS-windows-x64.txt"];
/** What a line of the provenance file must be: a Sigstore bundle around an in-toto statement (ADR-0035). */
export const BUNDLE_MEDIA_TYPE = /^application\/vnd\.dev\.sigstore\.bundle/;
export const IN_TOTO_PAYLOAD = "application/vnd.in-toto+json";
export const IN_TOTO_STATEMENT = "https://in-toto.io/Statement/v1";
/**
 * The build provenance of a release as one file: one signed bundle per line (JSON lines). The ending `.intoto.jsonl` is the
 * name tools that grade a release look for, and the file `gh attestation verify --bundle` reads (ADR-0035).
 */
export const provenanceName = (version) => `amo-${version}.intoto.jsonl`;
const LOOKUP_TRIES = 10;
const LOOKUP_PAUSE_MS = 3000;
// a new attestation can take a moment to be readable; a wrong one still fails after the last try
const VERIFY_TRIES = 3;
const VERIFY_PAUSE_MS = 5000;

/** The files a release carries for `version`, by role. Their names are the contract the downstream edition pins. */
export function expectedAssets(version) {
  return {
    binaries: BINARIES,
    checksums: CHECKSUM_FILES,
    tarballs: [`hybridcloudworks-migration-core-${version}.tgz`, `hybridcloudworks-migration-ui-${version}.tgz`],
    sboms: { cli: `amo-cli-${version}.cdx.json`, packages: `hybridcloudworks-migration-packages-${version}.cdx.json` },
    provenance: provenanceName(version),
  };
}
/** The ten files the build makes. Each one is attested, and the provenance file must name each one. */
export const builtNames = (version) => {
  const a = expectedAssets(version);
  return [...a.binaries, ...a.checksums, ...a.tarballs, a.sboms.cli, a.sboms.packages];
};
/** Every file a release carries: the ten built files and the provenance file, which exists only after they are attested. */
export const allNames = (version) => [...builtNames(version), expectedAssets(version).provenance];
/** Binaries and tarballs: build provenance AND a CycloneDX SBOM attestation each. */
export const attestedNames = (version) => [...BINARIES, ...expectedAssets(version).tarballs];
/** Checksum files and the two SBOMs: build provenance only (they are the files a consumer reads, not software; follow-up F7 of issue 83). */
export const provenanceOnlyNames = (version) => {
  const a = expectedAssets(version);
  return [...a.checksums, a.sboms.cli, a.sboms.packages];
};
/** Every [file, predicates] pair `verify-attestations` checks: all ten release files are bound to this workflow, ref and commit. */
export const attestationChecks = (version) => [
  ...attestedNames(version).map((name) => [name, [PROVENANCE, SBOM]]),
  ...provenanceOnlyNames(version).map((name) => [name, [PROVENANCE]]),
];

export const versionOfTag = (tag) => {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) throw new Error(`tag ${JSON.stringify(tag)} is not v followed by X.Y.Z`);
  return m[1];
};

/** The real `gh`; tests pass a fake with the same shape: (args) => { status, stdout, stderr }. */
export function realGh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function sha256Of(path) {
  return new Promise((resolveHash, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolveHash(h.digest("hex")));
  });
}

/** `expected` is every release file by default; the inventory job passes builtNames, because the provenance file comes later. */
export function checkFiles(dir, version, expected = allNames(version)) {
  const problems = [];
  const present = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()) : [];
  for (const n of expected.filter((x) => !present.includes(x))) problems.push(`${dir}/${n} is missing`);
  for (const n of present.filter((x) => !expected.includes(x))) problems.push(`${dir}/${n} is not one of the ${expected.length} files expected here`);
  for (const n of present.filter((x) => expected.includes(x) && statSync(join(dir, x)).size === 0)) problems.push(`${dir}/${n} is empty`);
  return problems;
}

export function verifyCommand(path, repo, predicate, workflow, sourceRef, sourceDigest) {
  return ["attestation", "verify", path, "--repo", repo, "--predicate-type", predicate, "--signer-workflow", `${repo}/${workflow}`, "--signer-digest", sourceDigest, "--source-ref", sourceRef, "--source-digest", sourceDigest, "--deny-self-hosted-runners"];
}

export function verifyAttestations({ dir, version, repo, workflow, sourceRef, sourceDigest }, gh = realGh, pause = sleepMs) {
  const problems = [];
  for (const [name, predicates] of attestationChecks(version)) {
    const path = join(dir, name);
    if (!existsSync(path)) { problems.push(`${path} is missing, so its attestations cannot be verified`); continue; }
    for (const predicate of predicates) {
      const command = verifyCommand(path, repo, predicate, workflow, sourceRef, sourceDigest);
      let result = gh(command);
      for (let i = 1; i < VERIFY_TRIES && result.status !== 0; i++) { pause(VERIFY_PAUSE_MS); result = gh(command); }
      if (result.status !== 0) {
        const last = (result.stderr || result.stdout).trim().split("\n").pop() || "gh failed";
        problems.push(`no ${predicate} attestation of ${name} from ${workflow} on ${sourceRef} at ${sourceDigest.slice(0, 12)}: ${last}`);
      } else {
        console.log(`verified ${predicate} for ${name} (${workflow}, ${sourceRef}, ${sourceDigest.slice(0, 12)})`);
      }
    }
  }
  return problems;
}

/** The same strict check, read from the provenance file instead of GitHub's attestation store. */
export function bundleVerifyCommand(path, bundle, repo, workflow, sourceRef, sourceDigest) {
  const [, , , ...flags] = verifyCommand(path, repo, PROVENANCE, workflow, sourceRef, sourceDigest);
  return ["attestation", "verify", path, "--bundle", bundle, ...flags];
}

/**
 * Read the text of a provenance file. Returns { problems, bundles, subjects }: `subjects` is every { name, sha256 } the
 * signed statements name. Nothing here checks a signature (that is `gh attestation verify --bundle`); this checks that
 * the file is what its name says, so an empty or unrelated file can never be attached under that name.
 */
export function readProvenance(text, label = "the provenance file") {
  const problems = [];
  const subjects = [];
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) problems.push(`${label} holds no bundle`);
  lines.forEach((line, i) => {
    const where = `${label}, line ${i + 1}`;
    let bundle = null;
    try { bundle = JSON.parse(line); } catch { bundle = null; }
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) { problems.push(`${where} is not a JSON object`); return; }
    if (!BUNDLE_MEDIA_TYPE.test(String(bundle.mediaType ?? ""))) { problems.push(`${where} is not a Sigstore bundle (mediaType ${JSON.stringify(bundle.mediaType ?? null)})`); return; }
    const envelope = bundle.dsseEnvelope;
    if (!envelope || envelope.payloadType !== IN_TOTO_PAYLOAD || typeof envelope.payload !== "string") { problems.push(`${where} has no signed in-toto statement`); return; }
    if (!Array.isArray(envelope.signatures) || !envelope.signatures.length || !bundle.verificationMaterial) { problems.push(`${where} has no signature or no certificate`); return; }
    let statement = null;
    try { statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")); } catch { statement = null; }
    if (!statement || statement._type !== IN_TOTO_STATEMENT) { problems.push(`${where} does not hold an in-toto statement`); return; }
    if (statement.predicateType !== PROVENANCE) { problems.push(`${where} is a ${JSON.stringify(statement.predicateType ?? null)} statement, not build provenance (${PROVENANCE})`); return; }
    if (!Array.isArray(statement.subject) || !statement.subject.length) { problems.push(`${where} names no file`); return; }
    for (const s of statement.subject) {
      const sha256 = s?.digest?.sha256;
      if (typeof s?.name !== "string" || !/^[0-9a-f]{64}$/.test(String(sha256 ?? ""))) problems.push(`${where} names a file without a name or a sha256`);
      else subjects.push({ name: basename(s.name), sha256 });
    }
  });
  return { problems, bundles: lines.length, subjects };
}

/** What is wrong with the provenance file in `dir`: it must name each of the ten built files there by sha256, and no other file. */
export async function provenanceProblems(dir, version) {
  const name = provenanceName(version);
  const path = join(dir, name);
  if (!existsSync(path)) return [`${path} is missing`];
  const { problems, subjects } = readProvenance(readFileSync(path, "utf8"), name);
  if (problems.length) return problems;
  const built = builtNames(version);
  for (const n of built) {
    const local = join(dir, n);
    if (!existsSync(local)) { problems.push(`${local} is missing, so ${name} cannot be compared with it`); continue; }
    const want = await sha256Of(local);
    const mine = subjects.filter((s) => s.name === n);
    if (!mine.length) problems.push(`${name} does not name ${n}`);
    else if (!mine.some((s) => s.sha256 === want)) problems.push(`${name} names ${n} with sha256 ${mine[0].sha256}, but the file here has ${want}`);
  }
  for (const n of [...new Set(subjects.map((s) => s.name))].filter((x) => !built.includes(x))) problems.push(`${name} names ${n}, which is not one of the ${built.length} built files of this release`);
  return problems;
}

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

/**
 * Write the provenance file into `dir` from the bundle files under `bundles` (what the attest job saved: one file per
 * build-provenance step), one bundle per line, then check it against the files in `dir`. Never replaces an existing file.
 */
export async function assembleProvenance({ bundles, dir, version }) {
  const name = provenanceName(version);
  const target = join(dir, name);
  if (existsSync(target)) return [`${target} already exists; it is never replaced`];
  if (!existsSync(bundles) || !statSync(bundles).isDirectory()) return [`${bundles} is not a directory of saved bundles`];
  const lines = [];
  const problems = [];
  for (const file of filesUnder(bundles)) {
    const read = readProvenance(readFileSync(file, "utf8"), file);
    problems.push(...read.problems);
    if (!read.problems.length) for (const line of readFileSync(file, "utf8").split("\n").filter((l) => l.trim())) lines.push(JSON.stringify(JSON.parse(line)));
  }
  if (!lines.length && !problems.length) problems.push(`${bundles} holds no bundle`);
  if (problems.length) return [...problems, `${name} was not written`];
  writeFileSync(target, `${lines.join("\n")}\n`);
  const after = await provenanceProblems(dir, version);
  if (!after.length) console.log(`${target} written: ${lines.length} signed bundles naming the ${builtNames(version).length} built files`);
  return after;
}

/** `gh attestation verify --bundle` for each of the ten built files: the attached file alone proves each one, with the strict flags. */
export async function verifyProvenanceFile({ dir, version, repo, workflow, sourceRef, sourceDigest }, gh = realGh, pause = sleepMs) {
  const problems = await provenanceProblems(dir, version);
  if (problems.length) return problems;
  const name = provenanceName(version);
  for (const n of builtNames(version)) {
    const command = bundleVerifyCommand(join(dir, n), join(dir, name), repo, workflow, sourceRef, sourceDigest);
    let result = gh(command);
    for (let i = 1; i < VERIFY_TRIES && result.status !== 0; i++) { pause(VERIFY_PAUSE_MS); result = gh(command); }
    if (result.status !== 0) {
      const last = (result.stderr || result.stdout).trim().split("\n").pop() || "gh failed";
      problems.push(`${name} does not prove ${n} came from ${workflow} on ${sourceRef} at ${sourceDigest.slice(0, 12)}: ${last}`);
    } else {
      console.log(`verified ${n} against ${name} (${workflow}, ${sourceRef}, ${sourceDigest.slice(0, 12)})`);
    }
  }
  return problems;
}

/** Every JSON value in `text`: `gh api --paginate` prints one array per page, back to back. */
export function decodeJsonValues(text) {
  const values = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    // find the end of the next top-level value by bracket matching (strings respected)
    let depth = 0, inString = false, escaped = false, j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") { depth--; if (depth === 0) { j++; break; } }
    }
    if (depth !== 0) throw new Error("unterminated JSON value");
    values.push(JSON.parse(text.slice(i, j)));
    i = j;
  }
  return values;
}

/** { releases, reason }: the releases (drafts included) whose tag is `tag`, or why they could not be listed. */
export function releasesForTag(repo, tag, gh = realGh) {
  const r = gh(["api", "--paginate", `repos/${repo}/releases?per_page=100`]);
  if (r.status !== 0) return { releases: [], reason: `could not list the releases of ${repo}: ${(r.stderr || r.stdout).trim()}` };
  try {
    const pages = decodeJsonValues(r.stdout);
    return { releases: pages.filter(Array.isArray).flat().filter((x) => x && typeof x === "object" && x.tag_name === tag), reason: null };
  } catch (error) {
    return { releases: [], reason: `could not read the list of releases of ${repo}: ${error.message}` };
  }
}

/** What is wrong with a release that should hold exactly the expected files and be (or not be) a draft. */
export async function releaseProblems(release, dir, version, { draft }) {
  const problems = [];
  if (Boolean(release.draft) !== draft) problems.push(`the release is ${draft ? "public" : "still a draft"}, expected it to be ${draft ? "a draft" : "public"}`);
  const expected = allNames(version);
  const assets = new Map((release.assets ?? []).filter((a) => a && typeof a === "object").map((a) => [a.name, a]));
  for (const n of expected.filter((x) => !assets.has(x))) problems.push(`asset ${n} is not on the release`);
  for (const n of [...assets.keys()].filter((x) => !expected.includes(x))) problems.push(`asset ${n} is on the release but is not one of the ${expected.length} expected files`);
  for (const [name, asset] of assets) {
    if (!expected.includes(name)) continue;
    if (asset.state !== "uploaded") problems.push(`asset ${name} is in state ${JSON.stringify(asset.state)}, not "uploaded"`);
    const local = join(dir, name);
    if (!/^sha256:[0-9a-f]{64}$/.test(String(asset.digest ?? ""))) {
      // never skip the content check: an asset GitHub reports without a sha256 cannot be compared with the attested file
      problems.push(`asset ${name} has no sha256 digest in GitHub's answer (got ${JSON.stringify(asset.digest ?? null)}), so its content cannot be checked`);
    } else if (existsSync(local)) {
      const want = `sha256:${await sha256Of(local)}`;
      if (asset.digest !== want) problems.push(`asset ${name} on the release has digest ${asset.digest}, not the sha256 of the attested file (${want})`);
    }
  }
  return problems;
}

/**
 * The text of the release page. `section` is the version's CHANGELOG.md section ({ heading, summary } from
 * changelogSection in check-release-version.mjs): its summary opens the page, so every release says what it changes.
 */
export function releaseNotes(tag, repo, workflow, section) {
  const version = versionOfTag(tag);
  if (!section?.summary) throw new Error(`no CHANGELOG.md summary for ${version}: the release notes are built from it`);
  return [
    `## What changed in ${tag}`,
    "",
    section.summary,
    "",
    `The full list is the section "${section.heading.replace(/^## /, "")}" of CHANGELOG.md: https://github.com/${repo}/blob/${tag}/CHANGELOG.md`,
    "",
    "## Verify a download",
    "",
    `Release ${tag}. Every binary and package tarball below has a signed build-provenance attestation and a signed CycloneDX SBOM attestation, made by \`${workflow}\` on \`refs/tags/${tag}\`. The checksum files and the two SBOMs have a signed build-provenance attestation too.`,
    "",
    "Verify a download (GitHub CLI):",
    "",
    "```bash",
    `gh attestation verify hybridcloudworks-migration-core-${version}.tgz --repo ${repo} --predicate-type ${PROVENANCE} --source-ref refs/tags/${tag} --signer-workflow ${repo}/${workflow} --deny-self-hosted-runners`,
    `gh attestation verify hybridcloudworks-migration-core-${version}.tgz --repo ${repo} --predicate-type ${SBOM} --source-ref refs/tags/${tag} --signer-workflow ${repo}/${workflow} --deny-self-hosted-runners`,
    "```",
    "",
    `The same build provenance is attached to this release as \`${provenanceName(version)}\` (one signed bundle per line), so a download can be checked from the files of the release alone:`,
    "",
    "```bash",
    `gh attestation verify hybridcloudworks-migration-core-${version}.tgz --repo ${repo} --bundle ${provenanceName(version)} --source-ref refs/tags/${tag} --signer-workflow ${repo}/${workflow} --deny-self-hosted-runners`,
    "```",
    "",
    `The SBOMs are \`amo-cli-${version}.cdx.json\` (the command-line tool) and \`hybridcloudworks-migration-packages-${version}.cdx.json\` (the two package tarballs). How this release is built and checked: https://github.com/${repo}/blob/${tag}/docs/release/README.md.`,
    "",
  ].join("\n");
}

const lookupDraft = (repo, tag, gh, pause) => {
  for (let attempt = 0; attempt < LOOKUP_TRIES; attempt++) {
    const { releases, reason } = releasesForTag(repo, tag, gh);
    if (!reason && releases.length === 1) return { draft: releases[0] };
    if (!reason && releases.length > 1) return { error: `${releases.length} releases now exist for ${tag}; leaving them as they are, nothing was made public` };
    if (attempt + 1 < LOOKUP_TRIES) pause(LOOKUP_PAUSE_MS);
  }
  return { error: `the draft release for ${tag} could not be found after it was created; nothing was made public` };
};

/**
 * Re-read the draft BY ID (the list answer is not trusted for its assets: it can lag behind the upload) until every
 * expected asset is uploaded with a sha256 that equals the attested file, with a bounded retry.
 * Returns { release, problems }; `problems` is empty only when the by-id answer is complete and correct.
 */
export async function settleDraft(repo, id, dir, version, gh, pause) {
  let problems = [];
  let release = null;
  for (let attempt = 0; attempt < LOOKUP_TRIES; attempt++) {
    const read = gh(["api", `repos/${repo}/releases/${id}`]);
    let value = null;
    try { value = read.status === 0 ? JSON.parse(read.stdout) : null; } catch { value = null; }
    if (value && typeof value === "object") {
      release = value;
      problems = await releaseProblems(value, dir, version, { draft: true });
      if (!problems.length) return { release, problems };
    } else {
      problems = [`could not read draft release ${id}: ${(read.stderr || read.stdout || "no answer").trim()}`];
    }
    if (attempt + 1 < LOOKUP_TRIES) pause(LOOKUP_PAUSE_MS);
  }
  return { release, problems };
}

export async function publish({ repo, tag, dir, workflow, changelog = "CHANGELOG.md" }, gh = realGh, pause = sleepMs) {
  const version = versionOfTag(tag);
  const files = checkFiles(dir, version);
  if (files.length) return [...files, "nothing was published"];
  const provenance = await provenanceProblems(dir, version);
  if (provenance.length) return [...provenance, "nothing was published"];
  let section = null;
  try { section = changelogSection(readFileSync(changelog, "utf8"), version); } catch (error) { return [`cannot read ${changelog}: ${error.message}`, "nothing was published"]; }
  if (!section?.summary) return [`${changelog} has no section with a summary for ${version}; the release notes are built from it`, "nothing was published"];

  const { releases, reason } = releasesForTag(repo, tag, gh);
  if (reason) return [reason];
  if (releases.length) {
    return [`${tag} already has ${releases.every((r) => r.draft) ? "a draft" : "a public release"}. Nothing was changed: a file is never replaced. Delete that release on the Releases page (the tag stays), then re-run the failed jobs, or ship the next version`];
  }

  const notesFile = join(dir, "..", `release-notes-${tag}.md`);
  writeFileSync(notesFile, releaseNotes(tag, repo, workflow, section));
  const created = gh(["release", "create", tag, "--repo", repo, "--draft", "--verify-tag", "--title", tag, "--notes-file", notesFile, ...allNames(version).map((n) => join(dir, n))]);
  if (created.status !== 0) return [`could not create the draft release ${tag}: ${(created.stderr || created.stdout).trim()}`];
  console.log(`draft release for ${tag} created with ${allNames(version).length} files; checking it before it becomes public`);

  const found = lookupDraft(repo, tag, gh, pause);
  if (found.error) return [found.error];
  const draft = found.draft;
  if (!Number.isInteger(draft.id)) return [`the draft release for ${tag} has no id; nothing was made public`];
  const stuck = "the draft stays unpublished: delete it on the Releases page before re-running";
  const settled = await settleDraft(repo, draft.id, dir, version, gh, pause);
  if (settled.problems.length) return [...settled.problems, stuck];

  const made = gh(["api", "--method", "PATCH", `repos/${repo}/releases/${draft.id}`, "-F", "draft=false"]);
  if (made.status !== 0) return [`could not make release ${tag} public: ${(made.stderr || made.stdout).trim()}`, stuck];
  const read = gh(["api", `repos/${repo}/releases/${draft.id}`]);
  let final = null;
  try { final = read.status === 0 ? JSON.parse(read.stdout) : null; } catch { final = null; }
  if (!final || typeof final !== "object") return [`could not read release ${tag} back; the publish request was sent, so check the release page`];
  const after = await releaseProblems(final, dir, version, { draft: false });
  if (final.tag_name !== tag) after.push(`the public release is for ${JSON.stringify(final.tag_name)}, expected ${JSON.stringify(tag)}`);
  if (after.length) return [...after, "the release was made public but does not match: check the release page now"];
  console.log(`release ${tag} is public with ${allNames(version).length} files: ${final.html_url}`);
  return [];
}

export async function verifyRelease({ repo, tag, out, workflow, sourceRef, sourceDigest }, gh = realGh, pause = sleepMs) {
  const version = versionOfTag(tag);
  const { releases, reason } = releasesForTag(repo, tag, gh);
  if (reason) return [reason];
  if (releases.length !== 1) return [`expected exactly one release for ${tag}, found ${releases.length}`];
  mkdirSync(out, { recursive: true });
  const got = gh(["release", "download", tag, "--repo", repo, "--dir", out, "--pattern", "*"]);
  if (got.status !== 0) return [`could not download the files of release ${tag}: ${(got.stderr || got.stdout).trim()}`];
  const problems = [...checkFiles(out, version), ...(await releaseProblems(releases[0], out, version, { draft: false }))];
  if (problems.length) return problems;
  const args = { dir: out, version, repo, workflow, sourceRef, sourceDigest };
  const store = verifyAttestations(args, gh, pause);
  return store.length ? store : verifyProvenanceFile(args, gh, pause);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    if (!k.startsWith("--") || i + 1 >= rest.length) throw new Error(`bad argument ${k}`);
    args[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[i + 1];
  }
  return args;
}
const need = (args, ...names) => { for (const n of names) if (!args[n]) throw new Error(`${args.command} needs --${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`); };

export async function main(argv) {
  const args = parseArgs(argv);
  let problems;
  if (args.command === "check-files") {
    need(args, "dir", "version");
    if (args.stage !== undefined && args.stage !== "built" && args.stage !== "release") throw new Error("check-files --stage is built (the ten files the build makes) or release (those and the provenance file)");
    problems = checkFiles(args.dir, args.version, args.stage === "built" ? builtNames(args.version) : allNames(args.version));
  }
  else if (args.command === "verify-attestations") { need(args, "dir", "version", "repo", "workflow", "sourceRef", "sourceDigest"); problems = verifyAttestations(args); }
  else if (args.command === "verify-provenance") { need(args, "dir", "version", "repo", "workflow", "sourceRef", "sourceDigest"); problems = await verifyProvenanceFile(args); }
  else if (args.command === "assemble-provenance") { need(args, "bundles", "dir", "version"); problems = await assembleProvenance(args); }
  else if (args.command === "publish") { need(args, "dir", "tag", "repo", "workflow"); problems = await publish(args); }
  else if (args.command === "verify-release") { need(args, "out", "tag", "repo", "workflow", "sourceRef", "sourceDigest"); problems = await verifyRelease(args); }
  else throw new Error("usage: release-publish.mjs check-files|verify-attestations|assemble-provenance|verify-provenance|publish|verify-release --option value ...");
  const github = process.env.GITHUB_ACTIONS === "true";
  for (const p of problems) console.log(github ? `::error::${p}` : `error: ${p}`);
  if (!problems.length && args.command === "check-files") console.log(`all ${(args.stage === "built" ? builtNames : allNames)(args.version).length} files are present`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.log(`error: ${error.message}`); process.exitCode = 1; });
}
