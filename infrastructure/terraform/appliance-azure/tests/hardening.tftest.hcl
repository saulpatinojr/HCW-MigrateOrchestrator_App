# Plan-only tests with mock providers for the database hardening and the API host allow-list (issues 53 and 83, ADR-0032,
# ADR-0033). Like appliance.tftest.hcl: both providers are mocked, every run is `command = plan`, nothing reaches Azure or
# Microsoft Entra ID, and a pass proves what the configuration declares, not how Azure behaves once deployed.

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

# ---- Host allow-list for the API (issue 83, F8)

run "the_api_gets_its_own_address_as_an_allowed_host_and_the_worker_gets_none" {
  command = plan

  override_resource {
    target          = azurerm_container_app_environment.app
    override_during = plan
    values = {
      id             = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.App/managedEnvironments/cae-test"
      default_domain = "happyfield-0123abcd.westus3.azurecontainerapps.io"
    }
  }

  variables {
    additional_allowed_hosts = ["amo.example.com"]
  }

  assert {
    condition     = one([for c in one(azurerm_container_app.api.template).container : one([for e in c.env : e.value if e.name == "AMO_ALLOWED_HOSTS"])]) == "ca-amo-prod-wus3-api.happyfield-0123abcd.westus3.azurecontainerapps.io,amo.example.com"
    error_message = "The API must accept its own Container Apps address plus additional_allowed_hosts."
  }

  assert {
    condition     = length(flatten([for c in one(azurerm_container_app.worker.template).container : [for e in c.env : e.name if e.name == "AMO_ALLOWED_HOSTS" || e.name == "AMO_ALLOWED_ORIGINS"]])) == 0
    error_message = "The worker serves no HTTP and must not get the web-exposure variables (issue 83, F10)."
  }
}

run "additional_allowed_hosts_refuses_schemes_ports_paths_wildcards_and_capitals" {
  command = plan

  variables {
    additional_allowed_hosts = ["https://app.example.com", "app.example.com:443", "app.example.com/path", "*.example.com", "App.Example.com", ".example.com", "example.com."]
  }

  expect_failures = [var.additional_allowed_hosts]
}
