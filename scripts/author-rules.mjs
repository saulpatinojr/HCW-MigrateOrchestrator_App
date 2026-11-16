#!/usr/bin/env node
/**
 * Rule authoring tool. Rules are *data* (rules/azure/*.json); this script is the maintained
 * authoring source so every rule carries the same shape, provenance and review cadence.
 * Run: node scripts/author-rules.mjs   (then: npm run rules:validate)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const RETRIEVED = "2026-10-03";
const REVIEW = "2027-04-03";
// Rules re-checked against the live Learn pages on 2026-11-16 (the learn-diff of PR #130) carry this date on the sources
// that were re-read, a 1.1.0 ruleVersion and a review date six months on. The other rules keep RETRIEVED and REVIEW.
const RECHECKED = "2026-11-16";
const RECHECKED_REVIEW = "2027-05-16";
const L = (path) => `https://learn.microsoft.com/azure/${path}`;
const SRC = {
  move: { title: "Move operation support for resources", url: L("azure-resource-manager/management/move-support-resources") },
  moveHowTo: { title: "Move resources to a new resource group or subscription", url: L("azure-resource-manager/management/move-resource-group-and-subscription") },
  mover: { title: "Azure Resource Mover overview", url: L("resource-mover/overview") },
  moverVm: { title: "Support matrix for moving Azure VMs across regions", url: L("resource-mover/support-matrix-move-region-azure-vm") },
  transfer: { title: "Transfer an Azure subscription to a different Microsoft Entra directory", url: L("role-based-access-control/transfer-subscription") },
  relocation: { title: "Azure relocation guidance overview", url: L("operational-excellence/overview-relocation") },
  migrate: { title: "Azure Migrate services overview", url: L("migrate/migrate-services-overview") },
  asr: { title: "Azure Site Recovery overview (DR only)", url: L("site-recovery/site-recovery-overview") },
};
// `retrieved` maps a source key to the date it was last read; an inline source may carry its own retrievedOn.
const src = (keys, retrieved = {}) => keys.map((k) => (typeof k === "string" ? { ...SRC[k], retrievedOn: retrieved[k] ?? RETRIEVED } : { ...k, retrievedOn: k.retrievedOn ?? RETRIEVED }));

const P = (disposition, tool, infrastructure, configuration, identity, data, expectedDowntime) => ({ disposition, tool, infrastructure, configuration, identity, data, expectedDowntime });
const RECREATE_REDEPLOY = P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "reconstruct", "not-applicable", "minutes");
const NATIVE = P("native-move", "arm-move", "move-with-resource", "move-with-resource", "move-with-resource", "move-with-resource", "none");
const MOVER = P("native-move", "azure-resource-mover", "recreate", "reconstruct", "reconstruct", "replicate", "minutes");
const XT_RECREATE = P("recreate-and-migrate", "terraform-redeploy", "recreate", "reconstruct", "reconstruct", "export-import", "hours");

const XT_IMPL = [
  "Direct cross-tenant move is not an ARM operation; the supported native path is transferring the whole subscription to the destination directory, after which tenant-bound objects (role assignments, managed identities, Key Vault access, Entra-integrated auth) must be rebuilt.",
  "If the subscription cannot be transferred, recreate in the destination tenant and migrate data separately.",
];

/** Cross-tenant default: recreate infrastructure; the data dimension follows the rule's own region/default data path. */
function defaultCrossTenant(o) {
  const data = (o.region ?? o.pattern).data;
  if (data === "not-applicable" || data === "retain-in-source") return { ...XT_RECREATE, disposition: "recreate-only", data };
  return { ...XT_RECREATE, data: data === "move-with-resource" ? "export-import" : data };
}

