# Appliance deployment (Azure)

Sprint 3 made the appliance a working, fail-closed service (ADR-0022). The Azure SDK is not used; all Azure calls are REST
with dependency-free credentials.

## 1. Provision

> **Status: never applied; a sandbox apply is pending.** The Container Apps environment is a workload-profile environment (owner
> decision on [issue 82](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues/82), ADR-0032) and the configuration passes `terraform validate` and the mocked-provider tests, but
> nothing has been created in any subscription. Do the first apply in a non-production subscription and read the plan first. The
> subnet firewall for the Container Apps subnet is provisional until that apply shows the environment starts and the API answers
> over 443 (section 2d).

Sign in with `az login` first (no secrets). Both shells use the subscription you are signed in to as the hosting subscription.

The appliance image is always deployed by its exact digest, never by a tag such as `:latest` (a tag can change under a running deployment, so Terraform refuses it). The digest is the last line of the `publish-images` run summary (see `docs/release/docker-hub.md`) and looks like `docker.io/hybridcloudworks/img-mo-appliance-app@sha256:` followed by 64 hexadecimal characters. Copy that line first. Until a release has published an image there is no digest to deploy; the repository variables in `docs/release/docker-hub.md` start the publishing.

PowerShell (the copied line is on the clipboard):

```powershell
$env:ARM_SUBSCRIPTION_ID = az account show --query id --output tsv
$env:TF_VAR_image_ref = Get-Clipboard
Set-Location infrastructure/terraform/appliance-azure
Copy-Item terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -out appliance.plan
terraform apply appliance.plan
```

bash:

```bash
export ARM_SUBSCRIPTION_ID="$(az account show --query id --output tsv)"
read -r -p "Paste the image line from the publish-images run summary: " TF_VAR_image_ref && export TF_VAR_image_ref
cd infrastructure/terraform/appliance-azure && cp terraform.tfvars.example terraform.tfvars
terraform init && terraform plan -out appliance.plan && terraform apply appliance.plan
```

Creates: resource group, user-assigned identity (Reader on `assessment_scope_ids`), VNet + delegated subnets, each behind
a network security group that denies all inbound traffic except what the appliance needs (section 2d), PostgreSQL
Flexible Server (private, **Entra-only auth**, the identity is the DB admin), Log Analytics + App Insights, Container Apps
environment + app, Entra app registration with app roles, and its enterprise application with **assignment required**
switched on (section 2). Follow the `post_apply` output (identifier URI, role assignments).

**Resource names.** Names follow the Cloud Adoption Framework (CAF) abbreviations and this estate's house style: `<type>-<workload>[-<function>]-<environment>-<region>-<nn>` (resource groups have no number). For `prefix = amo`, `environment = sandbox` and `location_short = scus` (South Central US):

| Resource | Name | CAF abbreviation |
| --- | --- | --- |
| Resource group (app) | `rg-app-amo-sandbox-scus` | `rg` |
| Resource group (platform-managed, Container Apps environment) | `rg-caeinfra-amo-sandbox-scus` | `rg` |
| Managed identity | `id-amo-sandbox-scus-01` | `id` |
| Log Analytics workspace | `log-amo-sandbox-scus-01` | `log` |
| Application Insights | `appi-amo-sandbox-scus-01` | `appi` |
| Virtual network | `vnet-amo-sandbox-scus-01` | `vnet` |
| Subnets | `snet-amo-aca-sandbox-scus-01`, `snet-amo-db-sandbox-scus-01` | `snet` |
| Network security groups | `nsg-amo-aca-sandbox-scus-01`, `nsg-amo-db-sandbox-scus-01` | `nsg` |
| Network security group rules | `nsgsr-<what the rule does>` | `nsgsr` |
| PostgreSQL flexible server | `pgsql-amo-sandbox-scus-01` | `pgsql` |
| Container Apps environment | `cae-amo-sandbox-scus-01` | `cae` |
| Container apps | `ca-amo-api-sandbox-scus-01`, `ca-amo-worker-sandbox-scus-01` | `ca` |
| Private DNS zone | `amo-sandbox-scus.postgres.database.azure.com` | none (the name must be the DNS domain and end in `postgres.database.azure.com`) |

