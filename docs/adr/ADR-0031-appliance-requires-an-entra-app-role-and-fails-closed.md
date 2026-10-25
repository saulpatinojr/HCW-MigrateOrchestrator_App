# ADR-0031: The appliance requires an Entra app role and fails closed without one

**Status:** Accepted · **Date:** 2026-10-25 · **Closes the role half of ticket #46 (AMO-5); the `nbf` half shipped earlier. Amends ADR-0022 and ADR-0007 (app-role mapping only)**

## Context

Until now the API validated a Microsoft Entra access token (signature, expiry, not-before, issuer, tenant, audience, object
id) and then mapped its `roles` claim to an authorization level. A token with **no** recognised role was mapped to the level
`discovery`, so anyone in the tenant who could obtain a token for the appliance's audience could run discovery assessments
against the scopes the appliance can read. That is a least-privilege gap, not a bypass of validation: the ticket (#46) asks
for either a required app role or Entra's "assignment required" setting, with tests for a missing and a wrong role. Whether
"assignment required" was on for the deployed application was not known, and the Terraform did not set it.

The roles already exist in `infrastructure/terraform/appliance-azure` (`Migration.Plan`, `Migration.Execute`,
`Migration.Execute.Destructive`) and are documented in ADR-0022 and `docs/deployment/enterprise.md`. The authorization
levels are, in order, `sign-in`, `discovery`, `validation`, `artifact-generation`, `planning`, `controlled-execution` and
`destructive-execution` (`packages/authorization`); higher levels imply lower ones.

## Decision

Both layers, because each covers a failure of the other:

1. **The API requires an app role.** `principalFromClaims` returns a principal only when the token's `roles` claim is an
   array containing at least one of the three known roles, matched exactly (case-sensitive). The highest role held wins:

   | App role | Authorization level |
   |---|---|
   | `Migration.Plan` | `planning` (includes discovery, validation, artifact generation) |
   | `Migration.Execute` | `controlled-execution` |
   | `Migration.Execute.Destructive` | `destructive-execution` |

   No role, an empty `roles` claim, a role the API does not know, a `roles` claim that is not an array of strings, or a
   missing object id gives no principal, and every protected route answers **403 `forbidden`** before any route logic runs.
   There is no default level. The lowest role is `Migration.Plan`, which is what the old "discovery" user effectively needed
   (the web UI and `POST /api/assessments` already required discovery; `validate-move` needed validation). The public routes
   `/api/health` and `/api/agents` are unchanged. A token that fails validation is still 401.
2. **Entra enforces assignment.** Terraform creates `azuread_service_principal.api` with
   `app_role_assignment_required = true`, so Entra issues a token for the API only to users, groups and applications that
   hold an assigned app role. Assignments are made in the Entra portal (steps in `docs/deployment/enterprise.md`) or
   declaratively with the optional variable `app_role_assignments`, which is empty by default and validated against the
   three roles. Outputs print the enterprise application's object ID and the role IDs.

The azuread provider stays pinned to `~> 3.0` (and azurerm to `~> 4.0`) in `required_providers`; `.terraform.lock.hcl` is not
committed in this repository and this change does not start doing so.

## Alternatives considered

- **Only "assignment required" in Entra.** Rejected as the sole control: the API cannot see the setting, it can be switched
  off in the portal without a code change, and a token minted for another reason would still reach every route. The API check
  costs a few lines and is testable here.
- **Only the API role check.** Rejected as the sole control: without the setting Entra still issues tokens to every user in
  the tenant, which then hit the API and its logs. Defence in depth is cheap here.
- **A fourth, lower role (for example `Migration.Read` mapped to `discovery`).** Deferred, not rejected. It would let an
  owner grant assess-only access, but it is a new role ID and a new product decision, and the ticket asked to design with the
  existing roles. If wanted, add it to `APP_ROLE_LEVELS`, to the Terraform role map (the static test fails until both agree)
  and to this table.
- **Keeping `discovery` as the level for an unrecognised role.** Rejected: that is the defect.

## Consequences

- A person who could sign in before and had no role now gets 403 until an administrator assigns a role. The web UI shows the
  API's message ("no application role assigned"). **After the first deployment of this change, assign yourself a role** or
  nobody can use the appliance.
- Role changes reach a user at their next sign-in, because the role is in the token.
- Applications (workload identities) can be assigned the roles too, since the roles allow `Application` members.
- `/api/me` also answers 403 for a roleless token and discloses no level.
- The role check logs a warning with the caller's object id; it writes no audit event, so a flood of roleless calls cannot
  fill the audit table.
- Drift guard: `tests/security/terraform-role-and-firewalls.test.mjs` fails when the Terraform roles and `APP_ROLE_LEVELS`
  differ, when `app_role_assignment_required` is not `true`, or when the 403 guard moves after a route. The plan-level
  checks run in `iac-validate` (`terraform test`, mocked providers).
- **Not verified:** behaviour against a real tenant, that the `roles` claim appears in a real access token for an assigned
  user, and Entra's refusal to issue a token to an unassigned user. Recorded in `VALIDATION.md`.
