import type { Assessment, ResourceDecisionRecord } from "@amo/domain";
import { tfName } from "./tf-name.js";

/**
 * Infrastructure as Code Agent output (§12.9, §21). Generates modular, illustrative Terraform for
 * resources whose infrastructure disposition is recreate. Never emits secrets; uses placeholders
 * only in variables/tfvars.example. Not production-approved until fmt/validate/scan/plan/approval.
 */
const hcl = (s: string): string => JSON.stringify(s);

const MODULE_FOR: Record<string, string> = {
  "microsoft.network/virtualnetworks": "network",
  "microsoft.network/networksecuritygroups": "network",
  "microsoft.network/routetables": "network",
  "microsoft.network/publicipaddresses": "network",
  "microsoft.network/privateendpoints": "connectivity",
  "microsoft.network/privatednszones": "connectivity",
  "microsoft.network/loadbalancers": "connectivity",
  "microsoft.network/applicationgateways": "connectivity",
  "microsoft.managedidentity/userassignedidentities": "identity",
  "microsoft.keyvault/vaults": "shared_services",
  "microsoft.operationalinsights/workspaces": "monitoring",
  "microsoft.insights/components": "monitoring",
  "microsoft.insights/actiongroups": "monitoring",
  "microsoft.insights/metricalerts": "monitoring",
  "microsoft.recoveryservices/vaults": "shared_services",
  "microsoft.storage/storageaccounts": "data_services",
  "microsoft.sql/servers": "data_services",
  "microsoft.sql/servers/databases": "data_services",
  "microsoft.dbforpostgresql/flexibleservers": "data_services",
  "microsoft.documentdb/databaseaccounts": "data_services",
  "microsoft.containerregistry/registries": "data_services",
  "microsoft.compute/virtualmachines": "workload",
  "microsoft.compute/disks": "workload",
  "microsoft.compute/availabilitysets": "workload",
  "microsoft.network/networkinterfaces": "workload",
  "microsoft.web/serverfarms": "workload",
  "microsoft.web/sites": "workload",
};

const RESOURCE_BLOCK: Record<string, (d: ResourceDecisionRecord, n: string) => string> = {
  "microsoft.network/virtualnetworks": (d, n) => `resource "azurerm_virtual_network" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = var.${n}_address_space # TODO: supply the source address space (not in CSV)
  tags                = var.tags
}`,
  "microsoft.network/networksecuritygroups": (d, n) => `resource "azurerm_network_security_group" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
  # Security rules must be exported from the source (az network nsg rule list) — not in CSV.
}`,
  "microsoft.network/publicipaddresses": (d, n) => `resource "azurerm_public_ip" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard" # Basic SKU is retired; the IP address value will change.
  tags                = var.tags
}`,
  "microsoft.managedidentity/userassignedidentities": (d, n) => `resource "azurerm_user_assigned_identity" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
  # New principal/client IDs: rebind every role assignment and Key Vault access after apply.
}`,
  "microsoft.keyvault/vaults": (d, n) => `resource "azurerm_key_vault" "${n}" {
  name                       = ${hcl(d.displayName + "-new")} # vault names are globally unique and soft-deleted names are reserved
  location                   = var.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = var.tenant_id
  sku_name                   = "standard"
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  enable_rbac_authorization  = true
  public_network_access_enabled = false
  tags                       = var.tags
  # Secrets are NOT defined in Terraform. Restore/recreate them with the Key Vault runbook.
}`,
  "microsoft.storage/storageaccounts": (d, n) => `resource "azurerm_storage_account" "${n}" {
  name                            = ${hcl((d.displayName + "new").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24))} # globally unique; source name is unavailable until the source is deleted
  location                        = var.location
  resource_group_name             = var.resource_group_name
  account_tier                    = "Standard"
  account_replication_type        = "ZRS" # TODO: match source redundancy (not in CSV)
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = false
  tags                            = var.tags
  # Data is copied separately (AzCopy / Storage Mover) — see runbooks/migration.md.
}`,
  "microsoft.operationalinsights/workspaces": (d, n) => `resource "azurerm_log_analytics_workspace" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30 # TODO: match source retention
  tags                = var.tags
  # Historical data stays in the source workspace; retain it until retention lapses.
}`,
  "microsoft.insights/components": (d, n) => `resource "azurerm_application_insights" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  application_type    = "web"
  workspace_id        = var.log_analytics_workspace_id
  tags                = var.tags
  # New connection string must be redeployed to applications.
}`,
  "microsoft.web/serverfarms": (d, n) => `resource "azurerm_service_plan" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  os_type             = "Linux" # TODO: confirm (not in CSV)
  sku_name            = ${hcl(d.sku ?? "P1v3")}
  tags                = var.tags
}`,
  "microsoft.web/sites": (d, n) => `resource "azurerm_linux_web_app" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = var.${n}_service_plan_id
  https_only          = true
  identity { type = "SystemAssigned" }
  site_config {}
  # App settings with Key Vault references must point at the destination vault; no secret literals here.
  tags = var.tags
}`,
  "microsoft.sql/servers": (d, n) => `resource "azurerm_mssql_server" "${n}" {
  name                          = ${hcl(d.displayName + "-new")} # DNS name is globally unique
  location                      = var.location
  resource_group_name           = var.resource_group_name
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false
  azuread_administrator {
    azuread_authentication_only = true
    login_username              = var.sql_entra_admin_login
    object_id                   = var.sql_entra_admin_object_id
  }
  tags = var.tags
}`,
  "microsoft.sql/servers/databases": (d, n) => `resource "azurerm_mssql_database" "${n}" {
  name      = ${hcl(d.displayName)}
  server_id = var.${n}_server_id
  sku_name  = ${hcl(d.sku ?? "GP_S_Gen5_2")} # TODO: match source
  # Data arrives via geo-replication/failover group or BACPAC import — not via Terraform.
  tags = var.tags
}`,
  "microsoft.containerregistry/registries": (d, n) => `resource "azurerm_container_registry" "${n}" {
  name                = ${hcl((d.displayName + "new").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50))}
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = ${hcl(d.sku ?? "Premium")}
  admin_enabled       = false
  tags                = var.tags
  # Import images with: az acr import (see scripts/azure-cli).
}`,
  "microsoft.compute/virtualmachines": (d, n) => `# ${d.displayName}: Resource Mover is the recommended path. This block is a fallback for recreate scenarios.
resource "azurerm_linux_virtual_machine" "${n}" {
  name                = ${hcl(d.displayName)}
  location            = var.location
  resource_group_name = var.resource_group_name
  size                = ${hcl(d.sku ?? "Standard_D2s_v5")} # TODO: match source
  admin_username      = "azureadmin"
  network_interface_ids = [var.${n}_nic_id]
  admin_ssh_key {
    username   = "azureadmin"
    public_key = var.ssh_public_key # public key only; never a private key
  }
  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
  }
  source_image_id = var.${n}_image_id # TODO: image/snapshot copied from source
  identity { type = "SystemAssigned" }
  tags = var.tags
}`,
};

