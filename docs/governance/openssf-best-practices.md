# OpenSSF Best Practices badge: answers for the passing level

The [OpenSSF Best Practices badge](https://www.bestpractices.dev/) is a self-assessment run by the Open Source Security
Foundation. The owner signs in at bestpractices.dev with GitHub, adds this repository, and answers each question of the
[passing criteria](https://www.bestpractices.dev/en/criteria/0). Scorecard (the OpenSSF tool that grades the repository's
security habits) looks the project up on bestpractices.dev by the repository's address, and its `CII-Best-Practices` check
(code scanning alert 21) stops alerting once the project reaches **passing**. Its default policy needs a score of 5, which
is passing; a badge "in progress" scores 2 and does not close the alert.

This page is the answer sheet, prepared on 2026-11-22 from the repository as it was that day. Each row gives the answer to
choose (Met, N/A or Unmet), the text to paste, and where the evidence is. Two rows are the owner's own statement, and one
row, **release_notes, is not met yet**: see "What stops the badge today" below. Repository links are to `main`.

Repository: <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App>

## Steps for the owner

1. Open <https://www.bestpractices.dev/en/projects/new> and sign in with GitHub.
2. Choose this repository (`saulpatinojr/HCW-MigrateOrchestrator_App`) and submit. bestpractices.dev fills in some answers
   by itself from the repository.
3. Go through the passing questions and give each the answer and text from the tables below. Save as you go.
4. **When it worked:** the project page shows a percentage, and "passing" once every MUST is Met or N/A. While
   release_notes is Unmet it will show "in progress", which is expected until that is fixed.
5. Scorecard picks the result up on its next run (every push to `main`, and weekly), and alert 21 closes on its own. No
   change to the README is needed for that.

## What stops the badge today

**release_notes (a MUST) is Unmet.** On 2026-11-22 the GitHub Release pages of `v0.2.0`, `v0.2.1`, `v0.3.0` and `v0.3.1`
are empty, and `v0.4.0` and `v0.4.1` link to `CHANGELOG.md` at their tag, where the changes of 0.3.x and 0.4.x sit under
"Unreleased" rather than under a section for that version. To meet it:

1. At each release, move the "Unreleased" entries of `CHANGELOG.md` into a section headed with the version and date, and
   put a short plain summary of the main changes on the GitHub Release page.
2. For the past releases, either write a short summary on each empty Release page or note on it that it was a
   pre-release of the development series, and give `v0.4.1` a summary of what it changed.

Once the next release is made that way, answer release_notes "Met" with the link to that release.

## Terms used below

- **FLOSS:** free/libre and open-source software. **OSI:** the Open Source Initiative, which approves open-source licences.
- **Semantic versioning (SemVer):** version numbers in the form major.minor.patch, such as 0.4.1.
- **CodeQL:** GitHub's code scanner that looks for security mistakes in the code. **gitleaks** and **GitGuardian:** tools
  that look for passwords and keys committed by mistake. **Dependabot:** GitHub's bot that proposes dependency updates and
  reports known vulnerabilities in them.
- **Property-based tests (fuzzing):** tests that feed many generated random inputs to the code and check that rules
  ("never throws", "reads back what was written") always hold. Here they use the `fast-check` library.
- **SHA-256:** a standard hash function. **RS256:** a standard way to sign tokens with an RSA key; Microsoft Entra ID
  signs its sign-in tokens that way. **MITM (man in the middle):** someone altering a download on its way to the user.
  **PFS (perfect forward secrecy):** a property of encrypted connections; here the hosting platform provides the
  encrypted connection, not this software.

## Basics

| Criterion | Answer | Justification and evidence |
|---|---|---|
| description_good | Met | The README's first lines say what the software does: assess an Azure resource inventory and plan moves between resource groups, subscriptions, regions and tenants. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App#readme> |
| interact | Met | Obtain: the README's "Quick start" and the GitHub Releases. Feedback: GitHub issues. Contribute: `CONTRIBUTING.md`. |
| contribution | Met | `CONTRIBUTING.md` describes the pull request process and the pull request template. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/CONTRIBUTING.md> |
| contribution_requirements | Met | `CONTRIBUTING.md` lists what a change must pass (`npm test`, `npm run rules:validate`), that new behaviour and bug fixes come with tests, and the rule-change requirements. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/CONTRIBUTING.md> |
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
| release_notes | **Unmet (for now)** | See "What stops the badge today" above. Answer Met with the link to the next release once it has a summary and a CHANGELOG section for its version. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/releases> |
| release_notes_vulns | N/A | No publicly known vulnerability with a CVE has been fixed in a release. |

## Reporting

| Criterion | Answer | Justification and evidence |
|---|---|---|
| report_process | Met | GitHub issues, with issue forms. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues> |
| report_tracker | Met | GitHub issues. |
| report_responses | Met | Every issue so far was opened by the maintainer and is answered or tracked; no bug report from anyone else has been left unanswered (checked 2026-11-22). |
| enhancement_responses | Met | Every enhancement request so far was opened by the maintainer and is answered or tracked; none from anyone else has been left unanswered (checked 2026-11-22). |
| report_archive | Met | GitHub issues are public, searchable and kept. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues?q=is%3Aissue> |
| vulnerability_report_process | Met | `SECURITY.md`. <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/SECURITY.md> |
| vulnerability_report_private | Met | `SECURITY.md`: report privately by email or through GitHub private vulnerability reporting, which is enabled (checked 2026-11-22). <https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/blob/main/SECURITY.md> |
| vulnerability_report_response | Met | No vulnerability report has been received in the last 6 months; `SECURITY.md` commits to an acknowledgement within 3 business days. |

## Quality

| Criterion | Answer | Justification and evidence |
|---|---|---|
| build | Met | `npm ci && npm run build` rebuilds everything from source; CI runs it on every pull request. |
| build_common_tools | Met | npm and the TypeScript compiler. |
| build_floss_tools | Met | Node.js, npm, TypeScript, esbuild: all FLOSS. |
| test | Met | `npm test` runs the suite (over 500 tests); documented in the README and `CONTRIBUTING.md`, and run by CI (the `build-test` job) on every pull request. |
| test_invocation | Met | `npm test`, the standard for a Node.js project. |
| test_most | Met | Unit, property-based (fast-check), golden-file, packaging and security tests across the packages and apps. |
| test_continuous_integration | Met | GitHub Actions runs the suite on every pull request and push to `main`. |
| test_policy | Met | `CONTRIBUTING.md`: new functionality and every bug fix come with an automated test, written to fail before the change. |
| tests_are_added | Met | Recent changes added tests that failed before the fix: the Learn parser fixes (pull requests 133, 134 and 138), and the property tests that found a crash on a malformed link and a crash on a CSV type named `constructor`. |
| tests_documented_added | Met | Stated in `CONTRIBUTING.md`. |
| warnings | Met | TypeScript `strict` mode; actionlint (workflow linter), zizmor (workflow security linter) and hadolint (Dockerfile linter) in CI. |
| warnings_fixed | Met | CI fails on TypeScript errors and on actionlint and zizmor findings; hadolint fails on errors and prints its warnings, which are fixed or explained in the Dockerfile. |
| warnings_strict | Met | `strict: true` in `tsconfig.base.json`. |

## Security

| Criterion | Answer | Justification and evidence |
|---|---|---|
| know_secure_design | **Owner's answer** | A self-assessment about the primary developer. If you answer Met, a justification such as: the maintainer designs the appliance's controls (Entra ID token validation on every route, no client secrets, managed identity, least-privilege Reader discovery, an approval gate before any change), recorded in the ADRs. |
| know_common_errors | **Owner's answer** | A self-assessment about the primary developer. If you answer Met: the maintainer guards against the common errors of this kind of software: spreadsheet formula injection in CSV files, oversized uploads (size and row limits), leaking internal errors (no raw errors in responses), secrets in logs (redacted logging), and lookups that trust user input (own-property lookups); CodeQL and property-based tests check for them. |
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
| vulnerabilities_critical_fixed | Met | No open Dependabot alert and no security advisory on 2026-11-22; dependency updates arrive weekly from Dependabot. |
| no_leaked_credentials | Met | Secret scanning (gitleaks and GitGuardian) runs on every pull request; the repository holds no credentials. |

## Analysis

| Criterion | Answer | Justification and evidence |
|---|---|---|
| static_analysis | Met | CodeQL runs on every pull request, every push to `main` and weekly; actionlint, zizmor and hadolint check workflows and Dockerfiles. |
| static_analysis_common_vulnerabilities | Met | CodeQL's security queries. |
| static_analysis_fixed | Met | CodeQL alerts are fixed before merge (for example alerts 27 and 28, a slow regular expression, in pull request 133). |
| static_analysis_often | Met | On every pull request and push to `main`. |
| dynamic_analysis | Met | Property-based tests with fast-check generate random input for the Learn parser and the CSV import on every test run. |
| dynamic_analysis_unsafe | N/A | TypeScript only; no memory-unsafe language. |
| dynamic_analysis_enable_assertions | Met | The property tests check invariants with assertions on every generated input. |
| dynamic_analysis_fixed | Met | The bugs the property tests found (a crash on a malformed link in a guidance note, and a crash and wrong output on resource types named `constructor` or `__proto__`) were fixed in the same pull request that added the tests. |
