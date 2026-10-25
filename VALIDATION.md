# VALIDATION.md

> **Repository split (2026-10-04, ADR-0027).** This file predates the split of the monorepo into `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` and `saulpatinojr/HCW-AzMigrateOrchestrator_App`. This repository (`saulpatinojr/HCW-AzMigrateOrchestrator_App`, the upstream product, ADR-0028) holds the shared core, rules, CLI, the explorer UI components and the Azure appliance; the lab API and lab web harness live downstream in `saulpatinojr/HCW-AzMigrateOrchestrator_Addon`. Entries below describe the monorepo as it was; paths that moved to the sibling repository are noted there.

Build date: 2026-10-03 · Environment: Ubuntu container, Node 22.22, npm 10.9, zip, python3. **Not available:** terraform, pwsh,
docker, network access to Azure/GitHub/Microsoft Learn. Everything below distinguishes what was executed from what was not.

## Executed and passing

| Check | Command | Result |
|---|---|---|
| TypeScript build (20 projects) | `npm run build` | clean |
| Unit/integration/golden/security/contract tests | `npm run test:only` | **51 passed, 0 failed** (count after this file and `repository.manifest.json` exist) |
| Rule corpus | `node apps/cli/dist/main.js rules validate` | 34 rules, 0 issues/duplicates/conflicts/stale; snapshot `1.0.34` matches `rules/snapshots/current.json` |
| CLI end-to-end (region relocation) | `amo assess … --region westus3 --zip` | 29 resources: 7 native-move, 2 orchestrated, 11 recreate-and-migrate, 6 recreate-only, 2 retain, 1 unknown; 0 safety findings; 44-file bundle + zip |
| CLI end-to-end (cross-tenant) | `amo assess … --cross-tenant` | 16 recreate-and-migrate, 12 recreate-only, 1 unknown |
| Demo API smoke | `node apps/lab-api/dist/server.js` + curl | `/api/health` ok, `/` 200, `/api/sample.csv` 200; lifecycle, isolation, 400/413/422/403 paths covered by `api.test.ts` |
| Golden files | `npm run goldens:update` then golden test | deterministic (fixed clock, IDs normalised) |
| Repository ZIP | `bash scripts/package-repository.sh` | created and listed; excluded-path leak check passed (see bottom) |

## Implemented with documented limitations

