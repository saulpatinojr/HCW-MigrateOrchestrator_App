# Learn move-support diff — 2026-11-23

Source: https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/azure-resource-manager/management/move-support-resources.md · matrix rows: 757 · rules checked: 35

**Nothing new to decide.** All 26 disagreements were reviewed earlier and kept, with the reason beside each.

## Disagreements (26)

### New, not yet reviewed (0)

None.

### Reviewed and kept as they are (26)

A person compared each of these with Learn and decided the rule stays. The decisions are in `rules/reports/learn-diff-reviewed.json`; a row comes back as new when the rule or Learn's cell changes.

| Rule | Field | Rule says | Learn says | Learn cell | Why the rule stays | Decided |
|---|---|---|---|---|---|---|
| azure.compute.virtualmachines | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move | Learn's cell says Yes and only names the tool (Azure Resource Mover); the rule's region path is already Resource Mover. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 1 of its per-row table) |
| azure.compute.disks | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) | The virtual machine move guidance names no limit for managed disks themselves; an attached disk moves with its virtual machine, whose rule carries the limits. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 3 of its per-row table) |
| azure.compute.disks | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) | The virtual machine move guidance names no limit for managed disks themselves; an attached disk moves with its virtual machine, whose rule carries the limits. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 4 of its per-row table) |
| azure.compute.disks | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move | Learn's cell says Yes and only names the tool (Azure Resource Mover); the rule's region path is already Resource Mover. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 2 of its per-row table) |
| azure.compute.snapshots | regionRelocation | conditional | unsupported | No - Full <br> No - Incremental | There is no Resource Manager region move, but the rule's region path is the service's own copy of an incremental snapshot to another region. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 5 of its per-row table) |
| azure.compute.availabilitysets | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) | The limit in the guidance is on the virtual machine (it cannot be moved on its own out of an availability set), not on the set; the set moves with its machines. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 5 of its per-row table) |
| azure.compute.availabilitysets | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) | The limit in the guidance is on the virtual machine (it cannot be moved on its own out of an availability set), not on the set; the set moves with its machines. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 6 of its per-row table) |
| azure.compute.availabilitysets | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move | Learn's cell says Yes and only names the tool (Azure Resource Mover); the rule's region path is already Resource Mover. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 6 of its per-row table) |
| azure.compute.virtualmachines.extensions | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) | A child resource: an extension moves with its virtual machine, as the rule's note already says. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 9 of its per-row table) |
| azure.compute.virtualmachines.extensions | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) | A child resource: an extension moves with its virtual machine, as the rule's note already says. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 10 of its per-row table) |
| azure.documentdb.databaseaccounts | regionRelocation | conditional | unsupported | No | The rule encodes Azure Cosmos DB's own path (add a region, fail over, remove the old region), not a Resource Manager move. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 8 of its per-row table) |
| azure.insights.actiongroups | regionRelocation | supported | unsupported | No | A global resource: it stays where it is, and the rule's region pattern is "retain". | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 9 of its per-row table) |
| azure.network.networkinterfaces | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The limits in the networking guidance (Standard SKU public IP, move the whole virtual network) are about moves across subscriptions, not across resource groups. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 11 of its per-row table) |
| azure.network.networkinterfaces | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move | Learn's cell says Yes and only names the tool (Azure Resource Mover); the rule's region path is already Resource Mover. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 15 of its per-row table) |
| azure.network.networksecuritygroups | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The networking guidance names nothing specific to network security groups; the general "move dependent resources together" is already a prerequisite of the virtual machine rule. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 15 of its per-row table) |
| azure.network.networksecuritygroups | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The networking guidance names nothing specific to network security groups; the general "move dependent resources together" is already a prerequisite of the virtual machine rule. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 16 of its per-row table) |
| azure.network.networksecuritygroups | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move | Learn's cell says Yes and only names the tool (Azure Resource Mover); the rule's region path is already Resource Mover. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 16 of its per-row table) |
| azure.network.publicipaddresses | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The Standard SKU limit applies across subscriptions only; the subscription move is already conditional. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 17 of its per-row table) |
| azure.network.publicipaddresses | regionRelocation | conditional | unsupported | **No**<br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move-r | "Conditional" with a recreate pattern is what Learn's cell describes: the configuration moves with Resource Mover, the address itself is not kept. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 18 of its per-row table) |
| azure.network.loadbalancers | resourceGroupMove | supported | conditional | **Yes** - Basic SKU<br> **Yes** - Standard SKU | Learn's cell says Yes for both SKUs (Basic and Standard); the report reads any qualifier after Yes as conditional. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 19 of its per-row table) |
| azure.network.routetables | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The networking guidance names nothing specific to route tables. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 18 of its per-row table) |
| azure.network.routetables | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The networking guidance names nothing specific to route tables. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 19 of its per-row table) |
| azure.network.privatednszones | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The networking guidance names nothing specific to private DNS zones. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 20 of its per-row table) |
| azure.network.privatednszones | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) | The networking guidance names nothing specific to private DNS zones. | 2026-11-22, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/136 (row 21 of its per-row table) |
| azure.network.privatednszones | regionRelocation | supported | unsupported | No | A global resource: it stays where it is, and the rule's region pattern is "retain". | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 27 of its per-row table) |
| azure.sql.servers | regionRelocation | unsupported | supported | **Yes** | Resource Mover's own tutorial says it does not move a SQL server across regions (a target server must exist first); the rule's failover-group path stays. | 2026-11-16, https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/pull/131 (row 30 of its per-row table) |

