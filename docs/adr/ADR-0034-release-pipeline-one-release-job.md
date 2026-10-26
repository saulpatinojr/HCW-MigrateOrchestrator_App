# ADR-0034: One job creates the release; permissions per job; attested SBOMs; the tag guards everything

**Status:** Accepted · **Date:** 2026-10-25 · **Decided by:** the orchestrator, at owner level (reversible by a later ADR); closes the design part of ticket AMO-11 (issue 52). The shape follows the pipeline built for `saulpatinojr/HCW-CloudCrawler_App` (`publish-core.yml`, `scripts/check-release-version.py`, `scripts/release-publish.py`).

## Context

A release here is a `v*` tag plus a GitHub Release holding the single-executable `amo` CLI for three platforms, their
checksum files and the two package tarballs the downstream edition pins by URL and hash. Ticket AMO-11 found:

- the `v0.3.1` tag was moved once (the first run failed, the tag was re-pointed) before the tag ruleset existed. It cannot
  be repaired: the same version name once pointed at different code. The ruleset `Protect release tags` (deletion,
  non-fast-forward, update on `refs/tags/v*`; it has since gained a creation rule that repository admins can bypass) has been
  active since 2026-10-24, so moving a tag is now blocked by the ruleset (an admin could still switch it off);
- `release-cli.yml` granted `contents: write`, `id-token: write` and `attestations: write` to the whole workflow, so the
  jobs that only build had the power to write to the repository (Scorecard alert TokenPermissions);
- two jobs (`sea` and `packages`) each edited the same release through a third-party action (`softprops/action-gh-release`),
  so a half-failed run left a public release with only some files;
- no SBOM (software bill of materials: the list of what is inside a download) existed for the CLI or the tarballs;
- nothing re-tested the tarballs after they were published;
- `publish-npm.yml` ran `npm install -g npm@latest` (Scorecard alert PinnedDependencies) and could be started by hand on any
  branch.

## Decision

1. **One workflow, one ordered path, one job that touches the release.** `release-cli.yml` has eight jobs: `check`, `sea`,
   `packages`, `inventory`, `attest`, `verify-attestations`, `release`, `post-release`. Only `release` has `contents: write`. It creates the
   release as a **draft** with every file, checks that the draft holds exactly the expected files (names, upload state, the
   sha256 GitHub reports), and only then makes it public. The draft is judged from `GET /releases/{id}`, re-read up to ten
   times while GitHub is still processing the uploads, never from the list answer; an expected asset with no sha256 digest is a
   problem, not a skipped check. No third-party release action; the steps are in
   `scripts/release-publish.mjs`, which has tests. An existing release (draft or public) for the tag is never touched and no
   file is ever replaced (no `--clobber`).
2. **Permissions per job, minimum scopes.** The workflow level is `contents: read`. Build jobs have nothing more. `attest`
   has `id-token: write` and `attestations: write` (no repository write) and runs no script of this repository (it does not check the repository out); `verify-attestations` runs the repository script that checks them, with `contents: read` and `attestations: read` only (review of pull request 79, F6). `release` has `contents: write` and
   `attestations: read`. `post-release` has `contents: read` and `attestations: read`. `publish-npm.yml` has `id-token:
   write` only in its `publish` job.
3. **Attested CycloneDX SBOMs.** `scripts/generate-sbom.mjs` (built on `npm sbom`) writes `amo-cli-<version>.cdx.json` and
   `hybridcloudworks-migration-packages-<version>.cdx.json` (the two tarballs installed the way a consumer installs them,
   with their React peers). `actions/attest` (v4.2.2, the newest stable at 2026-10-25, pinned by SHA) attests build
   provenance and the SBOM for each of the three binaries and each of the two tarballs.
