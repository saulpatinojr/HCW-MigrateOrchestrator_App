# Plan-only tests with mock providers (tickets #46 and #53, ADR-0031, ADR-0032). `terraform test` here never reaches
# Azure or Microsoft Entra ID and needs no credentials: both providers are mocked and every run is `command = plan`.
# A passing run proves what this configuration declares. It does not prove how Azure or Entra behave once deployed.

mock_provider "azurerm" {}
mock_provider "azuread" {}

variables {
  tenant_id = "00000000-0000-0000-0000-000000000000"
  image_ref = "docker.io/hybridcloudworks/img-mo-appliance-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

run "enterprise_application_requires_an_app_role" {
  command = plan

  assert {
    condition     = azuread_service_principal.api.app_role_assignment_required == true
    error_message = "The enterprise application must set app_role_assignment_required = true (ticket #46)."
  }

  assert {
    condition     = toset([for r in azuread_application.api.app_role : r.value]) == toset(["Migration.Plan", "Migration.Execute", "Migration.Execute.Destructive"])
    error_message = "The app roles must be exactly the three the API recognises (apps/appliance-api APP_ROLE_LEVELS)."
  }

  assert {
    condition     = azuread_service_principal.api.use_existing == true
    error_message = "The service principal must adopt an existing one (use_existing = true) instead of failing on an import error."
  }

  assert {
    condition     = length(azuread_app_role_assignment.api) == 0
    error_message = "No role is assigned unless var.app_role_assignments says so."
  }
}

run "declared_role_assignment_is_planned" {
  command = plan

  variables {
    app_role_assignments = {
      admin = { principal_object_id = "11111111-1111-4111-8111-111111111111", role = "Migration.Execute" }
    }
  }

  assert {
    condition     = length(azuread_app_role_assignment.api) == 1
    error_message = "One declared assignment must plan one azuread_app_role_assignment."
  }
}

run "unknown_role_in_an_assignment_is_refused" {
  command = plan

  variables {
    app_role_assignments = {
      admin = { principal_object_id = "11111111-1111-4111-8111-111111111111", role = "Migration.Read" }
    }
  }

  expect_failures = [var.app_role_assignments]
}

run "aca_subnet_firewall_denies_by_default_and_allows_only_https_probes_and_itself" {
  command = plan

  assert {
    condition     = azurerm_network_security_rule.aca_deny_all_inbound.access == "Deny" && azurerm_network_security_rule.aca_deny_all_inbound.direction == "Inbound" && azurerm_network_security_rule.aca_deny_all_inbound.priority == 4096 && azurerm_network_security_rule.aca_deny_all_inbound.source_address_prefix == "*" && azurerm_network_security_rule.aca_deny_all_inbound.destination_address_prefix == "*" && azurerm_network_security_rule.aca_deny_all_inbound.destination_port_range == "*"
    error_message = "The Container Apps subnet must end in an explicit deny-all-inbound rule at priority 4096."
  }

  assert {
    condition     = azurerm_network_security_rule.aca_allow_https_from_clients.destination_port_range == "443" && azurerm_network_security_rule.aca_allow_https_from_clients.protocol == "Tcp" && azurerm_network_security_rule.aca_allow_https_from_clients.access == "Allow" && azurerm_network_security_rule.aca_allow_https_from_clients.source_address_prefix == "Internet" && azurerm_network_security_rule.aca_allow_https_from_clients.source_address_prefixes == null && azurerm_network_security_rule.aca_allow_https_from_clients.destination_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 0)])
    error_message = "Ingress must be TCP 443 to the Container Apps subnet from the default source (the Internet tag, in the singular source_address_prefix, because the plural argument does not accept tags)."
  }

  assert {
    condition     = azurerm_network_security_rule.aca_allow_load_balancer_probes.source_address_prefix == "AzureLoadBalancer" && azurerm_network_security_rule.aca_allow_load_balancer_probes.destination_port_range == "30000-32767"
    error_message = "The load balancer probe rule must name the AzureLoadBalancer tag and ports 30000-32767."
  }

  assert {
    condition     = azurerm_network_security_rule.aca_allow_subnet_internal.source_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 0)]) && azurerm_network_security_rule.aca_allow_subnet_internal.destination_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 0)])
    error_message = "The intra-subnet rule must name only the Container Apps subnet on both sides."
  }

  assert {
    condition     = alltrue([for p in [azurerm_network_security_rule.aca_allow_https_from_clients.priority, azurerm_network_security_rule.aca_allow_load_balancer_probes.priority, azurerm_network_security_rule.aca_allow_subnet_internal.priority] : p < azurerm_network_security_rule.aca_deny_all_inbound.priority])
    error_message = "Every allow rule must be evaluated before the deny-all rule."
  }
}

