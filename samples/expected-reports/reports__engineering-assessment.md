# Engineering assessment

> Hybrid Cloud Works Migration Explorer: analysis of an exported inventory only. No Azure tenant was accessed.
> Dispositions are rule-based recommendations, not an authoritative Microsoft assessment. Validate every conditional or unknown item with an authenticated inspection and the current Microsoft Learn move-support matrix.
> Generated Terraform, scripts and runbooks are illustrative and not production-approved until validated (fmt/validate/scan/plan/human approval).

## Decision table

| Resource | Type | Disposition | Infra | Config | Identity | Data | Tool | Confidence | Rule |
|---|---|---|---|---|---|---|---|---|---|
| hcw-sample-rg-billing-prod-eus | Microsoft.Resources/resourceGroups | recreate-only | recreate | reconstruct | not-applicable | not-applicable | terraform-redeploy | medium (0.74) | azure.resources.resourcegroups |
| hcw-sample-vnet-billing-prod-eus | Microsoft.Network/virtualNetworks | native-move | recreate | reconstruct | reconstruct | replicate | azure-resource-mover | medium (0.74) | azure.network.virtualnetworks |
| hcw-sample-snet-app | Microsoft.Network/virtualNetworks/subnets | native-move | recreate | reconstruct | not-applicable | not-applicable | azure-resource-mover | medium (0.74) | azure.network.virtualnetworks.subnets |
| hcw-sample-nsg-app | Microsoft.Network/networkSecurityGroups | native-move | recreate | reconstruct | reconstruct | replicate | azure-resource-mover | medium (0.74) | azure.network.networksecuritygroups |
| hcw-sample-pip-lb-billing | Microsoft.Network/publicIPAddresses | recreate-and-migrate | recreate | reconstruct | not-applicable | not-applicable | azure-resource-mover | medium (0.7) | azure.network.publicipaddresses |
| hcw-sample-lb-billing-prod | Microsoft.Network/loadBalancers | native-move | recreate | reconstruct | reconstruct | replicate | azure-resource-mover | medium (0.65) | azure.network.loadbalancers |
| hcw-sample-nic-vm-billing-01 | Microsoft.Network/networkInterfaces | native-move | recreate | reconstruct | reconstruct | replicate | azure-resource-mover | medium (0.74) | azure.network.networkinterfaces |
| hcw-sample-vm-billing-01 | Microsoft.Compute/virtualMachines | native-move | recreate | reconstruct | reconstruct | replicate | azure-resource-mover | medium (0.74) | azure.compute.virtualmachines |
| hcw-sample-vm-billing-01_OsDisk | Microsoft.Compute/disks | orchestrated-migration | recreate | reconstruct | not-applicable | replicate | azure-resource-mover | medium (0.74) | azure.compute.disks |
| hcw-sample-avset-billing | Microsoft.Compute/availabilitySets | native-move | recreate | reconstruct | reconstruct | replicate | azure-resource-mover | medium (0.74) | azure.compute.availabilitysets |
| hcwsamplestbillingprod | Microsoft.Storage/storageAccounts | recreate-and-migrate | recreate | reconstruct | reconstruct | sync-and-cutover | azure-storage-mover | medium (0.74) | org.hcw.storage.storageaccounts.region |
| hcw-sample-kv-billing | Microsoft.KeyVault/vaults | recreate-and-migrate | recreate | reconstruct | reconstruct | backup-restore | backup-and-restore | medium (0.74) | azure.keyvault.vaults |
| hcw-sample-sql-billing-prod-eus | Microsoft.Sql/servers | recreate-and-migrate | recreate | reconstruct | reconstruct | replicate | failover-group | medium (0.74) | azure.sql.servers |
| hcw-sample-billingdb | Microsoft.Sql/servers/databases | recreate-and-migrate | recreate | reconstruct | not-applicable | replicate | geo-replication | medium (0.74) | azure.sql.servers.databases |
| hcw-sample-psql-billing-prod-eus | Microsoft.DBforPostgreSQL/flexibleServers | recreate-and-migrate | recreate | reconstruct | reconstruct | replicate | native-database-replication | medium (0.74) | azure.dbforpostgresql.flexibleservers |
| hcw-sample-cosmos-billing-prod | Microsoft.DocumentDB/databaseAccounts | orchestrated-migration | move-with-resource | reconstruct | not-applicable | replicate | service-specific-migration | medium (0.7) | azure.documentdb.databaseaccounts |
| hcwsampleacrbilling | Microsoft.ContainerRegistry/registries | recreate-and-migrate | recreate | reconstruct | reconstruct | export-import | container-image-copy | medium (0.74) | azure.containerregistry.registries |
| hcw-sample-asp-billing-prod-eus | Microsoft.Web/serverFarms | recreate-only | recreate | reconstruct | reconstruct | not-applicable | terraform-redeploy | medium (0.74) | azure.web.serverfarms |
| hcw-sample-app-billing-web-prod | Microsoft.Web/sites | recreate-and-migrate | recreate | reconstruct | reconstruct | export-import | application-deployment | medium (0.74) | azure.web.sites |
| hcw-sample-func-billing-jobs-prod | Microsoft.Web/sites | recreate-and-migrate | recreate | reconstruct | reconstruct | export-import | application-deployment | medium (0.74) | azure.web.sites |
| hcw-sample-appi-billing-prod | Microsoft.Insights/components | recreate-and-migrate | recreate | reconstruct | not-applicable | retain-in-source | terraform-redeploy | medium (0.74) | azure.insights.components |
| hcw-sample-log-prod-eus | Microsoft.OperationalInsights/workspaces | recreate-and-migrate | recreate | reconstruct | not-applicable | retain-in-source | terraform-redeploy | medium (0.74) | azure.operationalinsights.workspaces |
| hcw-sample-rsv-prod-eus | Microsoft.RecoveryServices/vaults | recreate-only | recreate | reconstruct | reconstruct | retain-in-source | terraform-redeploy | medium (0.74) | azure.recoveryservices.vaults |
| hcw-sample-pe-sql-billing | Microsoft.Network/privateEndpoints | recreate-only | recreate | reconstruct | reconstruct | not-applicable | terraform-redeploy | medium (0.74) | azure.network.privateendpoints |
| privatelink.database.windows.net | Microsoft.Network/privateDnsZones | retain | not-applicable | not-applicable | not-applicable | not-applicable | none | medium (0.74) | azure.network.privatednszones |
| hcw-sample-id-billing-app | Microsoft.ManagedIdentity/userAssignedIdentities | recreate-only | recreate | reconstruct | reconstruct | not-applicable | terraform-redeploy | medium (0.74) | azure.managedidentity.userassignedidentities |
| hcw-sample-ag-platform-oncall | Microsoft.Insights/actionGroups | retain | not-applicable | not-applicable | not-applicable | not-applicable | none | medium (0.74) | azure.insights.actiongroups |
| hcw-sample-alert-vm-cpu | Microsoft.Insights/metricAlerts | recreate-only | recreate | reconstruct | reconstruct | not-applicable | terraform-redeploy | medium (0.74) | azure.insights.metricalerts |
| hcw-sample-quantum-research-01 | Microsoft.Quantum/Workspaces | unknown-requires-validation | unknown | unknown | unknown | unknown | none | low (0.2) | — |

