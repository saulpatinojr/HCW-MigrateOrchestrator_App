# Releasing the CLI and the packages (owner runbook)

A release is a tag whose name starts with `v` (for example `v0.3.2`) pushed to this repository. Pushing the tag starts the
workflow [`release-cli.yml`](../../.github/workflows/release-cli.yml), which builds everything, signs it, and publishes one
[GitHub Release](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases). The design and the reasons are in
[ADR-0032](../adr/ADR-0032-release-pipeline-one-release-job.md). Publishing the packages to the npm registry is optional and
separate: [`npm-publishing.md`](npm-publishing.md).

A tag **cannot be moved or deleted** once it is pushed (the ruleset
[Protect release tags](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/rules/25778331)). That is on purpose: a version
name must always mean the same code. It also means a wrong tag is permanent, so the workflow checks everything it can before it
builds anything, and you can rehearse the whole run without a tag (section 2). The tag `v0.3.1` was moved once, before that
ruleset existed. It cannot be repaired; treat `v0.3.1` as "the version whose first run failed" and do not rely on it being
reproducible.

## 1. What a release contains

Ten files, nothing more. The workflow refuses to publish if one is missing, extra or empty.

| File | What it is |
|---|---|
| `amo-linux-x64`, `amo-darwin-arm64`, `amo-windows-x64.exe` | The `amo` command-line tool as a single executable (Node.js built in), one per platform |
| `SHA256SUMS-linux-x64.txt`, `SHA256SUMS-darwin-arm64.txt`, `SHA256SUMS-windows-x64.txt` | The checksum of each binary |
| `hybridcloudworks-migration-core-<version>.tgz`, `hybridcloudworks-migration-ui-<version>.tgz` | The two packages the downstream edition (`HCW-MigrateOrchestrator_AddOn`) installs. It pins them by address and hash, so these names must never change |
| `amo-cli-<version>.cdx.json` | The SBOM (software bill of materials: the list of what is inside) of the command-line tool, in CycloneDX format |
| `hybridcloudworks-migration-packages-<version>.cdx.json` | The SBOM of the two packages, as a consumer installs them |

Each of the three binaries and the two tarballs also has two signed attestations stored with GitHub (a statement, signed by
GitHub, that "this file was built by this workflow from this commit"): one for how it was built and one for its SBOM.
[About artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).

## 2. Rehearse first (publishes nothing)

The dry run builds every file exactly as a tag would, runs the same checks, and keeps the result as a download on the run page.
It can never create a release: only a pushed tag does.

1. Make sure the version you want is already merged to `main` (see section 3, step 1).
2. Start the dry run. bash or PowerShell:

   ```bash
   gh workflow run release-cli.yml --repo saulpatinojr/HCW-MigrateOrchestrator_App --ref main
   ```

   Or in the browser: [Actions, release](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/actions/workflows/release-cli.yml),
   Run workflow, Branch: `main`, leave "attest" unticked, Run workflow. (Any branch other than `main` stops at once with a clear message.)
3. Wait for the run to turn green (about ten minutes; three operating systems build in parallel). Open the run: the summary lists
   the sha256 of every file, and the `release-files` artifact holds the ten files.
4. Recommended once, before the first real tag: run it again with "attest" ticked:

   ```bash
   gh workflow run release-cli.yml --repo saulpatinojr/HCW-MigrateOrchestrator_App --ref main -f attest=true
   ```

   This signs the files and checks the signatures with the same strict command a real tag uses. It writes four permanent entries
   to the public signing log, naming `refs/heads/main`. That is harmless but cannot be undone, which is why it is off by default.

What the green dry run tells you: the version check passes, all three binaries build and pass their smoke test, the two tarballs
pass the clean-consumer gate, both SBOMs are generated, and exactly the ten expected files exist. If `main` still has the version
of the last release, the run prints a warning that the tag already exists: a real tag would be refused until the version is raised.

### What the dry run cannot prove

These happen only on a real tag, so the first real tag is also their first test. They are covered by tests against a fake `gh`
(`tests/release/`), not by a live run.

| Not rehearsed | Why | What to look at on the first real tag |
|---|---|---|
| The tag run itself starting, and the tag-only jobs `release` and `post-release` | A manual run is not a tag push, and those jobs are tag-only on purpose | The run lists seven jobs, all green |
| Creating the draft release, uploading ten files, making it public | Needs `contents: write` and a real tag; a manual run must never have that | The release page lists exactly the ten files |
| The attestation check bound to `refs/tags/<tag>` | The dry run, even with "attest" ticked, is bound to `refs/heads/main` | `attest` and `release` jobs are green |
| The released tarballs passing `packages:verify` | They exist only after publication | `post-release` is green |
| `gh` flags on the real runner (`release create --draft --verify-tag`, `attestation verify --signer-workflow --source-ref --source-digest`) | They were run against a fake in the tests | No error annotation in `release` |

## 3. Cut a release

