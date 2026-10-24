# Working plan: public migration project, website integration, and Azure appliance

Status: Phase 1 largely done, Phase 2 in progress.  
Created: 2026-10-03. Updated: 2026-10-04 (ADR-0027 split; ADR-0028 flip — this repository is the upstream product). Updated: 2026-10-10 (ADR-0030, pane model).  
Owner: HybridCloudWorks.  
Update this checklist as work is verified. Move completed-work summaries to `CHANGELOG.md`, record limitations in `VALIDATION.md`, and link open work to GitHub issues once the repository is published.

## Objective and agreed decisions

Publish this project as two public repositories (ADR-0027) that together support an explorer embedded in the existing HybridCloudWorks website and an independently deployable Azure appliance. Treat the first release as a read-only project/reference implementation with documented limitations.

The owner selected:

- Two repositories (2026-10-04, ADR-0027 then ADR-0028): `saulpatinojr/HCW-MigrateOrchestrator_App` is the **upstream product** — the appliance plus the engine, rules, CLI and UI components it is built on, freestanding; `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` is the **downstream slim web-front edition** (CSV lab API, site integration), also freestanding, consuming the upstream's published packages. Updates flow downstream when the edition's own tests pass against a new upstream release.
- Reuse the existing Hostinger VPS for the public lab API.
- Start the Azure appliance with authenticated read-only assessment.
- Keep appliance assessments session-only; no durable database initially.
- Target $25–$75 in incremental monthly hosting spend.

The existing website is https://hybridcloudworks.com and its repository is https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.

## Hosting and ownership

| Component | Home | Source of truth |
| --- | --- | --- |
| Engine packages, rules, CLI, UI components, appliance API/web/worker, `azure-*` packages, appliance Terraform, canonical ADRs, this plan | Public `saulpatinojr/HCW-MigrateOrchestrator_App` (upstream) | `_App` repository |
| Lab API, lab web harness, browser e2e, lab Terraform, Coder template, partner and website-integration docs | Public `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` (downstream) | `_Addon` repository |
| Website page `/tools/migration` framing the downstream pane | Existing Azure Static Web Apps website | Website repository |
| CSV lab API | Existing Hostinger VPS, behind host-native Caddy | Lab image from `_Addon` (built on the published core); host configuration in website repository |
| Authenticated appliance UI and API | One Azure Container App, same origin | `_App` repository |
| Lab image | Docker Hub `docker.io/hybridcloudworks/hcw-addon-migration`, by digest | Versioned releases from `_Addon` |
| Appliance image | Docker Hub `docker.io/hybridcloudworks/hcw-app-migration-appliance`, by digest, through the Docker OIDC connection | Versioned releases from `_App` |
| Reusable core and explorer packages | Public npm registry, `@hybridcloudworks/migration-core` and `@hybridcloudworks/migration-ui` (trusted publishing) | `_App` repository |
| CLI downloads | GitHub Releases | `_App` repository |
| Appliance infrastructure state | Dedicated HCP Terraform workspace | `_App` repository's project Terraform root |
| Existing VPS, wildcard lab DNS, host configuration | Existing HCP Terraform and Ansible configuration | Website repository |

Keep the website separate from both repositories. `_Addon` consumes `_App` only through exact pinned package versions (interim: the `_App` release pinned as `APP_REF`, never `main`). Do not copy the migration codebase into the website, install either repository from `main`, or use a submodule as the release mechanism. `_App` releases first; `_Addon` adopts a release when its `core-update` workflow proves compatibility (ADR-0028).

The website's documented Hostinger setup uses Ansible, Docker, Caddy, and Coder. Follow that model. Do not apply this project's standalone VPS or Cloudflare Tunnel templates to that existing host. Terraform must have one owner for each resource.

## Phase 1 — Prepare the initial public repositories