4. **The attestation check is bound to the tag.** `gh attestation verify` is run with `--signer-workflow`, `--signer-digest
   <commit>`, `--source-ref refs/tags/<tag>`, `--source-digest <commit>` and `--deny-self-hosted-runners`, for provenance and SBOM, in the `verify-attestations` job and again in
   `release` on the downloaded files, and in `post-release` on the files downloaded from the public release. "Some
   attestation of these bytes exists" is not enough: a dry-run attestation of the same bytes must not satisfy a real release.
5. **The tag guards each workflow.** `scripts/check-release-version.mjs` runs first in `release-cli.yml`, `publish-npm.yml` and
   `publish-images.yml`: the tag must be `v` + the version in `package.json`, `repository.manifest.json` and
   `package-lock.json` (both places), and the tagged commit must already be on `main`. It must also be the tip of `main`, or
   leave `.github/workflows` as the tip has it: GitHub's REST documentation says a `GITHUB_TOKEN` cannot create or modify a
   release whose commit adds or changes files under `.github/workflows` compared with the default branch, and an older commit
   would otherwise fail in `release` after the permanent attestations were written. Within each workflow nothing is built,
   attested, released or published before its check passes. The three workflows are independent runs of the same tag: none
   waits for another, so npm can publish (and an image can be pushed) even if the release run fails. That is accepted: each is
   gated by its own variable and an unpublished version number is cheap, but the owner must look at all of them after a tag.
6. **A post-release job re-runs `packages:verify` against the released tarballs.** `scripts/verify-packed-consumer.mjs`
   gained `--tarballs DIR --version X.Y.Z`; the `packages` job runs it on the packed tarballs before release and
   `post-release` runs it on the files downloaded from the public release.
7. **npm is not installed from `@latest`.** `publish-npm.yml` uses the npm that ships with Node 26 and fails with a clear
   message if it is older than 11.5.1 (the first version with trusted publishing). It is split into `verify` (read only;
   builds, assembles, runs the clean-consumer gate, keeps the result as an artifact) and `publish` (tag only; publishes
   exactly that artifact).
8. **Concurrency, no cancellation.** Both workflows use a concurrency group per ref with `cancel-in-progress: false`, so two
   runs for one tag queue instead of racing.
9. **A dry run that publishes nothing.** Run workflow on `main` takes the tag to be `v` + the package version, runs the
   same checks, builds everything, and keeps the files as a workflow artifact. `release` and `post-release` run only for a
   pushed `v*` tag, so a manual run can never create a release, whatever ref it names. Attestations in a dry run are opt-in
   (they are permanent entries in the public signing log). `docs/release/README.md` lists what the dry run cannot prove.

## Alternatives considered

- **Keep `softprops/action-gh-release` in both jobs and add `needs:`.** Rejected: still a third-party action holding
  `contents: write`, and still no draft-then-publish, so a failure after the first upload leaves a public partial release.
- **`gh release create` straight from the workflow YAML.** Rejected: the logic that decides whether a release becomes public
  would be untested shell. A script with a fake `gh` can be tested before a tag that the ruleset blocks from being moved is pushed.
- **A separate workflow per concern, joined by `workflow_run`.** Rejected: the two ends could disagree about the ref and the
  commit, and the strict attestation check needs one workflow identity.
- **Make the tag-already-exists case an error in the dry run.** Rejected as the default: `main` carries the version of the
  last release until a version-bump pull request lands, so the dry run would be red exactly when it is most wanted. It warns
  instead, and a real tag run is refused by `release` when a release already exists.

## Consequences

