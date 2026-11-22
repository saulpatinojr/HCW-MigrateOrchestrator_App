# Learn move-support diff — 2026-11-22

Source: https://raw.githubusercontent.com/MicrosoftDocs/azure-docs/main/articles/azure-resource-manager/management/move-support-resources.md · matrix rows: 757 · rules checked: 35

## Disagreements (33)

| Rule | Field | Rule says | Learn says | Learn cell |
|---|---|---|---|---|
| azure.compute.virtualmachines | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.virtualmachines | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.virtualmachines | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move |
| azure.compute.disks | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.disks | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.disks | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move |
| azure.compute.snapshots | regionRelocation | conditional | unsupported | No - Full <br> No - Incremental |
| azure.compute.availabilitysets | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.availabilitysets | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.availabilitysets | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move |
| azure.compute.virtualmachinescalesets | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.virtualmachinescalesets | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.virtualmachines.extensions | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.compute.virtualmachines.extensions | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/virtual-machines-move-limitations) |
| azure.documentdb.databaseaccounts | regionRelocation | conditional | unsupported | No |
| azure.insights.actiongroups | regionRelocation | supported | unsupported | No |
| azure.network.networkinterfaces | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.networkinterfaces | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.networkinterfaces | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move |
| azure.network.virtualnetworks | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.virtualnetworks | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.networksecuritygroups | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.networksecuritygroups | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.networksecuritygroups | regionRelocation | supported | conditional | **Yes** <br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move |
| azure.network.publicipaddresses | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.publicipaddresses | regionRelocation | conditional | unsupported | **No**<br/><br/> Use [Azure Resource Mover](../../resource-mover/tutorial-move-r |
| azure.network.loadbalancers | resourceGroupMove | supported | conditional | **Yes** - Basic SKU<br> **Yes** - Standard SKU |
| azure.network.routetables | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.routetables | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.privatednszones | resourceGroupMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.privatednszones | subscriptionMove | supported | conditional | Yes, with guidance (https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-limitations/networking-move-limitations) |
| azure.network.privatednszones | regionRelocation | supported | unsupported | No |
| azure.sql.servers | regionRelocation | unsupported | supported | **Yes** |

## Resource types in the matrix without a rule (721)

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
- microsoft.cache/redisenterprise (azure cache for redis enterprise)
- microsoft.cache/redisenterprise (azure managed redis)
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
- microsoft.cognitiveservices/cognitive search
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

## Rule types not found in the matrix (1)

- Microsoft.Network/virtualNetworks/subnets

Region-move disagreements are expected where a rule encodes a service-native relocation path rather than Resource Mover support. Review each row; update `scripts/author-rules.mjs`, bump `ruleVersion`, set `retrievedOn`, regenerate and re-snapshot.