- [x] **Flip (ADR-0028, 2026-10-04):** `_App` is the upstream product (engine, rules, CLI, UI components, appliance) and publishes the packages; `_Addon` is the downstream web-front edition consuming them. `_Addon` tags `v0.1.0`–`v0.1.3` are historical; `_App` releases start at `v0.2.0`. Downstream flow: `_Addon/.github/workflows/core-update.yml`.
- [x] Decide the repository split and record it: `_App` = appliance, `_Addon` = lab + UI package + shared core (ADR-0027, 2026-10-04).
- [x] Partition the local workspace into the two repositories per the ADR-0027 table (2026-10-04): sibling directories `HCW-AzMigrateOrchestrator_Addon` and `HCW-AzMigrateOrchestrator_App`, each with its own `package.json` workspaces, lockfile, `tsconfig.build.json`, CI, CODEOWNERS, Dependabot, CodeQL, `repository.manifest.json` and packaging scripts. `azure-discovery` was reduced to the interface in `_Addon`; its Azure clients became `packages/azure-arm` in `_App`. `_App` consumes the core through `file:` links to the sibling checkout, which CI pins at `ADDON_REF=v0.1.0` (that tag does not exist yet, so `_App` CI stays red until `_Addon` is pushed and tagged).
- [x] Re-point the edition-boundary test (2026-10-04): `_Addon` forbids any dependency on `@amo/azure-auth`, `@amo/azure-arm`, `@amo/azure-execution` or `@azure/*` and checks the interface package has no Azure endpoint or auth import; `_App` has the mirror `appliance-boundary` test.
- [x] First commits pushed 2026-10-04: `_Addon` `6223f70` on `main`, tagged `v0.1.0`; `_App` `35075cb` on `main`. Grep-based secret scan was clean before the push; gitleaks runs in each repository's `security.yml` on the pushed head — confirm it is green. The `v0.1.0` tag triggered `publish-images.yml` and `release-cli.yml` in `_Addon`; both failed (non-existent `trivy-action@0.29.0`, invalid `release-cli.yml`), so **no image or CLI artifacts exist for `v0.1.0`**. Both workflows are fixed on `main` (`6f9a356`, CI green). `v0.1.1` was cut from `4581e58`; its release workflows ran but failed (Trivy flagged npm's vendored sigstore in the base image after the push; the CLI smoke test globbed intermediates). A `v0.1.1` lab image exists in GHCR that did not pass the scan — do not deploy it. Release workflows were then reordered to scan before pushing (`705c7cd`); `v0.1.2` produced the CLI release (three platforms, checksums, provenance) but the lab image was blocked by the scan gate on a Debian base-image CVE; the runtime stage now applies `apt-get upgrade`, and `v0.1.3` (`df4d820`) published the first scanned lab image: `ghcr.io/saulpatinojr/azure-migration-orchestrator-lab@sha256:e5aa04aa524e35811ebcc565348f80c72207f1a80de81679eb3ddd73b3e24c47`. `_App` pins `ADDON_REF=v0.1.3`; its CI is green.
- [ ] Inspect the full candidate Git contents and history for credentials, customer inventories, local output, sensitive configuration, and unrelated files. Most project files were untracked during the initial review; verify the actual staged contents before the first push to either public repository.
- [ ] Confirm the license, ownership metadata, security reporting route, and public project description for each repository. Both are under `saulpatinojr`; transfer to the `HybridCloudWorks` organization is a separate, undecided step.
- [ ] Reconcile README, architecture, edition, deployment, and validation documents with current code and the smaller first-release posture.
- [ ] Remove obsolete account/image references and distinguish local examples, supported deployment profiles, and experimental templates. Done 2026-10-04: `hcw-architect` → `saulpatinojr` in CODEOWNERS, compose, Coder, Terraform defaults and deployment docs; integration guide points at `@hybridcloudworks/migration-ui` / `_Addon`. Open: Terraform and compose image defaults still end in `:latest` (replace with digests at the Phase 2 release); profile labelling not yet done.
- [x] Fix the invalid lab Dockerfile entry in the image-release workflow (2026-10-04). GHCR namespace is `ghcr.io/saulpatinojr/...`, already lowercase; recheck if the owner changes.
- [x] Fix invalid Coder HCL (two single-line blocks used `;`); `terraform fmt -check` and `terraform validate` pass with the coder and docker providers (2026-10-04). Keep Coder integration disabled for the initial deployment; the template is still unvalidated against a live Coder deployment.
- [x] Correct runtime input validation: `applicationGroupTagKey` is no longer rejected by the credential-name filter; `apiKey`/`accountKey`/`accessKey`/`key` still are (tests added, 2026-10-04).
- [ ] Fix approval targeting and execution authorization defects in retained experimental code: use fully scoped collection targets; align UI/API target formats; authenticate mover requests; enforce execution levels in `addResources`; reconcile commit authorization with documentation. Define approval lifetime and reuse explicitly before any future execution release.
- [ ] Correct bundle manifest coverage, real type-check commands, Windows command compatibility, and rule-report path normalization. Done 2026-10-04: `scripts/package-repository.ps1` excluded every file (an exclude-array element was parsed as a bare `$` regex); fixed and verified in both repositories. Open: the rest.
- [ ] Resolve the root esbuild advisory through a reviewed dependency update; do not use a blanket forced audit fix.
- [x] Runtime floor decided and applied as one coordinated change (2026-10-04, ADR-0029): Node 26 in `engines`, `@types/node`, every `setup-node`, both container images, the devcontainer and the CLI bundle target — in both repositories. Open: provider and Terraform version review against the website's version-floor policy (Phase 5).
- [ ] Add CODEOWNERS, contribution/security guidance, issue and PR templates, Dependabot, CodeQL, secret scanning, and repository rules.
- [x] Pin Actions to full commit SHAs (2026-10-04, both repositories; versions in trailing comments; Dependabot `github-actions` ecosystem enabled and already proposing bumps). Open: review the Dependabot PRs against the version-floor policy; least-privilege job permissions are set per workflow.
- [ ] Require current-head checks and the review → fix → current-head verification cycle in `.github/setup/HANDSHAKE.md` before merge.
- [ ] Enable private vulnerability reporting. Fork PR validation must not receive deployment credentials or execute privileged release jobs.