## Per-resource detail

### hcw-sample-rg-billing-prod-eus

- Type: `Microsoft.Resources/resourceGroups` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-only** via **terraform-redeploy** (alternatives: none)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: not-applicable
- Support — RG move: unsupported; subscription move: unsupported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 24
- Confidence: medium (0.74) — rule confidence 0.95; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.resources.resourcegroups v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Secondary actions**
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] type = Microsoft.Resources/resourceGroups
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing","environment":"prod","owner":"platform-team"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move resources to a new resource group or subscription (https://learn.microsoft.com/azure/azure-resource-manager/management/move-resource-group-and-subscription, 2026-10-03)
- [general-rule] A resource group is a container; its location only stores metadata. Create the destination group and move/recreate the contents.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-vnet-billing-prod-eus

- Type: `Microsoft.Network/virtualNetworks` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 16
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.network.virtualnetworks v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Dependencies**
- child → hcw-sample-snet-app [discovered]

**Prerequisites**
- All VNet peerings must be removed before a move and re-established afterwards
- Subnets with delegations, service endpoints or private endpoints require the dependent services to be handled first

**Risks**
- Address space collisions with existing destination networks/hub
- Peering, UDR and DNS settings are not carried by an ARM move

**Validation**
- Address space, subnets, NSG/UDR associations, peering state, DNS servers

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-vnet-billing-prod-eus
- [observed-from-csv] type = microsoft.network/virtualnetworks
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/virtualNetworks/hcw-sample-vnet-billing-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing","environment":"prod"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Azure Resource Mover overview (https://learn.microsoft.com/azure/resource-mover/overview, 2026-10-03)
- [general-rule] Relocate Azure Virtual Network to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-virtual-network, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-snet-app

- Type: `Microsoft.Network/virtualNetworks/subnets` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 28
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.network.virtualnetworks.subnets v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Dependencies**
- parent → hcw-sample-vnet-billing-prod-eus [discovered] — parent present in inventory

