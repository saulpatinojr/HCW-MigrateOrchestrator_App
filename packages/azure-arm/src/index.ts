/**
 * Azure Resource Manager clients for the appliance (ADR-0022, ADR-0027): Resource Graph discovery, ARM validateMoveResources
 * evidence and subscription/Lighthouse scope inventory. REST only, dependency-free credentials from @amo/azure-auth.
 * The DiscoveryProvider interface itself lives in @amo/azure-discovery so the lab (saulpatinojr/HCW-MigrateOrchestrator_AddOn) can never reach Azure.
 */
export * from "./resource-graph.js";
export * from "./move-validation.js";
export * from "./scopes.js";
