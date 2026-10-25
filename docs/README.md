# Documentation index

Canonical documentation for both repositories lives here (ADR-0028). Start with the working plan, then the ledger.

| Document | Purpose |
|---|---|
| [`../WORKING-PLAN.md`](../WORKING-PLAN.md) | The phased plan, acceptance gates and rollout order for publication, website integration and the Azure appliance; updated as work is verified |
| [`requirements-ledger.md`](requirements-ledger.md) · [`traceability-matrix.md`](traceability-matrix.md) | Requirement IDs, their status and where each is implemented or tested |
| [`adr/`](adr/) | Architecture decision records for both repositories, numbered in one sequence. Key ones: [ADR-0003](adr/ADR-0003-deterministic-rules-decide-llms-never-decide.md) rules decide, [ADR-0008](adr/ADR-0008-hard-edition-boundary-the-demo-cannot-construct-an-azure-provider.md) edition boundary, [ADR-0027](adr/ADR-0027-two-public-repositories-app-and-addon.md) two repositories, [ADR-0028](adr/ADR-0028-appliance-upstream-web-front-downstream.md) upstream/downstream, [ADR-0029](adr/ADR-0029-node-26-runtime-floor.md) Node 26 |
| [`architecture/overview.md`](architecture/overview.md) | Engine data flow and package boundaries |
| [`agents/README.md`](agents/README.md) | The 19 migration agents and the Safety Agent (generated from `packages/agents/src/definitions.ts`) |
| [`rules/README.md`](rules/README.md) · [`rules/coverage.md`](rules/coverage.md) | How rules are authored, sourced from Microsoft Learn, snapshotted and refreshed; resource-type coverage |
| [`product/`](product/) | Editions, cross-tenant behaviour, Marketplace evaluation |
| [`deployment/`](deployment/) | Azure appliance deployment (Container Apps, managed identity, Entra); lab deployment is documented downstream |
| [`release/README.md`](release/README.md) | Owner runbook for cutting a release: what a release contains, the dry run that publishes nothing, what it cannot prove, and what to do when a step fails |
| [`release/npm-publishing.md`](release/npm-publishing.md) | Owner runbook for the one-time npm bootstrap; after it, every `v*` tag publishes with trusted publishing |
| [`governance/`](governance/) | Review-pack provenance and authoring standard |
| [`repository-existing-files-review.md`](repository-existing-files-review.md) | Historical intake review of the supplied governance pack (2026-10-03) |
| [`../VALIDATION.md`](../VALIDATION.md) | What was executed and what was not, per change; limitations |

Downstream (web-front edition) documentation — website integration guide, routes, lab API OpenAPI, lab deployment,
operations runbook, lab threat model, partner one-pagers — lives in
[`HCW-MigrateOrchestrator_AddOn/docs`](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_AddOn/tree/main/docs).