**Secondary actions**
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-snet-app
- [observed-from-csv] type = microsoft.network/virtualnetworks/subnets
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/virtualNetworks/hcw-sample-vnet-billing-prod-eus/subnets/hcw-sample-snet-app
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Move resources to a new resource group or subscription (https://learn.microsoft.com/azure/azure-resource-manager/management/move-resource-group-and-subscription, 2026-10-03)
- [general-rule] Child resource: always moves with the parent virtual network.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-nsg-app

- Type: `Microsoft.Network/networkSecurityGroups` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 18
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.network.networksecuritygroups v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Validation**
- Rule count and effective security rules match
- Associations re-established

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-nsg-app
- [observed-from-csv] type = microsoft.network/networksecuritygroups
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/networkSecurityGroups/hcw-sample-nsg-app
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Azure Resource Mover overview (https://learn.microsoft.com/azure/resource-mover/overview, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-pip-lb-billing

- Type: `Microsoft.Network/publicIPAddresses` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: conditional; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 15
- Confidence: medium (0.7) — rule confidence 0.8; conditional support (-0.1)
- Rule: azure.network.publicipaddresses v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_CONDITIONAL · human approval: required

**Blockers**
- Rule requires human review before this disposition is accepted.

**Risks**
- The IP address value cannot be preserved across regions; DNS records, firewall allowlists and partner integrations must be updated
- Basic SKU public IPs are retired and must be replaced with Standard SKU

**Mitigations**
- Lower DNS TTL ahead of cutover; inventory external allowlists

**Secondary actions**
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-pip-lb-billing
- [observed-from-csv] type = microsoft.network/publicipaddresses
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/publicIPAddresses/hcw-sample-pip-lb-billing
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Standard
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Azure Resource Mover overview (https://learn.microsoft.com/azure/resource-mover/overview, 2026-10-03)
- [general-rule] Public IP addresses in Azure (https://learn.microsoft.com/azure/virtual-network/ip-services/public-ip-addresses, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-lb-billing-prod

- Type: `Microsoft.Network/loadBalancers` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: conditional; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 17
- Confidence: medium (0.65) — rule confidence 0.75; conditional support (-0.1)
- Rule: azure.network.loadbalancers v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_CONDITIONAL · human approval: required

**Dependencies**
- network → hcw-sample-pip-lb-billing [inferred] — frontend IP configuration (inferred from type and shared resource group; confirm with authenticated discovery)
- network → hcw-sample-vnet-billing-prod-eus [inferred] — internal frontend in a subnet (inferred from type and shared resource group; confirm with authenticated discovery)

**Risks**
- Constraint: Basic SKU load balancers are retired; plan an upgrade to Standard as part of the migration
- Constraint: Resource Mover supports internal and Standard public load balancers; backend pool members must move in the same move collection

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-lb-billing-prod
- [observed-from-csv] type = microsoft.network/loadbalancers
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/loadBalancers/hcw-sample-lb-billing-prod
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Standard
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Azure Resource Mover overview (https://learn.microsoft.com/azure/resource-mover/overview, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-nic-vm-billing-01

- Type: `Microsoft.Network/networkInterfaces` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 19
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.network.networkinterfaces v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Dependencies**
- network → hcw-sample-vnet-billing-prod-eus [inferred] — NIC lives in a subnet of the VNet (inferred from type and shared resource group; confirm with authenticated discovery)
- network → hcw-sample-nsg-app [inferred] — NSG may be associated to the NIC or subnet (inferred from type and shared resource group; confirm with authenticated discovery)
- network → hcw-sample-pip-lb-billing [inferred] — public IP may be bound to the NIC (inferred from type and shared resource group; confirm with authenticated discovery)

**Risks**
- Constraint: Private IP addresses are re-allocated at the destination unless statically configured in the target subnet range

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-nic-vm-billing-01
- [observed-from-csv] type = microsoft.network/networkinterfaces
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/networkInterfaces/hcw-sample-nic-vm-billing-01
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Support matrix for moving Azure VMs across regions (https://learn.microsoft.com/azure/resource-mover/support-matrix-move-region-azure-vm, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-vm-billing-01

- Type: `Microsoft.Compute/virtualMachines` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: azure-migrate, backup-and-restore, terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 26
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.compute.virtualmachines v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Dependencies**
- hard → hcw-sample-nic-vm-billing-01 [inferred] — VMs attach NICs; the NIC must exist in the destination VNet first (inferred from type and shared resource group; confirm with authenticated discovery)
- hard → hcw-sample-vm-billing-01_osdisk [inferred] — OS/data disks move with the VM (inferred from type and shared resource group; confirm with authenticated discovery)
- soft → hcw-sample-avset-billing [inferred] — availability set membership is set at VM creation (inferred from type and shared resource group; confirm with authenticated discovery)

**Prerequisites**
- Dependent NICs, disks, VNet, NSG and public IPs move together or already exist at the destination
- Stop Azure Backup/ASR protection before the move; re-enable afterwards

**Risks**
- VM must be deallocated for a region move; public IP address changes
- Extensions and boot diagnostics storage must be re-pointed
- Constraint: VMs with Azure Site Recovery replication, Azure Backup protection, or marketplace plans need the protection removed or the plan accepted before move
- Constraint: Resource Mover requires managed disks; unmanaged disks are not supported

**Mitigations**
- Schedule within the downtime window; pre-stage DNS TTL reductions

**Validation**
- VM boots and agent reports Ready
- Disk count/size match
- NSG/route effective rules match
- Application smoke test

**Rollback**
- Resource Mover: discard the move and restore source; ARM move: move back to the source scope

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-vm-billing-01
- [observed-from-csv] type = microsoft.compute/virtualmachines
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Compute/virtualMachines/hcw-sample-vm-billing-01
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Standard_D4s_v5
- [observed-from-csv] tags = {"application":"billing","environment":"prod"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Support matrix for moving Azure VMs across regions (https://learn.microsoft.com/azure/resource-mover/support-matrix-move-region-azure-vm, 2026-10-03)
- [general-rule] Azure Resource Mover overview (https://learn.microsoft.com/azure/resource-mover/overview, 2026-10-03)
- [general-rule] Transfer an Azure subscription to a different Microsoft Entra directory (https://learn.microsoft.com/azure/role-based-access-control/transfer-subscription, 2026-10-03)
- [general-rule] Azure Site Recovery is listed only as the DR mechanism for the migrated VM, never as the migration tool.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-vm-billing-01_OsDisk

- Type: `Microsoft.Compute/disks` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **orchestrated-migration** via **azure-resource-mover** (alternatives: backup-and-restore, export-and-import)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: replicate
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 25
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.compute.disks v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Risks**
- Constraint: Disks attached to a VM move with the VM; detached disks relocate via snapshot copy to the target region

**Validation**
- Disk SKU, size and encryption settings match

**Rollback**
- Source disk/snapshot retained until cutover is verified

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-vm-billing-01_OsDisk
- [observed-from-csv] type = microsoft.compute/disks
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Compute/disks/hcw-sample-vm-billing-01_OsDisk
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Premium_LRS
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Support matrix for moving Azure VMs across regions (https://learn.microsoft.com/azure/resource-mover/support-matrix-move-region-azure-vm, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-avset-billing

- Type: `Microsoft.Compute/availabilitySets` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **native-move** via **azure-resource-mover** (alternatives: terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 9
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.compute.availabilitysets v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-avset-billing
- [observed-from-csv] type = microsoft.compute/availabilitysets
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Compute/availabilitySets/hcw-sample-avset-billing
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Aligned
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Support matrix for moving Azure VMs across regions (https://learn.microsoft.com/azure/resource-mover/support-matrix-move-region-azure-vm, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcwsamplestbillingprod

- Type: `Microsoft.Storage/storageAccounts` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **azure-storage-mover** (alternatives: azcopy, object-replication, azure-data-factory, data-box)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: sync-and-cutover
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: hours; RTO/RPO compatibility: unknown/unknown; sequence: 13
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: org.hcw.storage.storageaccounts.region v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Prerequisites**
- Storage Mover agent or cloud-to-cloud job authorized against source and destination with managed identity (no account keys)

**Blockers**
- Rule requires human review before this disposition is accepted.

**Risks**
- Account name is globally unique and cannot be reused while the source exists
- Lifecycle, soft-delete, immutability and network rules are not copied by data tools

**Mitigations**
- Incremental Storage Mover jobs, freeze, final pass, reconciliation on object counts and bytes

**Validation**
- Container/share inventory matches
- Object counts and total bytes reconcile
- Access tier, encryption and network rules match

**Rollback**
- Source account stays authoritative until applications are verified against the destination

**Secondary actions**
- Data path: sync-and-cutover — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcwsamplestbillingprod
- [observed-from-csv] type = microsoft.storage/storageaccounts
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Storage/storageAccounts/hcwsamplestbillingprod
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] kind = StorageV2
- [observed-from-csv] sku = Standard_GRS
- [observed-from-csv] tags = {"application":"billing","environment":"prod"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Relocate Azure Storage Account to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-storage-account, 2026-10-03)
- [general-rule] What is Azure Storage Mover? (https://learn.microsoft.com/azure/storage-mover/service-overview, 2026-10-03)
- [general-rule] Hybrid Cloud Works standard: prefer the managed Azure Storage Mover service over AzCopy for region and tenant moves so that jobs are auditable and keyless. AzCopy remains the fallback for small ad-hoc copies.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-kv-billing

- Type: `Microsoft.KeyVault/vaults` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **backup-and-restore** (alternatives: manual-reconstruction, terraform-redeploy)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: backup-restore
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 6
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.keyvault.vaults v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Blockers**
- Rule requires human review before this disposition is accepted.

**Risks**
- Applications referencing the vault URI break at cutover
- Secret versions and rotation history may not carry
- Constraint: Vault names are globally unique; soft-delete and purge protection block name reuse until purge
- Constraint: Key Vault backup/restore of secrets, keys and certificates works only within the same Azure geography and subscription

**Validation**
- Secret/key/certificate inventory count matches
- RBAC/access policies reproduced for destination identities
- Dependent app settings resolve

**Secondary actions**
- Data path: backup-restore — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-kv-billing
- [observed-from-csv] type = microsoft.keyvault/vaults
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.KeyVault/vaults/hcw-sample-kv-billing
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = standard
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Moving an Azure Key Vault across subscriptions / tenants (https://learn.microsoft.com/azure/key-vault/general/move-subscription, 2026-10-03)
- [general-rule] Relocate Azure Key Vault to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-key-vault, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-sql-billing-prod-eus

- Type: `Microsoft.Sql/servers` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **failover-group** (alternatives: geo-replication, export-and-import, azure-database-migration-service, backup-and-restore)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 10
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.sql.servers v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- child → hcw-sample-billingdb [discovered]

**Risks**
- Constraint: Logical server name is globally unique (DNS); firewall rules, auditing, Entra admin and TDE keys are server-level configuration

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-sql-billing-prod-eus
- [observed-from-csv] type = microsoft.sql/servers
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Sql/servers/hcw-sample-sql-billing-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Active geo-replication (https://learn.microsoft.com/azure/azure-sql/database/active-geo-replication-overview, 2026-10-03)
- [general-rule] Failover groups overview (https://learn.microsoft.com/azure/azure-sql/database/failover-group-sql-db, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-billingdb

- Type: `Microsoft.Sql/servers/databases` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **geo-replication** (alternatives: failover-group, export-and-import, azure-database-migration-service, backup-and-restore)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: replicate
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 11
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.sql.servers.databases v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- parent → hcw-sample-sql-billing-prod-eus [discovered] — parent present in inventory

**Risks**
- Constraint: Databases move with the logical server; a cross-region move creates a geo-secondary then promotes it (near-zero data loss) or uses BACPAC export/import for offline moves
- Constraint: Elastic pool membership must exist at the destination before the database is replicated

**Validation**
- Row counts per table; checksum on critical tables
- Replication lag zero at cutover
- Application connection string switched to the listener/new server

**Rollback**
- Keep the source primary until the application is verified; fail back via the group

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-billingdb
- [observed-from-csv] type = microsoft.sql/servers/databases
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Sql/servers/hcw-sample-sql-billing-prod-eus/databases/hcw-sample-billingdb
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = GP_Gen5_4
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Active geo-replication (https://learn.microsoft.com/azure/azure-sql/database/active-geo-replication-overview, 2026-10-03)
- [general-rule] Import a BACPAC file (https://learn.microsoft.com/azure/azure-sql/database/database-import, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-psql-billing-prod-eus

- Type: `Microsoft.DBforPostgreSQL/flexibleServers` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **native-database-replication** (alternatives: backup-and-restore, azure-database-migration-service, export-and-import)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: replicate
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 22
- Confidence: medium (0.74) — rule confidence 0.75; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.dbforpostgresql.flexibleservers v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Risks**
- Constraint: Cross-region read replica promotion or geo-restore from geo-redundant backup; pg_dump/pg_restore for offline
- Constraint: Server parameters, firewall/VNet integration and Entra authentication are configuration to reconstruct

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-psql-billing-prod-eus
- [observed-from-csv] type = microsoft.dbforpostgresql/flexibleservers
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.DBforPostgreSQL/flexibleServers/hcw-sample-psql-billing-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Standard_D2ds_v4
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Relocate Azure Database for PostgreSQL flexible server (https://learn.microsoft.com/azure/operational-excellence/relocation-postgresql-flexible-server, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-cosmos-billing-prod

- Type: `Microsoft.DocumentDB/databaseAccounts` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **orchestrated-migration** via **service-specific-migration** (alternatives: azure-data-factory, export-and-import)
- Paths — infrastructure: move-with-resource; configuration: reconstruct; identity: not-applicable; data: replicate
- Support — RG move: supported; subscription move: supported; region: conditional; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 12
- Confidence: medium (0.7) — rule confidence 0.8; conditional support (-0.1)
- Rule: azure.documentdb.databaseaccounts v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_CONDITIONAL · human approval: required

**Risks**
- Constraint: Native path: add the target region, make it the write region, remove the source region — no data copy tool required
- Constraint: Private endpoints, firewall and CMK are reconstructed

**Validation**
- Region list and write region correct
- Document counts per container

**Secondary actions**
- Data path: replicate — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-cosmos-billing-prod
- [observed-from-csv] type = microsoft.documentdb/databaseaccounts
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.DocumentDB/databaseAccounts/hcw-sample-cosmos-billing-prod
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] kind = GlobalDocumentDB
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Relocate Azure Cosmos DB to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-cosmos-db, 2026-10-03)
- [general-rule] Manage an Azure Cosmos DB account (https://learn.microsoft.com/azure/cosmos-db/how-to-manage-database-account, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcwsampleacrbilling

- Type: `Microsoft.ContainerRegistry/registries` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **container-image-copy** (alternatives: terraform-redeploy, service-specific-migration)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: export-import
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 29
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.containerregistry.registries v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Risks**
- Constraint: Registry name is globally unique; geo-replicated Premium registries may simply add the target replication region
- Constraint: Images are copied with az acr import; webhooks, tasks, scope maps and tokens are reconstructed

**Secondary actions**
- Data path: export-import — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcwsampleacrbilling
- [observed-from-csv] type = microsoft.containerregistry/registries
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.ContainerRegistry/registries/hcwsampleacrbilling
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = Premium
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Relocate Azure Container Registry (https://learn.microsoft.com/azure/operational-excellence/relocation-container-registry, 2026-10-03)
- [general-rule] Import container images (https://learn.microsoft.com/azure/container-registry/container-registry-import-images, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-asp-billing-prod-eus

- Type: `Microsoft.Web/serverFarms` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-only** via **terraform-redeploy** (alternatives: application-deployment)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: not-applicable
- Support — RG move: conditional; subscription move: conditional; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 3
- Confidence: medium (0.74) — rule confidence 0.75; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.web.serverfarms v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Blockers**
- Rule requires human review before this disposition is accepted.

**Risks**
- Constraint: All apps in the plan must move together; the destination resource group must not previously have hosted App Service resources in a different webspace
- Constraint: App Service Environment (Isolated) plans cannot be moved

**Secondary actions**
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-asp-billing-prod-eus
- [observed-from-csv] type = microsoft.web/serverfarms
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Web/serverFarms/hcw-sample-asp-billing-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] kind = linux
- [observed-from-csv] sku = P1v3
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Move resources to a new resource group or subscription (https://learn.microsoft.com/azure/azure-resource-manager/management/move-resource-group-and-subscription, 2026-10-03)
- [general-rule] Relocate an App Service resource to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-app-service, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-app-billing-web-prod

- Type: `Microsoft.Web/sites` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **application-deployment** (alternatives: backup-and-restore, terraform-redeploy, slot-deployment)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: export-import
- Support — RG move: conditional; subscription move: conditional; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 8
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.web.sites v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- parent → hcw-sample-asp-billing-prod-eus [inferred] — an app belongs to an App Service plan (inferred from type and shared resource group; confirm with authenticated discovery)
- soft → hcw-sample-appi-billing-prod [inferred] — Application Insights connection string in app settings (inferred from type and shared resource group; confirm with authenticated discovery)
- identity → hcw-sample-kv-billing [inferred] — app settings commonly use Key Vault references (inferred from type and shared resource group; confirm with authenticated discovery)
- identity → hcw-sample-id-billing-app [inferred] — user-assigned identity may be bound to the app (inferred from type and shared resource group; confirm with authenticated discovery)

**Prerequisites**
- Hostname/TLS certificate ownership available in destination
- App settings with Key Vault references point to a destination vault

**Risks**
- Hostname cutover downtime; managed-identity object ID changes break RBAC on dependencies
- Constraint: Web apps and Function apps share this type (kind distinguishes them); the app must move with its plan
- Constraint: Private endpoints, VNet integration, custom domains/certificates and managed identities are reconstructed
- Constraint: Function Apps additionally need their storage account and host keys reconciled

**Validation**
- All app settings present (no unresolved Key Vault references)
- Custom domains bound, TLS valid
- Smoke test and health check endpoint

**Rollback**
- Keep the source app running until DNS cutover is verified; revert DNS

**Secondary actions**
- Data path: export-import — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-app-billing-web-prod
- [observed-from-csv] type = microsoft.web/sites
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Web/sites/hcw-sample-app-billing-web-prod
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] kind = app,linux
- [observed-from-csv] tags = {"application":"billing","environment":"prod"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Relocate an App Service resource to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-app-service, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-func-billing-jobs-prod

- Type: `Microsoft.Web/sites` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **application-deployment** (alternatives: backup-and-restore, terraform-redeploy, slot-deployment)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: export-import
- Support — RG move: conditional; subscription move: conditional; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 14
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.web.sites v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- parent → hcw-sample-asp-billing-prod-eus [inferred] — an app belongs to an App Service plan (inferred from type and shared resource group; confirm with authenticated discovery)
- soft → hcwsamplestbillingprod [inferred] — Function Apps require a storage account (kind contains functionapp) (inferred from type and shared resource group; confirm with authenticated discovery)
- soft → hcw-sample-appi-billing-prod [inferred] — Application Insights connection string in app settings (inferred from type and shared resource group; confirm with authenticated discovery)
- identity → hcw-sample-kv-billing [inferred] — app settings commonly use Key Vault references (inferred from type and shared resource group; confirm with authenticated discovery)
- identity → hcw-sample-id-billing-app [inferred] — user-assigned identity may be bound to the app (inferred from type and shared resource group; confirm with authenticated discovery)

**Prerequisites**
- Hostname/TLS certificate ownership available in destination
- App settings with Key Vault references point to a destination vault

**Risks**
- Hostname cutover downtime; managed-identity object ID changes break RBAC on dependencies
- Constraint: Web apps and Function apps share this type (kind distinguishes them); the app must move with its plan
- Constraint: Private endpoints, VNet integration, custom domains/certificates and managed identities are reconstructed
- Constraint: Function Apps additionally need their storage account and host keys reconciled

**Validation**
- All app settings present (no unresolved Key Vault references)
- Custom domains bound, TLS valid
- Smoke test and health check endpoint

**Rollback**
- Keep the source app running until DNS cutover is verified; revert DNS

**Secondary actions**
- Data path: export-import — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-func-billing-jobs-prod
- [observed-from-csv] type = microsoft.web/sites
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Web/sites/hcw-sample-func-billing-jobs-prod
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] kind = functionapp,linux
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Relocate an App Service resource to another region (https://learn.microsoft.com/azure/operational-excellence/relocation-app-service, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection
- Data volume, change rate and consistency requirements (needed to size the sync window)

### hcw-sample-appi-billing-prod

- Type: `Microsoft.Insights/components` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-and-migrate** via **terraform-redeploy** (alternatives: manual-reconstruction)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: retain-in-source
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 5
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.insights.components v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- hard → hcw-sample-log-prod-eus [inferred] — workspace-based Application Insights (inferred from type and shared resource group; confirm with authenticated discovery)

**Risks**
- Constraint: Telemetry history stays with the source; the connection string/instrumentation key changes and must be redeployed to applications
- Constraint: Workspace-based resources depend on the Log Analytics workspace decision

**Secondary actions**
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-appi-billing-prod
- [observed-from-csv] type = microsoft.insights/components
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Insights/components/hcw-sample-appi-billing-prod
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] kind = web
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Workspace-based Application Insights resources (https://learn.microsoft.com/azure/azure-monitor/app/create-workspace-resource, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-log-prod-eus

- Type: `Microsoft.OperationalInsights/workspaces` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: platform
- Disposition: **recreate-and-migrate** via **terraform-redeploy** (alternatives: export-and-import, manual-reconstruction)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: not-applicable; data: retain-in-source
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 4
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.operationalinsights.workspaces v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Risks**
- Constraint: Historical log data cannot be migrated between workspaces; retain the source workspace until the retention period lapses or export tables
- Constraint: Linked services, solutions, saved searches, DCRs and alert rules point at the workspace ID

**Secondary actions**
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-log-prod-eus
- [observed-from-csv] type = microsoft.operationalinsights/workspaces
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.OperationalInsights/workspaces/hcw-sample-log-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = PerGB2018
- [observed-from-csv] tags = {"application":"platform"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Move a Log Analytics workspace (https://learn.microsoft.com/azure/azure-monitor/logs/move-workspace, 2026-10-03)
- [general-rule] Relocate Log Analytics workspace (https://learn.microsoft.com/azure/operational-excellence/relocation-log-analytics, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-rsv-prod-eus

- Type: `Microsoft.RecoveryServices/vaults` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: platform
- Disposition: **recreate-only** via **terraform-redeploy** (alternatives: manual-reconstruction)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: retain-in-source
- Support — RG move: conditional; subscription move: conditional; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 27
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.recoveryservices.vaults v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- soft → hcw-sample-vm-billing-01 [inferred] — vault may protect VMs; protection must be stopped before VM move (inferred from type and shared resource group; confirm with authenticated discovery)

**Blockers**
- Rule requires human review before this disposition is accepted.

**Risks**
- Constraint: Vaults with Azure Site Recovery replication configured cannot be moved; disable replication first
- Constraint: Backup data cannot be transferred to a new vault — protect workloads anew in the destination vault and retain the source vault for recovery-point retention

**Secondary actions**
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-rsv-prod-eus
- [observed-from-csv] type = microsoft.recoveryservices/vaults
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.RecoveryServices/vaults/hcw-sample-rsv-prod-eus
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] sku = RS0
- [observed-from-csv] tags = {"application":"platform"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Move a Recovery Services vault across resource groups and subscriptions (https://learn.microsoft.com/azure/backup/backup-azure-move-recovery-services-vault, 2026-10-03)
- [general-rule] Relocate Azure Backup (https://learn.microsoft.com/azure/operational-excellence/relocation-backup, 2026-10-03)
- [general-rule] Migration vs DR: this vault is protection infrastructure. Recreate protection in the destination; do not treat ASR replication as the migration path for protected items.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-pe-sql-billing

- Type: `Microsoft.Network/privateEndpoints` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-only** via **terraform-redeploy** (alternatives: none)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 21
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.network.privateendpoints v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Dependencies**
- network → hcw-sample-vnet-billing-prod-eus [inferred] — private endpoint NIC lives in a subnet (inferred from type and shared resource group; confirm with authenticated discovery)
- dns → privatelink.database.windows.net [inferred] — zone group writes A records (inferred from type and shared resource group; confirm with authenticated discovery)

**Prerequisites**
- The target PaaS resource must already exist in the destination; the private endpoint is recreated against it
- Private DNS zone group records must be regenerated

**Risks**
- Stale A records in the private DNS zone cause resolution to the old region

**Secondary actions**
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-pe-sql-billing
- [observed-from-csv] type = microsoft.network/privateendpoints
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/privateEndpoints/hcw-sample-pe-sql-billing
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Relocate Azure Private Link Service / private endpoints (https://learn.microsoft.com/azure/operational-excellence/relocation-private-link, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### privatelink.database.windows.net

- Type: `Microsoft.Network/privateDnsZones` · Region: global · RG: hcw-sample-rg-billing-prod-eus · Application group: platform
- Disposition: **retain** via **none** (alternatives: export-and-import, terraform-redeploy)
- Paths — infrastructure: not-applicable; configuration: not-applicable; identity: not-applicable; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 20
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.network.privatednszones v1.0.0 · reason codes: RULE_MATCH, GLOBAL_RESOURCE · human approval: required

**Evidence**
- [observed-from-csv] name = privatelink.database.windows.net
- [observed-from-csv] type = microsoft.network/privatednszones
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Network/privateDnsZones/privatelink.database.windows.net
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = global
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"platform"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] What is Azure Private DNS? (https://learn.microsoft.com/azure/dns/private-dns-overview, 2026-10-03)
- [general-rule] Global resource — region relocation does not apply. Virtual network links must be recreated for destination VNets; records for relocated services are regenerated by their private endpoints.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-id-billing-app

- Type: `Microsoft.ManagedIdentity/userAssignedIdentities` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-only** via **terraform-redeploy** (alternatives: manual-reconstruction)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: unsupported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 7
- Confidence: medium (0.74) — rule confidence 0.85; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.managedidentity.userassignedidentities v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED · human approval: required

**Risks**
- Constraint: Identity principal ID and client ID change when recreated: every role assignment, Key Vault policy, and federated credential must be rebound

**Secondary actions**
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-id-billing-app
- [observed-from-csv] type = microsoft.managedidentity/userassignedidentities
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.ManagedIdentity/userAssignedIdentities/hcw-sample-id-billing-app
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Managed identities FAQ (https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/managed-identities-faq, 2026-10-03)
- [general-rule] Relocate managed identities (https://learn.microsoft.com/azure/operational-excellence/relocation-managed-identity, 2026-10-03)

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-ag-platform-oncall

- Type: `Microsoft.Insights/actionGroups` · Region: global · RG: hcw-sample-rg-billing-prod-eus · Application group: platform
- Disposition: **retain** via **none** (alternatives: terraform-redeploy)
- Paths — infrastructure: not-applicable; configuration: not-applicable; identity: not-applicable; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: none; RTO/RPO compatibility: unknown/unknown; sequence: 1
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.insights.actiongroups v1.0.0 · reason codes: RULE_MATCH, GLOBAL_RESOURCE · human approval: required

**Evidence**
- [observed-from-csv] name = hcw-sample-ag-platform-oncall
- [observed-from-csv] type = microsoft.insights/actiongroups
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Insights/actionGroups/hcw-sample-ag-platform-oncall
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = global
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"platform"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Global resource; verify receivers (webhooks, logic apps, automation runbooks) that are themselves migrated.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-alert-vm-cpu

- Type: `Microsoft.Insights/metricAlerts` · Region: global · RG: hcw-sample-rg-billing-prod-eus · Application group: billing
- Disposition: **recreate-only** via **terraform-redeploy** (alternatives: none)
- Paths — infrastructure: recreate; configuration: reconstruct; identity: reconstruct; data: not-applicable
- Support — RG move: supported; subscription move: supported; region: supported; target region/SKU availability: unknown/unknown
- Expected downtime: minutes; RTO/RPO compatibility: unknown/unknown; sequence: 2
- Confidence: medium (0.74) — rule confidence 0.8; capped at 0.74: inventory-only evidence cannot yield high confidence
- Rule: azure.insights.metricalerts v1.0.0 · reason codes: RULE_MATCH, REGION_MOVE_SUPPORTED · human approval: required

**Dependencies**
- soft → hcw-sample-ag-platform-oncall [inferred] — alert actions reference action groups (inferred from type and shared resource group; confirm with authenticated discovery)

**Secondary actions**
- Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.
- After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.

**Evidence**
- [observed-from-csv] name = hcw-sample-alert-vm-cpu
- [observed-from-csv] type = microsoft.insights/metricalerts
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Insights/metricAlerts/hcw-sample-alert-vm-cpu
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = global
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"billing"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.
- [general-rule] Move operation support for resources (https://learn.microsoft.com/azure/azure-resource-manager/management/move-support-resources, 2026-10-03)
- [general-rule] Alert scopes reference resource IDs; recreate against the destination resources.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

### hcw-sample-quantum-research-01

- Type: `Microsoft.Quantum/Workspaces` · Region: eastus · RG: hcw-sample-rg-billing-prod-eus · Application group: research
- Disposition: **unknown-requires-validation** via **none** (alternatives: manual-reconstruction)
- Paths — infrastructure: unknown; configuration: unknown; identity: unknown; data: unknown
- Support — RG move: unknown; subscription move: unknown; region: unknown; target region/SKU availability: unknown/unknown
- Expected downtime: unknown; RTO/RPO compatibility: unknown/unknown; sequence: 23
- Confidence: low (0.2) — No versioned rule exists for this resource type; the engine does not guess support.
- Rule: none v— · reason codes: NO_RULE_FOR_TYPE · human approval: required

**Blockers**
- No rule coverage: disposition cannot be determined automatically.

**Secondary actions**
- Escalate for manual review against the Microsoft Learn move-support matrix.

**Evidence**
- [observed-from-csv] name = hcw-sample-quantum-research-01
- [observed-from-csv] type = microsoft.quantum/workspaces
- [observed-from-csv] resourceId = /subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/hcw-sample-rg-billing-prod-eus/providers/Microsoft.Quantum/Workspaces/hcw-sample-quantum-research-01
- [observed-from-csv] resourceGroup = hcw-sample-rg-billing-prod-eus
- [observed-from-csv] subscriptionId = 00000000-0000-0000-0000-000000000001
- [observed-from-csv] location = eastus
- [observed-from-csv] subscriptionName = hcw-sample-prod
- [observed-from-csv] tags = {"application":"research"}
- [requires-authenticated-validation] Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment.

**Assumptions**
- Questionnaire field 'migrationMode' was not supplied; default used.
- Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.

**Missing information**
- Support rule for Microsoft.Quantum/Workspaces — add one under rules/azure or escalate for manual review
- SKU/tier (affects regional availability, move eligibility and data-copy method)
- Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)
- Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection

## Wave plan

> Preliminary grouping derived from resource type and inferred dependencies; refine with discovered dependencies and application ownership.
> Application groups observed from tags: billing, platform, research

### Wave 1: Foundation: network, identity, secrets, logging

_Everything else binds to these._

- Entry: Destination landing zone scope approved; Address space and naming approved
- Exit: VNets/subnets/NSGs reachable; Key Vaults and identities exist; Log Analytics receiving data
- Resources (8): hcw-sample-log-prod-eus, hcw-sample-kv-billing, hcw-sample-id-billing-app, hcw-sample-pip-lb-billing, hcw-sample-vnet-billing-prod-eus, hcw-sample-nsg-app, hcw-sample-rg-billing-prod-eus, hcw-sample-snet-app

### Wave 2: Data platforms: storage, databases, registries

_Long-running copies start early; applications cut over last._

- Entry: Wave 1 complete; Private connectivity in place; Data copy tooling authorised
- Exit: Initial copy complete; Reconciliation plan agreed
- Resources (6): hcw-sample-sql-billing-prod-eus, hcw-sample-billingdb, hcw-sample-cosmos-billing-prod, hcwsamplestbillingprod, hcw-sample-psql-billing-prod-eus, hcwsampleacrbilling

### Wave 3: Edge and platform: load balancers, gateways, private endpoints, plans

_Connectivity for compute and apps._

- Entry: Wave 2 initial copy complete
- Exit: Frontends healthy against staging backends
- Resources (3): hcw-sample-asp-billing-prod-eus, hcw-sample-lb-billing-prod, hcw-sample-pe-sql-billing

### Wave 4: Compute and applications

_Cutover wave._

- Entry: Waves 1–3 complete; Change freeze scheduled
- Exit: Smoke tests pass; Final data sync reconciled; DNS cutover
- Resources (6): hcw-sample-app-billing-web-prod, hcw-sample-avset-billing, hcw-sample-func-billing-jobs-prod, hcw-sample-nic-vm-billing-01, hcw-sample-vm-billing-01_OsDisk, hcw-sample-vm-billing-01

### Wave 5: Observability, backup and DR re-protection

_Protection follows the migrated workload._

- Entry: Wave 4 cutover accepted
- Exit: Alerts firing on destination; Backup/DR protection re-enabled
- Resources (5): hcw-sample-ag-platform-oncall, hcw-sample-alert-vm-cpu, hcw-sample-appi-billing-prod, privatelink.database.windows.net, hcw-sample-rsv-prod-eus

### Wave 6: Requires validation / manual review

_Unknowns are not scheduled until evidence exists._

- Entry: Authenticated inspection completed
- Exit: Each item assigned to a wave or retired
- Resources (1): hcw-sample-quantum-research-01
