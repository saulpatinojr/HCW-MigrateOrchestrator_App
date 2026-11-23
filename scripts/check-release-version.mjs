#!/usr/bin/env node
/**
 * Check that every place that names the release version agrees, before a v* tag can make a mistake permanent
 * (ADR-0034). A pushed v* tag is blocked from being moved or deleted (the "Protect release tags" ruleset; repository admins can
 * bypass it or switch it off), so a tag that disagrees with the package version is a mistake to be treated as permanent. This runs first in release-cli.yml and publish-npm.yml, before anything is
 * built, attested, released or published. Node standard library only.
 *
 *   node scripts/check-release-version.mjs                       versions agree (CI-safe, no tag needed)
 *   node scripts/check-release-version.mjs --tag v0.3.2          ... and the tag is "v" + that version
 *   node scripts/check-release-version.mjs --rehearse           the dry run: take the tag to be "v" + the version
 *   ... --ancestor-of origin/main                                ... and the tagged commit is already on that branch, and is
 *                                                                its tip or leaves .github/workflows as the tip has it
 *   ... --require-npm 11.5.1                                     ... and `npm --version` is at least that (trusted publishing)
 *   node scripts/check-release-version.mjs --set-version 0.3.2   write that version into all of the places below, and move
 *                                                                the "Unreleased" entries of CHANGELOG.md into a new section
 *                                                                for it (the same command in bash and PowerShell; then write
 *                                                                the section's summary and run npm test)
 *
 * With a tag or --rehearse, CHANGELOG.md must also have a section "## X.Y.Z — YYYY-MM-DD" for the version with a summary
 * paragraph: the release notes are built from it (scripts/release-publish.mjs), so a release never goes out without them.
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

const SECTION_HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\b.*$/;
const SUMMARY_PLACEHOLDER = "<!-- summary: one or two plain sentences on what this release changes, for its release page -->";

/** A paragraph that is a list item, a heading, a quote, a rule or empty is not a summary. */
const NOT_A_SUMMARY = /^(?:[-*+]\s|\d+[.)]\s|#|>|---|\*\*\*|___|$)/;

/**
 * The CHANGELOG.md section for `version`: { heading, date, summary, body, placeholder }, or null when there is none. The
 * section runs from its "## X.Y.Z — YYYY-MM-DD" heading to the next "## " heading. Its summary is its first paragraph after
 * the heading, once HTML comments are left out, and only when that paragraph is plain text (not a list item, heading,
 * quote or rule). `placeholder` is true while the comment --set-version leaves is still there.
 */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => SECTION_HEADING.exec(l)?.[1] === version);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  const first = body.replace(/<!--[\s\S]*?-->/g, "").trim().split(/\n\s*\n/)[0]?.trim() ?? "";
  const summary = NOT_A_SUMMARY.test(first) ? "" : first;
  return { heading: lines[start], date: SECTION_HEADING.exec(lines[start])[2], summary, body, placeholder: body.includes(SUMMARY_PLACEHOLDER) };
}

/** Problems with the CHANGELOG.md section that the release notes of `version` are built from; empty when it is usable. */
export function changelogProblems(root, version) {
  let text;
  try {
    text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  } catch (error) {
    return [`cannot read CHANGELOG.md: ${error.message}`];
  }
  const section = changelogSection(text, version);
  if (!section) return [`CHANGELOG.md has no section "## ${version} — YYYY-MM-DD" for this version: the release notes are built from it. Run --set-version ${version}, or add the heading above that version's entries`];
  if (section.placeholder) return [`the CHANGELOG.md section for ${version} still has the comment that marks where its summary goes: replace the comment with one or two plain sentences on what the release changes; the release page opens with them`];
  if (!section.summary) return [`the CHANGELOG.md section for ${version} has no summary: its first paragraph under the heading must be one or two plain sentences (not a list item or a heading); the release page opens with them`];
  return [];
}

/**
 * Start a section for `version` dated `date`: the entries under "## Unreleased" move into it, "## Unreleased" stays empty
 * above it, and a comment marks where the summary goes. Refuses a version that already has a section.
 */
export function startChangelogSection(text, version, date) {
  if (changelogSection(text, version)) throw new Error(`CHANGELOG.md already has a section for ${version}`);
  const marker = text.match(/^## Unreleased[ \t]*\r?\n/m);
  if (!marker) throw new Error('CHANGELOG.md has no "## Unreleased" heading to take the entries from');
  const at = marker.index + marker[0].length;
  const eol = marker[0].endsWith("\r\n") ? "\r\n" : "\n"; // keep the file's own line endings
  return `${text.slice(0, at)}${eol}## ${version} — ${date}${eol}${eol}${SUMMARY_PLACEHOLDER}${eol}${text.slice(at)}`;
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

/**
 * Write `version` into every place readVersions reads, keeping each file's formatting (two-space JSON, final newline), and
 * start its CHANGELOG.md section (dated `date`, UTC today by default) when that file exists.
 */
export function setVersion(root, version, date = new Date().toISOString().slice(0, 10)) {
  if (!PLAIN_VERSION.test(version)) throw new Error(`${JSON.stringify(version)} is not a plain X.Y.Z`);
  // Work out the new CHANGELOG.md first, so a CHANGELOG problem stops the command before any file is written.
  const changelog = join(root, "CHANGELOG.md");
  let changelogText = null;
  try { changelogText = readFileSync(changelog, "utf8"); } catch { changelogText = null; }
  const newChangelog = changelogText === null ? null : startChangelogSection(changelogText, version, date);
  const edit = (file, change) => {
    const json = readJson(root, file);
    change(json);
    writeFileSync(join(root, file), `${JSON.stringify(json, null, 2)}
`);
  };
  edit("package.json", (j) => { j.version = version; });
  edit("repository.manifest.json", (j) => { j.version = version; });
  edit("package-lock.json", (j) => { j.version = version; if (j.packages?.[""]) j.packages[""].version = version; });
  if (newChangelog !== null) writeFileSync(changelog, newChangelog);
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
      warnings.push(`dry run: the tag ${wanted} already exists, so a real tag run for this version would be refused (publish refuses a release that exists, and the ruleset blocks moving a tag); raise the version in a pull request before tagging`);
    }
  }
  if (version !== null && (tag !== null || rehearse)) problems.push(...changelogProblems(root, version));
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
    console.log(`version set to ${args.setVersion} in package.json, repository.manifest.json and package-lock.json; CHANGELOG.md has a new section for it: write its summary where the comment is, then run npm test`);
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
