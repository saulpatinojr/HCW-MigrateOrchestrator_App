# OpenSSF Best Practices badge: answers for the passing level

The [OpenSSF Best Practices badge](https://www.bestpractices.dev/) is a self-assessment: the owner signs in at
bestpractices.dev with GitHub, adds this repository, and answers each question of the
[passing criteria](https://www.bestpractices.dev/en/criteria/0). Scorecard's `CII-Best-Practices` check (code scanning
alert 21) reads the result from bestpractices.dev and stops alerting once the project reaches **passing** (its default
policy needs a score of 5, which is the passing level; "in progress" scores 2).

This page is the answer sheet, prepared on 2026-11-22 from the repository as it was that day. Each row gives the answer to
choose (Met, N/A or Unmet), the justification to paste, and the evidence. Where an answer can only come from the owner, the
row says so. Repository links below are to `main`.

Repository: <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App>

## Basics

| Criterion | Answer | Justification and evidence |
|---|---|---|
| description_good | Met | The README's first lines say what the software does: assess an Azure resource inventory and plan moves between resource groups, subscriptions, regions and tenants. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App#readme> |
| interact | Met | Obtain: the README's "Quick start" and the GitHub Releases. Feedback: GitHub issues. Contribute: `CONTRIBUTING.md`. |
| contribution | Met | `CONTRIBUTING.md` describes the pull request process and the pull request template. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/CONTRIBUTING.md> |
| contribution_requirements | Met | `CONTRIBUTING.md` lists what a change must pass (`npm test`, `npm run rules:validate`), that new behaviour comes with tests, and the rule-change requirements. |
| floss_license | Met | MIT. |
| floss_license_osi | Met | MIT is OSI-approved. |
| license_location | Met | `LICENSE` at the repository root. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/LICENSE> |
| documentation_basics | Met | README "Quick start", `docs/` (architecture, deployment, product, ADRs). <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/tree/main/docs> |
| documentation_interface | Met | The CLI's commands and options are in the README's "Quick start"; the appliance API's request and response shapes are the typed contracts in `packages/contracts`; the rule format is in `docs/rules/README.md` and `rules/schemas`. |
| sites_https | Met | GitHub (repository, releases) and the project website use HTTPS. |
| discussion | Met | GitHub issues and pull requests: public, searchable, linkable, no proprietary client needed. |
| english | Met | All documentation is in English; reports are accepted in English. |
| maintained | Met | Commits every week; see the commit history. |

## Change control

| Criterion | Answer | Justification and evidence |
|---|---|---|
| repo_public | Met | <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App> |
| repo_track | Met | git records who changed what and when. |
| repo_interim | Met | Every change lands on `main` through a pull request between releases. |
| repo_distributed | Met | git. |
| version_unique | Met | Each release has a unique semantic version tag (`v0.4.1`). |
| version_semver | Met | Semantic Versioning; releases are `v*` tags. |
| version_tags | Met | Each release is a git tag, protected by the "Protect release tags" ruleset. |
| release_notes | Met | Each GitHub Release has notes and links to `CHANGELOG.md`, which is a human-written summary, not a git log. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases> |
| release_notes_vulns | N/A | No publicly known vulnerability with a CVE has been fixed in a release. |

## Reporting

| Criterion | Answer | Justification and evidence |
|---|---|---|
| report_process | Met | GitHub issues, with issue forms. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues> |
| report_tracker | Met | GitHub issues. |
| report_responses | Met | All issues so far were opened by the maintainer and are answered or tracked; no outside bug report has gone unanswered (19 issues on 2026-11-22, none from outside). |
| enhancement_responses | Met | Same as above. |
| report_archive | Met | GitHub issues are public and kept. |
| vulnerability_report_process | Met | `SECURITY.md`. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/SECURITY.md> |
| vulnerability_report_private | Met | `SECURITY.md`: report privately by email or through GitHub private vulnerability reporting, which is enabled (checked 2026-11-22). |
| vulnerability_report_response | Met | No vulnerability report has been received in the last 6 months; `SECURITY.md` commits to an acknowledgement within the stated time. |

## Quality

| Criterion | Answer | Justification and evidence |
|---|---|---|
| build | Met | `npm ci && npm run build` rebuilds everything from source; CI runs it on every pull request. |
| build_common_tools | Met | npm and the TypeScript compiler. |
| build_floss_tools | Met | Node.js, npm, TypeScript, esbuild: all FLOSS. |
| test | Met | `npm test` runs the suite (over 500 tests); documented in the README and `CONTRIBUTING.md`, and run by CI (`build-test`). |
| test_invocation | Met | `npm test`, the standard for a Node.js project. |
| test_most | Met | Unit, property-based (fast-check), golden-file, packaging and security tests across the packages and apps. |
| test_continuous_integration | Met | GitHub Actions runs the suite on every pull request and push to `main`. |
| test_policy | Met | `CONTRIBUTING.md`: new functionality and every bug fix come with an automated test, written to fail before the change. |
| tests_are_added | Met | Recent changes added tests that failed before the fix, for example the Learn parser fixes (pull requests 133, 134 and 138) and the property tests that found a crash on a malformed link. |
| tests_documented_added | Met | Stated in `CONTRIBUTING.md`. |
| warnings | Met | TypeScript `strict` mode; actionlint, zizmor and hadolint in CI. |
| warnings_fixed | Met | CI fails on compiler errors and linter findings. |
| warnings_strict | Met | `strict: true` in `tsconfig.base.json`. |

## Security

| Criterion | Answer | Justification and evidence |
|---|---|---|
| know_secure_design | **Owner's answer** | A self-assessment about the primary developer. If you answer Met, a justification such as: the maintainer designs the appliance's controls (Entra ID token validation on every route, no client secrets, managed identity, least-privilege Reader discovery, an approval gate before any change), recorded in the ADRs. |
| know_common_errors | **Owner's answer** | Same. Evidence of practice: CSV formula-injection guards, size and row limits on uploads, no raw errors in responses, redacted logging, CodeQL and property-based tests. |
| crypto_published | Met | Only SHA-256 (`node:crypto`) for content hashes, and RS256 signature checks of Entra ID tokens against the tenant's published keys. |
| crypto_call | Met | Uses `node:crypto`; implements no cryptography of its own. |
| crypto_floss | Met | `node:crypto` (OpenSSL). |
| crypto_keylength | Met | Token signatures are RSA keys published by Microsoft Entra ID (2048-bit or more); the software creates no keys. |
| crypto_working | Met | No MD4, MD5, DES or RC4; only `RS256` tokens are accepted. |
| crypto_weaknesses | Met | No SHA-1. |
| crypto_pfs | N/A | The software implements no key-agreement protocol; TLS is provided by the platform. |
| crypto_password_storage | N/A | The software stores no user passwords; sign-in is Microsoft Entra ID. |
| crypto_random | Met | Identifiers use `crypto.randomUUID`, a cryptographically secure generator; the software generates no keys. |
| delivery_mitm | Met | Releases are downloaded over HTTPS from GitHub, and each binary and tarball has a signed build-provenance attestation. |
| delivery_unsigned | Met | Checksums come from the same HTTPS release, and the attestations are signed. |
| vulnerabilities_fixed_60_days | Met | No open Dependabot alert on 2026-11-22; dependency updates arrive weekly from Dependabot. |
| vulnerabilities_critical_fixed | Met | Same. |
| no_leaked_credentials | Met | Secret scanning (gitleaks and GitGuardian) runs on every pull request; the repository holds no credentials. |

## Analysis

| Criterion | Answer | Justification and evidence |
|---|---|---|
| static_analysis | Met | CodeQL runs on every pull request, every push to `main` and weekly; actionlint, zizmor and hadolint check workflows and Dockerfiles. |
| static_analysis_common_vulnerabilities | Met | CodeQL's security queries. |
| static_analysis_fixed | Met | CodeQL alerts are fixed before merge (for example alerts 27 and 28 in pull request 133). |
| static_analysis_often | Met | On every pull request and push to `main`. |
| dynamic_analysis | Met | Property-based tests with fast-check generate random input for the Learn parser and the CSV import on every test run. |
| dynamic_analysis_unsafe | N/A | TypeScript only; no memory-unsafe language. |
| dynamic_analysis_enable_assertions | Met | The property tests check invariants with assertions on every generated input. |
| dynamic_analysis_fixed | Met | The crash the property tests found (a malformed link in a guidance note) was fixed in the same pull request that added them. |

## After the badge is earned

bestpractices.dev gives the project a number and a badge. Add the badge to the README and Scorecard picks the result up on
its next run (every push to `main` and weekly); alert 21 then closes on its own.