The private DNS zone link (`pg-link`) and the database inside the server (`amo`) have no CAF abbreviation. The Entra application's display name is not an Azure resource name and is outside the convention. A name cannot be changed after creation, so change `prefix`, `environment` or `location_short` before the first apply, not after. Learn: [Abbreviation recommendations for Azure resources](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations), [Define your naming convention](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming).

## 2. Authentication model

Signing in with Microsoft Entra ID is not enough. To use the appliance a person (or an application) must also be **assigned
one of the app roles** below. The API reads the roles from the token and answers **403 `forbidden`** to a valid token
that has no role, or only a role it does not know, on every route except the public health and agent-list routes. There is
no "signed in, no role" level (ADR-0031).

| Role | Level | Can |
|---|---|---|
| (no role, or an unknown role) | none | nothing: every protected route answers 403 |
| `Migration.Read` | discovery | **assess only:** list scopes, run discovery assessments on permitted scopes, read your own assessments. No move validation, plans, approvals or execution |
| `Migration.Plan` | planning | + validate-move evidence, plans, bundles, operation status (no execution) |
| `Migration.Execute` | controlled-execution | + record approvals; Resource Mover prepare / initiateMove (approval `production-deploy`) / commit (approval `data-cutover`) / discard |
| `Migration.Execute.Destructive` | destructive-execution | + the destructive operations the approval gate reserves for it (source deletion workflows, future) |

If a person holds several roles, the highest one counts. `Migration.Read` is what a signed-in user without a role used to
get automatically (the old `discovery` level); now it has to be assigned like the others (ADR-0031).

What each role may call (`403` means the API refused it for lack of a level; every route also needs a valid token, and an
assessment is only visible to the person who created it):

| Route | Read | Plan | Execute | Execute.Destructive |
|---|---|---|---|---|
| `GET /api/health`, `GET /api/agents` (public) | yes | yes | yes | yes |
| `GET /api/me`, `GET /api/scopes` | yes | yes | yes | yes |
| `POST /api/assessments`, `GET /api/assessments`, `GET /api/assessments/{id}` | yes | yes | yes | yes |
| `POST /api/assessments/{id}/validate-move` | 403 | yes | yes | yes |
| `GET /api/operations/{targetKey}` | 403 | yes | yes | yes |
| `POST /api/approvals` | 403 | 403 | yes | yes |
| `POST /api/execution/resource-mover/{prepare, discard}` | 403 | 403 | yes | yes |
| `POST /api/execution/resource-mover/initiateMove` | 403 | 403 | yes, with a `production-deploy` approval recorded by someone else | same |
| `POST /api/execution/resource-mover/commit` | 403 | 403 | yes, with a `data-cutover` approval recorded by someone else | same |

No route today needs more than `Migration.Execute`: the extra level of `Migration.Execute.Destructive` is reserved by the approval
gate for operations such as source deletion, which the API does not expose yet.

Two layers apply this, and only the second is the control. First, Terraform sets `app_role_assignment_required = true` on the
enterprise application: Entra is meant to refuse to sign in an unassigned user and to issue a token to an unassigned
application, but it is a first layer only. Administrators who can manage the application are documented exceptions (a Global
Administrator is reported to bypass it), the portal's "Default Access" assignment is a placeholder and not a role, and **none of
this has been verified live here**. Second, the **API checks the role in every token and is the authoritative control**: a
token obtained any other way, or an environment where the setting was switched off, still gets 403.

**Before you apply: this locks out everyone who has no role, including you.** Enabling "assignment required" (or adopting an
enterprise application that had it off) takes effect at apply time. Put your own role in `app_role_assignments` in the **same**
apply (see "Assign roles with Terraform instead" below), or be ready to assign yourself in the Entra portal straight away.

Taking a role away does **not** cut a person off at once. The API only reads the access token, there is no revocation, so
they keep access until the token they already hold expires (by default about an hour to an hour and a half, per Microsoft
Learn). To cut someone off sooner, remove the role and revoke their sessions in Entra.

