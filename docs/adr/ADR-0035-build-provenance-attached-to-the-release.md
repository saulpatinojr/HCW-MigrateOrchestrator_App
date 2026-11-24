# ADR-0035: The build provenance is attached to the release as a file

**Status:** Accepted · **Date:** 2026-11-23 · **Decided by:** the owner ("apps: files", 2026-11-23), answering the estate-wide
record [ADR 0044, "Signed releases across the estate"](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/claude/ecstatic-einstein-4z5zkt-signed-releases/docs/decisions/0044-signed-releases.md)
of the main site (on that branch until [its pull request 1799](https://github.com/saulpatinojr/HCW-HybridCloudWorks/pull/1799) merges).
Amends ADR-0034 (the release pipeline); nothing in ADR-0034 is withdrawn.

## Context

Since `v0.4.0` every file of a release has build provenance: a statement, signed without any stored key, that says which
workflow built the file, from which commit. `release-cli.yml` makes it with `actions/attest` and checks it three times
(ADR-0034). The statement is kept in GitHub's attestation store, which a person reads with `gh attestation verify`.

Nothing on the release page itself carried that proof. Two consequences:

- A person who has only the downloaded files cannot check them without asking GitHub's store.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) (a tool that grades a repository's security habits; this repository
  runs it in `scanners.yml`) has a check named Signed-Releases. It reads only the **names** of the files attached to the five
  newest releases, and gives 10 for a file ending `.intoto.jsonl`. Proof kept in the attestation store does not count, so this
  repository scored 0. The main site's record quotes the source lines of Scorecard `v5.7.0` for this.

## Decision

1. **A release carries an eleventh file, `amo-<version>.intoto.jsonl`.** It holds the three build-provenance bundles of the
   release, one per line (a Sigstore bundle is the signed statement together with its signing certificate and its entry in the
   public signing log): one for the three binaries, one for the two package tarballs, one for the three checksum files and
   the two SBOMs. It is a copy of what the attestation store already holds. The SBOM attestations are not in it: the name
   promises provenance.
2. **The job that signs still runs no script.** `actions/attest` returns the path of each bundle as its output `bundle-path`
   (read from [`action.yml` at the pinned commit](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/action.yml);
   [`src/main.ts`](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/src/main.ts) writes one
   bundle, on one line, per step). The `attest` job saves the three files as workflow artifacts with the pinned upload
   action. The main site's record sketched a `jq` line in that job; here the file is written one job later, in
   `verify-attestations`, which cannot sign, so the rule of ADR-0034 decision 2 (the job with `id-token: write` runs no
   script) stays whole.
3. **The file is checked before it can be released.** `scripts/release-publish.mjs assemble-provenance` writes it and refuses
   it unless every line is a signed build-provenance bundle and the lines together name each of the ten built files by
   sha256, and no other file. `verify-provenance` then runs `gh attestation verify --bundle` for each of the ten files
   against that file alone, with the same strict flags as the store check (this workflow file, this ref, this commit, no
   self-hosted runner). Both run in `verify-attestations` (so a dry run with "attest" ticked rehearses them), the second again
   in `release`, and `post-release` repeats it on the files downloaded from the public release.
4. **The same guards cover it as the other files.** The expected file list has eleven names; the inventory check (before
   attesting) still accepts exactly ten, so nothing can sit under the provenance name early. `publish` refuses a missing,
   empty, misnamed or extra file, and a provenance file that is not about these files, before any call to GitHub. The file
   is attached in the one `gh release create --draft` call with the others; nothing is uploaded to a release afterwards.
5. **Keyless, as before.** No stored key and no new secret. Permissions are unchanged in every job: `attest` keeps
   `contents: read`, `id-token: write`, `attestations: write` (no repository write); `verify-attestations` keeps
   `contents: read`, `attestations: read`; `release` keeps `contents: write`, `attestations: read`.

## Consequences

- A download can be checked from the release's own files:
  `gh attestation verify <file> --repo saulpatinojr/HCW-MigrateOrchestrator_App --bundle amo-<version>.intoto.jsonl`.
  The command still needs the network once, to fetch the public trust root (the list of signing authorities), but not GitHub's
  attestation store.
- The file is public and permanent, like the attestations it copies. It holds nothing the public signing log does not
  already hold: the repository, the workflow, the commit and the sha256 of each file.
- The downstream edition (`HCW-MigrateOrchestrator_AddOn`) is not affected: it reads the tag name of the latest release and
  downloads the two tarballs by their exact address, checked by the integrity hash in its lockfile. It lists no other file.
- Scorecard's score moves slowly, and that is expected: it is the average over the five newest releases, so 2 after the
  first release with the file, then 4, 6, 8 and 10. Scorecard does not verify the file; this pipeline does.
- `publish-npm.yml` runs `verify-release`, so it now also needs the provenance file on the release it publishes from.

## Alternatives considered

- **A signature made with a stored key (`.asc`, minisign).** Rejected: a long-lived private key to protect and rotate, for a
  lower score, against the rule that this repository signs without stored keys.
- **A `jq` line in the `attest` job** (the main site's sketch). Works, but puts a script in the one job that can sign.
- **Attaching all five bundles (provenance and SBOM).** Rejected: the file name says provenance; the SBOM attestations stay in
  the store, where `verify-attestations` checks them.
- **Uploading the file to the release after it is public.** Rejected: the release job never adds to or replaces a published
  release (ADR-0034 decision 1), and GitHub's immutable releases would refuse it.
- **Immutable releases alone.** A separate owner decision per repository (the main site's record explains it); the Scorecard
  probe that reads it is experimental.

## Validation

`VALIDATION.md`, "Build provenance attached to the release (2026-11-23)", lists what was run. In short: the script commands
were run against the real files and the real attestations of `v0.4.3`, with the real `gh`; the workflow itself has not run.
The first proof on GitHub is the dry run with "attest" ticked, and then the next tag.