1. **Raise the version in a pull request** (the version check refuses anything else). From a clean, up-to-date clone, on a new
   branch. bash or PowerShell:

   ```bash
   node scripts/check-release-version.mjs --set-version 0.3.2
   npm test
   ```

   `0.3.2` is only an example: use the next version you mean to release. The command writes the version into `package.json`,
   `package-lock.json` (both places it appears) and `repository.manifest.json`; the release check refuses a tag if they disagree. Merge the pull request; the new version is then on `main`.
2. **Rehearse** (section 2). Do not skip this for the first release made with this pipeline.
3. **Tag the exact commit the dry run built.** PowerShell:

   ```powershell
   git fetch origin
   $version = node -p "require('./package.json').version"
   $sha = gh run list --repo saulpatinojr/HCW-MigrateOrchestrator_App --workflow release-cli.yml --event workflow_dispatch --branch main --status success --limit 1 --json headSha --jq ".[0].headSha"
   $sha
   ```

   Check that `$sha` printed one 40-character id and that `git log -1 $sha --format=%s` shows the commit you expect, then:

   ```powershell
   git tag -a "v$version" $sha -m "Release v$version"
   git push origin "v$version"
   ```

   bash:

   ```bash
   git fetch origin
   version="$(node -p "require('./package.json').version")"
   sha="$(gh run list --repo saulpatinojr/HCW-MigrateOrchestrator_App --workflow release-cli.yml --event workflow_dispatch --branch main --status success --limit 1 --json headSha --jq '.[0].headSha')"
   echo "$sha"
   git tag -a "v$version" "$sha" -m "Release v$version"
   git push origin "v$version"
   ```

   The package version in the working copy must be the one at `$sha`; run these from an up-to-date `main`.
4. **Watch the tag run** in [Actions](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/actions/workflows/release-cli.yml).
   When all seven jobs are green, open the [release page](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases) and
   check it lists the ten files from section 1.
5. **Verify one download yourself** (optional but quick). PowerShell or bash, after downloading
   `hybridcloudworks-migration-core-<version>.tgz` from the release page into the current folder:

   ```bash
   gh attestation verify "hybridcloudworks-migration-core-$(node -p "require('./package.json').version").tgz" --repo saulpatinojr/HCW-MigrateOrchestrator_App
   ```

   It prints the workflow, the tag and the commit that built the file. [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify).
6. Tell the downstream edition: add an entry to its `docs/whats-new-upstream.md` (its `core-update` workflow picks up the new
   release by itself).

## 4. If something goes wrong

The tag stays whatever happens. Use "Re-run failed jobs" only for a temporary failure (a network error): a re-run uses the workflow
file as it was at the tagged commit and the files built by that run, so a fix merged to `main` later cannot reach it.

| What failed | State of the world | What to do |
|---|---|---|
| `check` (version or ancestry) | Nothing built, nothing published; the tag exists | The tag is wrong and cannot be moved. Fix `main`, raise the version, tag the next version |
| `sea`, `packages` or `inventory` | Nothing published | Re-run failed jobs if it was temporary; otherwise fix `main` and ship the next version |
| `attest` | Nothing published; some signatures may exist | Same. Signatures of a version that was never released are harmless |
| `release`, before its last step | A **draft** release may exist (only repository writers see it) | Open the [Releases page](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases), delete the draft (the tag stays), then re-run failed jobs if it was temporary, or ship the next version. The job refuses to touch an existing draft or release |
| `post-release` | The release is public | Something about the published files is wrong. Delete the release on the Releases page (downstream may have pinned its hashes, so tell them), fix `main`, ship the next version |

Never delete a release asset and upload a replacement: the workflow never replaces a file, and the downstream edition pins hashes.

## 5. npm publishing (optional)

`publish-npm.yml` publishes the two packages to the npm registry on a tag, using trusted publishing (no token anywhere), when the
repository variable `NPM_TRUSTED_PUBLISHING` is `ready`. It runs the same version check first, uses the npm that ships with
Node 26 (and stops if that is older than 11.5.1), runs the clean-consumer gate, and publishes exactly the packages it gated. Its
dry run is Run workflow on `main`: it stops after the gate and publishes nothing. Setup: [`npm-publishing.md`](npm-publishing.md).
Not rehearsable: the publish itself, and that the registry accepts the OIDC token.

## 6. Where things are

| Piece | File |
|---|---|
| Workflow | [`release-cli.yml`](../../.github/workflows/release-cli.yml), [`publish-npm.yml`](../../.github/workflows/publish-npm.yml) |
| Version and tag check | [`scripts/check-release-version.mjs`](../../scripts/check-release-version.mjs) |
| Draft, check, publish; attestation checks; post-release download | [`scripts/release-publish.mjs`](../../scripts/release-publish.mjs) |
| SBOMs | [`scripts/generate-sbom.mjs`](../../scripts/generate-sbom.mjs) |
| Tests | `tests/release/` (the scripts against a fake `gh`; the workflow rules) |
