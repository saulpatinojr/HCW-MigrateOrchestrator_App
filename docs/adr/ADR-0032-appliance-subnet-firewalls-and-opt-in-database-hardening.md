# ADR-0032: Appliance subnet firewalls, and database hardening that costs money stays opt-in

**Status:** Accepted for the `db` firewall and the opt-in variable; the `aca` firewall is **PROVISIONAL, not validated** (see section 1); the Container Apps environment is a **workload-profile** environment (owner decision, issue 82, see "Decision: Container Apps environment"); the private endpoint is **Rejected** (see below) · **Date:** 2026-10-25 · **Part of ticket #53 (AMO-12). Amends ADR-0022 (hosting only)**

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

**Read this first.** The `db` group is consistent with Microsoft Learn for a PostgreSQL flexible server in a delegated subnet, and has never been applied. The `aca` group is
**provisional and not validated**: it has never been applied, and it **does not restrict who reaches the API from the internet**.
Microsoft Learn ([Network security groups for Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/firewall-integration)) says that for an external workload-profile
environment inbound traffic "routes through the public IP that exists in the managed resource group rather than through your
subnet", that "inbound NSG rules apply only to traffic that goes through your virtual network", and that "locking down inbound
traffic via NSG or firewall on an external workload profile environment isn't supported". So the `aca` group only limits traffic
that crosses the virtual network. What limits the public path is (a) the IP restrictions on the container app ingress, driven by
`ingress_allowed_source_prefixes` (Learn: [Set up IP ingress restrictions](https://learn.microsoft.com/en-us/azure/container-apps/ip-restrictions)), and above all (b) the Microsoft Entra
bearer token with an app role that the API requires on every protected request (every route except the public `/api/health` and `/api/agents`) (ADR-0031). A sandbox apply must confirm that the environment
starts and the API answers over 443 with this group attached before the PROVISIONAL label is removed (issues 82 and 53).
Each subnet gets an NSG, associated with the subnet, whose last rule is an explicit **deny all inbound at priority 4096**.
That rule also overrides Azure's built-in "allow traffic from the virtual network" rule, so a subnet is reachable only through
the rules below. Rules are separate `azurerm_network_security_rule` resources, and the association waits for them; the
Container Apps environment and the PostgreSQL server wait for their subnet's association, so they are created under the
firewall.

| Subnet | Priority | Allow (inbound) | Why it is needed |
|---|---|---|---|
| `snet-aca` | 100 | TCP 443 and 31443 (the edge proxy port) from `var.ingress_allowed_source_prefixes` (default `["Internet"]`) to the subnet | Learn's workload-profile inbound rows for HTTPS; relevant only to traffic that enters through the virtual network, see above |
| `snet-aca` | 110 | TCP 30000-32767 from `AzureLoadBalancer` | the environment's load balancer health probes (Learn: workload-profile inbound table) |
| `snet-aca` | 120 | any from the subnet to itself | traffic inside the delegated subnet (Learn's workload-profile table lists the subnet-to-subnet rule under outbound; allowing it inbound is this configuration's reading and is unverified) |
| `snet-db` | 100 | TCP 5432 from the `snet-aca` range to the `snet-db` range | the API and worker (in `snet-aca`) are the only database clients |
| `snet-db` | 110 | TCP 5432 from the `snet-db` range to itself | Learn: PostgreSQL features such as high availability need port 5432 inside the delegated subnet if NSGs restrict it |
| both | 4096 | **deny all** | default deny |

Choices inside that table:

- **Port 80 is not opened in the NSG, and that protects nothing on the public path.** Learn's workload-profile table lists 80 and
  31080 for HTTP as well; this configuration omits them. Because public traffic does not pass the subnet, the NSG does not stop a
  client from reaching port 80 of the environment's public IP. The container app sets `allow_insecure_connections = false`, so the
  platform redirects http to https, but a client that sends a bearer token over plain http before the redirect would still expose
  it. The clients (the web page, the CLI) use https; this is a residual risk, not a control.
- **Learn's static-IP row is not used.** That row belongs to consumption-only environments; none exists in the workload-profile table.
- **Outbound rules are not added.** (Learn, networking with private access, for the database subnet: if outbound is ever restricted, the **Storage** service tag, port 443, and **Microsoft Entra ID** (`AzureActiveDirectory`) must be allowed, because PostgreSQL archives write-ahead logs to Storage and this server uses Entra authentication.) The defaults (allow to the virtual network and the internet) stay. The Container Apps
  platform and PostgreSQL both have outbound dependencies (container registry, Microsoft Entra ID, Azure Monitor, Storage)
  that a lockdown has to list exactly, and getting that list wrong stops the environment from starting. An outbound lockdown
  is a separate, larger decision.
- **Ranges come from `var.vnet_cidr`** through two locals, so a different address plan keeps the rules correct.
- **`ingress_allowed_source_prefixes`** is `["Internet"]` or a list of CIDR ranges (validated: not empty, no `*`, a service tag
  is not mixed with ranges). An owner who wants the API reachable only from an office or VPN sets the ranges.

### 2. Accepted risk: the HTTPS allow rule is flagged by Trivy

With the allow rule in place Trivy reports `AVD-AZU-0047` (CRITICAL, "security group rule allows unrestricted ingress from
any IP address") on `aca_allow_https_from_clients` when the source is the default `Internet` tag, which would fail the
`iac-validate` gate. The container app has `external_enabled = true`, so the API is meant to be reachable over the internet, and
per Learn this NSG rule does not decide that for the public path. It is the **only** suppression, an inline
`#trivy:ignore:AVD-AZU-0047` directly above that one resource with the reason beside it; there is no `.trivyignore` file, and the
workflow's severity and exit code are unchanged. A static test fails if a second suppression or an ignore file appears. The
residual risk is that the API accepts connections (not requests: every protected request (every route except the public `/api/health` and `/api/agents`) needs an Entra token with an app role) from
anywhere. To close it, set `ingress_allowed_source_prefixes` to known ranges: they become Allow rules on the container app
ingress (the control that limits the public path) and are mirrored in this rule.

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

- The `aca` rules follow Learn's inbound table for a **workload-profile** environment (443 and 31443 for HTTPS clients, the Azure
  Load Balancer probe range, and the deny-all at the end). They are provisional (section 1).
- **Not verified, and the largest risk of this change:** that the environment and the database come up under these rules, that
  Learn's list is complete, and how the NSG behaves for an external workload-profile environment at all (Learn says the public path
  does not cross the subnet). Nothing was applied. Unverified details of the `aca` group: leaving out ports 80 and 31080, reading
  the subnet-to-subnet rule as also needed inbound, and whether the deny-all at the end affects anything the platform needs. If
  the environment fails to start or the API is unreachable after the groups are attached, review these first.
- The rule that allows the internet passes the tag in the singular `source_address_prefix`, and the ranges in the plural
  `source_address_prefixes`, because the azurerm documentation says the plural argument does not accept tags.

## Decision: Container Apps environment (owner, issue 82)

Found in review and decided by the owner on 2026-10-25 in a comment on [issue 82](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues/82):
**a workload-profile Container Apps environment** (subnet at least /27, delegated to `Microsoft.App/environments`, with a
`workload_profile` block). Label note: this is workload profiles, which is **this issue's Option B** (the issue text lists
consumption-only as Option A); the owner answered "workload" on 2026-10-25, and an earlier comment on the issue that called the
choice "option A" described the same workload-profile environment. The workload-profile description (subnet /27 or larger,
delegated, with a `workload_profile` block) is what is implemented.

