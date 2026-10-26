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
    condition     = toset([for r in azuread_application.api.app_role : r.value]) == toset(["Migration.Read", "Migration.Plan", "Migration.Execute", "Migration.Execute.Destructive"])
    error_message = "The app roles must be exactly the four the API recognises (apps/appliance-api APP_ROLE_LEVELS)."
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

run "migration_read_is_the_lowest_role_with_a_stable_id" {
  command = plan

  assert {
    condition     = length([for r in azuread_application.api.app_role : r.id if r.value == "Migration.Read"]) == 1 && [for r in azuread_application.api.app_role : r.id if r.value == "Migration.Read"][0] == uuidv5("url", "amo-role-Migration.Read")
    error_message = "Migration.Read must exist once, with the id derived the same way as the other roles."
  }

  assert {
    condition     = length(toset([for r in azuread_application.api.app_role : r.id])) == 4 && alltrue([for r in azuread_application.api.app_role : r.enabled && contains(r.allowed_member_types, "User") && contains(r.allowed_member_types, "Application")])
    error_message = "All four roles must have distinct ids, be enabled and be assignable to users and applications."
  }
}

run "migration_read_assignment_is_planned" {
  command = plan

  variables {
    app_role_assignments = {
      reader = { principal_object_id = "22222222-2222-4222-8222-222222222222", role = "Migration.Read" }
    }
  }

  assert {
    condition     = length(azuread_app_role_assignment.api) == 1
    error_message = "A Migration.Read assignment must plan one azuread_app_role_assignment."
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
      admin = { principal_object_id = "11111111-1111-4111-8111-111111111111", role = "Migration.Reader" }
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
    condition     = azurerm_network_security_rule.aca_allow_https_from_clients.destination_port_ranges == toset(["443", "31443"]) && azurerm_network_security_rule.aca_allow_https_from_clients.protocol == "Tcp" && azurerm_network_security_rule.aca_allow_https_from_clients.access == "Allow" && azurerm_network_security_rule.aca_allow_https_from_clients.source_address_prefix == "Internet" && azurerm_network_security_rule.aca_allow_https_from_clients.source_address_prefixes == null && azurerm_network_security_rule.aca_allow_https_from_clients.destination_address_prefixes == toset([cidrsubnet("10.60.0.0/22", 4, 0)])
    error_message = "Ingress through the virtual network must be TCP 443 and 31443 (Learn, workload-profile table) to the Container Apps subnet from the default source (the Internet tag, in the singular source_address_prefix, because the plural argument does not accept tags)."
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

# ---- Container Apps environment decision (issue 82, ADR-0032): a workload-profile environment

run "environment_is_a_workload_profile_environment_with_a_consumption_profile" {
  command = plan

  assert {
    condition     = length(azurerm_container_app_environment.app.workload_profile) == 1 && one([for p in azurerm_container_app_environment.app.workload_profile : p.name]) == "Consumption" && one([for p in azurerm_container_app_environment.app.workload_profile : p.workload_profile_type]) == "Consumption"
    error_message = "The environment must have exactly one workload profile, named and typed Consumption (a consumption-only environment would need a /23 and no delegation, which this configuration does not provide)."
  }

  assert {
    condition     = azurerm_container_app_environment.app.internal_load_balancer_enabled != true
    error_message = "The environment must stay external, to match external ingress on the API."
  }

  assert {
    condition     = azurerm_container_app.api.workload_profile_name == "Consumption" && azurerm_container_app.worker.workload_profile_name == "Consumption"
    error_message = "Both container apps must run on the Consumption profile."
  }
}

run "aca_subnet_meets_the_workload_profile_requirements" {
  command = plan

  assert {
    condition     = tonumber(split("/", one(azurerm_subnet.aca.address_prefixes))[1]) <= 27
    error_message = "snet-aca must be at least a /27 (Learn, Virtual network configuration, workload profile environment)."
  }

  assert {
    condition     = length(azurerm_subnet.aca.delegation) == 1 && one([for d in azurerm_subnet.aca.delegation : one([for s in d.service_delegation : s.name])]) == "Microsoft.App/environments"
    error_message = "snet-aca must be delegated to Microsoft.App/environments (required for a workload-profile environment)."
  }

  assert {
    condition     = one(azurerm_subnet.aca.address_prefixes) == "10.60.0.0/26" && one(azurerm_subnet.db.address_prefixes) == "10.60.0.64/26"
    error_message = "With the default vnet_cidr the subnets must be the first two sixteenths and must not overlap."
  }

  assert {
    condition     = length(azurerm_subnet.db.delegation) == 1 && one([for d in azurerm_subnet.db.delegation : one([for s in d.service_delegation : s.name])]) == "Microsoft.DBforPostgreSQL/flexibleServers"
    error_message = "snet-db must stay delegated to PostgreSQL flexible servers."
  }

  assert {
    condition     = contains(azurerm_subnet.db.service_endpoints, "Microsoft.Storage")
    error_message = "snet-db must declare the Microsoft.Storage service endpoint that Azure adds for a flexible server; without it Terraform plans to remove it, which can disrupt the server's connectivity."
  }
}

run "vnet_range_must_leave_the_aca_subnet_at_least_a_27" {
  command = plan

  variables {
    vnet_cidr = "10.60.0.0/24"
  }

  expect_failures = [var.vnet_cidr]
}

run "vnet_range_overlapping_a_reserved_range_is_refused" {
  command = plan

  variables {
    vnet_cidr = "172.16.0.0/12"
  }

  expect_failures = [azurerm_subnet.aca]
}

run "vnet_range_inside_a_reserved_range_is_refused" {
  command = plan

  variables {
    vnet_cidr = "100.100.64.0/22"
  }

  expect_failures = [azurerm_subnet.aca]
}

run "a_large_private_range_that_overlaps_nothing_is_accepted" {
  command = plan

  variables {
    vnet_cidr = "10.0.0.0/16"
  }

  assert {
    condition     = one(azurerm_subnet.aca.address_prefixes) == "10.0.0.0/20" && one(azurerm_subnet.db.address_prefixes) == "10.0.16.0/20"
    error_message = "The subnets follow vnet_cidr."
  }
}

run "api_ingress_has_no_ip_restrictions_for_the_internet_default_and_no_insecure_connections" {
  command = plan

  assert {
    condition     = length(azurerm_container_app.api.ingress[0].ip_security_restriction) == 0 && azurerm_container_app.api.ingress[0].allow_insecure_connections == false
    error_message = "The default Internet source adds no ingress restriction (Learn: with no rules all inbound traffic is allowed), and insecure connections stay off."
  }
}

run "api_ingress_allows_only_the_named_ranges_when_set" {
  command = plan

  variables {
    ingress_allowed_source_prefixes = ["203.0.113.0/24", "198.51.100.7/32"]
  }

  assert {
    condition     = toset([for r in azurerm_container_app.api.ingress[0].ip_security_restriction : r.ip_address_range]) == toset(["203.0.113.0/24", "198.51.100.7/32"]) && alltrue([for r in azurerm_container_app.api.ingress[0].ip_security_restriction : r.action == "Allow"])
    error_message = "Named client ranges must become Allow rules on the container app ingress (the control that limits the public path)."
  }
}

run "a_principal_object_id_that_is_not_a_guid_is_refused" {
  command = plan

  variables {
    app_role_assignments = {
      me = { principal_object_id = "not-a-guid", role = "Migration.Read" }
    }
  }

  expect_failures = [var.app_role_assignments]
}

run "a_guid_in_upper_case_is_accepted" {
  command = plan

  variables {
    app_role_assignments = {
      me = { principal_object_id = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE", role = "Migration.Read" }
    }
  }
}
