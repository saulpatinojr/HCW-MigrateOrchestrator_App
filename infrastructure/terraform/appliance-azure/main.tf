# Appliance on Azure: Container Apps + user-assigned managed identity + PostgreSQL Flexible Server (Entra auth, private)
# + Key Vault (config references) + Log Analytics / Application Insights. No client secrets anywhere (ADR-0022).
terraform {
  required_version = ">= 1.9.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    azuread = { source = "hashicorp/azuread", version = "~> 3.0" }
  }
}

provider "azurerm" {
  features {}
}
provider "azuread" {}

locals {
  name = "${var.prefix}-${var.environment}-${var.location_short}"
  tags = merge({ application = "azure-migration-orchestrator", component = "appliance", environment = var.environment }, var.tags)

  # Subnet ranges, shared by the subnets and by the network security group rules that name them (ADR-0032).
  aca_subnet_cidr = cidrsubnet(var.vnet_cidr, 4, 0)
  db_subnet_cidr  = cidrsubnet(var.vnet_cidr, 4, 1)

  # True when ingress_allowed_source_prefixes is exactly the tag "Internet"; the rule then uses source_address_prefix.
  ingress_from_tag = length(var.ingress_allowed_source_prefixes) == 1 && try(var.ingress_allowed_source_prefixes[0], "") == "Internet"

  # Ranges that Azure Kubernetes Service and workload-profile Container Apps environments reserve; the subnet range must not
  # overlap them (Microsoft Learn, "Virtual network configuration"). Terraform lacks a function that tests CIDR overlap, so the ranges are
  # compared as integers: first address and size.
  reserved_cidrs = ["169.254.0.0/16", "172.30.0.0/16", "172.31.0.0/16", "192.0.2.0/24", "100.100.0.0/17", "100.100.128.0/19", "100.100.160.0/19", "100.100.192.0/19"]
  vnet_first     = (((tonumber(split(".", split("/", var.vnet_cidr)[0])[0]) * 256 + tonumber(split(".", split("/", var.vnet_cidr)[0])[1])) * 256 + tonumber(split(".", split("/", var.vnet_cidr)[0])[2])) * 256 + tonumber(split(".", split("/", var.vnet_cidr)[0])[3]))
  vnet_size      = pow(2, 32 - tonumber(split("/", var.vnet_cidr)[1]))
  reserved_bounds = [
    for c in local.reserved_cidrs : {
      cidr  = c
      first = (((tonumber(split(".", split("/", c)[0])[0]) * 256 + tonumber(split(".", split("/", c)[0])[1])) * 256 + tonumber(split(".", split("/", c)[0])[2])) * 256 + tonumber(split(".", split("/", c)[0])[3]))
      size  = pow(2, 32 - tonumber(split("/", c)[1]))
    }
  ]
  vnet_overlaps = [for r in local.reserved_bounds : r.cidr if local.vnet_first < r.first + r.size && r.first < local.vnet_first + local.vnet_size]
}

resource "azurerm_resource_group" "app" {
  name     = "rg-${local.name}-01"
  location = var.location
  tags     = local.tags
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.name}-01"
  location            = var.location
  resource_group_name = azurerm_resource_group.app.name
  tags                = local.tags
}

# Reader on each assessment scope: discovery is read-only by default (§3.9).
resource "azurerm_role_assignment" "reader" {
  for_each             = toset(var.assessment_scope_ids)
  scope                = each.value
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_log_analytics_workspace" "app" {
  name                = "log-${local.name}-01"
  location            = var.location
  resource_group_name = azurerm_resource_group.app.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_application_insights" "app" {
  name                = "appi-${local.name}-01"
  location            = var.location
  resource_group_name = azurerm_resource_group.app.name
  workspace_id        = azurerm_log_analytics_workspace.app.id
  application_type    = "web"
  tags                = local.tags
}

resource "azurerm_virtual_network" "app" {
  name                = "vnet-${local.name}-01"
  location            = var.location
  resource_group_name = azurerm_resource_group.app.name
  address_space       = [var.vnet_cidr]
  tags                = local.tags
}

