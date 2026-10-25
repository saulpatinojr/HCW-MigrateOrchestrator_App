#!/usr/bin/env node
/**
 * Check that every place that names the release version agrees, before a v* tag can make a mistake permanent
 * (ADR-0034). A pushed v* tag cannot be moved or deleted (the "Protect release tags" ruleset), so a tag that disagrees with
 * the package version is a permanent mistake. This runs first in release-cli.yml and publish-npm.yml, before anything is
 * built, attested, released or published. Node standard library only.
 *
 *   node scripts/check-release-version.mjs                       versions agree (CI-safe, no tag needed)
 *   node scripts/check-release-version.mjs --tag v0.3.2          ... and the tag is "v" + that version
 *   node scripts/check-release-version.mjs --rehearse           the dry run: take the tag to be "v" + the version
 *   ... --ancestor-of origin/main                                ... and the tagged commit is already on that branch, and is
 *                                                                its tip or leaves .github/workflows as the tip has it
 *   ... --require-npm 11.5.1                                     ... and `npm --version` is at least that (trusted publishing)
 *   node scripts/check-release-version.mjs --set-version 0.3.2   write that version into all of the places below (the same
 *                                                                command in bash and PowerShell; then run npm test)
 *
 * The versions compared are `version` in package.json, in repository.manifest.json and in package-lock.json (both places
 * it appears). The workspace packages under apps/ and packages/ carry their own internal versions and are not published.
 * With GITHUB_OUTPUT set, `version=X.Y.Z` is written for later jobs. Exit 0 when everything agrees, 1 with one line per
 * problem otherwise (GitHub `::error::` annotations under Actions).
 */
import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const readJson = (root, file) => JSON.parse(readFileSync(join(root, file), "utf8"));

/** { where: version } for each place the release version is written, plus problems for places that could not be read. */
export function readVersions(root) {
  const found = {};
  const problems = [];
  const take = (label, file, pick) => {
    try {
      const v = pick(readJson(root, file));
      if (typeof v === "string" && v) found[label] = v;
      else problems.push(`no version found in ${file} (${label})`);
    } catch (error) {
      problems.push(`cannot read ${file} (${label}): ${error.message}`);
    }
  };
  take("package.json", "package.json", (j) => j.version);
  take("repository.manifest.json", "repository.manifest.json", (j) => j.version);
  take("package-lock.json version", "package-lock.json", (j) => j.version);
  take("package-lock.json root package", "package-lock.json", (j) => j.packages?.[""]?.version);
  return { found, problems };
}

/** Compare two dotted versions (numbers only). */
export function atLeast(actual, minimum) {
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** Write `version` into every place readVersions reads, keeping each file's formatting (two-space JSON, final newline). */
export function setVersion(root, version) {
  if (!PLAIN_VERSION.test(version)) throw new Error(`${JSON.stringify(version)} is not a plain X.Y.Z`);
  const edit = (file, change) => {
    const json = readJson(root, file);
    change(json);
    writeFileSync(join(root, file), `${JSON.stringify(json, null, 2)}
`);
  };
  edit("package.json", (j) => { j.version = version; });
  edit("repository.manifest.json", (j) => { j.version = version; });
  edit("package-lock.json", (j) => { j.version = version; if (j.packages?.[""]) j.packages[""].version = version; });
}

const git = (root, ...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });

/** null when `sha` is an ancestor of `ref`, otherwise the reason it is not. */
export function notOnBranch(root, sha, ref) {
  const r = git(root, "merge-base", "--is-ancestor", sha, ref);
  if (r.status === 0) return null;
  if (r.status === 1) return `commit ${sha.slice(0, 12)} is not on ${ref}: release only commits that reached the protected branch`;
  return `could not compare ${sha.slice(0, 12)} with ${ref}: ${(r.stderr || "git failed").trim()}`;
}

/**
 * null when a GITHUB_TOKEN can create the release for `sha`, otherwise the reason it cannot. GitHub documents (REST API,
 * releases) that a GITHUB_TOKEN cannot create or modify a release whose target commit adds or changes files under
 * .github/workflows relative to the default branch. Tagging an older ancestor after a workflow-changing pull request landed
 * would therefore only fail in the `release` job, AFTER the permanent attestations were written. So the tagged commit must be
 * the tip of `ref` or must not differ from it under .github/workflows.
 */
