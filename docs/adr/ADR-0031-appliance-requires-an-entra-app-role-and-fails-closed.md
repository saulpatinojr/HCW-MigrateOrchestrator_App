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
   There is no default level. The lowest role is `Migration.Plan`. It is **wider** than what an old role-less "discovery"
   user had: `planning` also covers validation and artifact generation (for example `validate-move` evidence), which the
   `discovery` level did not. There is no role below it, so nobody can be given discovery only; whether to add one is
   listed under "Alternatives considered". The public routes `/api/health` and `/api/agents` are unchanged. A token that
   fails validation is still 401.
2. **Entra enforces assignment.** Terraform creates `azuread_service_principal.api` with
   `app_role_assignment_required = true`, so Entra issues a token for the API only to users, groups and applications that
   hold an assigned app role. Assignments are made in the Entra portal (steps in `docs/deployment/enterprise.md`) or
   declaratively with the optional variable `app_role_assignments`, which is empty by default and validated against the
   three roles. Outputs print the enterprise application's object ID and the role IDs.

The service principal sets `use_existing = true`, so an enterprise application that already exists for the registration (for
example one created by the portal) is adopted instead of stopping the apply with an import error; the alternative is
`terraform import azuread_service_principal.api <object id>` before the first apply. It also has
`lifecycle { prevent_destroy = true }`, because destroying it deletes every role assignment made on it (`terraform destroy`
of the whole configuration therefore stops, on purpose).

**Provider pinning.** The providers are constrained in `required_providers` (`azuread ~> 3.0`, `azurerm ~> 4.0`) and the
dependency lock file `infrastructure/terraform/appliance-azure/.terraform.lock.hcl` is now **committed**, with checksums for
linux (amd64, arm64), macOS (amd64, arm64) and Windows (amd64). I chose to commit it because a constraint alone lets every CI
run and every administrator pick up a different minor version of a provider that can create and grant roles, and the lock file
pins the exact version and its checksums, which `terraform init -lockfile=readonly` (now used by `iac-validate` and
`scripts/ci/local-iac-checks.sh`) verifies. The cost is one more file to keep current: a Dependabot `terraform` entry proposes
the bumps. Locked versions at the time of writing: azuread 3.10.0, azurerm 4.81.0.

**Who can apply role assignments.** Creating `azuread_app_role_assignment` needs, in Microsoft Graph application permissions,
`AppRoleAssignment.ReadWrite.All` and `Application.Read.All` (or the Application Administrator directory role, or Privileged
Role Administrator and similar) for the identity that runs Terraform
([provider docs](https://registry.terraform.io/providers/hashicorp/azuread/latest/docs/resources/app_role_assignment)).
**A pipeline that holds that permission can grant itself, or anyone, `Migration.Execute.Destructive`.** For production,
assign roles by hand in the Entra portal, by a person who is not the pipeline identity, and leave `app_role_assignments` empty
in the pipeline. Use the variable for a lab or for your own first assignment.

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
- A new role reaches a user at their next sign-in, because the role is in the token. **Removing a role does not take effect at once:** the API only reads the token, there is no revocation, so a person whose role was removed keeps access until their existing access token expires (the tenant default lifetime is about an hour to an hour and a half, per Microsoft Learn; not measured here). To cut someone off sooner, remove the role and also revoke their sessions in Entra; the API does not check anything beyond the token.
- Applications (workload identities) can be assigned the roles too, since the roles allow `Application` members.
- `/api/me` also answers 403 for a roleless token and discloses no level.
- The role check logs a warning with the caller's object id; it writes no audit event, so a flood of roleless calls cannot
  fill the audit table.
- Drift guard: `tests/security/terraform-role-and-firewalls.test.mjs` fails when the Terraform roles and `APP_ROLE_LEVELS`
  differ, when `app_role_assignment_required` is not `true`, or when the 403 guard moves after a route. The plan-level
  checks run in `iac-validate` (`terraform test`, mocked providers).
- **Not verified:** behaviour against a real tenant, that the `roles` claim appears in a real access token for an assigned
  user, and Entra's refusal to issue a token to an unassigned user. Recorded in `VALIDATION.md`.

## Rollback and lock-out

- **Lock-out at apply time.** Turning `app_role_assignment_required` on (or adopting an existing enterprise application that had
  it off) means everyone who is not assigned a role is refused by Entra from that moment, **including you**. Put your own
  role in `app_role_assignments` in the same apply (the command is in `docs/deployment/enterprise.md`), or assign yourself in the
  portal immediately after, before anyone needs the appliance.
- **Entra setting.** To roll back the Entra half, set `app_role_assignment_required = false` and apply; do **not** remove the
  `azuread_service_principal` resource, because destroying it deletes the role assignments (hence `prevent_destroy`). The API
  still answers 403 to a token without a role, which is the intended safe state.
- **API.** Deploy the previous image digest (`image_ref`). The previous image maps a role-less token to the `discovery` level
  again, so rolling back the API alone re-opens the gap this ADR closes; roll back only for an outage, and say so in the ticket.
- **Terraform tests and lock file.** Reverting the lock file reverts the provider versions; run `terraform init` again.

## Unverified, stated plainly

- Entra refusing the sign-in of an unassigned user (and an unassigned application's token request) once assignment is required
  is Microsoft's documented behaviour and is **unverified live** here; the web page maps `AADSTS50105` on the strength of
  that documentation and a unit test of the message, not a real redirect.
