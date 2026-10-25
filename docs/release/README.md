# Releasing the CLI and the packages (owner runbook)

A release is a tag whose name starts with `v` (for example `v0.3.2`) pushed to this repository. Pushing the tag starts the
workflow [`release-cli.yml`](../../.github/workflows/release-cli.yml), which builds everything, signs it, and publishes one
[GitHub Release](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases). The design and the reasons are in
[ADR-0034](../adr/ADR-0034-release-pipeline-one-release-job.md). Publishing the packages to the npm registry is optional and
separate: [`npm-publishing.md`](npm-publishing.md).

A pushed tag is **blocked from being moved, deleted or overwritten** by the ruleset
[Protect release tags](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/rules/25778331) (rules: deletion,
non-fast-forward, update and creation; the creation rule lets repository admins bypass it, so an admin could still create a tag
without the usual review, and an admin could also switch the ruleset off). That is on purpose: a version name must always mean the
same code. Treat a wrong tag as permanent, so the first job of the workflow checks what it can before it builds anything in that
workflow, and you can rehearse the whole run without a tag (section 2). The tag `v0.3.1` was moved once, before that ruleset
existed. It cannot be repaired; treat `v0.3.1` as "the version whose first run failed" and do not rely on it being reproducible.
Whether to tighten the creation rule, and whether to turn on GitHub's "immutable releases" setting, are owner decisions in the
repository settings; this pipeline does not change them (draft-then-publish is the order GitHub documents for immutable releases,
so turning it on later needs no change here).

Three workflows start from the same tag and run **independently** of each other: `release-cli.yml` (this runbook),
`publish-npm.yml` (optional, section 5) and `publish-images.yml` (the appliance image, skipped while `DOCKERHUB_ENABLED` is not
`true`). Each runs its own version check first. `release-cli.yml` and `publish-images.yml` do not wait for each other (the image
can be pushed even if the release run fails); `publish-npm.yml` does wait for the release to be public and verified, so npm never
gets a package from a failed release run. Look at all of them after a tag.

## 1. What a release contains

Ten files, nothing more. The workflow refuses to publish if one is missing, extra or empty.

| File | What it is |
|---|---|
| `amo-linux-x64`, `amo-darwin-arm64`, `amo-windows-x64.exe` | The `amo` command-line tool as a single executable (Node.js built in), one per platform |
| `SHA256SUMS-linux-x64.txt`, `SHA256SUMS-darwin-arm64.txt`, `SHA256SUMS-windows-x64.txt` | The checksum of each binary |
| `hybridcloudworks-migration-core-<version>.tgz`, `hybridcloudworks-migration-ui-<version>.tgz` | The two packages the downstream edition (`HCW-MigrateOrchestrator_AddOn`) installs. It pins them by address and hash, so these names must never change |
| `amo-cli-<version>.cdx.json` | The SBOM (software bill of materials: the list of what is inside) of the command-line tool, in CycloneDX format |
| `hybridcloudworks-migration-packages-<version>.cdx.json` | The SBOM of the two packages, as a consumer installs them |

