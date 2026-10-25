# ADR-0022: Appliance authentication, discovery, evidence and gated execution

**Status:** Accepted · **Date:** 2026-10-03

## Context
Sprint 3 turns the appliance from interfaces into a working, fail-closed service without adopting the Azure SDK, which would
add a large dependency surface and could only be exercised against recorded fixtures here anyway.

## Decision
- **Identity:** `@amo/azure-auth` validates Entra access tokens (RS256 via tenant JWKS; issuer, tenant, audience, expiry) with
  Node's crypto only. App roles `Migration.Plan` / `Migration.Execute` / `Migration.Execute.Destructive` map to authorization levels.
- **Credentials:** Azure CLI (developer), managed identity (IMDS / `IDENTITY_ENDPOINT`), workload identity federation
  (federated token file → client assertion). Client secrets are rejected at startup and have no implementation.
- **Discovery:** Azure Resource Graph REST (`2022-10-01`), paged with `$skipToken`; 403 becomes a permission gap, not an error.
  Evidence from it is `observed-from-azure-api`, which lifts the unauthenticated confidence cap.
- **Evidence:** ARM `validateMoveResources` (202 → poll → 204/409) attaches per-resource evidence and blockers to an assessment.
- **Execution:** Azure Resource Mover is the first controlled-execution surface: `prepare`/`initiateMove`/`commit`/`discard`,
  each passing the approval gate with approvals persisted in the repository and audited. `discard` is the rollback path.
- **Persistence:** `AssessmentRepository` with in-memory and PostgreSQL (`pg`) implementations; PostgreSQL uses Entra
  authentication only (`DATABASE_URL` with an embedded password is refused for non-local hosts).
- **Hosting:** `infrastructure/terraform/appliance-azure` — Container Apps, user-assigned identity with Reader on assessment
  scopes, PostgreSQL Flexible Server (private, Entra-only), Log Analytics/App Insights, Entra app registration with app roles.

## Consequences
The appliance works end to end against fakes with 84 tests; real-tenant validation is the remaining step. Execution RBAC
(Contributor on source/target resource groups for Resource Mover) is granted per engagement, never by the base Terraform.
Resource Mover request shapes are marked [VERIFY] against the current API version.

- Amended 2026-10-25: a token with no recognised app role is no longer mapped to `discovery`; it is refused with 403, a fourth, lowest role `Migration.Read` (assess only) was added, and Terraform requires role assignment on the enterprise application (ADR-0031). The two subnets of the hosting configuration now have network security groups with deny-all-inbound (ADR-0032).