## Phase 2 — Publish independently consumable artifacts

- [x] Package the core as `@hybridcloudworks/migration-core` and the UI as `@hybridcloudworks/migration-ui` from `_App` (2026-10-04: `scripts/assemble-packages.mjs`, `tests/packaging`, clean-consumer gate). Both names were unpublished on 2026-10-04; scope ownership must be settled by the owner (`docs/release/npm-publishing.md` step 1).
- [x] Bundle internal workspace implementation and TypeScript declarations; React/React DOM are peers; no `@amo/*` reference survives in the installed packages (asserted by `tests/packaging` and `scripts/verify-packed-consumer.mjs`).
- [ ] Preserve browser/prerender-safe imports and document required Tailwind source scanning.
- [x] Test the packed packages in a clean consumer project (`npm run packages:verify`; CI job `packed-consumer`): install from tarballs, run an assessment with rules resolved from inside the package, import the UI, type-check a strict consumer.
- [ ] Release tarballs (done 2026-10-11): `release-cli.yml` packs `dist-packages/migration-core` and `migration-ui` on every `v*` tag and attaches both tarballs to the GitHub Release with provenance; the downstream edition pins them by URL + integrity and adopts releases through `core-update`. npm publishing is optional from here on.
- [ ] Configure npm trusted publishing: `publish-npm.yml` is in place (OIDC, `--provenance`, no token) and gated on `NPM_TRUSTED_PUBLISHING=ready`. **Owner action:** the registry bootstrap in `docs/release/npm-publishing.md` (create the scope, first publish from a trusted machine, configure the trusted publisher, set the variable). Bootstrap prepared 2026-10-04 (dry runs clean at `v0.2.1`: core 103 files / 76.4 kB, ui 28 files / 14.2 kB) and **paused by the owner** pending the website repository review; resume at step 1 of the runbook.
- [ ] Publish the appliance image to Docker Hub (`publish-images.yml`, moved from GHCR on 2026-10-10 to match the AddOn images; owner steps in `docs/release/docker-hub.md`). It publishes on an `_App` tag once `DOCKERHUB_ENABLED` and `DOCKERHUB_CONNECTION` are set. Tags `v0.3.0` and `v0.3.1` were cut after the move and the job was skipped for both (checked in the run history on 2026-10-24), so no digest exists to deploy yet (ticket #42). The lab image moved to Docker Hub with the AddOn's pane release (`v0.3.0`); its earlier GHCR packages (`v0.1.3`) stay where they are.
- [x] Build, test, and scan release images before promoting a release; SBOM, provenance and digest recorded in the workflow summary (2026-10-04). The gate is proven: `v0.1.2` was blocked on a base-image CVE and nothing was pushed.
- [x] Publish versioned CLI release assets with checksums after platform-specific smoke checks — `v0.1.2` and `v0.1.3` releases carry `amo-linux-x64`, `amo-darwin-arm64`, `amo-windows-x64.exe` and `SHA256SUMS-*.txt`, each smoke-tested (`rules validate` + sample `assess`) and attested.
- [ ] Start at `v0.1.0`; pin the website to an exact UI version and deployments to corresponding immutable image digests. Never deploy `latest` or a moving branch as the artifact contract.
- [x] Pull requests build, lint, scan and start the appliance image (CI job `appliance-image`, ticket #45, 2026-10-24); the job is a required check on `main`.
- [x] Terraform refuses `latest`: `image_ref` in `infrastructure/terraform/appliance-azure` is required and must be an exact `@sha256:` digest (ticket #43). It cannot be used for a real deployment until the appliance image is published (ticket #42).
- [x] `main` and `v*` tags are protected by rulesets applied through `repository-admin.yml` (2026-10-24): `main` takes changes through pull requests with the six required checks, and a `v*` tag cannot be deleted, moved or re-pointed, so the release URLs and integrity hashes the AddOn pins stay valid. (Before this, `v0.3.1` had been moved once: its first `publish-images` run is at the `v0.3.0` commit, its second at the final one.)

## Phase 3: show the explorer on the website as a pane, hosted on the existing lab host (ADR-0030)

- [x] Ship `v0.3.0` with the pane-ready `MigrationExplorer` props, the `AddOnHealth` contract and ADR-0030 (`REFACTOR_APP.md` section 7). Released 2026-10-11; `v0.3.1` followed the same day, and the AddOn pins `v0.3.1` by URL and integrity hash.
- [ ] Downstream adoption: the AddOn's `core-update` workflow bumps the release-tarball URLs to `v0.3.0` (the sibling checkout and `APP_REF` are retired on its side); its pane app `_Addon/apps/lab-web` mounts `<MigrationExplorer apiBaseUrl="" partners={false} onStageChange={(s) => reportPaneState(s === "running" ? "working" : "ready")} onNavigate={(path) => requestNavigate(path)} contactPath="/contact" />`, owns the Turnstile widget (rendered into the `turnstile` node with the site key from `/api/health`, token passed through `getTurnstileToken`), and posts `hcw-addon` messages (`loading`, `ready`, `working`, `unavailable`) to the origins in `/api/health.siteOrigins`.
- [ ] Website route `/tools/migration` renders the generic `AddOnPanePage` for the catalogue row `migration`. The site never installs the UI package; it frames the AddOn.
- [ ] Hostname `migration.lab.hybridcloudworks.com` under the existing `*.lab` wildcard DNS and certificate; no DNS or certificate change.
- [ ] Image `docker.io/hybridcloudworks/hcw-addon-migration`, published by the AddOn's `publish-images.yml` after the scan gate, pinned by digest in the website's `lab-host/ansible/group_vars/all.yml`.
- [ ] Hosting by the website's `addons` Ansible role: loopback port 18081, hardened `docker_container` (non-root, read-only, capabilities dropped, memory and pids limits, bounded logs, no socket), Caddy route with the site-only `frame-ancestors`, health wait, rollback by the previous digest.
- [ ] Turnstile on uploads with the site key published by `/api/health`; the exact-origin CORS list may be empty because the pane is same-origin with its API.
- [ ] 5 MB/5,000-row limits, owner-token isolation, 120-minute TTL, bounded memory storage and explicit deletion preserved (unchanged upstream and downstream).
- [ ] Rate limiting and bounded assessment concurrency: moved downstream to `_Addon/apps/lab-api` (`429 rate_limited`, `503 overloaded`, both with `Retry-After`) and done there; nothing in this repository.
- [ ] Telemetry and Coder workspace creation off; upload processing, expiry and restart deletion stated in the pane beside the upload control.
- [ ] Host secrets through the website's vault (`vault_addon_migration_turnstile_secret`); public values in `group_vars`; nothing in Vite bundles, Git, Terraform state or logs.
- [ ] npm publication of `@hybridcloudworks/migration-core` and `@hybridcloudworks/migration-ui` is optional for this phase; the `file:` link and `APP_REF` stay the contract until the owner resumes the bootstrap.

## Phase 4 — Deploy a small read-only Azure appliance

- [ ] Add a project profile in `infrastructure/terraform/appliance-project`, separate from the larger experimental appliance template.
- [ ] Build an appliance image serving the compiled UI and API at the same origin. Protect `/api/*` as appropriate, provide static asset/SPA fallback handling, and avoid introducing a cross-origin UI/API split.
- [ ] Use `migrate.hybridcloudworks.com` for the appliance with verified custom-domain HTTPS. DNS records must have one Terraform owner; coordinate any existing shared-zone configuration rather than duplicating it.
- [ ] Start with one Consumption Container App, minimum/maximum one replica, 0.25 vCPU and 0.5 GiB memory. Confirm these limits through realistic inventory tests before deployment.
- [ ] Provide an explicit reviewed idle-mode change to zero minimum replicas. Explain that restart, revision deployment, or idle shutdown discards session-only assessments.
- [ ] Deploy a user-assigned managed identity with Reader only on approved assessment scopes; enforce that allowlist in the API as well as Azure RBAC.
- [ ] Use tenant-only Entra sign-in with assigned users/groups. Supply API and SPA registration identifiers through separately documented bootstrap; do not give the infrastructure deployment identity broad directory-management permissions.
- [ ] Make execution unavailable in the project profile: reject approvals and Resource Mover write routes, cap user authorization at planning, and expose read-only mode in health responses and UI. Default to disabled execution; Reader RBAC alone is not the application-level control.
- [ ] Add an owner-authorized appliance bundle-download endpoint rebuilding the bundle from the stored assessment.
- [ ] Omit PostgreSQL, the polling worker, custom VNet, private endpoints, and Application Insights initially. Use bounded, content-free platform logs and explicitly disclose temporary storage.
- [ ] Run real test-scope sign-in and Resource Graph assessments before describing authenticated discovery as validated. Do not enable migration execution as part of these tests.

## Phase 5 — Terraform and delivery controls

- [ ] Follow the website's IaC standard, tagging contract, naming guidance, required-input inventory, and secrets-placement rules. Preserve existing resource addresses and ownership.
- [ ] Create HCP workspace `hcw-amo-project` in organization `hcw`, under a new `Projects` project. Verify availability before creation. Never point this root at `hcw-azure`, `hcw-lab`, or legacy `HCW` state.
- [ ] Configure HCP dynamic Azure credentials with separate plan/apply permissions and trust scoped to the exact project, workspace, and run phase.
- [ ] Keep automatic apply disabled. Delivery is an explicit protected manual action; review the current plan before approval and reject unexpected destroys/replacements.
- [ ] Pin verified provider versions; commit `.terraform.lock.hcl` for each supported deployable root and relevant platform checksums.
- [ ] Run credential-free Terraform formatting, initialization without a backend, validation, TFLint, policy/security checks, and project-profile tests in PR CI. Run authenticated plans only through the approved HCP workflow.
- [ ] Keep Terraform state, saved plans, real variable files, `.env`, credentials, and customer inventory out of Git and public artifacts. Add missing `*.tfplan` exclusions.
- [ ] Do not generate secret values through Terraform. Provision required secrets out-of-band and record references and consumers, never values.
- [ ] Set a $50 monthly incremental budget target and alerts at 50%, 80%, and 100%; budget alerts are notifications, not a hard spending cap. Check the regional estimate before apply and review actual cost after two weeks.

## Acceptance gates and rollout order

| Gate | Required evidence |
| --- | --- |
| Public source upload | Reviewed candidate Git contents/history; accurate project posture; no secrets or customer data; coherent release workflows |
| Core verification | `npm test`, `npm run rules:validate`, golden comparison, real frontend type checks and builds |
| Artifact release | Clean packed-package installation; both Docker images build and pass smoke/security checks; documented version, digest, SBOM, provenance |
| Infrastructure | Supported Terraform roots initialize/validate; reviewed HCP plan; no unexpected destruction or duplicated ownership |
| Website | Prerender and route checks; browser upload, Turnstile, CORS, assessment, file/ZIP download, isolation, deletion and TTL tests |
| Hostinger | Additive Ansible change; loopback API binding; healthy Caddy routing; unrelated host services unaffected; digest rollback verified |
| Appliance | Assigned-user sign-in; allowed-scope discovery; denied unapproved scopes; owner-only bundles; execution refused; documented session loss after restart |
| Public uploads | Migration-rule sources independently verified; deployed browser checks green; limits and privacy disclosures present |
| Operating budget | Regional estimate fits the agreed target; alert delivery configured; actual cost reviewed after two weeks |

Rollout sequence:

1. Prepare and publish reviewed public source without automatically deploying it.
2. Publish verified UI, container, and CLI release artifacts.
3. Integrate the exact UI release into the website and deploy the lab API through existing host management.
4. Enable public uploads only after deployed validation passes.
5. Deploy and validate the read-only Azure appliance independently.

A code publication is not a deployment approval. Keep external publishing, infrastructure application, and website delivery explicit and reviewable.

## Initial review baseline and limitations

The review executed on 2026-10-03 reported:

- 92 passing tests and a passing core TypeScript build.
- 35 rules, snapshot `1.0.35`, with matching corpus checksum.
- A 29-resource sample assessment producing 51 files and no safety findings.
- Passing appliance-web type check and appliance-web/UI-harness builds.
- Passing formatting checks for the Azure, Cloudflare, and Hostinger Terraform directories, but a Coder template parse failure.
- One moderate root esbuild advisory.

These are historical review observations, not evidence for a future release head. Checks used Node 26.7 while existing CI targeted Node 22. Live Azure, PostgreSQL, Coder, Docker deployment, provider initialization/validation, and browser E2E were not established by that review. Structural rule validation does not establish correctness of Azure support statements.

## Assumptions and deferred work

- The existing VPS has capacity; measure it before adding the service.
- The proposed repository/package/domain/workspace names need ownership and collision verification, not automatic substitution with unrelated names.
- The $25–$75 range is an incremental budget target, not a provider quote or guarantee. Logging, compute, HCP entitlements, and provider plans must be checked before deployment.
- No new Hostinger purchase, Cloudflare Tunnel, PostgreSQL, polling worker, Coder infrastructure, live migration execution, Marketplace listing, or production-readiness claim is included in the initial release.
- Durable storage, additional replicas, execution, and customer-facing enterprise operation require separate design decisions, security review, and live validation.

## Reference sources

- Website: https://github.com/HybridCloudWorks/HCW-HybridCloudWorks
- Existing host management: https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/lab-host/README.md
- Existing VPS ownership: https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/infra-lab/README.md
- HCW IaC standard: https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/docs/standards/iac-repository-standard.md
- npm trusted publishing: https://docs.npmjs.com/trusted-publishers/
- Public npm packages: https://docs.npmjs.com/about-public-packages/
- GHCR: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- GitHub Actions security: https://docs.github.com/en/actions/reference/security/secure-use
- HCP dynamic credentials: https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials
- Terraform lock files: https://developer.hashicorp.com/terraform/language/files/dependency-lock
- Container Apps plans: https://learn.microsoft.com/en-us/azure/container-apps/plans
- Container Apps billing: https://learn.microsoft.com/en-us/azure/container-apps/billing

Sources and website configuration were inspected on 2026-10-03. Recheck provider contracts and runtime versions when implementing.