Each of the three binaries and the two tarballs also has two signed attestations (build provenance and SBOM), and each checksum file and SBOM has one (build provenance), stored with GitHub (a statement, signed by
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
| The tag run itself starting, and the tag-only jobs `release` and `post-release` | A manual run is not a tag push, and those jobs are tag-only on purpose | The run lists eight jobs, all green |
| Creating the draft release, uploading ten files, making it public | Needs `contents: write` and a real tag; a manual run must never have that | The release page lists exactly the ten files |
| The attestation check bound to `refs/tags/<tag>` | The dry run, even with "attest" ticked, is bound to `refs/heads/main` | `attest`, `verify-attestations` and `release` jobs are green |
| The released tarballs passing `packages:verify` | They exist only after publication | `post-release` is green |
| `gh` flags on the real runner (`release create --draft --verify-tag`, `attestation verify --signer-workflow --signer-digest --source-ref --source-digest --deny-self-hosted-runners`) | They were run against a fake in the tests | No error annotation in `release` |
| GitHub's rule that a `GITHUB_TOKEN` cannot create or modify a release whose commit changes files under `.github/workflows` compared with `main` ([REST docs, releases](https://docs.github.com/en/rest/releases/releases)) | Only a real `release` job tries to create a release. `check` refuses a tag on a commit that is not the tip of `main` unless `.github/workflows` is identical to the tip's, which is proven by tests on a scratch git repository, not by GitHub | `release` creates the draft without an authorisation error |
| That a draft's asset list and sha256 digests are complete when the script reads them | The list answer can lag behind the upload, and it is not proven that GitHub reports a sha256 for assets on a **draft**. The script re-reads the draft by its id (up to 10 times, 3 seconds apart) and refuses to publish while any asset is not `uploaded` or has no sha256 matching the attested file; this was tested against a fake that lags and one that never reports a digest | `release` finishes without the message "has no sha256 digest". If it does appear on every try, nothing is published (the draft stays) and the check needs a different source for the digest |
| The `check` failure path on a real tag run (a tag on a commit that is not on `main`, or on an old commit after a workflow change) | A dry run always starts from the tip of `main`, so it never goes down that path | If you ever push such a tag, `check` is red with one plain message, nothing else runs, and the next version is the way forward |
| That `actions/attest` can create attestations whose source is `refs/tags/<tag>` (the dry run, even with "attest" ticked, uses `refs/heads/main`) and that `gh attestation verify --source-ref refs/tags/<tag>` accepts them | Needs a real tag run | `attest` and `release` are green |

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
   $sha = gh run list --repo saulpatinojr/HCW-MigrateOrchestrator_App --workflow release-cli.yml --event workflow_dispatch --branch main --status success --limit 1 --json headSha --jq ".[0].headSha"
   $main = git rev-parse origin/main
   $sha
   $main
   ```

   The two lines must be the same 40-character id. If they differ, `main` moved after the dry run: run the dry run again. (A tag on
   an older commit is refused by the `check` job when `.github/workflows` changed since, because GitHub does not let the workflow's
   token create a release for such a commit; stopping here saves you a permanent tag.) Check that
   `git log -1 $sha --format=%s` shows the commit you expect. The version comes from that commit, not from your working copy:

   ```powershell
   $version = (git show "${sha}:package.json" | ConvertFrom-Json).version
   git tag -a "v$version" $sha -m "Release v$version"
   git push origin "v$version"
   ```

   bash:

   ```bash
   git fetch origin
   sha="$(gh run list --repo saulpatinojr/HCW-MigrateOrchestrator_App --workflow release-cli.yml --event workflow_dispatch --branch main --status success --limit 1 --json headSha --jq '.[0].headSha')"
   main="$(git rev-parse origin/main)"
   echo "$sha"; echo "$main"
   [ "$sha" = "$main" ] || { echo "main moved after the dry run: run the dry run again"; exit 1; }
   version="$(git show "$sha:package.json" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')"
   git tag -a "v$version" "$sha" -m "Release v$version"
   git push origin "v$version"
   ```

4. **Watch the tag run** in [Actions](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/actions/workflows/release-cli.yml).
   When all eight jobs are green, open the [release page](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases) and
   check it lists the ten files from section 1.
5. **Verify one download yourself** (optional but quick), with the same strict flags the pipeline uses. After downloading
   `hybridcloudworks-migration-core-<version>.tgz` from the release page into the current folder, bash:

   ```bash
   f="$(ls hybridcloudworks-migration-core-*.tgz)"; tag="v${f#hybridcloudworks-migration-core-}"; tag="${tag%.tgz}"
   gh attestation verify "$f" --repo saulpatinojr/HCW-MigrateOrchestrator_App --predicate-type https://slsa.dev/provenance/v1 --source-ref "refs/tags/$tag" --signer-workflow saulpatinojr/HCW-MigrateOrchestrator_App/.github/workflows/release-cli.yml --deny-self-hosted-runners
   ```

   PowerShell:

   ```powershell
   $f = (Get-ChildItem hybridcloudworks-migration-core-*.tgz).Name
   $tag = "v" + $f.Substring("hybridcloudworks-migration-core-".Length).Replace(".tgz", "")
   gh attestation verify $f --repo saulpatinojr/HCW-MigrateOrchestrator_App --predicate-type https://slsa.dev/provenance/v1 --source-ref "refs/tags/$tag" --signer-workflow saulpatinojr/HCW-MigrateOrchestrator_App/.github/workflows/release-cli.yml --deny-self-hosted-runners
   ```

   Use `--predicate-type https://cyclonedx.org/bom` instead to check the SBOM attestation. It prints the workflow, the tag and the
   commit that built the file. [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify). The `amo` binaries
   have no `--version` option: identify a binary by its `SHA256SUMS-*.txt` file and its attestation, not by running it.
6. **Tell the downstream edition.** `HCW-MigrateOrchestrator_AddOn` checks this repository's latest release every 6 hours (its
   `core-update` workflow), pins the two tarballs by URL and integrity hash, and does **not** verify attestations. So the first
   release made with this pipeline reaches it by itself, as a pull request on its side; look at that pull request. Add an entry to
   its `docs/whats-new-upstream.md` (newest first) and update its "Current upstream state" table, which still says the latest
   release is `v0.3.1`. Suggested entry text: "Upstream release `v<new version>` is built by the rebuilt release pipeline
   (ADR-0034 upstream): file names are unchanged, two SBOM files (`amo-cli-<version>.cdx.json`,
   `hybridcloudworks-migration-packages-<version>.cdx.json`) are added, every binary and tarball has signed provenance and SBOM
   attestations, and the release page appears only after the files were checked. Reaches this edition: the tarballs only; the pins
   and hashes are unchanged in form." Whether the downstream edition should start verifying attestations is its owner's decision.