- **Enterprise edition:** authorization levels, approval gate, app-role mapping, provider interface and fail-closed API exist. **Not implemented:** Entra token validation (JWKS/PKCE flow), Azure Resource Graph adapter, service-API enrichment, Lighthouse, controlled execution, PostgreSQL repository, `apps/enterprise-web`, `apps/worker`. Mocks are never presented as production behaviour (`AzureResourceGraphDiscoveryProvider.discover` throws).
- **Coder lab:** provider abstraction with tests; template authored; **not validated** against a live Coder deployment; workspace image `amo-lab-workspace` not yet built/published.
- **Rules:** 34 rules cover the 24 required types + 10 extras. Microsoft Learn URLs and support statements were authored from documentation knowledge on 2026-10-03 and **not fetched live** here; several support states are marked `conditional` where the matrix has caveats. Required before publication: open every `documentationSources[].url`, confirm each `support` state against the current move-support matrix, and bump `reviewDate`.
- **Terraform generation:** modular scaffolding for 16 resource types; import blocks and drift detection deliberately deferred (ADR-0012). Generated output was **not** run through `terraform validate` here (binary absent); `iac-validate.yml` covers the repository's own Terraform in CI.
- **Infrastructure:** `Dockerfile.demo`, compose files, Caddyfile, VPS Terraform and cloud-init were **not** built or applied (no docker/terraform). Base images are now pinned by digest (ticket #49) and GitHub Actions by commit SHA (superseding this note, which dates from the first build).
- **PowerShell:** `scripts/package-repository.ps1` and generated `.ps1` scaffolding were not executed (no pwsh). Bash equivalents were executed.
- **Demo UX:** 27 of 29 §18 items present; "Open in Coder" and the guided lab appear only when a workspace provider is configured.
- **Observability:** structured redacted logging implemented; OpenTelemetry exporter not wired (ADR-0014).

## Sprint 1 additions (2026-10-03)

- **Executed:** 63 tests pass including `packages/ui` server-render tests, lab-api CORS/Turnstile tests (siteverify mocked), edition-boundary tests. Build clean with the new React/Radix dependencies.
- **Not executed:** Playwright e2e for the explorer (no browser here; spec in `docs/website-integration/integration-guide.md` §6); `terraform init/validate` for `lab-hostinger` and `lab-cloudflare` (no terraform binary — CI matrix covers both; **the Hostinger provider source and resource names are marked [VERIFY] and `init` is the safety net**); `publish-lab-image.yml` (needs GitHub); Turnstile against the real siteverify endpoint; Cloudflare Tunnel end to end.
- Dependencies added: `react`, `react-dom`, `@radix-ui/react-dialog`, `@radix-ui/react-tabs` (UI package only; lab-api remains zero-dependency).

## Sprint 2 additions (2026-10-03)

- **Executed:** 70 tests pass (state-impact ID derivation and classification, HCP output invariants, manifest/schema check with file and MCP sources, Learn parser/diff on fixtures and the live corpus); `refresh-rules-from-learn.mjs --from <fixture>` runs offline end to end.
- **Not executed (no terraform/network here):** `terraform validate` of generated bundles and the real-schema argument check — now a CI job (`generated-terraform`) so they run on every push; live fetch of the Learn tables (source path **[VERIFY]**); `rules-refresh.yml` PR creation; Terraform MCP adapter against a live server.
- Generated HCL formatting is normalized by `terraform fmt` in CI before validation rather than asserted byte-exact.

## Sprint 3 additions (2026-10-03)

- **Executed:** 84 tests pass — JWKS validation with a generated RSA key (tamper, tenant, audience, expiry, unknown kid), credential flows against fakes, Resource Graph paging and 403 handling, `validateMoveResources` 202→409/204, Resource Mover gating per role/approval, appliance API end to end (401 fail-closed, discovery → assessment → validate-move evidence → ownership isolation → approvals → execution → audit), PostgreSQL repository SQL against a fake client, lab boundary extended to `azure-auth`/`azure-execution`.
- **Not executed (no Azure/network/terraform here):** anything against a real tenant — JWKS fetch, Resource Graph, ARM validation, Resource Mover ([VERIFY] 2023-08-01 request shapes), PostgreSQL connectivity (the Entra token-as-password provider for `pg` is not wired; `DATABASE_URL` currently expects local trust auth or a token-bearing URL), `appliance-azure` Terraform (`iac-validate.yml` covers fmt/init/validate), `Dockerfile.appliance` build.
- New runtime dependency: `pg` (appliance only). Lab remains zero-dependency.

## Sprint 4 additions (2026-10-03)

- **Executed:** 85 tests — workspace endpoint hidden when disabled (404), in-memory provider lifecycle through the API, one-time bundle token (works once, then 404; never grants the assessment itself).
- **Not executed:** Coder workspace creation against a live deployment, workspace image build, `coder templates push`.

## Sprint 5 additions (2026-10-03)

- **Executed:** 86 tests; `scripts/build-sea.sh` built `dist-sea/amo` (120 MB) here and it ran `rules validate`, `rules coverage` and a full `assess` from `/tmp` with embedded rules; coverage endpoint and telemetry (opt-in, identifier-free) tested; overlay change caught by the checksum gate, change report reviewed, snapshot 1.0.35, goldens regenerated.
- **Not executed:** macOS/Windows SEA builds (CI matrix), release publishing, provenance attestation of the binaries.
- Dev dependencies added: `esbuild`, `postject` (build-time only).

## Sprint 6 additions (2026-10-03)

- **Executed:** 88 tests — scope inventory delegation flag and relationship derivation, appliance API `/api/scopes` and automatic cross-tenant intent (fixture + fake ARG), `pg` Entra password provider wiring (injected pool factory), refusal of password URLs and missing credentials. `apps/appliance-web` type-checks and builds with Vite (output 1 chunk > 500 kB: MSAL; chunking is a follow-up).
- **Not executed:** MSAL sign-in and token acquisition in a browser, Lighthouse projection on a real managing tenant, PostgreSQL token login against Azure Database for PostgreSQL.
- New runtime dependencies (appliance-web only): `@azure/msal-browser`, `vite`, `@vitejs/plugin-react` (build). Tailwind via play CDN pending a compiled build.

## Sprint 7 additions (2026-10-03)

- **Executed:** 92 tests — operation polling status mapping and retry-after, worker `runOnce` (due/not-due, completion audit), API operation recording and listing, PostgreSQL operations SQL; `apps/appliance-web` and `apps/ui-harness` build with compiled Tailwind (15 kB CSS incl. `packages/ui` classes).
- **Not executed:** Playwright e2e — the sandbox cannot download browsers (`playwright install` blocked); the spec and CI job are in place and run on GitHub-hosted runners. Worker against real Azure operation URLs.
- Dev dependencies added: `@playwright/test`, `tailwindcss`, `@tailwindcss/vite`.

## Phase 1 additions (2026-10-04)

- **Environment:** Windows 11, Node 26.5, npm 11.17 (CI targets Node 22 — this run is not evidence for Node 22). No terraform, docker, pwsh or Azure access used.
- **Executed:** `npm ci`; `npm test` — 94 tests pass (92 + 2 new contracts tests); `npm run rules:validate` — 35 rules, snapshot 1.0.35, checksum matches. Content audit of the 359 files Git would add: no GUIDs outside obviously synthetic test values, no secret-shaped strings outside detector regexes, no `/subscriptions/<real id>`, no stray state/plan/env/zip files; emails present are documentation addresses (`security@`, `conduct@`, `ops@migrate-demo`) and fake PostgreSQL user@host examples.
- **Not executed:** `publish-images.yml` after the matrix fix (needs GitHub Actions); Playwright e2e; anything against the two new GitHub repositories — nothing has been pushed to `_App` or `_Addon`.
- **Limitation:** the audit above is grep-based. Run gitleaks (already in `security.yml`) on each repository's first commit before pushing; both repositories are public.

## Repository split verification (2026-10-04)

- **Environment:** Windows 11, Node 26.5, npm 11.17, Terraform CLI, PowerShell 7.6 (CI targets Node 22 — not evidence for Node 22). No Docker build, no Azure access.
- **Executed:** tree generated from the monorepo by copy; `npm install` (new lockfile) then `npm ci` clean; `npm test` — **74 pass, 0 fail** (edition-boundary rewritten for the split); `npm run rules:validate` — 35 rules, snapshot 1.0.35, checksum matches; `terraform fmt -check -recursive infrastructure` clean; Coder template `terraform init -backend=false && terraform validate` passes (coder 2.19.0, docker 3.9.0 providers); `scripts/package-repository.ps1` — 316 files, `.env.example` included, no `.git/`, `node_modules/`, `dist/` or `.env` leak.
- **Not executed:** `terraform init/validate` for `lab-hostinger` and `lab-cloudflare` (CI `iac-validate`); Playwright e2e; `publish-images.yml`, `release-cli.yml`; `scripts/package-repository.sh` (no `zip` on this machine); anything against GitHub — this tree has no commits and no remote.
- **GitHub Actions after the first push (2026-10-04):** `ci` jobs `build-test` and `e2e` green at `5ae2051`; `generated-terraform` was red until the generator fixes in this commit (locally: generated bundles for `--region westus3` and `--cross-tenant` pass `terraform init -backend=false` and `validate`, root and hcp). `security` green. `publish-images` and `release-cli` failed on the `v0.1.0` tag (non-existent `trivy-action@0.29.0`; invalid `release-cli.yml`) — both fixed on `main`; no release artifacts exist for `v0.1.0`. `coder-template` fails without `CODER_URL`/`CODER_SESSION_TOKEN` secrets, by design until the lab environment exists.
- **Release `v0.1.3` (2026-10-04, `df4d820`):** `publish-images` green — scan passed before push; lab image `ghcr.io/saulpatinojr/azure-migration-orchestrator-lab@sha256:e5aa04aa524e35811ebcc565348f80c72207f1a80de81679eb3ddd73b3e24c47` with provenance attestation and SBOM. `release-cli` green on all three runners — `amo-linux-x64`, `amo-darwin-arm64`, `amo-windows-x64.exe` + `SHA256SUMS-*.txt`, smoke-tested and attested. `_App` CI green at `ADDON_REF=v0.1.3`. Not done: the appliance image (publishes on an `_App` tag; none cut yet); the Coder workspace image (manual workflow); any deployment.
- **Release workflows at `v0.1.2` (2026-10-04):** `release-cli` green on all three OS runners; release assets: `amo-linux-x64`, `amo-darwin-arm64`, `amo-windows-x64.exe` plus `SHA256SUMS-*.txt`, each smoke-tested (`rules validate` + sample `assess`) and attested. `publish-images` **blocked before push** by the scan gate (libpcre2-8-0 CVE-2026-103111, fixed in deb12u2) — the gate works; no lab image was published for `v0.1.2`. Fix: `apt-get upgrade` in the runtime stage. **Executed locally:** rebuilt lab image has `libpcre2-8-0 10.42-1+deb12u2`; `aquasec/trivy` (container) with `--severity HIGH,CRITICAL --ignore-unfixed` exits 0.
- **Release workflows at `v0.1.1` (2026-10-04):** `publish-images` built and pushed the lab image, then the Trivy scan failed on npm's vendored `sigstore` (CVE-2026-48815) in the Node base image — so a `v0.1.1` lab image exists in GHCR that did not pass the scan; do not deploy it. `release-cli` failed its smoke test because `./dist-sea/amo*` expanded to the binary plus build intermediates. Both fixed on `main` (`705c7cd`). **Executed locally (Windows, Docker Desktop 29.8):** `docker build` of `Dockerfile.lab` → health 200, no `npm`; `docker build` of the appliance `Dockerfile` from the two-tree context → core import resolves, rules present, API starts; `scripts/build-sea.sh` → `dist-sea/amo-windows-x64.exe` (99 MB) passes `rules validate` and a sample `assess`. **Not executed:** Trivy locally (CI runs it before pushing); Linux/macOS SEA builds (CI matrix); the workspace image.
- **Limitation:** `_App` pins `ADDON_REF` to a release tag of this repository (`v0.1.2` once cut); its CI is green against the sibling checkout.
## Flip to the upstream product (2026-10-04, ADR-0028)

- **Environment:** Windows 11, Node 26.5, npm 11.17, Docker Desktop 29.8, Terraform CLI, PowerShell 7.6 (CI targets Node 22 — not evidence for Node 22).
- **Executed:** tree rebuilt from the two post-split repositories; `npm install` (new lockfile); `npm test` — **88 pass, 0 fail** (includes `tests/packaging` and the rewritten `appliance-boundary`); `npm run rules:validate` — 35 rules, snapshot 1.0.35; `npm run web:build` — chunk hashes identical to the pre-flip build; `npm run packages:verify` — both packages packed, installed from tarballs into an empty project, assessment of the sample ran with rules resolved from inside `node_modules/@hybridcloudworks/migration-core/rules`, UI import ok, strict consumer type-checks; `docker build` of `Dockerfile.appliance` → core import resolves, 14 rule files, API starts, no `npm`, containerised Trivy (HIGH/CRITICAL, fixed only) exit 0; `terraform fmt -check` clean; PowerShell packaging 314 files, no leak; all 8 workflow files parse and every action is SHA-pinned.
- **Not executed:** anything against npmjs.com (names unpublished; scope ownership unverified anonymously; `publish-npm.yml` is gated and will be skipped until the owner bootstrap); GitHub Actions on the flipped head (pushed after this section was written — see the run links in the PR/commit); Playwright (lives in `_Addon`); live Azure.
- **Limitation:** the published packages are ESM-only with Node16 resolution; CommonJS consumers are not supported. ~~Appliance start-up does not refuse to run without Entra configuration~~ — **closed 2026-10-24 (ticket #51):** in production mode (`NODE_ENV=production`, set by the image) a missing or empty `AMO_ENTRA_TENANT_ID` or `AMO_ENTRA_CLIENT_ID` makes the API exit 1 with a message naming the missing variable. Outside production mode it still starts unconfigured and routes still fail closed; the `appliance-image` CI job now checks both the refusal and a start with placeholder IDs.

## Node 26 runtime floor (2026-10-04, ADR-0029)

- **Executed (Windows 11, Node 26.5, npm 11.17, Docker Desktop 29.8):** `npm install` with `@types/node ^26.6.4`; `npm test` — 88 pass; `npm run packages:verify` passes and the published packages declare `engines.node >=26`; `docker build` of `Dockerfile.appliance` on `node:26-bookworm-slim` → Node 26 at runtime, core import ok, API starts, containerised Trivy (HIGH/CRITICAL, fixed only) exit 0; `scripts/build-sea.sh` with `--target=node26` → Windows executable passes `rules validate`; all workflows parse with `setup-node 26`.
- **Not executed locally:** GitHub-hosted runners on Node 26 (first exercised by the CI run of the Node 26 commit and by the `v0.2.1` release workflows — see their run links in the plan); Linux/macOS CLI builds (release matrix); the devcontainer image pull.
- **Note:** earlier sections that say "CI targets Node 22" describe runs before this change.

## Questionnaire focus, region picker and portal-link resource ids (2026-10-11, v0.3.1)

- **Executed (Linux, Node 26.11, npm 10.9):** `npm test` — 110 pass (the previous 104 plus two `csv-ingestion` tests for the RESOURCE LINK derivation and `resourceIdFromPortalLink`, and four `ui` tests for quoted-cell preview, `csvColumnValues`, `regionId`/`AZURE_REGIONS` and the questionnaire's rendered options); `npm run rules:validate` (35 rules, snapshot 1.0.35 unchanged); `npm run packages:verify` (public surface changed: the packed `migration-ui` exports `QuestionnaireFormProps`, `OTHER_REGION`, `AZURE_REGIONS`, `regionId`, `csvColumnValues`, `splitCsvLine`; the strict consumer type-checks and runs); `npm run web:build`. A 56-row portal "All resources" export (six columns, no RESOURCE ID) run through `ingestResourcesCsv` locally: 56 resources, 56 with a derived resource id, 22 canonical types, no errors; the export itself is not a fixture (it names real subscriptions) and is not committed.
- **Not executed here:** the focus behaviour itself. `renderToStaticMarkup` runs no reconciliation, so the test suite cannot observe a remount; the fix is structural (module-level field components) and is verified by typing more than one character into any questionnaire field in the downstream pane (`_Addon/tests/e2e` journey spec types a region).
- **Limitation:** `AZURE_REGIONS` is a snapshot of the public regions on 2026-10-11 `[VERIFY]`; a region launched later is entered through "Other".

## Pane-ready explorer and AddOn health contract (2026-10-10, ADR-0030, v0.3.0)

- **Executed (Linux, Node 26.11, npm 10.9):** `npm ci`; `npm test` — 104 pass (the previous 88 plus nine new `ui` tests and seven new `contracts` tests); `npm run rules:validate` (35 rules, snapshot 1.0.35 unchanged); `npm run packages:verify` (public surface changed: the packed `migration-ui` declarations carry the new optional props, `Stage`, `ResultsStage`, `EnterpriseCta` and `MigrationAddOnHealth`; the packed `migration-core/contracts` declarations carry `AddOnHealth`, `isAddOnHealth` and `AddOnPaneMessage`; the strict consumer type-checks and runs); `npm run web:build` (`apps/appliance-web` compiles with the unchanged `PoweredBy` and the new optional props); `grep -c "migration-api.lab" dist-packages/migration-ui/README.md` prints 0.
- **Not executed here:** the stage callback sequence and the CTA click path. `renderToStaticMarkup` runs no effects and no event handlers, so `ui.test.tsx` asserts markup only (no callback during server rendering; `<button>` versus `<a>`). The sequence `loading, ready, working, ready` and the `navigate` message are observed by the downstream e2e (`_Addon/tests/e2e`, host page with the production sandbox).
- **Limitation:** `LabApiClient.health()`'s type describes AddOn `v0.3.0` and later; against an older lab API the new fields are absent at runtime and the explorer reads only `workspace`.

## Repository protection, appliance-image CI and the Terraform digest rule (2026-10-24)

- **Executed (Linux, Node 26.12.1, npm 10.9.4):** `npm ci`; `npm test`: 110 pass; `npm run rules:validate`: 35 rules, snapshot 1.0.35, checksum `f5794584ade134f86ae39722a520f01bb1fb648a7767e0c7d23a960e32ed888f`. Between the `v0.3.1` tag and `main`, `git diff` over `packages/` and `rules/` shows two things: the rule corpus that ships in `migration-core` (`rules/azure`, `organization`, `schemas`, `snapshots`) and every `packages/*/src` file are unchanged, and only `packages/ui/package.json` differs (dependency ranges: `@radix-ui/react-dialog` ^1.3.1, `@radix-ui/react-tabs` ^1.2.1, `react-dom` peer ^19.3.1). The next release therefore carries a different `migration-ui` manifest and the same code.
- **Executed (GitHub-hosted CI, pull request #61 head `2464ef5`):** all nine checks green, including the first run of the new `appliance-image` job (build without push, hadolint, Trivy HIGH/CRITICAL fixed-only, start with no secrets and read `/api/health`) and `generated-terraform`.
- **Executed (integrity check):** the `v0.3.1` release assets `hybridcloudworks-migration-core-0.3.1.tgz` and `hybridcloudworks-migration-ui-0.3.1.tgz` were downloaded and their SHA-512 digests equal the `integrity` values in the downstream edition's `package-lock.json`.
- **Not demonstrated:** a pull request whose `appliance-image` job fails being blocked from merging. The check is required (`repository-admin.yml` task `protect-main`, applied 2026-10-24), but no deliberately failing pull request has been opened to prove the block.
- **Not executed here:** a Docker build on this machine (no Docker daemon; CI builds the image), and `terraform plan` against Azure. The `image_ref` validation (exact `@sha256:` plus 64 hexadecimal characters) has not been exercised in a real deployment because no appliance image digest exists for `v0.3.0` or `v0.3.1`: the `publish-images` job was skipped, not failed, for both because `DOCKERHUB_ENABLED` is not set (ticket #42).
- **Limitation, recorded:** the `v0.3.1` tag was moved once before the release was published (the run history shows `publish-images` at the `v0.3.0` commit, then at the final commit). The published assets match the downstream pins; the tag rulesets applied on 2026-10-24 prevent a repeat.

## Tickets #43, #49, #50, #51 and two new consistency tests (2026-10-24)

- **Executed (Linux, Node 26.12.1):** `npm ci`; `npm test`: 125 pass, 0 fail; `npm run rules:validate`: 35 rules, snapshot 1.0.35, checksum unchanged (`f5794584...ed888f`); `npm run packages:verify`: passed. `actionlint` 1.7.7 on `ci.yml`: clean. The new startup refusals were also run by hand: `NODE_ENV=production node apps/appliance-api/dist/server.js` with no settings exits 1 with the message; with placeholder all-zero tenant and client IDs it starts and listens.
- **Executed (digests):** the multi-platform index digests for `node:26-bookworm-slim` and `postgres:16-alpine` were read anonymously from Docker Hub on 2026-10-24.
- **Not executed:** a Docker build or run of the appliance image (no Docker daemon here; the `appliance-image` CI job builds it, and its changed start-up steps have not run yet), `terraform fmt`/`validate` (Terraform is not installed here; no Terraform file changed in this change set), and anything against a real tenant.
- **Limitation, recorded:** the production start-up check looks only at `AMO_ENTRA_TENANT_ID` and `AMO_ENTRA_CLIENT_ID` being non-empty; it does not contact Entra to prove they are right. "Production" means `NODE_ENV=production`; a deployment that clears that variable gets the old behaviour (starts, routes answer 401). The worker is not covered by the Entra check (it already exits 2 without a tenant).

## Node 26 enforcement, scanners, issue forms and doc lint (2026-10-24)

- **Executed (Linux, Node 26.12.1 from the npm `node` package, npm 10.9.4):** `npm ci`; `npm test`: 110 pass, 0 fail; `npm run rules:validate`: 35 rules, snapshot 1.0.35; `npm run packages:verify`: passed.
- **Executed (Node 22.22.0):** `npm ci --dry-run` with the new `.npmrc` stops with `EBADENGINE ... Required: {"node":">=26"}` (ticket #55).
- **Executed:** `actionlint` 1.7.7 on every file in `.github/workflows`: no findings. The two issue forms parse as YAML and use only labels that exist (`bug`, `enhancement`). Action pins were read from the upstream tags with `git ls-remote` (`ossf/scorecard-action` v2.4.4, `google/osv-scanner-action` v2.7.0).
- **Not executed:** the new `scanners.yml` jobs and the CodeQL `actions` language have never run; their first result is the pull request that adds them. The issue forms have not been seen in GitHub's "New issue" chooser. No Docker or hadolint here.
- **Limitation, recorded:** `markdownlint-cli2` with `.markdownlint.jsonc` (MD013, MD033, MD034, MD041, MD060 off; `samples/` ignored) still reports 81 findings, mostly MD022 and MD032 in older ADRs and `REFACTOR_APP.md`. Nothing in CI runs markdownlint. The scanners are report-only and are not required checks; OpenSSF Scorecard does not run on pull requests, and its results are not published to the public Scorecard service.

## Entra `nbf` check, ticket #46 (2026-10-24)

Ran on Node 26.12.1: `npm ci`, `npm test` (126 passed, 0 failed, including the new `nbf` test and the appliance API tests), `npm run rules:validate` and `npm run packages:verify`. Not run: Docker, Terraform, a live Entra sign-in. The role / assignment-required half of #46 was implemented afterwards (ADR-0031, section below).

## App role required and subnet firewalls, tickets #46 and #53 (2026-10-25, ADR-0031, ADR-0032)

Ran on Windows 11 with Node 26.5.0, Terraform 1.16.6 (local), Terraform 1.9.8 and Trivy 0.76.1 (pinned containers), Docker Desktop (`desktop-linux`):

- `npm ci`, `npm run build`, `npm run test:only` (167 passed, 0 failed, including 7 new API tests (the `Migration.Read` route matrix, the refuse-before-parsing test and the table tests among them), 15 static Terraform and role tests and 3 web sign-in message tests), `npm run rules:validate` (35 rules), `npm run packages:verify`, `npm run web:build` (includes the web typecheck). On Windows the golden-file test fails on a stock checkout because Git rewrites `samples/` to CRLF line endings; the run above used LF copies of those files (the committed content), as CI does.
- `bash scripts/ci/local-iac-checks.sh all`: `terraform fmt -check`, `init -backend=false -lockfile=readonly`, `validate`, `terraform test` (26 plan-only runs, mocked providers, including the `Migration.Read` role with its stable id, the workload-profile block, the `snet-aca` size, delegation and address plan, the `vnet_cidr` limits and the ingress IP restrictions) with Terraform 1.9.8, and `trivy config` at HIGH,CRITICAL (0 findings, with the one documented suppression, which still applies after the ingress rule moved the `Internet` tag to the singular `source_address_prefix`). At all severities Trivy still reports 3 MEDIUM findings on the PostgreSQL server parameters (`AVD-AZU-0019`, `-0021`, `-0024`); they were there before and are not part of these tickets.
- Owner decision (2026-10-25, HCW-HybridCloudWorks issue 1373 row C3): `Migration.Read` was added as the lowest role together with Entra assignment-required, reversing the deferral in the first draft of ADR-0031. Not verified: that a real access token carries `Migration.Read` in `roles`, like the other roles.
- Mutations checked for the environment decision (each fails a `terraform test` run and, where it applies, the static test, then was restored): removing the `workload_profile` block; removing the `snet-aca` delegation; making `snet-aca` a /28; making the reserved-range precondition always true; never emitting the ingress IP restrictions; relaxing the `vnet_cidr` limit to /30; removing `workload_profile_name` from the worker.
- Mutations checked in the previous round: making the plan-time precondition always true fails the default-stop run; restoring the old Destructive description ("commit cutovers") fails the description test; removing the validation entry from the route table fails four tests; bypassing every level check with the approvals pre-recorded makes the `Migration.Read` initiateMove and commit rows come back 202 instead of 403 (so they no longer pass for the wrong reason); mapping `Migration.Read` to `controlled-execution` fails four API tests.
- Mutations checked earlier: mapping `Migration.Read` to `planning` fails three API tests (the route matrix among them); removing it from the API role table fails three; removing it from the Terraform role map fails two `terraform test` runs and the static role test; making `principalFromClaims` default to `discovery` fails two API tests; setting `app_role_assignment_required = false` or moving the deny rule from priority 4096 fails three Terraform test runs.

**Container Apps environment (issue 82, owner decision 2026-10-25).** The environment is now a workload-profile environment (one `Consumption` profile; `snet-aca` is a /26, delegated to `Microsoft.App/environments`, which meets Learn's /27 minimum for that type; `vnet_cidr` is limited to /8 to /23 and must not overlap the ranges Learn lists as reserved). The plan-time stop was removed. Checked by `terraform test` with mocked providers and by static tests only: **never applied**. A sandbox apply is pending and is what must show that the environment starts, the database is reachable from it and the API answers over 443.

**Role checks.** Every route's minimum level now comes from one table (`apps/appliance-api/src/route-levels.ts`) checked before any body is read or the repository is touched; refusals name no level (tested on every refused row for `Migration.Read`, for `Migration.Plan` on execution routes and for a caller with no role). Markdownlint (`markdownlint-cli2` 0.24.0 with the repository config) on the files changed here: the only 3 findings are on lines that were already in `CHANGELOG.md` and `VALIDATION.md`; the README, the deployment guide and both new ADRs are clean.

**Provisional, not validated: the Container Apps (`aca`) network security group.** Learn ([Network security groups](https://learn.microsoft.com/en-us/azure/container-apps/firewall-integration)) says that for an external workload-profile environment inbound traffic goes through a public IP in the managed resource group and not through the subnet, that inbound subnet rules apply only to traffic that goes through the virtual network, and that locking down inbound traffic with an NSG is not supported. So this group does not limit who reaches the API from the internet; that is done by the IP restrictions on the API ingress (`ingress_allowed_source_prefixes`) and by the token and role check. The earlier claim that port 80 is closed is withdrawn. Unverified: how the group behaves on the subnet at all, that the environment starts under it, the omitted ports 80 and 31080, and the subnet-to-subnet rule read as needed inbound. Region support and quotas for workload profiles were not checked.

**Not run, not verified:** `terraform plan` or `apply` against any subscription or tenant; that the Container Apps environment and the PostgreSQL server start under the new network security groups; that the environment is accepted by Azure in the chosen region with the available quota, that the `snet-aca` firewall lets it start, that Entra refuses to issue a token to an unassigned user or application, and that the web page shows the right message for a real `AADSTS50105` redirect (only the message mapping is unit-tested); that a real access token carries the `roles` claim; checkov (the ticket's scanner; the image was not pulled), and which resource `CKV2_AZURE_57` names; the version of Trivy that `aquasecurity/trivy-action` uses in CI (CI passed on the first push with the inline suppression). Ticket #53 is only partly done on scanning: no checkov, and the baseline is prose in ADR-0032, not a file a CI step compares against.

## Not implemented

Execution beyond Resource Mover; Bicep/ARM mainTemplate for Marketplace; PDF/HTML reports; rate limiting and concurrency bounds (delivered downstream in `_Addon/apps/lab-api`, ADR-0030); persistence of enterprise assessments; cost/capacity live checks (agent defined, returns unknown without authenticated APIs).

## How to complete runtime validation

These are the checks that still need a machine with Docker, Terraform or an Azure sign-in. Run them from a clean clone.

1. Build the appliance image: `docker build -f infrastructure/docker/Dockerfile.appliance -t amo-appliance:dev .` (the pull request build and scan job tracks this, ticket #45).
2. Terraform: `terraform -chdir=infrastructure/terraform/appliance-azure fmt -check`, then `terraform -chdir=infrastructure/terraform/appliance-azure init -backend=false`, then `terraform -chdir=infrastructure/terraform/appliance-azure validate`. Run `terraform validate` on a generated bundle's `terraform/` directory as well.
3. Packaging: `pwsh -File scripts/package-repository.ps1` (or `bash scripts/package-repository.sh`); `pwsh -Command "Invoke-ScriptAnalyzer <bundle>/scripts/powershell/Invoke-ArmMove.ps1"` on a generated bundle.
4. Rules: verify every rule URL and support state, then `npm run rules:validate`, `amo rules report` and `amo rules snapshot`.
5. Repository settings: actions are pinned by commit and the main branch and release tags are protected (rulesets created 2026-10-24 by the `repository-admin` workflow); base images are pinned by digest (ticket #49, 2026-10-24).
6. Seed the GitHub Copilot review handshake PRs listed in `docs/governance/github-copilot-code-reviewer-pack-VALIDATION_REPORT.md`.

The lab web, Playwright end-to-end and Coder template checks that used to be listed here belong to `saulpatinojr/HCW-AzMigrateOrchestrator_Addon`.

## Archive

`azure-migration-orchestrator.zip` — see the final section of the build log and `scripts/package-repository.sh`; files sit at the archive root; `.git`, `node_modules`, `dist`, `.local`, `.env`, state and caches excluded.