function rule(id, type, o) {
  const provider = type.split("/")[0];
  return {
    ruleId: id,
    ruleVersion: o.version ?? "1.0.0",
    provider,
    resourceType: type,
    applicableApiVersions: o.apiVersions ?? ["*"],
    relevantSku: o.sku ?? ["*"],
    tier: o.tier ?? ["*"],
    operatingSystemConstraints: o.os ?? [],
    featureConstraints: o.features ?? [],
    sourceScope: ["resource-group", "subscription", "region", "tenant"],
    destinationScope: ["resource-group", "subscription", "region", "tenant"],
    sourceRegion: "any",
    destinationRegion: "any",
    tenantApplicability: "any",
    support: o.support,
    recommendedPattern: o.pattern,
    regionRelocationPattern: o.region,
    crossTenantPattern: o.crossTenant ?? defaultCrossTenant(o),
    alternatives: o.alternatives,
    documentationSources: src(o.sources ?? ["move", "moveHowTo"], o.retrieved),
    reviewDate: o.reviewDate ?? REVIEW,
    confidence: o.confidence ?? 0.8,
    exceptions: o.exceptions ?? [],
    requiredEvidence: o.requiredEvidence ?? ["Confirm the resource's current configuration via authenticated inspection before relying on this rule."],
    humanReviewRequired: o.humanReview ?? false,
    prerequisites: o.prerequisites ?? [],
    risks: o.risks ?? [],
    mitigations: o.mitigations ?? [],
    validation: o.validation ?? [],
    rollback: o.rollback ?? [],
    crossTenantImplications: o.xt ?? XT_IMPL,
    precedence: 10,
    notes: o.notes,
  };
}
const S = (rg, sub, region, xt) => ({ resourceGroupMove: rg, subscriptionMove: sub, regionRelocation: region, crossTenant: xt });