If a person is refused at sign-in because they have no role, the sign-in page of the appliance web now says so and tells them
to ask an administrator (Entra error code `AADSTS50105`; unverified against a real redirect).

**Known limitations (pre-existing, not changed).** A role is not a data scope. Operation status
(`GET /api/operations/{targetKey}`) can be read by any `Migration.Plan` holder or higher for any collection name. Approvals are
matched on the collection name only. Assessments are the exception: they are visible only to their creator. See ADR-0031.

**Two-person approval (`AMO_ALLOW_SELF_APPROVAL`).** An approval only counts for a Resource Mover `initiateMove` or `commit` when
the person who recorded it is not the person executing. So a move needs two `Migration.Execute` holders: one records the approval
(`POST /api/approvals`), the other runs the action; a person's own approval is ignored and the answer is 403 with the reason. If
the appliance is a lab or has a single operator, an administrator can set `AMO_ALLOW_SELF_APPROVAL=true` on the **API** Container
App (not the worker) to turn the rule off; every execution that used the caller's own approval is then marked `selfApproval: true`
in the audit log. It is off by default, the Terraform in this repository never sets it, and any value other than `true` or
`false` stops the API at startup. For `docker compose`, put it in `.env` (see `.env.example`).

### Assign a role to a person

Do this after the first `terraform apply`, and again for each new person. You need to be an owner of the application or
hold the Application Administrator or Cloud Application Administrator role in Entra. See
[Assign users and groups to an application](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal).

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com) and sign in.
2. Go to **Entra ID**, then **Enterprise apps**, and open **Azure Migration Orchestrator (prod)** (the name ends in the `environment` you deployed, `prod` by default).
3. Choose **Users and groups**, then **Add user/group**.
4. Under **Users**, pick the person. Assigning a group needs Microsoft Entra ID P1 or higher; a single user does not.
5. Under **Select a role**, pick `Migration.Read` (assess only), `Migration.Plan`, `Migration.Execute` or `Migration.Execute.Destructive`, then **Assign**. Start with the lowest role the person needs.
6. Ask the person to sign out of the appliance and sign in again. Their new token carries the role. You should see their level next to their name at the top of the page.

### Assign roles with Terraform instead

The variable `app_role_assignments` assigns roles when you apply. This example assigns yourself `Migration.Execute`.
Run it in the same shell you use for the other `terraform` commands in section 1, then plan and apply again.

PowerShell:

```powershell
$me = az ad signed-in-user show --query id --output tsv
$env:TF_VAR_app_role_assignments = '{"me":{"principal_object_id":"' + $me + '","role":"Migration.Execute"}}'
```

bash:

```bash
me="$(az ad signed-in-user show --query id --output tsv)"
export TF_VAR_app_role_assignments="{\"me\":{\"principal_object_id\":\"$me\",\"role\":\"Migration.Execute\"}}"
```

Each entry is a label you choose, the person's (or group's, or application's) object ID, and the role. The outputs
`api_service_principal_object_id` and `api_app_roles` print the enterprise application's object ID and the role IDs.
Removing an entry removes that assignment on the next apply. A role assigned in the portal and also listed here is
reported as already existing: keep each person in one place.

