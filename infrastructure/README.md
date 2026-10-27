# Infrastructure

| Path | What | Status |
|---|---|---|
| `docker/Dockerfile.appliance` | Appliance API + worker image on `node:26-bookworm-slim`: multi-stage build, Debian security upgrades, npm removed from the runtime, non-root, health check. Published by `publish-images.yml` after a Trivy scan, with provenance and SBOM | Supported build; deploy by digest |
| `terraform/appliance-azure/` | Full experimental template: Container Apps, user-assigned identity, PostgreSQL Flexible Server (Entra-only), Log Analytics / App Insights, Entra app registration with app roles | **Experimental.** Validates in CI (`iac-validate`); applied to one sandbox subscription (first 2026-10-26, updated 2026-10-27), not to production. The first production deployment is planned to use the smaller `appliance-project` profile (`WORKING-PLAN.md` Phase 4; not written yet: one Consumption Container App, session-only storage, Reader-only identity, execution disabled) |

Rules: Terraform has one owner per resource; state, plans, variable files and credentials never enter Git; apply is a
reviewed manual action from the HCP Terraform workspace (Phase 5). The lab infrastructure (Hostinger VPS, Cloudflare edge,
Coder) lives downstream in `HCW-MigrateOrchestrator_AddOn/infrastructure`.
