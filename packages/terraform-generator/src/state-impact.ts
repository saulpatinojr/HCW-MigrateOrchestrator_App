import type { Assessment, ResourceDecisionRecord } from "@amo/domain";
import { tfName } from "./tf-name.js";

/**
 * IaC state impact (ADR-0020). An ARM move or a Resource Mover relocation gives every resource a NEW resource ID
 * (subscription / resource-group segment, and for region moves a new resource). Existing Terraform state therefore
 * points at IDs that no longer exist. We emit declarative `removed` + `import` blocks (Terraform ≥ 1.7) and an
 * equivalent imperative script, so the customer's state is reconciled without destroying anything.
 */
export const AZURERM_TYPE: Record<string, string> = {
  "microsoft.compute/virtualmachines": "azurerm_linux_virtual_machine", // or azurerm_windows_virtual_machine — confirm OS
  "microsoft.compute/disks": "azurerm_managed_disk",
  "microsoft.compute/availabilitysets": "azurerm_availability_set",
  "microsoft.compute/snapshots": "azurerm_snapshot",
  "microsoft.compute/virtualmachinescalesets": "azurerm_linux_virtual_machine_scale_set",
  "microsoft.network/networkinterfaces": "azurerm_network_interface",
  "microsoft.network/virtualnetworks": "azurerm_virtual_network",
  "microsoft.network/virtualnetworks/subnets": "azurerm_subnet",
  "microsoft.network/networksecuritygroups": "azurerm_network_security_group",
  "microsoft.network/publicipaddresses": "azurerm_public_ip",
  "microsoft.network/loadbalancers": "azurerm_lb",
  "microsoft.network/routetables": "azurerm_route_table",
  "microsoft.network/natgateways": "azurerm_nat_gateway",
  "microsoft.network/applicationgateways": "azurerm_application_gateway",
  "microsoft.network/privateendpoints": "azurerm_private_endpoint",
  "microsoft.network/privatednszones": "azurerm_private_dns_zone",
  "microsoft.web/serverfarms": "azurerm_service_plan",
  "microsoft.web/sites": "azurerm_linux_web_app", // or azurerm_linux_function_app when kind contains functionapp
  "microsoft.storage/storageaccounts": "azurerm_storage_account",
  "microsoft.keyvault/vaults": "azurerm_key_vault",
  "microsoft.sql/servers": "azurerm_mssql_server",
  "microsoft.sql/servers/databases": "azurerm_mssql_database",
  "microsoft.dbforpostgresql/flexibleservers": "azurerm_postgresql_flexible_server",
  "microsoft.documentdb/databaseaccounts": "azurerm_cosmosdb_account",
  "microsoft.containerregistry/registries": "azurerm_container_registry",
  "microsoft.operationalinsights/workspaces": "azurerm_log_analytics_workspace",
  "microsoft.insights/components": "azurerm_application_insights",
  "microsoft.insights/actiongroups": "azurerm_monitor_action_group",
  "microsoft.insights/metricalerts": "azurerm_monitor_metric_alert",
  "microsoft.recoveryservices/vaults": "azurerm_recovery_services_vault",
  "microsoft.managedidentity/userassignedidentities": "azurerm_user_assigned_identity",
  "microsoft.resources/resourcegroups": "azurerm_resource_group",
};

export type StateImpactKind = "id-changes-same-resource" | "new-resource-recreated" | "no-change" | "unknown";

export interface StateImpactEntry {
  resource: string;
  resourceType: string;
  terraformType: string | null;
  kind: StateImpactKind;
  oldId: string | null;
  /** Computed when the destination subscription/resource group are known; otherwise a template with TODO markers. */
  newId: string | null;
  newIdIsTemplate: boolean;
  suggestedAddress: string;
  note: string;
}

function terraformTypeFor(d: ResourceDecisionRecord): string | null {
  const t = d.resourceType.toLowerCase();
  if (t === "microsoft.web/sites" && /functionapp/i.test(d.kind ?? "")) return "azurerm_linux_function_app";
  return AZURERM_TYPE[t] ?? null;
}

export function computeNewId(oldId: string | null, a: Assessment): { id: string | null; template: boolean } {
  if (!oldId) return { id: null, template: false };
  const sub = a.intent.destinationSubscriptionId;
  const rg = a.intent.destinationResourceGroup;
  const m = oldId.match(/^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)(\/.*)?$/i);
  if (!m) return { id: null, template: false };
  const rest = m[3] ?? "";
  const op = a.intent.desiredOperation;
  // Subscription: unchanged for RG and region moves; explicit or placeholder for subscription/cross-tenant moves.
  const newSub = op === "resource-group-move" || op === "region-relocation" || op === "disaster-recovery" ? sub ?? m[1] : sub ?? "__DESTINATION_SUBSCRIPTION_ID__";
  // Resource group: a region move lands in a new target RG (the source still exists), so it is explicit or placeholder too.
  const newRg = op === "disaster-recovery" ? m[2] : rg ?? "__DESTINATION_RESOURCE_GROUP__";
  const template = newSub.includes("__") || newRg.includes("__");
  return { id: `/subscriptions/${newSub}/resourceGroups/${newRg}${rest}`, template };
}

