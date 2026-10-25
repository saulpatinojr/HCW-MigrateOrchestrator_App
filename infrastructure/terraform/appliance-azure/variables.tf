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
  description = "The appliance image, always by immutable digest (docker.io/hybridcloudworks/hcw-migrateorchestrator@sha256:...), as printed at the end of the publish-images run summary. A tag such as :latest can change under a running deployment, so it is refused."
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