**Who may run this, and why production should not.** The identity that runs `terraform apply` needs permission to assign app
roles: in Microsoft Graph application permissions `AppRoleAssignment.ReadWrite.All` and `Application.Read.All`, or the
Application Administrator directory role
([provider documentation](https://registry.terraform.io/providers/hashicorp/azuread/latest/docs/resources/app_role_assignment)).
**A pipeline that holds that permission can give itself, or anyone, `Migration.Execute.Destructive`.** For production, leave
`app_role_assignments` empty in the pipeline and assign roles by hand in the portal (steps above), by a person who is not the
pipeline identity. Use the variable for a lab, or for your own first assignment.

**Provider versions.** `.terraform.lock.hcl` in `infrastructure/terraform/appliance-azure` is committed on purpose: it pins the
exact `azuread` and `azurerm` versions and their checksums, so every administrator and the CI job use the same providers
(`terraform init` uses it as is; the CI job runs `init -lockfile=readonly` and fails if it would change). Dependabot proposes
provider bumps as pull requests that update it. To move a provider yourself, run `terraform init -upgrade` and commit the
changed lock file. If `init` tells you the lock file does not match, do not delete it; ask why it changed.

Tokens: authorization-code flow with PKCE in the client; the API validates audience `api://` followed by the API registration's Application (client) ID against the tenant
JWKS. Credentials for Azure calls: managed identity in Container Apps (`AMO_CREDENTIAL_KIND=managed-identity`), workload
identity federation in CI, Azure CLI for local development. `AMO_*SECRET` / `AZURE_*SECRET` variables abort startup.

## 2b. Web UI

`apps/appliance-web` (Vite + React + MSAL). Register a **second**, public-client SPA app registration with redirect URI
set to the exact web address where you host the UI, with no slash at the end (the app sends `window.location.origin`, for example `https://` followed by the host name that Static Web Apps shows once you create it, and Microsoft Entra compares the address exactly), expose the API's `access_as_user` scope on the API registration, and pre-authorize the SPA. Build with
`VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_SPA_CLIENT_ID` and `VITE_API_SCOPE` (public values).

**Where the web UI and the API live decides one more setting (CORS, ADR-0033).** CORS (Cross-Origin Resource Sharing) is the browser
rule that decides which websites may read an API's answers.

- **Same address (recommended).** Put one reverse proxy on a single address that sends `/api/*` to the API Container App and
  everything else to the compiled `dist/`, and leave `VITE_API_BASE_URL` empty so the web UI calls `/api/...` on the address that
  served it. Nothing else is needed: with `AMO_ALLOWED_ORIGINS` unset the API sends no CORS headers at all.
- **Different addresses.** Build the web UI with `VITE_API_BASE_URL` set to the API's address, and tell the API which web address
  may call it by setting `AMO_ALLOWED_ORIGINS` on the **API** Container App (not the worker; for example in the Azure portal: the
  Container App, Containers, Environment variables, add `AMO_ALLOWED_ORIGINS` with the value, then create the new revision).
  The value is a comma-separated list of exact origins: `https://`, the host in lower case, a port only when it is not
  the default, and **nothing else** (no path, no trailing slash). `http://` is accepted only for a web UI on your own machine
  (`localhost`, `127.0.0.1` or `[::1]`); any other `http://` entry is refused. It is the same text as the redirect address registered above.
  Examples: `https://app.example.com`, or for a local web UI started with Vite, `http://localhost:5174`; two origins are
  `https://app.example.com,http://localhost:5174`. A wildcard (`*`), `null` or a malformed entry makes the API refuse to start
  with a message that names `AMO_ALLOWED_ORIGINS`. Allowed origins get `Access-Control-Allow-Origin` with their own address,
  `Vary: Origin`, and a preflight answer for `GET`, `POST`, the `Authorization` and `Content-Type` headers; no cookies or other
  credentials are ever allowed, and the Entra token and the app role (ADR-0031) are still required on every protected route. An origin that is not in the list
  gets no CORS headers, so the browser will not let that page read the answers. For local development with `docker compose`, put
  `AMO_ALLOWED_ORIGINS=http://localhost:5174` in `.env` (see `.env.example`). The Terraform in this repository does not set the
  variable.

- **Which Host names the API answers (local use).** `docker compose` publishes the API on `127.0.0.1:8081` only (not on your network), and sets
  `AMO_ALLOWED_HOSTS=localhost:8081,127.0.0.1:8081,[::1]:8081`. The API then answers `421` to a request whose `Host` header is any other name. This is a
  defence against DNS rebinding: a web page on another site that gets its own name to point at your machine would otherwise be able to read the
  API's public routes (`/api/health`, `/api/agents`). The variable is empty by default and is not set by the Terraform in this repository, because in
  Azure the platform and its health probes use addresses the application cannot know; leave it empty there. An IP address as the Host (for example `127.0.0.1`, which the image's own health check uses) is always served, because rebinding needs a domain name. Set it on the **API** only; the worker ignores it.

Front door options for the same-address layout: Azure Front Door or Application Gateway path routing, a small Caddy or nginx
container in front of both, or Azure Static Web Apps with the Container App linked as its API backend. The Static Web Apps option
is **untested** here and has limits
([Container Apps backend](https://learn.microsoft.com/azure/static-web-apps/apis-container-apps),
[API overview](https://learn.microsoft.com/azure/static-web-apps/apis-overview)): the Standard plan is required, the API paths
must start with `/api`, linking adds an `Azure Static Web Apps (Linked)` identity provider on the Container App that by default
accepts only traffic proxied through the static web app, only HTTP is supported, and a request is capped at 45 seconds. That the
proxy forwards the `Authorization` header unchanged is not verified. Any proxy in front of the API can add or remove headers, so
check the response headers there. A front door is not provisioned by the Terraform in this repository and has not been
exercised here (`VALIDATION.md`).

## 2c. Worker

The worker Container App (named `ca-`, your app name, then `-worker`) runs `node apps/worker/dist/main.js` from the same image with the same identity, polling Azure long-running
operations recorded by the API and auditing their completion (ADR-0026). Locally: the `worker` service in
`docker-compose.appliance.yml`.

## 2d. Network rules and optional costs

The two subnets each have a network security group (a firewall for a subnet) with a deny-all-inbound rule at the end, so
only the traffic below gets in (ADR-0032). Outbound traffic is left at Azure's defaults.

> **Provisional, not validated: the Container Apps group (`snet-amo-aca-…`).** The database group is consistent with Microsoft Learn but
> has never been applied. The Container Apps environment is a **workload-profile** environment (owner decision, issue 82): its
> subnet must be at least a /27 and delegated to `Microsoft.App/environments`; `snet-amo-aca-…` is a /26 with that delegation. For
> that kind of environment Microsoft says inbound traffic from the internet "routes through the public IP that exists in the
> managed resource group rather than through your subnet", that inbound subnet rules "apply only to traffic that goes through
> your virtual network", and that locking down inbound traffic with an NSG or firewall "isn't supported"
> ([Network security groups for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/firewall-integration)).
> So this firewall **does not restrict who reaches the API from the internet**. What does: the IP restrictions on the container app
> ingress (`ingress_allowed_source_prefixes`, below) and, above all, the sign-in token with an app role that every protected call needs (everything except the public health and agent-list routes)
> (section 2). Whether the firewall itself lets the environment start has not been shown: a sandbox apply must confirm it.

| Subnet | Allowed in | Everything else |
|---|---|---|
| Container Apps (`snet-amo-aca-…`) | HTTPS (443 and the edge proxy port 31443) from `ingress_allowed_source_prefixes`; the Azure Load Balancer health probes; the subnet's own addresses | denied, including the database subnet |
| Database (`snet-amo-db-…`) | PostgreSQL (5432) from the Container Apps subnet; 5432 inside the database subnet (PostgreSQL features such as high availability need it) | denied |

- **Port 80 is not blocked by this firewall.** Public traffic does not cross the subnet (see the box above), so the firewall cannot
  close port 80 for it. The API app does not accept plain http (`allow_insecure_connections = false`: the platform redirects to
  https), but a client that sends its sign-in token over `http://` before the redirect would still expose it. Use `https://`. The
  rules for ports 80 and 31080 that Microsoft lists are not opened here; whether that matters was not tested.
- **Who can reach the API.** `ingress_allowed_source_prefixes` defaults to `["Internet"]`, because the API is public and every
  call still needs a token with an app role. To allow only your office or VPN, set it to a list of ranges in `terraform.tfvars`,
  for example `ingress_allowed_source_prefixes = ["203.0.113.0/24"]`. They become **Allow rules on the container app ingress**
  (Microsoft Learn, [Set up IP ingress restrictions](https://learn.microsoft.com/en-us/azure/container-apps/ip-restrictions):
  only the listed IPv4 ranges are admitted and everything else is denied; with no rules everything is allowed, which is the
  `Internet` default). That is the control that limits the public path. Ranges must be IPv4 in their network form
  (`203.0.113.0/24` or `198.51.100.7/32`, not `203.0.113.7/24`); IPv6, `0.0.0.0/0` and `"Internet"` mixed with ranges are refused.
  Not verified against a live environment.
- **Address plan.** `vnet_cidr` (default `10.60.0.0/22`) is split into sixteenths: `snet-amo-aca-…` is the first (`10.60.0.0/26`) and
  `snet-amo-db-…` the second (`10.60.0.64/26`). The environment needs `snet-amo-aca-…` to be at least a /27, so `vnet_cidr` must be an IPv4
  range from /8 to /23, and it must not overlap the ranges Azure reserves for these environments (169.254.0.0/16, 172.30.0.0/16,
  172.31.0.0/16, 192.0.2.0/24, 100.100.0.0/17, 100.100.128.0/19, 100.100.160.0/19, 100.100.192.0/19; Microsoft Learn, [Virtual
  network configuration](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks)); Terraform checks both.
- **Extra cost of a workload-profile environment in your own network.** Learn lists a managed resource group (name starts with
  `ME_`) with a public IP for inbound traffic, a public IP for outbound traffic and a standard load balancer, billed on top of the
  apps. Region support and quotas for workload profiles were not checked.
- **Geo-redundant database backup is off.** `postgres_geo_redundant_backup_enabled = true` keeps a second copy of the
  backups in the paired Azure region. It costs money (backup storage is billed for twice the backup size beyond the free
  allowance, see [Backup and restore](https://learn.microsoft.com/azure/postgresql/backup-restore/concepts-backup-restore))
  and Azure only allows choosing it when the server is created: switching it on for an existing server makes Terraform plan
  to destroy and recreate the database. Decide before the first apply. Restoring in the paired region also needs a second
  virtual network and DNS zone, which this configuration does not create.
- **No private endpoint.** The database already has no public address and lives inside the virtual network (virtual network
  integration). Azure Database for PostgreSQL offers either that or a private endpoint, not both, so there is nothing to add;
  see ADR-0032.

## 3. API surface

`GET /api/health` · `GET /api/me` · `GET /api/scopes` (subscriptions incl. Lighthouse-delegated) · `POST /api/assessments {scope:{kind,id}, intent, destinationSubscriptionId?}` · `GET /api/assessments` ·
`GET /api/assessments/{id}` · `POST /api/assessments/{id}/validate-move {targetResourceGroupId}` ·
`POST /api/approvals {operation,targetKey,note}` · `POST /api/execution/resource-mover/{prepare|initiateMove|commit|discard}` (returns `operationId`) · `GET /api/operations/{targetKey}`.

Every state-changing call is audited (`audit_events`). Execution RBAC for Resource Mover (Contributor on source and target
resource groups) is granted **per engagement** and removed afterwards; the base Terraform grants Reader only.

## 4. Local development

`docker compose -f docker-compose.appliance.yml up --build` with `AMO_DISCOVERY_FIXTURE=1` (no Azure) or
`AMO_CREDENTIAL_KIND=azure-cli` with `~/.azure` mounted. The appliance image runs in production mode (`NODE_ENV=production`), so without `AMO_ENTRA_TENANT_ID` and
`AMO_ENTRA_CLIENT_ID` it refuses to start and prints which one is missing (exit code 1); an empty value counts as missing.
Outside production mode (for example `npm run appliance:api` on a laptop) it still starts, and every protected route returns
401 by design.

## 5. Not yet validated against a real tenant

JWKS fetch, Resource Graph paging, `validateMoveResources` polling, Resource Mover API shapes ([VERIFY] 2023-08-01 request
bodies), PostgreSQL Entra token exchange at connect time (implemented as a `pg` password provider, ADR-0025; untested live). All are exercised against fakes in the test suite.

Also not yet validated live: that Entra refuses to issue a token to an unassigned user or application once `app_role_assignment_required` is on, that the `roles` claim carries the assigned role in a real access token, and that the subnet network security groups let the Container Apps environment and the PostgreSQL server come up and talk to each other. The Terraform tests (`terraform test` with mocked providers) and the static tests prove what the configuration declares, not what Azure or Entra do with it. If the Container Apps environment fails to start after the groups are attached, the first rule to review is the one for the Container Apps subnet (section 2d) against the current Microsoft Learn page "Network security groups for configuring a virtual network in Azure Container Apps".