**Why the previous configuration was invalid.** It had no `workload_profile` block, so the environment was consumption-only, which
per Learn ([Virtual network configuration](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks)) needs a subnet of at least /23 that must not be delegated, while
`snet-aca` was a /26 delegated to `Microsoft.App/environments`. The azurerm provider documents the same split (/23 for
consumption-only, /27 for workload profiles) and that an environment created without a profile cannot get one later.

**What changed, with the Learn basis:**

| Change | Basis |
|---|---|
| `azurerm_container_app_environment.app` has one `workload_profile` named and typed `Consumption` | provider docs: a `Consumption` profile must be named `Consumption`, one per environment; Learn: workload-profile environments are the default type |
| `snet-aca` stays delegated to `Microsoft.App/environments` and must be at least a /27 | Learn, workload profile tab: "The minimum subnet size required ... is /27. You must delegate your subnet to Microsoft.App/environments" |
| `snet-aca` stays a /26 (the first sixteenth of the default /22) | Learn's table: a /26 has 50 available addresses and fits 250 Consumption-profile replicas; this configuration runs at most 3 API replicas and 1 worker, and a revision change temporarily doubles the need |
| `vnet_cidr` must be an IPv4 range from /8 to /23, so the first sixteenth is never smaller than a /27 | arithmetic on the above |
| `vnet_cidr` must not overlap `169.254.0.0/16`, `172.30.0.0/16`, `172.31.0.0/16`, `192.0.2.0/24`, `100.100.0.0/17`, `100.100.128.0/19`, `100.100.160.0/19`, `100.100.192.0/19` (a precondition on the subnet, compared as integers because Terraform has no overlap function) | Learn, "Restrictions for subnet address ranges", workload profile tab |
| `snet-aca` and `snet-db` are the first two sixteenths of `vnet_cidr`, so they cannot overlap each other; the default plan is `10.60.0.0/26` and `10.60.0.64/26`, unchanged | `cidrsubnet(vnet_cidr, 4, 0)` and `(…, 4, 1)`; tested |
| Both container apps set `workload_profile_name = "Consumption"` | provider docs: names the profile to place the app on |
| The API ingress sets `allow_insecure_connections = false` and turns `ingress_allowed_source_prefixes` into Allow rules (`ip_security_restriction`) when ranges are given; the default `Internet` adds none | Learn, "Set up IP ingress restrictions": allow rules admit only the listed IPv4 CIDR ranges and deny the rest, all rules must be the same type, and with no rules everything is allowed |
| The plan-time stop (`acknowledge_container_apps_environment_is_invalid_issue_82` and the precondition) is **removed** | the combination is now valid per Learn; nothing in it is known to be invalid, so no narrower precondition was kept except the address-range one above |

**Cost and recreate impact.** Nothing is deployed, so nothing is recreated now. For the record: an environment cannot be converted
between types (the provider recreates it), and for a workload-profile environment in your own network Learn lists extra managed
resources that are billed on top of the app: a `ME_`-prefixed resource group with a standard public IP for ingress (external
environment), a second public IP for egress, and a standard load balancer. I did not estimate a monetary figure.

**What I did not decide.** Whether to use dedicated profiles (not needed: the code has no hardware requirement), an internal
environment, NAT gateway or user-defined routes (workload profiles support them; not used), or a custom resource group name for the
managed resources (the default is used). Region support and quotas for workload profiles were not checked.

**Status.** `terraform plan` is no longer stopped; the configuration has still **never been applied**. A sandbox apply is pending
and is the evidence that closes issue 82 and the `aca` part of ticket #53.

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