## 4. If something goes wrong

The tag stays whatever happens. Use "Re-run failed jobs" only for a temporary failure (a network error): a re-run uses the workflow
file as it was at the tagged commit and the files built by that run, so a fix merged to `main` later cannot reach it.

| What failed | State of the world | What to do |
|---|---|---|
| `check` (version, ancestry, or "not the tip of main and `.github/workflows` differs") | Nothing built, nothing published; the tag exists | The tag is wrong and the ruleset blocks moving it. Fix `main`, raise the version, tag the next version |
| `sea`, `packages` or `inventory` | Nothing published | Re-run failed jobs if it was temporary; otherwise fix `main` and ship the next version |
| `attest` | Nothing published; some signatures may exist | Same. Signatures of a version that was never released are harmless |
| `release`, before its last step | A **draft** release may exist (only repository writers see it) | Open the [Releases page](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases), delete the draft (the tag stays), then re-run failed jobs if it was temporary, or ship the next version. The job refuses to touch an existing draft or release |
| `post-release`, a temporary failure (a network or registry error while it downloads or installs react) | The release is public and the earlier jobs verified it | "Re-run failed jobs" |
| `post-release`, a real failure (a file or digest differs from the release, an attestation does not verify, or `packages:verify` fails on a second try) | The release is public but something about the published files is wrong | Delete the release on the Releases page (downstream may have pinned its hashes, so tell them), fix `main`, ship the next version |

Never delete a release asset and upload a replacement: the workflow never replaces a file, and the downstream edition pins hashes.

## 5. npm publishing (optional)

`publish-npm.yml` publishes the two packages to the npm registry on a tag, using trusted publishing (no token anywhere), when the
repository variable `NPM_TRUSTED_PUBLISHING` is `ready`. It runs the same version check first, uses the npm that ships with
Node 26 (and stops if that is older than 11.5.1), rehearses the build and the clean-consumer gate, then **waits for the GitHub
Release of the tag to be public**, downloads it and verifies every file's digest and attestation (job `release-ready`), and publishes
**the released tarballs themselves** (job `publish`), after comparing their sha256 again. So what reaches npm is what the release
carries and what was attested, and a failed release run publishes nothing. The `publish` job runs in the GitHub Environment
`npm-publish`; **create it with required reviewers before arming the workflow** (steps in [`npm-publishing.md`](npm-publishing.md),
step 4: Settings, Environments, New environment, name `npm-publish`, tick Required reviewers, add yourself): without that setup the
environment is created empty on first use and nobody has to approve. Its
dry run is Run workflow on `main`: it stops after the gate and publishes nothing. Setup: [`npm-publishing.md`](npm-publishing.md).
Not rehearsable: the wait for a real public release, the publish itself, and that the registry accepts the OIDC token. It starts from
the same tag as the release run (see the top of this page), and a bad publish cannot be undone: a version can never be published again.
Mark it instead, from a trusted machine and an owner login (never a stored token), then ship the next version. The version below is
an example; use the one that was published:

```bash
npm deprecate "@hybridcloudworks/migration-core@0.3.2" "Do not use: published in error, use the next version"
npm deprecate "@hybridcloudworks/migration-ui@0.3.2" "Do not use: published in error, use the next version"
```

## 6. Where things are

| Piece | File |
|---|---|
| Workflow | [`release-cli.yml`](../../.github/workflows/release-cli.yml), [`publish-npm.yml`](../../.github/workflows/publish-npm.yml) |
| Version and tag check | [`scripts/check-release-version.mjs`](../../scripts/check-release-version.mjs) |
| Draft, check, publish; attestation checks; post-release download | [`scripts/release-publish.mjs`](../../scripts/release-publish.mjs) |
| SBOMs | [`scripts/generate-sbom.mjs`](../../scripts/generate-sbom.mjs) |
| Tests | `tests/release/` (the scripts against a fake `gh`; the workflow rules) |