## Resource types in the matrix without a rule (718)

- microsoft.aad/domainservices
- microsoft.aadiam/diagnosticsettings
- microsoft.aadiam/diagnosticsettingscategories
- microsoft.aadiam/privatelinkforazuread
- microsoft.aadiam/tenants
- microsoft.addons/supportproviders
- microsoft.adhybridhealthservice/aadsupportcases
- microsoft.adhybridhealthservice/addsservices
- microsoft.adhybridhealthservice/agents
- microsoft.adhybridhealthservice/anonymousapiusers
- microsoft.adhybridhealthservice/configuration
- microsoft.adhybridhealthservice/logs
- microsoft.adhybridhealthservice/reports
- microsoft.adhybridhealthservice/servicehealthmetrics
- microsoft.adhybridhealthservice/services
- microsoft.advisor/configurations
- microsoft.advisor/generaterecommendations
- microsoft.advisor/metadata
- microsoft.advisor/recommendations
- microsoft.advisor/suppressions
- microsoft.alertsmanagement/alertprocessingrules
- microsoft.alertsmanagement/alerts
- microsoft.alertsmanagement/alertslist
- microsoft.alertsmanagement/alertsmetadata
- microsoft.alertsmanagement/alertssummary
- microsoft.alertsmanagement/alertssummarylist
- microsoft.alertsmanagement/smartdetectoralertrules
- microsoft.alertsmanagement/smartgroups
- microsoft.analysisservices/servers
- microsoft.apimanagement/reportfeedback
- microsoft.apimanagement/service
- microsoft.app/managedenvironments
- microsoft.appconfiguration/configurationstores
- microsoft.appconfiguration/configurationstores/eventgridfilters
- microsoft.appplatform/spring
- microsoft.appservice/apiapps
- microsoft.appservice/appidentities
- microsoft.appservice/gateways
- microsoft.attestation/attestationproviders
- microsoft.authorization/classicadministrators
- microsoft.authorization/dataaliases
- microsoft.authorization/denyassignments
- microsoft.authorization/elevateaccess
- microsoft.authorization/findorphanroleassignments
- microsoft.authorization/locks
- microsoft.authorization/permissions
- microsoft.authorization/policyassignments
- microsoft.authorization/policydefinitions
- microsoft.authorization/policysetdefinitions
- microsoft.authorization/privatelinkassociations
- microsoft.authorization/resourcemanagementprivatelinks
- microsoft.authorization/roleassignments
- microsoft.authorization/roleassignmentsusagemetrics
- microsoft.authorization/roledefinitions
- microsoft.automation/automationaccounts
- microsoft.automation/automationaccounts/configurations
- microsoft.automation/automationaccounts/runbooks
- microsoft.avs/privateclouds
- microsoft.azureactivedirectory/b2cdirectories
- microsoft.azureactivedirectory/b2ctenants
- microsoft.azurearcdata/datacontrollers
- microsoft.azurearcdata/postgresinstances
- microsoft.azurearcdata/sqlmanagedinstances
- microsoft.azurearcdata/sqlserverinstances
- microsoft.azurearcdata/sqlserverlicenses
- microsoft.azuredata/datacontrollers
- microsoft.azuredata/hybriddatamanagers
- microsoft.azuredata/postgresinstances
- microsoft.azuredata/sqlinstances
- microsoft.azuredata/sqlmanagedinstances
- microsoft.azuredata/sqlserverinstances
- microsoft.azuredata/sqlserverregistrations
- microsoft.azurestack/cloudmanifestfiles
- microsoft.azurestack/registrations
- microsoft.azurestackhci/clusters
- microsoft.batch/batchaccounts
- microsoft.billing/billingaccounts
- microsoft.billing/billingperiods
- microsoft.billing/billingpermissions
- microsoft.billing/billingproperty
- microsoft.billing/billingroleassignments
- microsoft.billing/billingroledefinitions
- microsoft.billing/departments
- microsoft.billing/enrollmentaccounts
- microsoft.billing/invoices
- microsoft.billing/transfers
- microsoft.bingmaps/mapapis
- microsoft.biztalkservices/biztalk
- microsoft.blockchain/blockchainmembers
- microsoft.blockchain/cordamembers
- microsoft.blockchain/watchers
- microsoft.blockchaintokens/tokenservices
- microsoft.blueprint/blueprintassignments
- microsoft.blueprint/blueprints
- microsoft.botservice/botservices
- microsoft.cache/redis
- microsoft.cache/redisenterprise
- microsoft.capacity/appliedreservations
- microsoft.capacity/calculateexchange
- microsoft.capacity/calculateprice
- microsoft.capacity/calculatepurchaseprice
- microsoft.capacity/catalogs
- microsoft.capacity/commercialreservationorders
- microsoft.capacity/exchange
- microsoft.capacity/reservationorders
- microsoft.capacity/reservations
- microsoft.capacity/resources
- microsoft.capacity/validatereservationorder
- microsoft.cdn/cdnwebapplicationfirewallmanagedrulesets
- microsoft.cdn/cdnwebapplicationfirewallpolicies
- microsoft.cdn/edgenodes
- microsoft.cdn/profiles
- microsoft.cdn/profiles/endpoints
- microsoft.certificateregistration/certificateorders
- microsoft.classiccompute/capabilities
- microsoft.classiccompute/domainnames
- microsoft.classiccompute/quotas
- microsoft.classiccompute/resourcetypes
- microsoft.classiccompute/validatesubscriptionmoveavailability
- microsoft.classiccompute/virtualmachines
- microsoft.classicinfrastructuremigrate/classicinfrastructureresources
- microsoft.classicnetwork/capabilities
- microsoft.classicnetwork/expressroutecrossconnections
- microsoft.classicnetwork/expressroutecrossconnections/peerings
- microsoft.classicnetwork/gatewaysupporteddevices
- microsoft.classicnetwork/networksecuritygroups
- microsoft.classicnetwork/quotas
- microsoft.classicnetwork/reservedips
- microsoft.classicnetwork/virtualnetworks
- microsoft.classicstorage/disks
- microsoft.classicstorage/images
- microsoft.classicstorage/osimages
- microsoft.classicstorage/osplatformimages
- microsoft.classicstorage/publicimages
- microsoft.classicstorage/quotas
- microsoft.classicstorage/storageaccounts
- microsoft.classicstorage/vmimages
- microsoft.classicsubscription/operations
- microsoft.cognitiveservices/accounts
- microsoft.commerce/ratecard
- microsoft.commerce/usageaggregates
- microsoft.communication/communicationservices
- microsoft.compute/diskaccesses
- microsoft.compute/diskencryptionsets
- microsoft.compute/galleries
- microsoft.compute/galleries/images
- microsoft.compute/galleries/images/versions
- microsoft.compute/hostgroups
- microsoft.compute/hostgroups/hosts
- microsoft.compute/images
- microsoft.compute/proximityplacementgroups
- microsoft.compute/restorepointcollections
- microsoft.compute/restorepointcollections/restorepoints
- microsoft.compute/sharedvmextensions
- microsoft.compute/sharedvmimages
- microsoft.compute/sharedvmimages/versions
- microsoft.compute/sshpublickeys
- microsoft.compute/capabilities
- microsoft.compute/domainnames
- microsoft.compute/quotas
- microsoft.compute/resourcetypes
- microsoft.compute/validatesubscriptionmoveavailability
- microsoft.confluent/organizations
- microsoft.consumption/aggregatedcost
- microsoft.consumption/balances
- microsoft.consumption/budgets
- microsoft.consumption/charges
- microsoft.consumption/costtags
- microsoft.consumption/credits
- microsoft.consumption/events
- microsoft.consumption/forecasts
- microsoft.consumption/lots
- microsoft.consumption/marketplaces
- microsoft.consumption/pricesheets
- microsoft.consumption/products
- microsoft.consumption/reservationdetails
- microsoft.consumption/reservationrecommendationdetails
- microsoft.consumption/reservationrecommendations
- microsoft.consumption/reservationsummaries
- microsoft.consumption/reservationtransactions
- microsoft.consumption/tags
- microsoft.consumption/tenants
- microsoft.consumption/terms
- microsoft.consumption/usagedetails
- microsoft.containerinstance/containergroups
- microsoft.containerinstance/serviceassociationlinks
- microsoft.containerregistry/registries/agentpools
- microsoft.containerregistry/registries/buildtasks
- microsoft.containerregistry/registries/replications
- microsoft.containerregistry/registries/tasks
- microsoft.containerregistry/registries/webhooks
- microsoft.containerservice/containerservices
- microsoft.containerservice/managedclusters
- microsoft.containerservice/openshiftmanagedclusters
- microsoft.contentmoderator/applications
- microsoft.cortanaanalytics/accounts
- microsoft.costmanagement/alerts
- microsoft.costmanagement/billingaccounts
- microsoft.costmanagement/budgets
- microsoft.costmanagement/cloudconnectors

## Rule types not found in the matrix (1)

- Microsoft.Network/virtualNetworks/subnets

## Learn rows that name a product, not a resource type (2)

These rows are left out of the comparison above; a resource type never contains a space.

- microsoft.cognitiveservices/cognitive search
- microsoft.devspaces/aks cluster

Region-move disagreements are expected where a rule encodes a service-native relocation path rather than Resource Mover support. Review each new row. To accept it: update `scripts/author-rules.mjs`, bump `ruleVersion`, set `retrievedOn`, regenerate and re-snapshot. To keep the rule: add the row to `rules/reports/learn-diff-reviewed.json` with the reason and a link to where it was decided.
