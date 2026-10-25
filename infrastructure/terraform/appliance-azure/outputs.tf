output "api_fqdn" {
  value = azurerm_container_app.api.ingress[0].fqdn
}
output "api_client_id" {
  value = azuread_application.api.client_id
}
output "api_service_principal_object_id" {
  description = "Object ID of the enterprise application. Entra requires an assigned app role (assignment required is on), so this is where users and groups are assigned in the portal."
  value       = azuread_service_principal.api.object_id
}
output "api_app_roles" {
  description = "App role name to role ID. A user, group or application must hold one of these to get a token for the API."
  value       = azuread_service_principal.api.app_role_ids
}
output "managed_identity_principal_id" {
  value = azurerm_user_assigned_identity.app.principal_id
}
output "post_apply" {
  value = "1) Set identifier_uris = [\"api://<api_client_id>\"] and re-apply. 2) Assign an app role to every person or application that may use the API (Enterprise applications > the app > Users and groups, or var.app_role_assignments): without a role the API answers 403 (Entra's assignment requirement is a first layer on top of that). 3) For Resource Mover, grant the managed identity Contributor on the source and target resource groups per engagement, then remove it."
}
