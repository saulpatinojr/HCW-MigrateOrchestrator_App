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
  type        = string
  description = "Address range of the virtual network. It is split into sixteenths: snet-aca is the first and snet-db the second, so the range must be an IPv4 /23 or larger (snet-aca must be at least a /27, the minimum Microsoft Learn gives for a workload-profile Container Apps environment: https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks) and must not overlap the ranges Azure Kubernetes Service and workload-profile environments reserve, which a precondition on the subnet checks (169.254.0.0/16, 172.30.0.0/16, 172.31.0.0/16, 192.0.2.0/24, 100.100.0.0/17, 100.100.128.0/19, 100.100.160.0/19, 100.100.192.0/19). The default /22 gives snet-aca a /26."
  default     = "10.60.0.0/22"
  validation {
    condition     = try(can(regex("^[0-9]{1,3}([.][0-9]{1,3}){3}/[0-9]{1,2}$", var.vnet_cidr)) && cidrhost(var.vnet_cidr, 0) == split("/", var.vnet_cidr)[0] && tonumber(split("/", var.vnet_cidr)[1]) <= 23 && tonumber(split("/", var.vnet_cidr)[1]) >= 8, false)
    error_message = "vnet_cidr must be an IPv4 range in network form with a prefix length from /8 to /23 (so that snet-aca, a sixteenth of it, is at least a /27), for example 10.60.0.0/22."
  }
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
  description = "Who may reach the API over HTTPS (port 443) through the Container Apps subnet firewall: the single value \"Internet\" (the default; the API is public, and every protected request still needs an Entra token that carries an app role, ADR-0031; only the health and agent-list routes are public), or a list of IPv4 CIDR ranges in their network form (for example 203.0.113.0/24 or 198.51.100.7/32, not 203.0.113.7/24) such as your office or VPN addresses, which is stricter. IPv6, 0.0.0.0/0 and a tag mixed with ranges are refused. It is enforced twice: as IP restrictions on the container app ingress (the control that limits the public path, Learn: Set up IP ingress restrictions) and, only for traffic that crosses the virtual network, in the subnet firewall (ADR-0032)."
  default     = ["Internet"]
  validation {
    condition = length(var.ingress_allowed_source_prefixes) > 0 && (
      (length(var.ingress_allowed_source_prefixes) == 1 && try(var.ingress_allowed_source_prefixes[0], "") == "Internet") ||
      alltrue([
        for p in var.ingress_allowed_source_prefixes :
        try(can(regex("^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/(3[0-2]|[12]?[0-9])$", p)) && cidrhost(p, 0) == split("/", p)[0] && split("/", p)[1] != "0", false)
      ])
    )
    error_message = "ingress_allowed_source_prefixes must be exactly [\"Internet\"] or a non-empty list of IPv4 ranges in network form, such as \"203.0.113.0/24\". Host bits must be zero (203.0.113.7/24 is refused; write 203.0.113.0/24 or 203.0.113.7/32), IPv6 and 0.0.0.0/0 are refused (use \"Internet\" for everyone), and \"Internet\" cannot be mixed with ranges."
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
  description = "Who may use the API: Entra users, groups or applications to assign an app role to, keyed by any short label. Empty by default; assign in the Entra portal instead if you prefer (docs/deployment/enterprise.md, section 2). role is Migration.Read (assess only), Migration.Plan, Migration.Execute or Migration.Execute.Destructive. Assigning a group needs Microsoft Entra ID P1 or higher."
  default     = {}
  validation {
    condition     = alltrue([for a in values(var.app_role_assignments) : contains(["Migration.Read", "Migration.Plan", "Migration.Execute", "Migration.Execute.Destructive"], a.role)])
    error_message = "Each role must be exactly Migration.Read, Migration.Plan, Migration.Execute or Migration.Execute.Destructive."
  }
  validation {
    condition     = alltrue([for a in values(var.app_role_assignments) : can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", a.principal_object_id))])
    error_message = "Each principal_object_id must be the object ID (a GUID such as 00000000-0000-0000-0000-000000000000) of the Entra user, group or application, not its name."
  }
}