export function stateImpactEntries(a: Assessment): StateImpactEntry[] {
  return a.decisions.map((d) => {
    const tfType = terraformTypeFor(d);
    const addr = `${tfType ?? "azurerm_UNKNOWN"}.${tfName(d.displayName)}`;
    let kind: StateImpactKind;
    let note: string;
    if (d.disposition === "retain" || d.disposition === "retire" || d.recommendedTool === "none") {
      kind = "no-change"; note = "Resource stays where it is; no state change.";
    } else if (d.recommendedTool === "arm-move") {
      kind = "id-changes-same-resource"; note = "Same resource, new ID after the ARM move: detach the old state entry (removed, destroy=false) and import the new ID.";
    } else if (d.infrastructureDisposition === "recreate") {
      kind = "new-resource-recreated"; note = "New resource is created (Terraform or Resource Mover). If Terraform creates it, no import is needed; if Resource Mover creates it, import the new ID. Either way remove the old address with destroy=false so the source survives until decommission.";
    } else if (d.disposition === "unknown-requires-validation") {
      kind = "unknown"; note = "Disposition unknown; state impact cannot be determined.";
    } else {
      kind = "id-changes-same-resource"; note = "Service-native relocation keeps the resource; verify whether the ID changes for this service.";
    }
    const { id: newId, template } = kind === "no-change" || kind === "unknown" ? { id: null, template: false } : computeNewId(d.resourceId, a);
    return { resource: d.displayName, resourceType: d.resourceType, terraformType: tfType, kind, oldId: d.resourceId, newId, newIdIsTemplate: template, suggestedAddress: addr, note };
  });
}

export function generateStateImpact(a: Assessment): Record<string, string> {
  const entries = stateImpactEntries(a);
  const header = `# Generated by Azure Migration Orchestrator ${a.applicationVersion} — IaC state impact (ADR-0020)\n# Terraform >= 1.7 (removed blocks) and >= 1.5 (import blocks). Replace suggested addresses with the ADDRESSES IN YOUR STATE.\n# Nothing here destroys a resource: every removed block sets destroy = false.\n\n`;
  const impacted = entries.filter((e) => e.kind !== "no-change" && e.kind !== "unknown");
  const removed = impacted.map((e) => `removed {\n  from = ${e.suggestedAddress}  # TODO: actual address in your state (terraform state list)\n  lifecycle {\n    destroy = false\n  }\n}`).join("\n\n");
  const imports = impacted.filter((e) => e.newId).map((e) => `import {\n  to = ${e.suggestedAddress}\n  id = "${e.newId}"${e.newIdIsTemplate ? "  # TODO: replace the __PLACEHOLDER__ tokens with the destination scope" : ""}\n}`).join("\n\n");
  const script = `#!/usr/bin/env bash
${header}# Imperative equivalent for Terraform < 1.7. Dry-run by default; EXECUTE=1 to apply. Run in the root module directory.
# Placeholders __DESTINATION_SUBSCRIPTION_ID__ / __DESTINATION_RESOURCE_GROUP__ are filled from the environment.
set -euo pipefail
EXECUTE="\${EXECUTE:-0}"
DEST_SUB="\${DESTINATION_SUBSCRIPTION_ID:-}"
DEST_RG="\${DESTINATION_RESOURCE_GROUP:-}"
fill() { printf '%s' "$1" | sed "s#__DESTINATION_SUBSCRIPTION_ID__#$DEST_SUB#g; s#__DESTINATION_RESOURCE_GROUP__#$DEST_RG#g"; }
run() { if [ "$EXECUTE" = "1" ]; then "$@"; else echo "DRY-RUN: $*"; fi; }
` + impacted.filter((e) => e.newId).map((e) => `# ${e.resource} (${e.kind})\nrun terraform state rm '${e.suggestedAddress}'\nrun terraform import '${e.suggestedAddress}' "$(fill '${e.newId}')"`).join("\n") + "\n";
  const table = ["| Resource | Type | Impact | Old ID | New ID |", "|---|---|---|---|---|", ...entries.map((e) => `| ${e.resource} | ${e.terraformType ?? "—"} | ${e.kind} | ${e.oldId ? "`…" + e.oldId.split("/providers/")[1] + "`" : "—"} | ${e.newId ? (e.newIdIsTemplate ? "template" : "computed") : "—"} |`)].join("\n");
  const readme = `# IaC state impact\n\nARM moves and Resource Mover relocations change resource IDs. If this estate is managed with Terraform, apply the blocks here **after** the migration step for each resource and **before** the next \`terraform plan\`, or Terraform will plan to recreate everything it can no longer find.\n\n- \`removed.tf\` detaches old addresses without destroying anything.\n- \`imports.tf\` imports the new IDs${a.intent.destinationSubscriptionId || a.intent.destinationResourceGroup ? "" : " (destination subscription/resource group were not supplied, so IDs contain TODO placeholders)"}.\n- \`state-mv.sh\` is the imperative equivalent for older Terraform.\n- Addresses are **suggestions** derived from resource names; replace them with the addresses from \`terraform state list\`.\n- VM/App types assume Linux (\`azurerm_linux_*\`); switch to the Windows variants where applicable.\n\n${table}\n\n## Notes\n\n${entries.filter((e) => e.kind !== "no-change").map((e) => `- **${e.resource}**: ${e.note}`).join("\n")}\n`;
  return {
    "state-impact/README.md": readme,
    "state-impact/removed.tf": header + (removed || "# No resources require state detachment for this operation.\n") + "\n",
    "state-impact/imports.tf": header + (imports || "# No imports can be generated for this operation.\n") + "\n",
    "state-impact/state-mv.sh": script,
    "state-impact/state-impact.json": JSON.stringify(entries, null, 2) + "\n",
  };
}
