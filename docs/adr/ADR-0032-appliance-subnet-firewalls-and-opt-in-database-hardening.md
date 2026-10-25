# ADR-0032: Appliance subnet firewalls, and database hardening that costs money stays opt-in

**Status:** Accepted for the `db` firewall and the opt-in variable; the `aca` firewall is **PROVISIONAL, not validated** (see "Open question"); the private endpoint is **Rejected** (see below) · **Date:** 2026-10-25 · **Part of ticket #53 (AMO-12). Amends ADR-0022 (hosting only)**

## Context

A scan of `infrastructure/terraform/appliance-azure` (checkov, run by the person who filed ticket #53) reported four failed
checks: `CKV_AZURE_136` (database backups are not geo-redundant), `CKV2_AZURE_57` (no private endpoint) and `CKV2_AZURE_31`
(no network security group on two subnets, reported twice). Some of those are fixes, and some are cost or architecture
choices that belong to the owner. The `iac-validate` workflow already runs `trivy config` at HIGH and CRITICAL and fails the
job on a finding; that gate stays exactly as it is.

Before this change the Container Apps subnet (`snet-aca`) and the database subnet (`snet-db`) had no network security group
(NSG, a firewall for a subnet), so Azure's default rules applied: any resource in the virtual network could reach both
subnets, and the Container Apps subnet accepted what the platform routed to it.

## Decision

### 1. A firewall on each subnet, deny by default (`db`: done; `aca`: PROVISIONAL, not validated)

**Read this first.** The `db` group is a sound design for a PostgreSQL server in a delegated subnet. The `aca` group is
**provisional and not validated**: it was written for a consumption-only Container Apps environment, and that environment, as
this Terraform describes it, is not valid (see "Open question" below). Do not treat ticket #53's "NSGs attached to both
subnets" as met for `aca` until the owner has chosen the environment type and the rules have been checked against it.

Each subnet gets an NSG, associated with the subnet, whose last rule is an explicit **deny all inbound at priority 4096**.
That rule also overrides Azure's built-in "allow traffic from the virtual network" rule, so a subnet is reachable only through
the rules below. Rules are separate `azurerm_network_security_rule` resources, and the association waits for them; the
Container Apps environment and the PostgreSQL server wait for their subnet's association, so they are created under the
firewall.

| Subnet | Priority | Allow (inbound) | Why it is needed |
|---|---|---|---|
| `snet-aca` | 100 | TCP 443 from `var.ingress_allowed_source_prefixes` (default `["Internet"]`) to the subnet | the API is public (external ingress) and its users sign in from anywhere; every call still needs a token with an app role (ADR-0031) |
| `snet-aca` | 110 | TCP 30000-32767 from `AzureLoadBalancer` | the environment's load balancer health probes (Learn: NSG rules for Container Apps) |
| `snet-aca` | 120 | any from the subnet to itself | the environment's Envoy sidecars talk to each other (Learn) |
| `snet-db` | 100 | TCP 5432 from the `snet-aca` range to the `snet-db` range | the API and worker (in `snet-aca`) are the only database clients |
| `snet-db` | 110 | TCP 5432 from the `snet-db` range to itself | Learn: PostgreSQL features such as high availability need port 5432 inside the delegated subnet if NSGs restrict it |
| both | 4096 | **deny all** | default deny |

Choices inside that table:

- **Port 80 is not opened.** Learn lists 80 and 443 for HTTP and HTTPS. The API is only used over HTTPS, and a closed port 80
  means a mistyped `http://` call never sends a bearer token in clear text; it fails to connect instead of being redirected.
- **Outbound rules are not added.** The defaults (allow to the virtual network and the internet) stay. The Container Apps
  platform and PostgreSQL both have outbound dependencies (container registry, Microsoft Entra ID, Azure Monitor, Storage)
  that a lockdown has to list exactly, and getting that list wrong stops the environment from starting. An outbound lockdown
  is a separate, larger decision.
- **Ranges come from `var.vnet_cidr`** through two locals, so a different address plan keeps the rules correct.
- **`ingress_allowed_source_prefixes`** is `["Internet"]` or a list of CIDR ranges (validated: not empty, no `*`, a service tag
  is not mixed with ranges). An owner who wants the API reachable only from an office or VPN sets the ranges.

### 2. Accepted risk: public HTTPS ingress is flagged by Trivy

With the allow rule in place Trivy reports `AVD-AZU-0047` (CRITICAL, "security group rule allows unrestricted ingress from
any IP address") on `aca_allow_https_from_clients`, which would fail the `iac-validate` gate. The rule is the design: the
container app has `external_enabled = true`, so the API is meant to be reachable over the internet. This is the **only**
suppression, an inline `#trivy:ignore:AVD-AZU-0047` directly above that one resource with the reason beside it; there is no
`.trivyignore` file, and the workflow's severity and exit code are unchanged. A static test fails if a second suppression or an
ignore file appears. The residual risk is that the API accepts connections (not requests: every request needs an Entra token
with an app role) from anywhere. To close it, set `ingress_allowed_source_prefixes` to known ranges.

### 3. Left to the owner: geo-redundant backup, opt-in, default off

`CKV_AZURE_136` is a recovery-capability choice that costs money, so it is a variable and not a default:
`postgres_geo_redundant_backup_enabled`, default `false`, passed to `geo_redundant_backup_enabled` on the server.

- **Cost.** With it on, backups are also copied to the paired region and the billed backup storage is
  `((2 x local backup size) - provisioned storage) x price` (Learn, "Backup and restore"). Provisioned storage is 32 GiB and
  Learn says up to 100 percent of it is included free. I did not estimate a monetary figure: it depends on the backup size and
  the region price.
- **It can only be chosen when the server is created.** Learn: you cannot change the backup redundancy of an existing server.
  Turning the variable on for a server that already exists makes Terraform plan to destroy and recreate the database. The
  variable description and `docs/deployment/enterprise.md` say so; the decision belongs before the first apply.
- **Restoring is not automated.** A geo-restore creates a new server in the paired region in a different virtual network
  (virtual networks cannot span regions), so a DR runbook also needs a second network and DNS zone, which this configuration does
  not create. Enabling the variable gives the backup copy, not a recovery procedure.
- Region and SKU support for geo-redundant backup was not checked here; check the `location` and `postgres_sku` before choosing.

**Decision needed from the owner:** keep the default (no geo-redundant backup, point-in-time restore within the region only), or
turn it on before the first apply and accept the cost.

### 4. Rejected: a private endpoint for the database

`CKV2_AZURE_57` asks for a private endpoint. The database is already private: `public_network_access_enabled = false`, a
delegated subnet and a private DNS zone (virtual network integration). Learn describes the two networking options for Azure
Database for PostgreSQL flexible server as mutually exclusive ("private access (virtual network integration)" or "public
access and private endpoint"). Adding a private endpoint would mean recreating the server in the other mode, changing how the
API reaches it and giving up the Entra-only, no-public-address design of ADR-0022, for no gain in exposure. This is the
"likely false positive" the ticket suspected. No variable is offered because there is no clean switch: it would be a
destructive rebuild. If a private endpoint on the Container Apps environment is ever wanted, it needs a workload-profile
environment with public network access disabled, which removes the public API; that is a different architecture and a new ADR.

I could not re-run checkov here (the image is about a gigabyte and the machine was nearly out of disk), so I cannot say which
resource `CKV2_AZURE_57` names; the two candidates in this configuration are the database and the Container Apps
environment, and both are covered above. The ticket's `CKV2_AZURE_31` (NSG on two subnets) is fixed by section 1.

### 5. Scanning

- `iac-validate` is unchanged except for one added step, `terraform test`, which runs plan-only tests against mocked providers
  (`infrastructure/terraform/appliance-azure/tests/appliance.tftest.hcl`): no credentials, nothing applied.
- `scripts/ci/local-iac-checks.sh` runs `terraform` (fmt, init without a backend, validate, test) with Terraform 1.9.8 and
  `trivy config` at HIGH,CRITICAL in disposable containers pinned by digest (Trivy 0.76.1 by digest, the same pattern as
  the other HCW repositories). It refuses a Docker engine that is not the local one.
- **Ticket #53 is only partly done on scanning.** checkov was not run and was not added to CI, and the "stored baseline" below is prose in this ADR: nothing in the pipeline compares a scan against it. The gate that exists is Trivy at HIGH,CRITICAL failing the job.
- **Baseline (Trivy 0.76.1, 2026-10-25).** Before this change: 0 findings at HIGH and CRITICAL; 3 at MEDIUM
  (`AVD-AZU-0019` connection logging, `AVD-AZU-0021` connection throttling, `AVD-AZU-0024` checkpoint logging). After: 0 at
  HIGH and CRITICAL with the one suppression above; the same MEDIUM findings remain. The MEDIUM findings are **not** fixed here
  and not suppressed: they are PostgreSQL server parameters (`log_connections`, `connection_throttle.enable`,
  `log_checkpoints`) outside this ticket, and the gate does not fail on MEDIUM. Raising the gate to MEDIUM would fail
  the build until they are fixed; that is a follow-up, not part of this decision.

## Consequences

- The `aca` rules follow the Learn page for a **consumption-only** Container Apps environment, which is what this
  configuration creates (it has no `workload_profile` block). That environment type is not valid as configured, so the
  rules are provisional (next section).
- **Not verified, and the largest risk of this change:** that the environment and the database come up under these rules, and
  that Learn's list of Container Apps rules is complete. Nothing was applied. Two details of the `aca` group are
  unverified: closing port 80 (Learn lists 80 and 443 for a consumption-only environment, and I assumed 443 is enough for an
  API that is only used over HTTPS), and the extra Learn row that allows client addresses to the environment's `staticIP`
  (I left it out because, for an external environment, that address is the public one in a managed resource group and not in
  the subnet). If the environment fails to start or the API is unreachable after the groups are attached, review these first.
- The rule that allows the internet passes the tag in the singular `source_address_prefix`, and the ranges in the plural
  `source_address_prefixes`, because the azurerm documentation says the plural argument does not accept tags.

## Open question for the owner: Container Apps environment type and subnet (not decided here)

Found while reviewing, and not changed: `snet-aca` is a /26 (the default `vnet_cidr` is a /22 split into sixteenths), it is
**delegated** to `Microsoft.App/environments`, and the environment resource has no `workload_profile` block, which makes it a
**consumption-only** environment. Per Microsoft Learn ([Virtual network configuration](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks))
a consumption-only environment needs a subnet of at least **/23** and the subnet **must not be delegated** to any service.
So resizing the subnet alone does not make the configuration valid, and the delegation as written suits the other type.
It has never been applied, so this probably fails at the first real apply. A second Learn constraint
([Network security groups for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/firewall-integration)):
for an **external workload-profile** environment, inbound traffic arrives through a public IP in a managed resource group and
locking down inbound traffic with an NSG or firewall is **not supported**.

| | Option A: consumption-only, /23, not delegated | Option B: workload profiles, /27 or larger, delegated |
|---|---|---|
| Learn status | the legacy type | the default type |
| `snet-aca` | enlarge to at least /23 and remove the delegation, which changes the address plan (and `snet-db` moves) | the current /26 is large enough and already delegated; add a `workload_profile` block (a Consumption profile) |
| Environment | stays consumption-only; no UDRs or NAT gateway | new environment type; an existing environment cannot be converted, it is recreated |
| NSG on `snet-aca` | applicable (the provisional rules are written for this type) | inbound lockdown by NSG is **not supported** for an external environment, so the `aca` group would not protect the API |
| Limiting who reaches the API | NSG source ranges | container app ingress IP restrictions instead of NSG inbound rules |
| What this ADR's `aca` group becomes | validated against Learn, then kept | removed or reduced to the rules Learn supports; the `db` group is unchanged |

Either option is a new ADR and a changed address plan or environment resource, so it needs an owner decision and its own
ticket. Until then the `aca` group is provisional.

## Rollback

- **Network security groups.** Remove the two `azurerm_subnet_network_security_group_association` resources first (the
  subnets are then unfiltered again, which restores the previous behaviour), then the groups and rules. In Terraform:
  delete the association blocks and the two `depends_on` references to them and apply; then delete the groups. Do it in two
  applies, not one, so no subnet is left pointing at a deleted group. For an emergency on a live environment, detach the
  group from the subnet in the portal (Virtual networks, Subnets, Network security group set to None).
- **Geo-redundant backup.** Leave the variable `false` (the default). Once a server has been created with it on, it cannot
  be switched off in place; the server would be recreated or restored.

## Other consequences

- No existing resource changes by default except that two NSGs, seven rules and two associations are added, two `depends_on`
  edges are added, and the server states `geo_redundant_backup_enabled = false`, which is the provider default.
- Adding the groups to an already deployed subnet is a change to a live network; plan it in a maintenance window and read
  the plan first.
