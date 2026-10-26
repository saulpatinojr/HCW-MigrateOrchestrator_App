# Learn move-support diff — 2026-10-26

Source: https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/azure-resource-manager/management/move-support-resources.md · matrix rows: 0 · rules checked: 35

## Disagreements (0)

| Rule | Field | Rule says | Learn says | Learn cell |
|---|---|---|---|---|

## Resource types in the matrix without a rule (0)


## Rule types not found in the matrix (35)

- Microsoft.Compute/virtualMachines
- Microsoft.Compute/disks
- Microsoft.Compute/snapshots
- Microsoft.Compute/availabilitySets
- Microsoft.Compute/virtualMachineScaleSets
- Microsoft.Compute/virtualMachines/extensions
- Microsoft.ContainerRegistry/registries
- Microsoft.DBforPostgreSQL/flexibleServers
- Microsoft.DocumentDB/databaseAccounts
- Microsoft.Insights/components
- Microsoft.Insights/actionGroups
- Microsoft.Insights/metricAlerts
- Microsoft.KeyVault/vaults
- Microsoft.ManagedIdentity/userAssignedIdentities
- Microsoft.Network/networkInterfaces
- Microsoft.Network/virtualNetworks
- Microsoft.Network/virtualNetworks/subnets
- Microsoft.Network/networkSecurityGroups
- Microsoft.Network/publicIPAddresses
- Microsoft.Network/loadBalancers
- Microsoft.Network/routeTables
- Microsoft.Network/natGateways
- Microsoft.Network/applicationGateways
- Microsoft.Network/privateEndpoints
- Microsoft.Network/privateDnsZones
- Microsoft.OperationalInsights/workspaces
- Microsoft.RecoveryServices/vaults
- Microsoft.Resources/resourceGroups
- Microsoft.Sql/servers
- Microsoft.Sql/servers/databases
- Microsoft.Storage/storageAccounts
- Microsoft.Web/serverFarms
- Microsoft.Web/sites
- Microsoft.Web/sites/slots
- Microsoft.Storage/storageAccounts

Region-move disagreements are expected where a rule encodes a service-native relocation path rather than Resource Mover support. Review each row; update `scripts/author-rules.mjs`, bump `ruleVersion`, set `retrievedOn`, regenerate and re-snapshot.
