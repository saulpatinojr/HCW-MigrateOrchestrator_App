# Traceability matrix

Path markers (the same convention as `docs/requirements-ledger.md`): a path followed by *(downstream)* lives in `saulpatinojr/HCW-MigrateOrchestrator_AddOn`; *(retired)* means it was deleted and exists in neither repository. Every other path names a file in this repository, written from the repository root, and `tests/end-to-end/requirements-ledger.test.mjs` fails when one does not exist.

| Req | Implementation | Tests | Documentation |
|---|---|---|---|
| R-01 | `packages/*`, `apps/*` | `packages/agents/src/orchestrator.test.ts` | `docs/architecture/overview.md`, ADR-0001 |
| R-02, R-10, R-11 | `packages/domain/src/{taxonomy,decision}.ts` | `packages/domain/src/domain.test.ts` | `docs/product/editions.md` |
| R-03, R-15 | `packages/authorization`, `apps/appliance-api`, `packages/azure-discovery` | `packages/authorization/src/authorization.test.ts`, `apps/appliance-api/src/enterprise.test.ts`, `packages/azure-discovery/src/discovery.test.ts` | `docs/deployment/enterprise.md`, ADR-0005, ADR-0007 |
| R-04 | `apps/lab-api/src/app.ts` *(downstream)*, `assertDemoCannotUseAzure` in `packages/azure-discovery/src/index.ts`, `EDITION_MAX_LEVEL` in `packages/authorization/src/index.ts` | `apps/lab-api/src/api.test.ts` *(downstream)* ("no execution surface"), `packages/agents/src/orchestrator.test.ts` ("refuses authenticated provider") | `docs/demo/user-guide.md` *(downstream)*, ADR-0008 |
| R-05 | spread across engine | safety agent tests; classification tests (ASR, cap, unknown) | `docs/security/threat-model.md` *(downstream)* |
| R-06 | — | — | `docs/repository-existing-files-review.md` |
| R-07 | `scripts/package-repository.{sh,ps1}`, `repository.manifest.json` | `tests/end-to-end/repository-manifest.test.mjs` | `README.md` |
| R-12, R-13 | `rules/azure/*.json`, `scripts/author-rules.mjs`, `packages/evidence-engine` | `packages/evidence-engine/src/evidence.test.ts` (clean corpus, precedence, conflicts, duplicates, snapshot diff) | `docs/rules/README.md`, ADR-0012 |
| R-14 | `packages/agents/src/{definitions,orchestrator,safety}.ts` | `packages/agents/src/orchestrator.test.ts` (19 agents, e2e, safety) | `docs/agents/README.md` (generated) |
| R-16 | cross-tenant branch in `packages/classification-engine/src/classify.ts`, `defaultIntent` in `packages/domain/src/intent.ts` | `packages/classification-engine/src/classify.test.ts` ("cross-tenant managed identity") | `docs/product/cross-tenant.md` |
| R-17 | `packages/landing-zone` | covered via classification tests (prerequisites) | ADR-0011 |
| R-18 | `packages/csv-ingestion` | `packages/csv-ingestion/src/ingest.test.ts` (BOM, quoting, delimiter, duplicates, formula injection, limits, missing ID) | `docs/security/threat-model.md` *(downstream)* |
| R-19 | `apps/lab-web` *(downstream)* (the form was `apps/lab-web/public/index.html` *(retired)* and `apps/lab-web/public/app.js` *(retired)*, replaced by the React pane), `parseCreateAssessmentRequest` in `packages/contracts/src/index.ts` | `packages/contracts/src/contracts.test.ts`, `apps/lab-api/src/api.test.ts` *(downstream)* | `docs/demo/user-guide.md` *(downstream)* |
| R-20 | `apps/lab-web` *(downstream)* | `apps/lab-api/src/api.test.ts` *(downstream)* (static + CSP) | `docs/demo/user-guide.md` *(downstream)* |
| R-21, R-22 | `packages/report-engine`, `packages/artifact-generator` | golden test, orchestrator e2e | `docs/demo/output-bundle.md` *(downstream)* |
| R-23 | `packages/terraform-generator` | golden `samples/expected-reports/terraform__main.tf`; safety secret scan | ADR-0013 |
| R-24 | `packages/runbook-generator` | golden `samples/expected-reports/runbooks__migration.md` | — |
| R-25 | `packages/validation-engine` | orchestrator e2e (bundle contains validation/*) | — |
| R-26 | `packages/workspace-provider`, `infrastructure/coder` *(downstream)* | `packages/workspace-provider/src/workspace.test.ts` | `docs/deployment/coder.md` *(downstream)*, ADR-0010 |
| R-27 | — | — | `docs/website-integration/routes.md` *(downstream)* |
| R-28 | `.github/**` | `.github/workflows/ci.yml` runs tests | `.github/setup/*.md`, existing-files review |
| R-29 | `.github/workflows/*.yml`, `tests/security/no-secrets.test.mjs` | that test | `VALIDATION.md` |