const rules = [
  rule("azure.compute.virtualmachines", "Microsoft.Compute/virtualMachines", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE,
    region: MOVER,
    alternatives: ["azure-migrate", "backup-and-restore", "terraform-redeploy"],
    sources: ["move", "moverVm", "mover", "transfer"],
    features: ["VMs with Azure Site Recovery replication, Azure Backup protection, or marketplace plans need the protection removed or the plan accepted before move", "Resource Mover requires managed disks; unmanaged disks are not supported"],
    prerequisites: ["Dependent NICs, disks, VNet, NSG and public IPs move together or already exist at the destination", "Stop Azure Backup/ASR protection before the move; re-enable afterwards"],
    risks: ["VM must be deallocated for a region move; public IP address changes", "Extensions and boot diagnostics storage must be re-pointed"],
    mitigations: ["Schedule within the downtime window; pre-stage DNS TTL reductions"],
    validation: ["VM boots and agent reports Ready", "Disk count/size match", "NSG/route effective rules match", "Application smoke test"],
    rollback: ["Resource Mover: discard the move and restore source; ARM move: move back to the source scope"],
    notes: ["Azure Site Recovery is listed only as the DR mechanism for the migrated VM, never as the migration tool."],
    confidence: 0.85,
  }),
  rule("azure.compute.disks", "Microsoft.Compute/disks", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE,
    region: P("orchestrated-migration", "azure-resource-mover", "recreate", "reconstruct", "not-applicable", "replicate", "minutes"),
    alternatives: ["backup-and-restore", "export-and-import"],
    sources: ["move", "moverVm"],
    features: ["Disks attached to a VM move with the VM; detached disks relocate via snapshot copy to the target region"],
    validation: ["Disk SKU, size and encryption settings match"],
    rollback: ["Source disk/snapshot retained until cutover is verified"],
  }),
  rule("azure.compute.snapshots", "Microsoft.Compute/snapshots", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("conditional", "conditional", "conditional", "unsupported"),
    pattern: NATIVE,
    region: P("orchestrated-migration", "export-and-import", "recreate", "not-applicable", "not-applicable", "export-import", "none"),
    alternatives: ["backup-and-restore"],
    notes: ["Region copy uses incremental snapshot copy (az snapshot create --copy-start) or SAS export/import.", "Resource group and subscription moves: Learn lists full snapshots as movable and incremental snapshots as not movable (2026-11-16)."],
    confidence: 0.75,
  }),
  rule("azure.compute.availabilitysets", "Microsoft.Compute/availabilitySets", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE, region: MOVER, alternatives: ["terraform-redeploy"], sources: ["move", "moverVm"],
  }),
  rule("azure.compute.virtualmachinescalesets", "Microsoft.Compute/virtualMachineScaleSets", {
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: NATIVE, region: RECREATE_REDEPLOY,
    alternatives: ["terraform-redeploy", "azure-migrate"],
    risks: ["Region relocation requires recreating the scale set and redeploying the image/model"],
    confidence: 0.75,
  }),
  rule("azure.compute.virtualmachines.extensions", "Microsoft.Compute/virtualMachines/extensions", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "not-applicable", "not-applicable", "none"),
    region: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "not-applicable", "not-applicable", "none"),
    alternatives: ["terraform-redeploy"],
    notes: ["Child resource: moves with the parent VM. Re-apply after a region move."],
  }),
  rule("azure.network.networkinterfaces", "Microsoft.Network/networkInterfaces", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE, region: MOVER, alternatives: ["terraform-redeploy"], sources: ["move", "moverVm"],
    features: ["Private IP addresses are re-allocated at the destination unless statically configured in the target subnet range"],
  }),
  rule("azure.network.virtualnetworks", "Microsoft.Network/virtualNetworks", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE, region: MOVER,
    alternatives: ["terraform-redeploy"],
    sources: ["move", "mover", { title: "Relocate Azure Virtual Network to another region", url: L("operational-excellence/relocation-virtual-network") }],
    prerequisites: ["All VNet peerings must be removed before a move and re-established afterwards", "Subnets with delegations, service endpoints or private endpoints require the dependent services to be handled first"],
    risks: ["Address space collisions with existing destination networks/hub", "Peering, UDR and DNS settings are not carried by an ARM move"],
    validation: ["Address space, subnets, NSG/UDR associations, peering state, DNS servers"],
    confidence: 0.85,
  }),
  rule("azure.network.virtualnetworks.subnets", "Microsoft.Network/virtualNetworks/subnets", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "not-applicable", "not-applicable", "none"),
    region: P("native-move", "azure-resource-mover", "recreate", "reconstruct", "not-applicable", "not-applicable", "none"),
    alternatives: ["terraform-redeploy"],
    notes: ["Child resource: always moves with the parent virtual network."],
  }),
  rule("azure.network.networksecuritygroups", "Microsoft.Network/networkSecurityGroups", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE, region: MOVER, alternatives: ["terraform-redeploy"], sources: ["move", "mover"],
    validation: ["Rule count and effective security rules match", "Associations re-established"],
  }),
  rule("azure.network.publicipaddresses", "Microsoft.Network/publicIPAddresses", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("supported", "conditional", "conditional", "unsupported"),
    pattern: NATIVE,
    region: P("recreate-and-migrate", "azure-resource-mover", "recreate", "reconstruct", "not-applicable", "not-applicable", "minutes"),
    alternatives: ["terraform-redeploy"],
    sources: ["move", "mover", { title: "Public IP addresses in Azure", url: L("virtual-network/ip-services/public-ip-addresses") }, { title: "Move networking resources to new resource group or subscription", url: L("azure-resource-manager/management/move-limitations/networking-move-limitations"), retrievedOn: RECHECKED }],
    notes: ["Subscription move: Learn says a resource associated with a Standard SKU public IP address can't be moved across subscriptions; disassociate the address first (2026-11-16)."],
    risks: ["The IP address value cannot be preserved across regions; DNS records, firewall allowlists and partner integrations must be updated", "Basic SKU public IPs are retired and must be replaced with Standard SKU"],
    mitigations: ["Lower DNS TTL ahead of cutover; inventory external allowlists"],
    humanReview: true,
    confidence: 0.8,
  }),
  rule("azure.network.loadbalancers", "Microsoft.Network/loadBalancers", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("supported", "conditional", "conditional", "unsupported"),
    pattern: NATIVE, region: MOVER,
    alternatives: ["terraform-redeploy"],
    sources: ["move", "mover"],
    features: ["Basic SKU load balancers are retired; plan an upgrade to Standard as part of the migration", "Resource Mover supports internal and Standard public load balancers; backend pool members must move in the same move collection"],
    notes: ["Subscription move: Learn lists Basic SKU as Yes and Standard SKU as No (2026-11-16); for a Standard load balancer plan a redeploy in the destination subscription."],
    confidence: 0.75,
  }),
  rule("azure.network.routetables", "Microsoft.Network/routeTables", {
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: NATIVE, region: RECREATE_REDEPLOY, alternatives: ["terraform-redeploy"],
  }),
  rule("azure.network.natgateways", "Microsoft.Network/natGateways", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("unsupported", "unsupported", "unsupported", "unsupported"),
    pattern: RECREATE_REDEPLOY, region: RECREATE_REDEPLOY, alternatives: ["terraform-redeploy"],
    notes: ["Learn lists NAT gateways as not movable to another resource group, subscription or region (2026-11-16): recreate in the destination."],
    risks: ["Outbound IP changes; update downstream allowlists"],
    confidence: 0.7,
  }),
  rule("azure.network.applicationgateways", "Microsoft.Network/applicationGateways", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("unsupported", "unsupported", "unsupported", "unsupported"),
    pattern: RECREATE_REDEPLOY, region: RECREATE_REDEPLOY,
    notes: ["Learn lists application gateways as not movable to another resource group, subscription or region (2026-11-16): recreate in the destination."],
    alternatives: ["terraform-redeploy"],
    risks: ["Certificates (Key Vault references) and WAF policies must be re-bound in the destination"],
    humanReview: true, confidence: 0.75,
  }),
  rule("azure.network.privateendpoints", "Microsoft.Network/privateEndpoints", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("conditional", "conditional", "unsupported", "unsupported"),
    pattern: NATIVE, region: RECREATE_REDEPLOY,
    alternatives: ["terraform-redeploy"],
    sources: ["move", { title: "Relocate Azure Private Link Service / private endpoints", url: L("operational-excellence/relocation-private-link") }, { title: "Move networking resources to new resource group or subscription", url: L("azure-resource-manager/management/move-limitations/networking-move-limitations"), retrievedOn: RECHECKED }],
    notes: ["Resource group and subscription moves: Learn allows them only for private endpoints of the listed private-link resources (for example Microsoft.Sql/servers and Microsoft.DocumentDB/databaseAccounts); all other private endpoints are recreated (2026-11-16)."],
    prerequisites: ["The target PaaS resource must already exist in the destination; the private endpoint is recreated against it", "Private DNS zone group records must be regenerated"],
    risks: ["Stale A records in the private DNS zone cause resolution to the old region"],
    confidence: 0.8,
  }),
  rule("azure.network.privatednszones", "Microsoft.Network/privateDnsZones", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE,
    region: P("retain", "none", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "none"),
    alternatives: ["export-and-import", "terraform-redeploy"],
    sources: ["move", { title: "What is Azure Private DNS?", url: L("dns/private-dns-overview") }],
    notes: ["Global resource — region relocation does not apply. Virtual network links must be recreated for destination VNets; records for relocated services are regenerated by their private endpoints."],
    xt: ["Zones cannot be shared across tenants; export the record set and recreate the zone and links in the destination tenant."],
  }),
  rule("azure.web.serverfarms", "Microsoft.Web/serverFarms", {
    support: S("conditional", "conditional", "unsupported", "unsupported"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "move-with-resource", "not-applicable", "none"),
    region: RECREATE_REDEPLOY,
    alternatives: ["terraform-redeploy", "application-deployment"],
    sources: ["move", "moveHowTo", { title: "Relocate an App Service resource to another region", url: L("operational-excellence/relocation-app-service") }],
    features: ["All apps in the plan must move together; the destination resource group must not previously have hosted App Service resources in a different webspace", "App Service Environment (Isolated) plans cannot be moved"],
    confidence: 0.75,
    humanReview: true,
  }),
  rule("azure.web.sites", "Microsoft.Web/sites", {
    support: S("conditional", "conditional", "unsupported", "unsupported"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "reconstruct", "not-applicable", "none"),
    region: P("recreate-and-migrate", "application-deployment", "recreate", "reconstruct", "reconstruct", "export-import", "minutes"),
    alternatives: ["backup-and-restore", "terraform-redeploy", "slot-deployment"],
    sources: ["move", { title: "Relocate an App Service resource to another region", url: L("operational-excellence/relocation-app-service") }],
    features: ["Web apps and Function apps share this type (kind distinguishes them); the app must move with its plan", "Private endpoints, VNet integration, custom domains/certificates and managed identities are reconstructed", "Function Apps additionally need their storage account and host keys reconciled"],
    prerequisites: ["Hostname/TLS certificate ownership available in destination", "App settings with Key Vault references point to a destination vault"],
    risks: ["Hostname cutover downtime; managed-identity object ID changes break RBAC on dependencies"],
    validation: ["All app settings present (no unresolved Key Vault references)", "Custom domains bound, TLS valid", "Smoke test and health check endpoint"],
    rollback: ["Keep the source app running until DNS cutover is verified; revert DNS"],
    confidence: 0.8,
  }),
  rule("azure.web.sites.slots", "Microsoft.Web/sites/slots", {
    support: S("conditional", "conditional", "unsupported", "unsupported"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "reconstruct", "not-applicable", "none"),
    region: RECREATE_REDEPLOY, alternatives: ["slot-deployment", "terraform-redeploy"], sources: ["move"],
    notes: ["Child resource: moves with the parent site."],
  }),
  rule("azure.storage.storageaccounts", "Microsoft.Storage/storageAccounts", {
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: NATIVE,
    region: P("recreate-and-migrate", "azcopy", "recreate", "reconstruct", "reconstruct", "sync-and-cutover", "hours"),
    alternatives: ["azure-storage-mover", "object-replication", "azure-data-factory", "data-box"],
    sources: ["move", { title: "Relocate Azure Storage Account to another region", url: L("operational-excellence/relocation-storage-account") }, { title: "Get started with AzCopy", url: L("storage/common/storage-use-azcopy-v10") }],
    features: ["Account name is globally unique and cannot be reused while the source exists", "Lifecycle, soft-delete, immutability and network rules are not copied by data tools"],
    risks: ["Large data volumes extend the sync window; egress cost", "Applications hold the account name/endpoint and keys/SAS — connection reconfiguration required"],
    mitigations: ["Use incremental AzCopy sync passes, freeze writes, then final sync and reconciliation (object counts, sizes, MD5 where available)"],
    validation: ["Container/share inventory matches", "Object counts and total bytes reconcile within tolerance", "Access tier and encryption settings match"],
    rollback: ["Source account remains intact until applications are verified against the destination"],
    humanReview: true,
    confidence: 0.85,
  }),
  rule("azure.keyvault.vaults", "Microsoft.KeyVault/vaults", {
    support: S("supported", "supported", "unsupported", "conditional"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "reconstruct", "move-with-resource", "none"),
    region: P("recreate-and-migrate", "backup-and-restore", "recreate", "reconstruct", "reconstruct", "backup-restore", "minutes"),
    crossTenant: P("recreate-and-migrate", "manual-reconstruction", "recreate", "reconstruct", "reconstruct", "export-import", "hours"),
    alternatives: ["manual-reconstruction", "terraform-redeploy"],
    sources: ["move", { title: "Moving an Azure Key Vault across subscriptions / tenants", url: L("key-vault/general/move-subscription") }, { title: "Relocate Azure Key Vault to another region", url: L("operational-excellence/relocation-key-vault") }],
    features: ["Vault names are globally unique; soft-delete and purge protection block name reuse until purge", "Key Vault backup/restore of secrets, keys and certificates works only within the same Azure geography and subscription"],
    xt: ["A vault is bound to a tenant ID: after a subscription transfer the vault's tenantId must be updated and all access policies / RBAC recreated", "HSM-protected keys cannot be exported; plan re-generation and re-encryption"],
    risks: ["Applications referencing the vault URI break at cutover", "Secret versions and rotation history may not carry"],
    validation: ["Secret/key/certificate inventory count matches", "RBAC/access policies reproduced for destination identities", "Dependent app settings resolve"],
    humanReview: true, confidence: 0.85,
  }),
  rule("azure.sql.servers", "Microsoft.Sql/servers", {
    support: S("supported", "supported", "unsupported", "conditional"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "reconstruct", "move-with-resource", "none"),
    region: P("recreate-and-migrate", "failover-group", "recreate", "reconstruct", "reconstruct", "replicate", "minutes"),
    alternatives: ["geo-replication", "export-and-import", "azure-database-migration-service", "backup-and-restore"],
    sources: ["move", { title: "Active geo-replication", url: L("azure-sql/database/active-geo-replication-overview") }, { title: "Failover groups overview", url: L("azure-sql/database/failover-group-sql-db") }],
    features: ["Logical server name is globally unique (DNS); firewall rules, auditing, Entra admin and TDE keys are server-level configuration"],
    xt: ["Entra administrator and Entra-authenticated logins are tenant-bound and must be recreated; TDE with customer-managed keys references a Key Vault in the source tenant"],
    confidence: 0.8,
  }),
  rule("azure.sql.servers.databases", "Microsoft.Sql/servers/databases", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("supported", "supported", "conditional", "conditional"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "not-applicable", "move-with-resource", "none"),
    region: P("recreate-and-migrate", "geo-replication", "recreate", "reconstruct", "not-applicable", "replicate", "minutes"),
    alternatives: ["failover-group", "export-and-import", "azure-database-migration-service", "backup-and-restore"],
    sources: ["move", { title: "Active geo-replication", url: L("azure-sql/database/active-geo-replication-overview") }, { title: "Import a BACPAC file", url: L("azure-sql/database/database-import") }, { title: "Move Azure SQL Database resources to another region (Resource Mover)", url: L("resource-mover/tutorial-move-region-sql"), retrievedOn: RECHECKED }],
    notes: ["Region move: Learn lists databases as movable across regions with Azure Resource Mover or the SQL move guidance; Resource Mover doesn't move the logical server, so a target server must exist in the destination region first (2026-11-16)."],
    features: ["Databases move with the logical server; a cross-region move creates a geo-secondary then promotes it (near-zero data loss) or uses BACPAC export/import for offline moves", "Elastic pool membership must exist at the destination before the database is replicated"],
    validation: ["Row counts per table; checksum on critical tables", "Replication lag zero at cutover", "Application connection string switched to the listener/new server"],
    rollback: ["Keep the source primary until the application is verified; fail back via the group"],
    confidence: 0.85,
  }),
  rule("azure.dbforpostgresql.flexibleservers", "Microsoft.DBforPostgreSQL/flexibleServers", {
    support: S("supported", "supported", "unsupported", "conditional"),
    pattern: P("native-move", "arm-move", "move-with-resource", "move-with-resource", "reconstruct", "move-with-resource", "none"),
    region: P("recreate-and-migrate", "native-database-replication", "recreate", "reconstruct", "reconstruct", "replicate", "minutes"),
    alternatives: ["backup-and-restore", "azure-database-migration-service", "export-and-import"],
    sources: ["move", { title: "Relocate Azure Database for PostgreSQL flexible server", url: L("operational-excellence/relocation-postgresql-flexible-server") }],
    features: ["Cross-region read replica promotion or geo-restore from geo-redundant backup; pg_dump/pg_restore for offline", "Server parameters, firewall/VNet integration and Entra authentication are configuration to reconstruct"],
    confidence: 0.75,
  }),
  rule("azure.documentdb.databaseaccounts", "Microsoft.DocumentDB/databaseAccounts", {
    support: S("supported", "supported", "conditional", "unsupported"),
    pattern: NATIVE,
    region: P("orchestrated-migration", "service-specific-migration", "move-with-resource", "reconstruct", "not-applicable", "replicate", "none"),
    alternatives: ["azure-data-factory", "export-and-import"],
    sources: ["move", { title: "Relocate Azure Cosmos DB to another region", url: L("operational-excellence/relocation-cosmos-db") }, { title: "Manage an Azure Cosmos DB account", url: L("cosmos-db/how-to-manage-database-account") }],
    features: ["Native path: add the target region, make it the write region, remove the source region — no data copy tool required", "Private endpoints, firewall and CMK are reconstructed"],
    validation: ["Region list and write region correct", "Document counts per container"],
    confidence: 0.8,
  }),
  rule("azure.containerregistry.registries", "Microsoft.ContainerRegistry/registries", {
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: NATIVE,
    region: P("recreate-and-migrate", "container-image-copy", "recreate", "reconstruct", "reconstruct", "export-import", "none"),
    alternatives: ["terraform-redeploy", "service-specific-migration"],
    sources: ["move", { title: "Relocate Azure Container Registry", url: L("operational-excellence/relocation-container-registry") }, { title: "Import container images", url: L("container-registry/container-registry-import-images") }],
    features: ["Registry name is globally unique; geo-replicated Premium registries may simply add the target replication region", "Images are copied with az acr import; webhooks, tasks, scope maps and tokens are reconstructed"],
    confidence: 0.8,
  }),
  rule("azure.operationalinsights.workspaces", "Microsoft.OperationalInsights/workspaces", {
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: NATIVE,
    region: P("recreate-and-migrate", "terraform-redeploy", "recreate", "reconstruct", "not-applicable", "retain-in-source", "none"),
    alternatives: ["export-and-import", "manual-reconstruction"],
    sources: ["move", { title: "Move a Log Analytics workspace", url: L("azure-monitor/logs/move-workspace") }, { title: "Relocate Log Analytics workspace", url: L("operational-excellence/relocation-log-analytics") }],
    features: ["Historical log data cannot be migrated between workspaces; retain the source workspace until the retention period lapses or export tables", "Linked services, solutions, saved searches, DCRs and alert rules point at the workspace ID"],
    confidence: 0.85,
  }),
  rule("azure.insights.components", "Microsoft.Insights/components", {
    support: S("supported", "supported", "unsupported", "unsupported"),
    pattern: NATIVE,
    region: P("recreate-and-migrate", "terraform-redeploy", "recreate", "reconstruct", "not-applicable", "retain-in-source", "none"),
    alternatives: ["manual-reconstruction"],
    sources: ["move", { title: "Workspace-based Application Insights resources", url: L("azure-monitor/app/create-workspace-resource") }],
    features: ["Telemetry history stays with the source; the connection string/instrumentation key changes and must be redeployed to applications", "Workspace-based resources depend on the Log Analytics workspace decision"],
  }),
  rule("azure.insights.actiongroups", "Microsoft.Insights/actionGroups", {
    support: S("supported", "supported", "supported", "unsupported"),
    pattern: NATIVE, region: P("retain", "none", "not-applicable", "not-applicable", "not-applicable", "not-applicable", "none"),
    alternatives: ["terraform-redeploy"], sources: ["move"],
    notes: ["Global resource; verify receivers (webhooks, logic apps, automation runbooks) that are themselves migrated."],
  }),
  rule("azure.insights.metricalerts", "Microsoft.Insights/metricAlerts", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("unsupported", "unsupported", "unsupported", "unsupported"),
    pattern: RECREATE_REDEPLOY, region: RECREATE_REDEPLOY, alternatives: ["terraform-redeploy"], sources: ["move"],
    notes: ["Alert scopes reference resource IDs; recreate against the destination resources.", "Learn lists metric alerts as not movable to another resource group, subscription or region (2026-11-16)."],
  }),
  rule("azure.recoveryservices.vaults", "Microsoft.RecoveryServices/vaults", {
    support: S("conditional", "conditional", "unsupported", "unsupported"),
    pattern: NATIVE,
    region: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "reconstruct", "retain-in-source", "none"),
    alternatives: ["manual-reconstruction"],
    sources: ["move", { title: "Move a Recovery Services vault across resource groups and subscriptions", url: L("backup/backup-azure-move-recovery-services-vault") }, { title: "Relocate Azure Backup", url: L("operational-excellence/relocation-backup") }],
    features: ["Vaults with Azure Site Recovery replication configured cannot be moved; disable replication first", "Backup data cannot be transferred to a new vault — protect workloads anew in the destination vault and retain the source vault for recovery-point retention"],
    notes: ["Migration vs DR: this vault is protection infrastructure. Recreate protection in the destination; do not treat ASR replication as the migration path for protected items."],
    humanReview: true, confidence: 0.8,
  }),
  rule("azure.managedidentity.userassignedidentities", "Microsoft.ManagedIdentity/userAssignedIdentities", {
    version: "1.1.0", reviewDate: RECHECKED_REVIEW, retrieved: { move: RECHECKED },
    support: S("unsupported", "unsupported", "unsupported", "unsupported"),
    pattern: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "reconstruct", "not-applicable", "minutes"),
    region: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "reconstruct", "not-applicable", "none"),
    crossTenant: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "reconstruct", "not-applicable", "minutes"),
    alternatives: ["manual-reconstruction"],
    sources: ["move", { title: "Managed identities FAQ", url: L("../entra/identity/managed-identities-azure-resources/managed-identities-faq").replace("azure/../", ""), retrievedOn: RECHECKED }, { title: "Relocate managed identities", url: L("operational-excellence/relocation-managed-identity") }],
    features: ["Identity principal ID and client ID change when recreated: every role assignment, Key Vault policy, and federated credential must be rebound"],
    xt: ["Managed identities are tenant-bound service principals; they are always recreated in the destination tenant."],
    notes: ["Learn lists user-assigned identities as not movable to another resource group or subscription, and its managed identities FAQ says moving one to a different resource group isn't supported (2026-11-16): create a new identity and grant it the same access."],
    confidence: 0.85,
  }),
  rule("azure.resources.resourcegroups", "Microsoft.Resources/resourceGroups", {
    support: S("unsupported", "unsupported", "unsupported", "unsupported"),
    pattern: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "not-applicable", "not-applicable", "none"),
    region: P("recreate-only", "terraform-redeploy", "recreate", "reconstruct", "not-applicable", "not-applicable", "none"),
    alternatives: ["terraform-redeploy"], sources: ["moveHowTo"],
    notes: ["A resource group is a container; its location only stores metadata. Create the destination group and move/recreate the contents."],
    confidence: 0.95,
  }),
];

// group by provider namespace file
const byFile = new Map();
for (const r of rules) {
  const f = r.provider.toLowerCase().replace("microsoft.", "") + ".json";
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(r);
}
mkdirSync("rules/azure", { recursive: true });
for (const [f, list] of byFile) writeFileSync(join("rules/azure", f), JSON.stringify(list, null, 2) + "\n");
console.log(`wrote ${rules.length} rules into ${byFile.size} files`);