run "db_subnet_firewall_allows_postgres_only_from_the_aca_subnet" {
  command = plan

  assert {
    condition     = azurerm_network_security_rule.db_allow_postgres_from_aca.destination_port_range == "5432" && azurerm_network_security_rule.db_allow_postgres_from_aca.protocol == "Tcp" && azurerm_network_security_rule.db_allow_postgres_from_aca.access == "Allow" && azurerm_network_security_rule.db_allow_postgres_from_aca.source_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 0)]) && azurerm_network_security_rule.db_allow_postgres_from_aca.destination_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 1)])
    error_message = "PostgreSQL must be reachable on TCP 5432 from the Container Apps subnet only."
  }

  assert {
    condition     = azurerm_network_security_rule.db_allow_postgres_within_subnet.destination_port_range == "5432" && azurerm_network_security_rule.db_allow_postgres_within_subnet.source_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 1)])
    error_message = "The only other database-subnet allow is 5432 from inside the database subnet."
  }

  assert {
    condition     = azurerm_network_security_rule.db_deny_all_inbound.access == "Deny" && azurerm_network_security_rule.db_deny_all_inbound.priority == 4096 && azurerm_network_security_rule.db_deny_all_inbound.source_address_prefix == "*" && azurerm_network_security_rule.db_deny_all_inbound.destination_port_range == "*"
    error_message = "The database subnet must end in an explicit deny-all-inbound rule at priority 4096."
  }
}

run "firewall_rules_follow_a_custom_vnet_range" {
  command = plan

  variables {
    vnet_cidr = "10.99.0.0/22"
  }

  assert {
    condition     = azurerm_network_security_rule.db_allow_postgres_from_aca.source_address_prefixes == toset(["10.99.0.0/26"]) && azurerm_network_security_rule.db_allow_postgres_from_aca.destination_address_prefixes == toset(["10.99.0.64/26"])
    error_message = "The rules must be derived from vnet_cidr, not hard-coded."
  }
}

run "ingress_can_be_limited_to_named_ranges" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["203.0.113.0/24", "198.51.100.7/32"]
  }

  assert {
    condition     = azurerm_network_security_rule.aca_allow_https_from_clients.source_address_prefixes == toset(["203.0.113.0/24", "198.51.100.7/32"]) && azurerm_network_security_rule.aca_allow_https_from_clients.source_address_prefix == null
    error_message = "Named client ranges must replace Internet in the plural source_address_prefixes and leave the singular one unset."
  }
}

run "ingress_refuses_wildcards_empty_lists_and_mixed_tags" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["*"]
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "ingress_refuses_an_empty_list" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = []
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "ingress_refuses_internet_mixed_with_ranges" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["Internet", "203.0.113.0/24"]
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "ingress_refuses_a_range_with_host_bits_set" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["203.0.113.7/24"]
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "ingress_refuses_ipv6" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["2001:db8::/32"]
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "ingress_refuses_the_whole_internet_as_a_range" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["0.0.0.0/0"]
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "ingress_refuses_malformed_ranges" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["203.0.113.0/33", "010.0.0.0/8", "203.0.113.0", "Internet "]
  }

  expect_failures = [var.ingress_allowed_source_prefixes]
}

run "geo_redundant_backup_is_off_by_default" {
  command = plan

  assert {
    condition     = azurerm_postgresql_flexible_server.db.geo_redundant_backup_enabled == false
    error_message = "Geo-redundant backup costs money and is an owner decision: it must default to off (ADR-0032)."
  }
}

run "geo_redundant_backup_is_opt_in" {
  command = plan

  variables {
    postgres_geo_redundant_backup_enabled = true
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.db.geo_redundant_backup_enabled == true
    error_message = "Setting postgres_geo_redundant_backup_enabled must turn the backup copy on."
  }
}
