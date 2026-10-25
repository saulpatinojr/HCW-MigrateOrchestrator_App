variable "prefix" {
  type    = string
  default = "amo"
}
variable "environment" {
  type    = string
  default = "prod"
}
variable "location" {
  type    = string
  default = "westus3"
}
variable "location_short" {
  type    = string
  default = "wus3"
}
variable "tenant_id" {
  type = string
}
variable "vnet_cidr" {
  type    = string
  default = "10.60.0.0/22"
}
variable "postgres_sku" {
  type    = string
  default = "B_Standard_B1ms"
}
variable "image_ref" {
  type        = string
  description = "The appliance image, always by immutable digest (docker.io/hybridcloudworks/img-mo-appliance-app@sha256:...), as printed at the end of the publish-images run summary. A tag such as :latest can change under a running deployment, so it is refused."
  validation {
    condition     = can(regex("^[^@[:space:]]+@sha256:[0-9a-f]{64}$", var.image_ref))
    error_message = "image_ref must be an image reference with an exact digest, in the form registry/name@sha256:<64 hexadecimal characters>. Tags such as :latest are not accepted. Copy the reference from the end of the publish-images run summary."
  }
}
variable "assessment_scope_ids" {
  type        = list(string)
  description = "Subscriptions or management groups the appliance may discover (Reader). Execution RBAC is granted per engagement, never here."
  default     = []
}
variable "tags" {
  type    = map(string)
  default = {}
}
variable "ingress_allowed_source_prefixes" {
  type        = list(string)
  description = "Who may reach the API over HTTPS (port 443) through the Container Apps subnet firewall: the single value \"Internet\" (the default; the API is public, and every request still needs an Entra token that carries an app role, ADR-0031), or a list of IPv4 CIDR ranges such as your office or VPN addresses, which is stricter. A service tag cannot be mixed with ranges."
  default     = ["Internet"]
  validation {
    condition     = length(var.ingress_allowed_source_prefixes) > 0 && ((length(var.ingress_allowed_source_prefixes) == 1 && try(var.ingress_allowed_source_prefixes[0], "") == "Internet") || alltrue([for p in var.ingress_allowed_source_prefixes : can(cidrhost(p, 0))]))
    error_message = "ingress_allowed_source_prefixes must be exactly [\"Internet\"] or a non-empty list of CIDR ranges such as \"203.0.113.0/24\". Do not mix \"Internet\" with ranges, and do not use \"*\"."
  }
}
variable "postgres_geo_redundant_backup_enabled" {
  type        = bool
  description = "Keep a second copy of the PostgreSQL backups in the paired Azure region, so the database can be restored there after a regional outage. Off by default because it costs money (backup storage is billed for twice the backup size beyond the free allowance, see https://learn.microsoft.com/azure/postgresql/backup-restore/concepts-backup-restore) and because Azure only allows choosing it when the server is created: switching it on for a server that already exists makes Terraform plan to DESTROY and recreate the database. Decide before the first apply (ADR-0032)."
  default     = false
}
variable "app_role_assignments" {
  type = map(object({
    principal_object_id = string
    role                = string
  }))
  description = "Who may use the API: Entra users, groups or applications to assign an app role to, keyed by any short label. Empty by default; assign in the Entra portal instead if you prefer (docs/deployment/enterprise.md, section 2). role is Migration.Plan, Migration.Execute or Migration.Execute.Destructive. Assigning a group needs Microsoft Entra ID P1 or higher."
  default     = {}
  validation {
    condition     = alltrue([for a in values(var.app_role_assignments) : contains(["Migration.Plan", "Migration.Execute", "Migration.Execute.Destructive"], a.role)])
    error_message = "Each role must be exactly Migration.Plan, Migration.Execute or Migration.Execute.Destructive."
  }
}