- Release assets: the existing eight names are unchanged (the downstream edition's URLs and hashes keep working) and two SBOM
  files are added. The release page appears only at the end of a successful run; between the start of `release` and its last
  step a draft is visible only to repository writers.
- If `post-release` fails, the release is already public, so a failure there is a signal, not a rollback. A temporary failure
  (a network or registry error while installing react) is a "Re-run failed jobs" case. A real mismatch means deleting the
  release on the Releases page (the tag stays) and shipping the next patch version; `docs/release/README.md` has the steps.
- Fixed names for the three binaries assume `ubuntu-latest` is x64, `macos-latest` is arm64 and `windows-latest` is x64. If
  GitHub changes a label, `inventory` fails before anything is attested or published.
- Not changed: the repository rulesets, secrets and variables; `publish-images.yml` apart from the same first-job check (the
  appliance image keeps its own gate, `docs/release/docker-hub.md`; the check is inert while `DOCKERHUB_ENABLED` is unset),
  `rules-refresh.yml` and the `self-merging-pr` action. Immutable releases (a GitHub setting)
  are off; draft-then-publish is the order GitHub documents for them, so turning them on later needs no change here.
- Open owner decisions, not made here: tightening the tag ruleset's creation rule (admins can bypass it) and turning on
  immutable releases. The downstream edition checks `releases/latest` and pins by URL and hash without verifying attestations.
- Static and local evidence only: no workflow has run. The first real exercise is the dry run on `main`, then the tag.

## Addendum 2026-10-25: follow-ups F7 and F5, and the image build ([issue 83](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues/83))

From the independent review of the pull request that introduced this ADR (F6, the split of the verification out of the signing job,
is described in decisions 2 and 4 above). Decided by the orchestrator under the owner's standing instruction to take the cheap,
clearly right follow-ups; each is reversible by reverting the workflow change.

- **F7, every release file is bound to the attestation.** The three checksum files and the two SBOMs were only checked by name and
  size. A fifth `actions/attest` step makes them subjects (build provenance), and `verify-attestations` and `verify-release` now check
  ten files: provenance and SBOM for the binaries and tarballs, provenance for the checksum files and SBOMs (15 checks in all). An SBOM
  or checksum file that differs from what the workflow produced fails the release before it is made public. The SBOM predicate is not
  repeated for those five files: they are metadata about the software, not software.
- **F5, npm publishes only what was released and attested.** `publish-npm.yml` used to build its own `dist-packages` and publish those,
  so the tarballs on npm were a second build of the same commit, never compared with the attested ones. It now has a job
  `release-ready` (read-only) that waits for the release of the tag to be public, downloads it, runs `verify-release` (files, GitHub's
  digests, attestations bound to `release-cli.yml`, the tag and the commit) and records the sha256 of the two tarballs; `publish`
  (`id-token: write`, GitHub Environment `npm-publish`) downloads those tarballs, compares the sha256 again and runs
  `npm publish <tarball> --provenance`. Consequences: npm can no longer publish after a failed release run (it waits up to 45
  minutes, then stops), and a publish needs a person to approve the Environment, which the owner must create with required reviewers
  (docs/release/npm-publishing.md, step 4; the trusted-publisher entry on npmjs.com names the environment `npm-publish`). The
  registry bootstrap had not been done, so changing the entry now costs nothing. Not rehearsable: the wait for a real public release
  and the publish itself.
- **Appliance image: one build.** `publish-images.yml` scanned one build and pushed another. It now builds once, pushes that build by
  digest without a tag, scans that digest, tags it with `docker buildx imagetools create`, then attests the same digest. A failed
  scan leaves an untagged image under its digest (no tag, no attestation) that is deleted by hand; the alternative of building
  twice with a cache still produces two images. Not exercised: the workflow is inert until `DOCKERHUB_ENABLED` is set.
- **Appliance image: only a tag logs in.** The first manual run of `publish-images.yml` (run 40254017571) failed at the Docker Hub
  login with `400 access_denied`, because the connection in Docker Home trusts tag refs only and a manual run is on `main`. The
  workflow is now two paths: `rehearse` (manual run: builds into the runner's local Docker, scans, no login, no push, `contents:
  read` only) and `build-scan-publish` (gated by `DOCKERHUB_ENABLED` and a `refs/tags/v*` push; the only job with `id-token: write`
  and `attestations: write`). The alternative of a single job with the login step conditioned was rejected because the job's
  permissions would still include `id-token: write` on a path that never needs it. `tests/release/release-workflows.test.mjs`
  pins the gate, the permissions and the absence of a login on the manual path, with mutation checks.