resource "azurerm_subnet" "aca" {
  name                 = "snet-aca"
  resource_group_name  = azurerm_resource_group.app.name
  virtual_network_name = azurerm_virtual_network.app.name
  address_prefixes     = [local.aca_subnet_cidr]
  # Workload-profile environment subnet rules (Learn, "Virtual network configuration"): at least /27 (var.vnet_cidr is limited to
  # /23 or larger, so this /26 default and any allowed range pass), delegated to Microsoft.App/environments (below), and not
  # overlapping the reserved ranges.
  lifecycle {
    precondition {
      condition     = length(local.vnet_overlaps) == 0
      error_message = "vnet_cidr overlaps a range that Azure Kubernetes Service or a workload-profile Container Apps environment reserves: the ranges listed in local.reserved_cidrs (Microsoft Learn, Virtual network configuration). Choose another range."
    }
  }
  delegation {
    name = "aca"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "db" {
  name                 = "snet-db"
  resource_group_name  = azurerm_resource_group.app.name
  virtual_network_name = azurerm_virtual_network.app.name
  address_prefixes     = [local.db_subnet_cidr]
  delegation {
    name = "pg"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# Subnet firewalls (ticket #53, ADR-0032). Each subnet gets a network security group (NSG) that ends in an explicit
# deny-all-inbound rule at priority 4096, which also overrides Azure's built-in "allow traffic from the virtual network"
# rule, so nothing reaches either subnet unless a rule below names it. Outbound is left at Azure's defaults on purpose:
# the Container Apps platform and PostgreSQL both have outbound dependencies (container registry, Microsoft Entra ID,
# Azure Monitor, Storage) that an outbound lockdown must list exactly, and the docs for both services say what to allow.

# Container Apps subnet, for a workload-profile environment (ADR-0032, owner decision on issue 82). Rules follow the
# inbound table for workload profiles in "Network security groups for configuring a virtual network in Azure Container
# Apps" (https://learn.microsoft.com/en-us/azure/container-apps/firewall-integration).
#
# What this group does NOT do: Microsoft says that for an external workload-profile environment inbound traffic arrives
# through a public IP in the managed resource group and not through this subnet, that inbound NSG rules apply only to
# traffic that goes through the virtual network, and that locking down inbound traffic with an NSG or firewall is not
# supported for such an environment. So these rules do NOT restrict who reaches the API from the internet. That is done by
# the IP restrictions on the container app ingress (var.ingress_allowed_source_prefixes) and, above all, by the bearer
# token and role check in the API (ADR-0031). The group limits traffic that does cross the virtual network.
#
# PROVISIONAL, NOT VALIDATED: never applied. A sandbox apply must confirm the environment starts and the API answers over
# 443 with this group attached (issue 82, issue 53). The db group below is a separate group.
resource "azurerm_network_security_group" "aca" {
  name                = "nsg-${local.name}-aca"
  location            = var.location
  resource_group_name = azurerm_resource_group.app.name
  tags                = local.tags
}

# Accepted risk, the only suppression in this configuration (ADR-0032): by default the source is the Internet tag, because the
# container app has external ingress and its users sign in from anywhere. Per Learn this rule only matters for traffic that
# enters through the virtual network; the public path is limited by the ingress IP restrictions and by the Entra token with an
# app role (ADR-0031), which every request needs.
#trivy:ignore:AVD-AZU-0047
resource "azurerm_network_security_rule" "aca_allow_https_from_clients" {
  name                        = "allow-https-from-clients"
  description                 = "HTTPS (443 and the edge proxy port 31443) from var.ingress_allowed_source_prefixes; only traffic through the VNet."
  network_security_group_name = azurerm_network_security_group.aca.name
  resource_group_name         = azurerm_resource_group.app.name
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  # A service tag goes in the singular argument; the plural one accepts ranges only (azurerm docs).
  source_address_prefix        = local.ingress_from_tag ? "Internet" : null
  source_address_prefixes      = local.ingress_from_tag ? null : var.ingress_allowed_source_prefixes
  destination_address_prefixes = [local.aca_subnet_cidr]
  destination_port_ranges      = ["443", "31443"]
}

resource "azurerm_network_security_rule" "aca_allow_load_balancer_probes" {
  name                         = "allow-azure-load-balancer-probes"
  description                  = "Azure Load Balancer health probes of the environment (the platform allocates a port in this range)."
  network_security_group_name  = azurerm_network_security_group.aca.name
  resource_group_name          = azurerm_resource_group.app.name
  priority                     = 110
  direction                    = "Inbound"
  access                       = "Allow"
  protocol                     = "Tcp"
  source_port_range            = "*"
  source_address_prefix        = "AzureLoadBalancer"
  destination_address_prefixes = [local.aca_subnet_cidr]
  destination_port_range       = "30000-32767"
}

resource "azurerm_network_security_rule" "aca_allow_subnet_internal" {
  name                         = "allow-subnet-internal"
  description                  = "Traffic inside the Container Apps subnet (the environment's Envoy sidecars talk to each other)."
  network_security_group_name  = azurerm_network_security_group.aca.name
  resource_group_name          = azurerm_resource_group.app.name
  priority                     = 120
  direction                    = "Inbound"
  access                       = "Allow"
  protocol                     = "*"
  source_port_range            = "*"
  source_address_prefixes      = [local.aca_subnet_cidr]
  destination_address_prefixes = [local.aca_subnet_cidr]
  destination_port_range       = "*"
}

resource "azurerm_network_security_rule" "aca_deny_all_inbound" {
  name                        = "deny-all-inbound"
  description                 = "Default deny: everything not allowed above, including other subnets of the virtual network."
  network_security_group_name = azurerm_network_security_group.aca.name
  resource_group_name         = azurerm_resource_group.app.name
  priority                    = 4096
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  source_address_prefix       = "*"
  destination_address_prefix  = "*"
  destination_port_range      = "*"
}

# The association comes after the rules, so the subnet is never briefly attached to an empty group.
resource "azurerm_subnet_network_security_group_association" "aca" {
  subnet_id                 = azurerm_subnet.aca.id
  network_security_group_id = azurerm_network_security_group.aca.id
  depends_on = [
    azurerm_network_security_rule.aca_allow_https_from_clients,
    azurerm_network_security_rule.aca_allow_load_balancer_probes,
    azurerm_network_security_rule.aca_allow_subnet_internal,
    azurerm_network_security_rule.aca_deny_all_inbound,
  ]
}

# Database subnet: PostgreSQL only, and only from the Container Apps subnet.
resource "azurerm_network_security_group" "db" {
  name                = "nsg-${local.name}-db"
  location            = var.location
  resource_group_name = azurerm_resource_group.app.name
  tags                = local.tags
}

resource "azurerm_network_security_rule" "db_allow_postgres_from_aca" {
  name                         = "allow-postgres-from-aca-subnet"
  description                  = "PostgreSQL (5432) from the Container Apps subnet, where the API and the worker run."
  network_security_group_name  = azurerm_network_security_group.db.name
  resource_group_name          = azurerm_resource_group.app.name
  priority                     = 100
  direction                    = "Inbound"
  access                       = "Allow"
  protocol                     = "Tcp"
  source_port_range            = "*"
  source_address_prefixes      = [local.aca_subnet_cidr]
  destination_address_prefixes = [local.db_subnet_cidr]
  destination_port_range       = "5432"
}

resource "azurerm_network_security_rule" "db_allow_postgres_within_subnet" {
  name                         = "allow-postgres-within-db-subnet"
  description                  = "Port 5432 inside the database subnet, which PostgreSQL features such as high availability need (Microsoft Learn)."
  network_security_group_name  = azurerm_network_security_group.db.name
  resource_group_name          = azurerm_resource_group.app.name
  priority                     = 110
  direction                    = "Inbound"
  access                       = "Allow"
  protocol                     = "Tcp"
  source_port_range            = "*"
  source_address_prefixes      = [local.db_subnet_cidr]
  destination_address_prefixes = [local.db_subnet_cidr]
  destination_port_range       = "5432"
}

resource "azurerm_network_security_rule" "db_deny_all_inbound" {
  name                        = "deny-all-inbound"
  description                 = "Default deny: everything not allowed above."
  network_security_group_name = azurerm_network_security_group.db.name
  resource_group_name         = azurerm_resource_group.app.name
  priority                    = 4096
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  source_address_prefix       = "*"
  destination_address_prefix  = "*"
  destination_port_range      = "*"
}

resource "azurerm_subnet_network_security_group_association" "db" {
  subnet_id                 = azurerm_subnet.db.id
  network_security_group_id = azurerm_network_security_group.db.id
  depends_on = [
    azurerm_network_security_rule.db_allow_postgres_from_aca,
    azurerm_network_security_rule.db_allow_postgres_within_subnet,
    azurerm_network_security_rule.db_deny_all_inbound,
  ]
}

resource "azurerm_private_dns_zone" "pg" {
  name                = "${local.name}.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.app.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "pg" {
  name                  = "pg-link"
  resource_group_name   = azurerm_resource_group.app.name
  private_dns_zone_name = azurerm_private_dns_zone.pg.name
  virtual_network_id    = azurerm_virtual_network.app.id
}

# PostgreSQL with Entra-only authentication; the app's managed identity is the database principal.
resource "azurerm_postgresql_flexible_server" "db" {
  name                          = "psql-${local.name}-01"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.app.name
  version                       = "16"
  sku_name                      = var.postgres_sku
  storage_mb                    = 32768
  delegated_subnet_id           = azurerm_subnet.db.id
  private_dns_zone_id           = azurerm_private_dns_zone.pg.id
  public_network_access_enabled = false
  # Off by default. Opting in roughly doubles backup storage and can only be chosen when the server is created (ADR-0032).
  geo_redundant_backup_enabled = var.postgres_geo_redundant_backup_enabled
  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = var.tenant_id
  }
  tags = local.tags
  depends_on = [
    azurerm_private_dns_zone_virtual_network_link.pg,
    azurerm_subnet_network_security_group_association.db,
  ]
}

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "app" {
  server_name         = azurerm_postgresql_flexible_server.db.name
  resource_group_name = azurerm_resource_group.app.name
  tenant_id           = var.tenant_id
  object_id           = azurerm_user_assigned_identity.app.principal_id
  principal_name      = azurerm_user_assigned_identity.app.name
  principal_type      = "ServicePrincipal"
}

resource "azurerm_postgresql_flexible_server_database" "amo" {
  name      = "amo"
  server_id = azurerm_postgresql_flexible_server.db.id
}

resource "azurerm_container_app_environment" "app" {
  name                       = "cae-${local.name}-01"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.app.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.app.id
  infrastructure_subnet_id   = azurerm_subnet.aca.id
  tags                       = local.tags
  # The subnet firewall is attached before the environment is created, so the environment is built under it.
  depends_on = [azurerm_subnet_network_security_group_association.aca]

  # A workload-profile environment (owner decision on issue 82, ADR-0032). Microsoft Learn, "Virtual network configuration"
  # (https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks): the subnet must be at least /27 and
  # delegated to Microsoft.App/environments (snet-aca is a /26 with that delegation). The provider documents that an
  # environment created without a workload profile is consumption-only and cannot get profiles later (it would be recreated),
  # and that a Consumption profile must be named "Consumption". External ingress (internal_load_balancer_enabled stays at its
  # default, false) matches external_enabled on the API.
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_container_app" "api" {
  name                         = "ca-${local.name}-api"
  container_app_environment_id = azurerm_container_app_environment.app.id
  resource_group_name          = azurerm_resource_group.app.name
  revision_mode                = "Single"
  tags                         = local.tags
  workload_profile_name        = "Consumption"
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  ingress {
    external_enabled = true
    target_port      = 8081
    # No plain-HTTP bridge: the platform redirects http to https. Note that the NSG cannot close port 80 for the public path.
    allow_insecure_connections = false
    # The real source restriction for the public path (Learn, "Set up IP ingress restrictions": allow rules admit only the
    # listed IPv4 ranges and deny the rest; with no rules everything is allowed). Empty for the default "Internet".
    dynamic "ip_security_restriction" {
      for_each = local.ingress_from_tag ? {} : { for i, p in var.ingress_allowed_source_prefixes : "allow-${i}" => p }
      content {
        name             = ip_security_restriction.key
        description      = "Allowed client range from ingress_allowed_source_prefixes"
        action           = "Allow"
        ip_address_range = ip_security_restriction.value
      }
    }
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
  template {
    min_replicas = 1
    max_replicas = 3
    container {
      name   = "appliance-api"
      image  = var.image_ref
      cpu    = 0.5
      memory = "1Gi"
      env {
        name  = "AMO_ENTRA_TENANT_ID"
        value = var.tenant_id
      }
      env {
        name  = "AMO_ENTRA_CLIENT_ID"
        value = azuread_application.api.client_id
      }
      env {
        name  = "AMO_ENTRA_AUDIENCE"
        value = "api://${azuread_application.api.client_id}"
      }
      env {
        name  = "AMO_CREDENTIAL_KIND"
        value = "managed-identity"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }
      env {
        # Entra token auth to PostgreSQL: the app exchanges its managed identity for a DB token at connect time (no password).
        name  = "DATABASE_URL"
        value = "postgres://${azurerm_user_assigned_identity.app.name}@${azurerm_postgresql_flexible_server.db.fqdn}:5432/amo?sslmode=require"
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.app.connection_string
      }
    }
  }
}

# Entra app registration for the appliance API with app roles mapped to authorization levels. The API refuses a token
# that carries none of these roles (403, ADR-0031). That API check is the authoritative control; the service principal
# below adds Entra's assignment requirement as a first layer (see the note there).
resource "azuread_application" "api" {
  display_name     = "Azure Migration Orchestrator (${var.environment})"
  sign_in_audience = "AzureADMyOrg"
  identifier_uris  = [] # set to ["api://<client_id>"] after creation (azuread requires the ID first)

  dynamic "app_role" {
    for_each = {
      "Migration.Read"                = "Assess only: run discovery assessments and read your own results (no move validation, plans or execution)"
      "Migration.Plan"                = "Plan migrations (validation evidence, plans and bundles; no execution)"
      "Migration.Execute"             = "Record approvals and run gated Resource Mover actions: prepare, initiateMove, commit (each with its recorded approval) and discard"
      "Migration.Execute.Destructive" = "Reserved for irreversible operations such as source deletion; the API exposes none yet, so today it grants nothing beyond Migration.Execute"
    }
    content {
      allowed_member_types = ["User", "Application"]
      description          = app_role.value
      display_name         = app_role.key
      enabled              = true
      id                   = uuidv5("url", "amo-role-${app_role.key}")
      value                = app_role.key
    }
  }
}

# The enterprise application (service principal) behind the registration. app_role_assignment_required = true is a FIRST
# layer: Entra is meant to refuse to sign in users, and to issue tokens to applications, that have no assigned app role.
# It is not the control: administrators who can manage the application are documented exceptions to it, the portal's
# "Default Access" assignment is a placeholder and not a role, and none of this has been verified live (ADR-0031). The
# authoritative control is the role check in the API, which answers 403 to any token without a recognised app role.
resource "azuread_service_principal" "api" {
  client_id                    = azuread_application.api.client_id
  app_role_assignment_required = true
  # Adopt a service principal that already exists for this application (for example one created by the portal) instead of
  # failing; without it, apply stops with an import error. See "Rollback" in ADR-0031.
  use_existing = true

  # Roll back by setting app_role_assignment_required = false, never by removing this resource: destroying the enterprise
  # application deletes every role assignment made on it.
  lifecycle {
    prevent_destroy = true
  }
}

# Optional, declarative role assignments (var.app_role_assignments, empty by default). Anyone not listed there is assigned
# in the Entra portal instead; the steps are in docs/deployment/enterprise.md.
resource "azuread_app_role_assignment" "api" {
  for_each            = var.app_role_assignments
  app_role_id         = azuread_service_principal.api.app_role_ids[each.value.role]
  principal_object_id = each.value.principal_object_id
  resource_object_id  = azuread_service_principal.api.object_id
}

# Worker: same image, different command; polls Azure long-running operations and updates the repository (ADR-0026).
resource "azurerm_container_app" "worker" {
  name                         = "ca-${local.name}-worker"
  container_app_environment_id = azurerm_container_app_environment.app.id
  resource_group_name          = azurerm_resource_group.app.name
  revision_mode                = "Single"
  tags                         = local.tags
  workload_profile_name        = "Consumption"
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }
  template {
    min_replicas = 1
    max_replicas = 1
    container {
      name    = "worker"
      image   = var.image_ref
      command = ["node", "apps/worker/dist/main.js"]
      cpu     = 0.25
      memory  = "0.5Gi"
      env {
        name  = "AMO_ENTRA_TENANT_ID"
        value = var.tenant_id
      }
      env {
        name  = "AMO_CREDENTIAL_KIND"
        value = "managed-identity"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }
      env {
        name  = "DATABASE_URL"
        value = "postgres://${azurerm_user_assigned_identity.app.name}@${azurerm_postgresql_flexible_server.db.fqdn}:5432/amo?sslmode=require"
      }
    }
  }
}
