# Plan-only tests with mock providers for the database hardening and the API host names (issues 53 and 83, ADR-0032). Like
# appliance.tftest.hcl: both providers are mocked, every run is `command = plan`, nothing reaches Azure or Microsoft Entra ID,
# and a pass proves what the configuration declares, not how Azure behaves once deployed. What the API Container App is given
# in AMO_ALLOWED_HOSTS cannot be read in a plan (the environment's address is known only after apply, and a mocked apply cannot
# be torn down because the enterprise application has prevent_destroy), so tests/security/terraform-allowed-hosts.test.mjs
# checks that wiring in the file instead.

mock_provider "azurerm" {}
mock_provider "azuread" {}

variables {
  tenant_id = "00000000-0000-0000-0000-000000000000"
  image_ref = "docker.io/hybridcloudworks/img-mo-appliance-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}

# ---- Geo-redundant backup needs a paired region (Learn: Backup and restore; Azure region pairs and nonpaired regions)

run "geo_redundant_backup_is_refused_in_a_region_without_a_pair" {
  command = plan

  variables {
    location                              = "qatarcentral"
    location_short                        = "qac"
    postgres_geo_redundant_backup_enabled = true
  }

  expect_failures = [var.postgres_geo_redundant_backup_enabled]
}

run "geo_redundant_backup_is_refused_when_the_region_is_written_with_a_space_and_capitals" {
  command = plan

  variables {
    location                              = "Poland Central"
    location_short                        = "plc"
    postgres_geo_redundant_backup_enabled = true
  }

  expect_failures = [var.postgres_geo_redundant_backup_enabled]
}

run "geo_redundant_backup_is_accepted_in_a_paired_region" {
  command = plan

  variables {
    location                              = "northeurope"
    location_short                        = "neu"
    postgres_geo_redundant_backup_enabled = true
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.db.geo_redundant_backup_enabled == true
    error_message = "A paired region (North Europe, paired with West Europe) must accept the opt-in."
  }
}

run "an_unpaired_region_is_fine_while_geo_redundant_backup_stays_off" {
  command = plan

  variables {
    location       = "qatarcentral"
    location_short = "qac"
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.db.geo_redundant_backup_enabled == false
    error_message = "The rule applies only to the opt-in; the default must work in any region."
  }
}

run "the_database_stays_private_and_entra_only_with_no_private_endpoint" {
  command = plan

  assert {
    condition     = azurerm_postgresql_flexible_server.db.public_network_access_enabled == false && length(azurerm_subnet.db.delegation) == 1
    error_message = "The database must stay private through virtual network integration (a delegated subnet, public access disabled); a private endpoint is not available for such a server (ADR-0032 section 4)."
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.db.authentication[0].password_auth_enabled == false && azurerm_postgresql_flexible_server.db.authentication[0].active_directory_auth_enabled == true
    error_message = "The database must stay Entra-only."
  }
}

# ---- Host names for the API (issue 83, F8)

run "additional_allowed_hosts_accepts_bare_lower_case_names" {
  command = plan

  variables {
    additional_allowed_hosts = ["amo.example.com", "api-2.example.co.uk"]
  }

  assert {
    condition     = length(var.additional_allowed_hosts) == 2
    error_message = "Bare lower-case host names must be accepted."
  }
}

run "additional_allowed_hosts_refuses_schemes_ports_paths_wildcards_and_capitals" {
  command = plan

  variables {
    additional_allowed_hosts = ["https://app.example.com", "app.example.com:443", "app.example.com/path", "*.example.com", "App.Example.com", ".example.com", "example.com."]
  }

  expect_failures = [var.additional_allowed_hosts]
}
