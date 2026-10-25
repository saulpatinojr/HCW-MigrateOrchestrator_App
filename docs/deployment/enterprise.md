# Appliance deployment (Azure)

Sprint 3 made the appliance a working, fail-closed service (ADR-0022). The Azure SDK is not used; all Azure calls are REST
with dependency-free credentials.

## 1. Provision

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

Creates: resource group, user-assigned identity (Reader on `assessment_scope_ids`), VNet + delegated subnets, PostgreSQL
Flexible Server (private, **Entra-only auth**, the identity is the DB admin), Log Analytics + App Insights, Container Apps
environment + app, Entra app registration with app roles. Follow the `post_apply` output (identifier URI, role assignments).

## 2. Authentication model

| Role | Level | Can |
|---|---|---|
| (signed in, no role) | discovery | run discovery assessments on permitted scopes |
| `Migration.Plan` | planning | + validate-move evidence, plans, bundles |
| `Migration.Execute` | controlled-execution | + record approvals; Resource Mover prepare / initiateMove (approval `production-deploy`) / discard |
| `Migration.Execute.Destructive` | destructive-execution | + commit (approval `data-cutover`), source deletion workflows (future) |

Tokens: authorization-code flow with PKCE in the client; the API validates audience `api://` followed by the API registration's Application (client) ID against the tenant
JWKS. Credentials for Azure calls: managed identity in Container Apps (`AMO_CREDENTIAL_KIND=managed-identity`), workload
identity federation in CI, Azure CLI for local development. `AMO_*SECRET` / `AZURE_*SECRET` variables abort startup.

## 2b. Web UI

`apps/appliance-web` (Vite + React + MSAL). Register a **second**, public-client SPA app registration with redirect URI
set to the exact web address where you host the UI, with no slash at the end (the app sends `window.location.origin`, for example `https://` followed by the host name that Static Web Apps shows once you create it, and Microsoft Entra compares the address exactly), expose the API's `access_as_user` scope on the API registration, and pre-authorize the SPA. Build with
`VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_SPA_CLIENT_ID` and `VITE_API_SCOPE` (public values), and leave `VITE_API_BASE_URL` empty
so the web UI calls `/api/...` on the address that served it.

**The web UI and the API must share one address (same origin).** The API has no CORS support on purpose (a browser rule
that lets one website call an API on another address): it sends no `Access-Control-*` headers, has no allowed-origins
setting, and a web UI hosted on a different address is blocked by the browser (ADR-0031). Put one reverse proxy on a single
address that sends `/api/*` to the API Container App and everything else to the compiled `dist/`. Options: Azure Static Web
Apps (Standard plan) with the Container App linked as its API backend
([Microsoft Learn](https://learn.microsoft.com/azure/static-web-apps/apis-container-apps)), Azure Front Door or Application
Gateway path routing, or a small Caddy or nginx container in front of both. The redirect address registered above is that
one address. Entra token validation on every protected route is unchanged. This front door is not provisioned by the
Terraform in this repository and has not been exercised here (`VALIDATION.md`).

## 2c. Worker

The worker Container App (named `ca-`, your app name, then `-worker`) runs `node apps/worker/dist/main.js` from the same image with the same identity, polling Azure long-running
operations recorded by the API and auditing their completion (ADR-0026). Locally: the `worker` service in
`docker-compose.appliance.yml`.

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
