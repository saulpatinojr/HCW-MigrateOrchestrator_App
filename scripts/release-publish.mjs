#!/usr/bin/env node
/**
 * The steps of release-cli.yml that talk to GitHub about a release, kept in a script so that tests can run them
 * (ADR-0032). A v* tag cannot be moved or deleted once it is pushed, so the steps that decide whether the files are really
 * the attested ones, and whether a release becomes public, must not be untested shell inside a workflow. Node standard
 * library only; it calls the GitHub CLI (`gh`), authenticated by GH_TOKEN in the workflow.
 *
 *   check-files           the directory holds exactly the files a release carries, none empty
 *   verify-attestations   `gh attestation verify` the provenance and the CycloneDX SBOM of every binary and tarball, and
 *                         insist that each came from THIS workflow file, on THIS ref, at THIS commit. Without those three,
 *                         "some attestation for this file exists in this repository" would be enough, and a dry-run
 *                         attestation of the same bytes would satisfy a real release.
 *   publish               create the GitHub Release as a DRAFT with every file, check that the draft holds exactly those
 *                         files (names, upload state and the sha256 GitHub reports), and only then make it public. A
 *                         release that already exists for the tag (draft or public) is never touched and no file is ever
 *                         replaced. Until the last step succeeds nobody but the repository's writers can see a release, so
 *                         a failure never leaves a public, half-filled release next to the permanent tag.
 *   verify-release        after publication: download the public release, check it holds exactly those files with the
 *                         digests GitHub reports, and verify the attestations of what was downloaded. The workflow then
 *                         runs `npm run packages:verify` against the downloaded tarballs.
 *
 * Exit 0 on success, 1 with one line per problem (GitHub `::error::` annotations under Actions).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVENANCE = "https://slsa.dev/provenance/v1";
export const SBOM = "https://cyclonedx.org/bom";
export const BINARIES = ["amo-linux-x64", "amo-darwin-arm64", "amo-windows-x64.exe"];
export const CHECKSUM_FILES = ["SHA256SUMS-linux-x64.txt", "SHA256SUMS-darwin-arm64.txt", "SHA256SUMS-windows-x64.txt"];
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
  };
}
export const allNames = (version) => {
  const a = expectedAssets(version);
  return [...a.binaries, ...a.checksums, ...a.tarballs, a.sboms.cli, a.sboms.packages];
};
export const attestedNames = (version) => [...BINARIES, ...expectedAssets(version).tarballs];

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

export function checkFiles(dir, version) {
  const problems = [];
  const expected = allNames(version);
  const present = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()) : [];
  for (const n of expected.filter((x) => !present.includes(x))) problems.push(`${dir}/${n} is missing`);
  for (const n of present.filter((x) => !expected.includes(x))) problems.push(`${dir}/${n} is not one of the ${expected.length} files a release carries`);
  for (const n of present.filter((x) => expected.includes(x) && statSync(join(dir, x)).size === 0)) problems.push(`${dir}/${n} is empty`);
  return problems;
}

export function verifyCommand(path, repo, predicate, workflow, sourceRef, sourceDigest) {
  return ["attestation", "verify", path, "--repo", repo, "--predicate-type", predicate, "--signer-workflow", `${repo}/${workflow}`, "--source-ref", sourceRef, "--source-digest", sourceDigest];
}

export function verifyAttestations({ dir, version, repo, workflow, sourceRef, sourceDigest }, gh = realGh, pause = sleepMs) {
  const problems = [];
  for (const name of attestedNames(version)) {
    const path = join(dir, name);
    if (!existsSync(path)) { problems.push(`${path} is missing, so its attestations cannot be verified`); continue; }
    for (const predicate of [PROVENANCE, SBOM]) {
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
    if (asset.digest && existsSync(local)) {
      const want = `sha256:${await sha256Of(local)}`;
      if (asset.digest !== want) problems.push(`asset ${name} on the release has digest ${asset.digest}, not the sha256 of the attested file (${want})`);
    }
  }
  return problems;
}

export function releaseNotes(tag, repo, workflow) {
  const version = versionOfTag(tag);
  return [
    `Release ${tag}. Every binary and package tarball below has a signed build-provenance attestation and a signed CycloneDX SBOM attestation, made by \`${workflow}\` on \`refs/tags/${tag}\`.`,
    "",
    "Verify a download (GitHub CLI):",
    "",
    "```bash",
    `gh attestation verify hybridcloudworks-migration-core-${version}.tgz --repo ${repo} --source-ref refs/tags/${tag} --signer-workflow ${repo}/${workflow}`,
    `gh attestation verify hybridcloudworks-migration-core-${version}.tgz --repo ${repo} --predicate-type ${SBOM}`,
    "```",
    "",
    `What changed: https://github.com/${repo}/blob/${tag}/CHANGELOG.md`,
    "",
    `The SBOMs are \`amo-cli-${version}.cdx.json\` (the command-line tool) and \`hybridcloudworks-migration-packages-${version}.cdx.json\` (the two package tarballs). How this release is built and checked: docs/release/README.md.`,
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

export async function publish({ repo, tag, dir, workflow }, gh = realGh, pause = sleepMs) {
  const version = versionOfTag(tag);
  const files = checkFiles(dir, version);
  if (files.length) return [...files, "nothing was published"];

  const { releases, reason } = releasesForTag(repo, tag, gh);
  if (reason) return [reason];
  if (releases.length) {
    return [`${tag} already has ${releases.every((r) => r.draft) ? "a draft" : "a public release"}. Nothing was changed: a file is never replaced. Delete that release on the Releases page (the tag stays), then re-run the failed jobs, or ship the next version`];
  }

  const notesFile = join(dir, "..", `release-notes-${tag}.md`);
  writeFileSync(notesFile, releaseNotes(tag, repo, workflow));
  const created = gh(["release", "create", tag, "--repo", repo, "--draft", "--verify-tag", "--title", tag, "--notes-file", notesFile, ...allNames(version).map((n) => join(dir, n))]);
  if (created.status !== 0) return [`could not create the draft release ${tag}: ${(created.stderr || created.stdout).trim()}`];
  console.log(`draft release for ${tag} created with ${allNames(version).length} files; checking it before it becomes public`);

  const found = lookupDraft(repo, tag, gh, pause);
  if (found.error) return [found.error];
  const draft = found.draft;
  if (!Number.isInteger(draft.id)) return [`the draft release for ${tag} has no id; nothing was made public`];
  const stuck = "the draft stays unpublished: delete it on the Releases page before re-running";
  const before = await releaseProblems(draft, dir, version, { draft: true });
  if (before.length) return [...before, stuck];

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
  return verifyAttestations({ dir: out, version, repo, workflow, sourceRef, sourceDigest }, gh, pause);
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
  if (args.command === "check-files") { need(args, "dir", "version"); problems = checkFiles(args.dir, args.version); }
  else if (args.command === "verify-attestations") { need(args, "dir", "version", "repo", "workflow", "sourceRef", "sourceDigest"); problems = verifyAttestations(args); }
  else if (args.command === "publish") { need(args, "dir", "tag", "repo", "workflow"); problems = await publish(args); }
  else if (args.command === "verify-release") { need(args, "out", "tag", "repo", "workflow", "sourceRef", "sourceDigest"); problems = await verifyRelease(args); }
  else throw new Error("usage: release-publish.mjs check-files|verify-attestations|publish|verify-release --option value ...");
  const github = process.env.GITHUB_ACTIONS === "true";
  for (const p of problems) console.log(github ? `::error::${p}` : `error: ${p}`);
  if (!problems.length && args.command === "check-files") console.log(`all ${allNames(args.version).length} release files are present`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.log(`error: ${error.message}`); process.exitCode = 1; });
}