export interface TerraformBundle {
  files: Record<string, string>;
  modulesUsed: string[];
  skipped: Array<{ resource: string; reason: string }>;
}

export function generateTerraform(a: Assessment): TerraformBundle {
  const files: Record<string, string> = {};
  const skipped: TerraformBundle["skipped"] = [];
  const byModule = new Map<string, string[]>();
  const extraVars = new Set<string>();
  for (const d of a.decisions) {
    const t = d.resourceType.toLowerCase();
    if (d.infrastructureDisposition !== "recreate") {
      skipped.push({ resource: d.displayName, reason: `infrastructure disposition is ${d.infrastructureDisposition}; no Terraform recreate needed` });
      continue;
    }
    const mod = MODULE_FOR[t];
    const block = RESOURCE_BLOCK[t];
    if (!mod || !block) {
      skipped.push({ resource: d.displayName, reason: `no Terraform template for ${d.resourceType}; handle manually` });
      continue;
    }
    const n = tfName(d.displayName);
    const body = block(d, n);
    for (const m of body.matchAll(/var\.(\w+)/g)) extraVars.add(m[1]);
    byModule.set(mod, [...(byModule.get(mod) ?? []), `# Source: ${d.resourceId ?? d.displayName}\n# Rule: ${d.ruleId} · disposition: ${d.disposition} · confidence: ${d.confidence.band}\n${body}`]);
  }
  const common = new Set(["location", "resource_group_name", "tags", "tenant_id", "log_analytics_workspace_id", "sql_entra_admin_login", "sql_entra_admin_object_id", "ssh_public_key"]);
  const header = `# Generated by ${a.edition === "demo" ? "Hybrid Cloud Works Migration Explorer" : "Azure Migration Orchestrator"} ${a.applicationVersion}\n# Generated: ${a.createdAt} · input ${a.inputHash.slice(0, 12)} · rules ${a.rulesVersion}\n# STATUS: ILLUSTRATIVE — NOT PRODUCTION-APPROVED. Run fmt/validate/tfsec or trivy/plan and obtain human approval.\n\n`;
  files["versions.tf"] = header + `terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
  }
  # Remote state: configure an azurerm backend with state locking per environment (see README.md).
  # backend "azurerm" {}
}
`;
  files["providers.tf"] = header + `provider "azurerm" {
  features {}
  subscription_id = var.destination_subscription_id
  tenant_id       = var.tenant_id
  # Authenticate with Azure CLI, managed identity or workload identity federation — never a client secret in code.
}

provider "azurerm" {
  alias           = "source"
  features {}
  subscription_id = var.source_subscription_id
  tenant_id       = var.source_tenant_id
}
`;
  const varBlocks = [
    `variable "destination_subscription_id" { type = string }`,
    `variable "source_subscription_id" { type = string }`,
    `variable "tenant_id" { type = string }`,
    `variable "source_tenant_id" { type = string }`,
    // HCL forbids a single-line block that continues onto a second line; emit the multi-line form whenever a default is present.
    a.intent.destinationRegion ? `variable "location" {\n  type    = string\n  default = ${hcl(a.intent.destinationRegion)}\n}` : `variable "location" { type = string }`,
    `variable "resource_group_name" { type = string }`,
    `variable "tags" {\n  type = map(string)\n  default = ${JSON.stringify({ "migration-source": "azure-migration-orchestrator", ...a.intent.requiredTags }, null, 2).replace(/"(\w[\w-]*)":/g, "$1 =").replace(/,\n/g, "\n")}\n}`,
    `variable "log_analytics_workspace_id" {\n  type    = string\n  default = null\n}`,
    `variable "sql_entra_admin_login" {\n  type    = string\n  default = "sql-admins"\n}`,
    `variable "sql_entra_admin_object_id" {\n  type    = string\n  default = null\n}`,
    `variable "ssh_public_key" {\n  type        = string\n  description = "Public key only."\n  default     = null\n}`,
    ...[...extraVars].filter((v) => !common.has(v)).sort().map((v) => `variable "${v}" {\n  type        = ${v.endsWith("address_space") ? "list(string)" : "string"}\n  description = "TODO: supply from source inspection"\n}`),
  ];
  files["variables.tf"] = header + varBlocks.join("\n\n") + "\n";
  const modules = [...byModule.keys()].sort();
  // Every `var.x` a module body references must be declared by that module and passed by the root call, or
  // `terraform validate` fails with "Missing required argument" / "Reference to undeclared input variable".
  const moduleInputs = (m: string): string[] => [...new Set([...byModule.get(m)!.join("\n").matchAll(/var\.(\w+)/g)].map((x) => x[1]))].filter((v) => !["location", "resource_group_name", "tags"].includes(v)).sort();
  const varType = (v: string): string => (v.endsWith("address_space") ? "list(string)" : "string");
  const moduleCall = (m: string): string => {
    const inputs = ["location", "resource_group_name", "tags", ...moduleInputs(m)];
    const width = Math.max("source".length, ...inputs.map((v) => v.length));
    return `module "${m}" {\n  ${"source".padEnd(width)} = "./modules/${m}"\n` + inputs.map((v) => `  ${v.padEnd(width)} = var.${v}`).join("\n") + "\n}";
  };
  files["main.tf"] = header + (modules.length ? modules.map(moduleCall).join("\n\n") : "# No resources require recreation for this operation.") + "\n";
  files["outputs.tf"] = header + `output "generated_modules" {\n  value = ${JSON.stringify(modules)}\n}\n`;
  files["terraform.tfvars.example"] = header + `destination_subscription_id = "00000000-0000-0000-0000-000000000000"\nsource_subscription_id      = "00000000-0000-0000-0000-000000000000"\ntenant_id                   = "00000000-0000-0000-0000-000000000000"\nsource_tenant_id            = "00000000-0000-0000-0000-000000000000"\nlocation                    = ${hcl(a.intent.destinationRegion ?? "westus3")}\nresource_group_name         = "rg-example-prod-wus3-01"\n# Placeholder values only. Never commit real identifiers or secrets.\n`;
  for (const m of modules) {
    files[`modules/${m}/main.tf`] = header + byModule.get(m)!.join("\n\n") + "\n";
    files[`modules/${m}/variables.tf`] = header + `variable "location" { type = string }\nvariable "resource_group_name" { type = string }\nvariable "tags" { type = map(string) }\n` + moduleInputs(m).map((v) => `variable "${v}" { type = ${varType(v)} }`).join("\n") + "\n";
  }
  files["README.md"] = `# Generated Terraform\n\n${a.edition === "demo" ? "**DEMO — NOT FOR PRODUCTION.** " : ""}Illustrative scaffolding for resources whose infrastructure disposition is *recreate*. Modules: ${modules.join(", ") || "none"}.\n\nSeparation: platform/connectivity/identity/shared_services/workload/monitoring/data_services. State: use a remote azurerm backend with locking, one state per environment. Import blocks are intentionally omitted until the destination is inspected.\n\nSkipped (${skipped.length}):\n${skipped.map((s) => `- ${s.resource}: ${s.reason}`).join("\n")}\n\nBefore use: terraform fmt -check, terraform validate, security scan (trivy/tfsec), policy check, plan review, environment test, human approval.\n`;
  return { files, modulesUsed: modules, skipped };
}
export * from "./state-impact.js";
export * from "./hcp.js";
export * from "./schema-check.js";