export function workflowParity(root, sha, ref) {
  const tip = git(root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  if (tip.status !== 0) return `could not resolve ${ref}: ${(tip.stderr || "git failed").trim()}`;
  if (tip.stdout.trim() === sha) return null;
  const diff = git(root, "diff", "--quiet", sha, ref, "--", ".github/workflows");
  if (diff.status === 0) return null;
  if (diff.status === 1) return `commit ${sha.slice(0, 12)} is not the tip of ${ref} (${tip.stdout.trim().slice(0, 12)}) and .github/workflows differs between them: a GITHUB_TOKEN cannot create a release for such a commit, so the release job would fail after the attestations were written. Tag the tip of ${ref}`;
  return `could not compare .github/workflows between ${sha.slice(0, 12)} and ${ref}: ${(diff.stderr || "git failed").trim()}`;
}

/** { problems, warnings, version, tag }. `tag` is the tag being released (given, or derived with `rehearse`). */
export function check(root, { tag = null, rehearse = false, ancestorOf = null, sha = null, requireNpm = null, npmVersion = null } = {}) {
  const problems = [];
  const warnings = [];
  const { found, problems: unreadable } = readVersions(root);
  problems.push(...unreadable);
  const distinct = [...new Set(Object.values(found))];
  if (distinct.length > 1) {
    problems.push(`the version differs between files (${distinct.join(", ")}): ${Object.entries(found).map(([k, v]) => `${k} says ${v}`).join("; ")}`);
  }
  let version = distinct.length === 1 ? distinct[0] : null;
  if (version !== null && !PLAIN_VERSION.test(version)) {
    problems.push(`version ${JSON.stringify(version)} is not a plain X.Y.Z (pre-release versions are not released by this pipeline)`);
    version = null;
  }
  if (tag !== null && rehearse) problems.push("use either a tag or --rehearse, not both");
  let wanted = null;
  if (tag !== null) {
    wanted = tag.replace(/^refs\/tags\//, "");
    if (!TAG.test(wanted)) problems.push(`tag ${JSON.stringify(wanted)} is not "v" followed by X.Y.Z`);
    else if (version !== null && wanted !== `v${version}`) problems.push(`tag ${wanted} does not match the package version ${version}`);
  } else if (rehearse && version !== null) {
    wanted = `v${version}`;
    const existing = git(root, "rev-parse", "--verify", "--quiet", `refs/tags/${wanted}`);
    if (existing.status === 0) {
      warnings.push(`dry run: the tag ${wanted} already exists, so a real tag run for this version would be refused (publish refuses a release that exists, and a tag cannot be moved); raise the version in a pull request before tagging`);
    }
  }
  if (ancestorOf !== null && (tag !== null || rehearse)) {
    const commit = sha || git(root, "rev-parse", "HEAD").stdout.trim();
    const reason = notOnBranch(root, commit, ancestorOf);
    if (reason) problems.push(reason);
    else {
      const parity = workflowParity(root, commit, ancestorOf);
      if (parity) problems.push(parity);
    }
  }
  if (requireNpm !== null) {
    const have = npmVersion ?? execSync("npm --version", { encoding: "utf8" }).trim();
    if (!/^\d+\.\d+\.\d+/.test(have)) problems.push(`could not read the npm version (got ${JSON.stringify(have)})`);
    else if (!atLeast(have, requireNpm)) problems.push(`npm ${have} is older than ${requireNpm}, the first version with trusted publishing; use a newer Node 26 release (its bundled npm) rather than installing npm@latest`);
  }
  return { problems, warnings, version, tag: wanted };
}

function parseArgs(argv) {
  const args = { root: resolve(dirname(fileURLToPath(import.meta.url)), ".."), tag: null, rehearse: false, ancestorOf: null, requireNpm: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === "--tag") args.tag = value();
    else if (a === "--rehearse") args.rehearse = true;
    else if (a === "--ancestor-of") args.ancestorOf = value();
    else if (a === "--require-npm") args.requireNpm = value();
    else if (a === "--root") args.root = resolve(value());
    else if (a === "--set-version") args.setVersion = value();
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.setVersion) {
    setVersion(args.root, args.setVersion);
    console.log(`version set to ${args.setVersion} in package.json, repository.manifest.json and package-lock.json`);
    return 0;
  }
  const { problems, warnings, version, tag } = check(args.root, { ...args, sha: process.env.GITHUB_SHA || null });
  const github = process.env.GITHUB_ACTIONS === "true";
  for (const w of warnings) console.log(github ? `::warning::${w}` : `warning: ${w}`);
  for (const p of problems) console.log(github ? `::error::${p}` : `error: ${p}`);
  if (problems.length) return 1;
  if (process.env.GITHUB_OUTPUT && version) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`release version consistent: ${version}${tag ? `, tag ${tag}` : ""}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.log(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
