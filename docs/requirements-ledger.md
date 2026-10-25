# Requirement ledger

Path markers: a path followed by *(downstream)* lives in `saulpatinojr/HCW-MigrateOrchestrator_AddOn`; *(retired)* means it was deleted and exists in neither repository. `tests/end-to-end/requirements-ledger.test.mjs` fails on any other path that does not exist here.

Source: the master implementation prompt (sections §1–§25; the supplied copy ends mid-§25). Each requirement has an ID,
an implementation status for **this build**, and pointers. Status legend: **Done** (implemented and tested), **Partial**
(implemented with documented gaps), **Interface** (contract + safe local adapter, real integration pending), **Planned**
(documented, not built). Since the repository split (ADR-0027, ADR-0028) the lab (demo) web front lives in `saulpatinojr/HCW-MigrateOrchestrator_AddOn`; paths marked *downstream* below are in that repository, not this one. The traceability matrix (`docs/traceability-matrix.md`) maps IDs to code, tests and docs.

| ID | Requirement (abridged) | Status | Notes |
|---|---|---|---|
| R-01 | Shared migration intelligence core used by both editions | Done | `packages/*` consumed by `apps/cli` and `apps/appliance-api` here, and by `apps/lab-api` (downstream) |
| R-02 | Answer the 14 questions per resource (§1) | Done | `ResourceDecisionRecord` fields; unsupported never final (`validateRule`, classification alternatives) |
| R-03 | Enterprise edition: Entra OIDC, managed identity, WIF, Lighthouse, ARG discovery, approval gates, orchestration | Partial | Entra token validation, MI/WIF/CLI credentials, Resource Graph discovery, `validateMoveResources` evidence, persisted approvals, Resource Mover gated execution (ADR-0022). Lighthouse and controlled execution beyond Resource Mover pending; real-tenant validation pending |
| R-04 | Demo edition: CSV input, no credentials, no Azure connector, no execution, labelled assumptions | Done | `apps/lab-api` (downstream), `assertDemoCannotUseAzure`, `EDITION_MAX_LEVEL.demo = planning`, tests |
| R-05 | 20 non-negotiable principles (§3) | Done/Partial | Each enforced in code or tests where mechanisable; P15 (governance files adapted) in `docs/repository-existing-files-review.md` |
| R-06 | Workspace inspection recorded (§4) | Done | `docs/repository-existing-files-review.md` |
| R-07 | Repository delivery contract + ZIP without nested dir, exclusions (§5) | Done | `scripts/package-repository.{sh,ps1}`, `make package`, `tests/end-to-end/repository-manifest.test.mjs` |
| R-08 | Monorepo structure (§6) | Done | All listed packages/apps exist with real content: `packages/ui` (Sprint 1), `apps/appliance-web` (Sprint 6), `apps/worker` (Sprint 7); plus `apps/ui-harness` for e2e (downstream) |
| R-09 | Technology selection + ADRs (§7) | Done | TypeScript/Node 26 (ADR-0029; was 22 per ADR-0002), zero runtime deps; ADR-0001…0016 |
| R-10 | Decision taxonomy (§8) | Done | `packages/domain/src/taxonomy.ts` |
| R-11 | Resource decision record fields (§9) | Done | `packages/domain/src/decision.ts` |
| R-12 | Initial rules vertical slice for 24 types; Unknown for others (§10) | Done | 35 rules in `rules/azure` (snapshot 1.0.35); `NO_RULE_FOR_TYPE` → unknown-requires-validation |
| R-13 | Rule engine: schema, conflicts, duplicates, precedence, overlays, snapshots, checksums, tooling, golden tests, rollback, change report, offline snapshot (§11) | Done | `packages/evidence-engine`, `rules/schemas`, `rules/snapshots/current.json`, `amo rules …`, rollback = git revert + snapshot |
| R-14 | 19 agents with bounded definitions; orchestrator (§12) | Done/Partial | All 19 defined; deterministic ones execute; Discovery/Cost agents enterprise-only and pending real Azure adapters |
| R-15 | Enterprise authentication & authorization levels (§13) | Done | 7 levels, gate, JWKS token validation, app-role mapping (a token without a recognised app role is refused with 403, and Terraform requires role assignment: ADR-0031), env refuses client secrets, certificate path and user name; PKCE is the client's responsibility (documented) |
| R-16 | Cross-tenant workflow first-class (§14) | Done | `crossTenantPattern`, `crossTenantImplications`, intent coercion, tests |
| R-17 | Landing-zone profile shared (§15) | Done | `packages/landing-zone`, sample profile, questionnaire-derived profile never claims validation |
| R-18 | resources.csv ingestion robustness + security + provenance (§16) | Done | `packages/csv-ingestion` and its tests; limits via `API_LIMITS` |
| R-19 | Demo questionnaire (§17) | Done | `apps/lab-web` (downstream) form → `MigrationIntent`; prohibited fields rejected server-side |
| R-20 | Demo UX 29 items (§18) | Partial | 27/29 in `apps/lab-web` (downstream); Open-in-Coder action and guided lab depend on a Coder deployment (provider built, UI action hidden until configured) |
| R-21 | Demo output: exec summary, engineering assessment, generated assets, metadata, DEMO-NOT-FOR-PRODUCTION (§19) | Done | `packages/report-engine`, `packages/artifact-generator` |
| R-22 | Bundle format (§20) | Done | exact layout in `buildBundle`; `VALIDATION-STATUS.md` for authenticated runs |
| R-23 | Terraform requirements (§21) | Partial | Modular, aliases, variables, no secrets, not-production labels; import blocks/drift detection intentionally deferred until destination inspected |
| R-24 | Scripts & runbooks (§22) | Done | dry-run default, structured logs, exit codes, correlation IDs; 5 runbooks with required sections |
| R-25 | Data migration & validation (§23) | Done | reconciliation plan per data-bearing resource; data dimension separate |
| R-26 | Coder browser lab with provider abstraction, template, security (§24) | Done (fakes) | `packages/workspace-provider` (3 providers, tests), `infrastructure/coder/template` *(downstream)*; not validated live |
| R-27 | Website integration routes (§25, truncated) | Done | `docs/website-integration/routes.md` *(downstream)* with proposed routes under `/education/migration-labs/…` |
| R-28 | GitHub Copilot review/coding-agent configuration | Done | supplied `.github` pack installed, nesting defect fixed, repo profile added |
| R-29 | Security scanning, release packaging, CI | Done/Partial | `ci.yml`, `security.yml`, `iac-validate.yml`; every action pinned to a full commit SHA; release pipeline in `release-cli.yml` and `publish-npm.yml` (`docs/release/README.md`, ADR-0034) |
| R-30 | VALIDATION.md + traceability | Done | `VALIDATION.md`, `docs/traceability-matrix.md` |
| R-31 | Sprint 1: three deployables, boundary test, React UI package, CORS + Turnstile (the lab API, downstream; the appliance API allows only the exact origins in `AMO_ALLOWED_ORIGINS`, none by default, ADR-0033), Hostinger + Cloudflare IaC, GHCR publish, partner showcase, site integration guide | Done | ADR-0017…0019; `tests/security/edition-boundary.test.mjs` *(downstream)*; `packages/ui`; `infrastructure/terraform/lab-*` *(retired)*; `.github/workflows/publish-lab-image.yml` *(retired)*; `docs/partners` *(retired)*; `docs/website-integration/integration-guide.md` *(downstream)* |
| R-32 | Sprint 2: IaC state impact, HCP-ready output, schema validation of generated Terraform, Learn rule-refresh pipeline | Done | ADR-0020/0021; `packages/terraform-generator/src/{state-impact,hcp,schema-check}.ts`; `packages/evidence-engine/src/learn-matrix.ts`; `scripts/refresh-rules-from-learn.mjs`; `rules-refresh.yml`; `ci.yml` job `generated-terraform` |
| R-33 | Sprint 3: appliance — Entra auth, credentials, Resource Graph, validate-move evidence, approvals + audit, Resource Mover execution, PostgreSQL repository, Container Apps IaC, appliance image | Done (fakes) | ADR-0022; `packages/azure-auth`, `packages/azure-arm/src/{resource-graph,move-validation}.ts`, `packages/azure-execution`, `apps/appliance-api`, `infrastructure/terraform/appliance-azure`, `infrastructure/docker/Dockerfile.appliance` |
| R-34 | Sprint 4: guided lab — one-time bundle tokens, workspace endpoint, Open-in-Coder UI, workspace image, template push | Done (fakes) | ADR-0023; `apps/lab-api/src/{store,app}.ts` (downstream); `packages/ui` SummaryPanel/MigrationExplorer; `infrastructure/coder/{image,template}` and `coder-template.yml` (downstream) |
| R-35 | Sprint 5: single-executable CLI, opt-in aggregate telemetry, rules coverage endpoint/page, organizational overlay, Marketplace evaluation | Done | ADR-0024; `scripts/build-sea.sh`, `apps/cli/src/rules-source.ts`, `release-cli.yml`; `lab-api` (downstream) `/api/stats`, `/api/rules/coverage`; `rules/organization/hcw-standards.json`; `docs/rules/coverage.md`; `docs/product/marketplace-evaluation.md` |
| R-36 | Sprint 6: Lighthouse-aware scopes + derived tenant relationship, PostgreSQL Entra token auth, appliance web UI (MSAL PKCE) | Done (fakes / build-verified) | ADR-0025; `packages/azure-arm/src/scopes.ts`; `apps/appliance-api` `/api/scopes`; `apps/appliance-api/src/repository.ts` `pgEntraPasswordProvider`; `apps/appliance-web` |
| R-37 | Sprint 7: worker + operation tracking, compiled Tailwind for both UIs, ui-harness, Playwright e2e in CI | Done (e2e CI-only) | ADR-0026; `apps/worker`, `packages/azure-execution/src/operations.ts`, `/api/operations`; `apps/ui-harness`, `playwright.config.ts`, `tests/e2e/lab.spec.ts` and the `ci.yml` job `e2e` (all downstream) |
