import {
  bandFor,
  type Dependency,
  type Edition,
  type EvidenceItem,
  type LandingZoneProfile,
  type MigrationIntent,
  type MigrationRule,
  type NormalizedResource,
  type ResourceDecisionRecord,
  type SupportState,
} from "@amo/domain";
import { findRule, type LoadedRules } from "@amo/evidence-engine";
import { landingZonePrerequisites } from "@amo/landing-zone";

export interface ClassifyContext {
  edition: Edition;
  authenticated: boolean;
  intent: MigrationIntent;
  profile: LandingZoneProfile;
  rules: LoadedRules;
  dependencies: Map<string, Dependency[]>;
  sequence: Map<string, number>;
  today: string;
}

/** Max confidence any CSV-only (unauthenticated) conclusion may carry (§3 principle 8). */
export const UNAUTHENTICATED_CONFIDENCE_CAP = 0.74;

const DATA_DIMENSIONS = new Set(["replicate", "backup-restore", "export-import", "sync-and-cutover"]);
const GLOBAL_TYPES = new Set(["microsoft.network/privatednszones", "microsoft.insights/actiongroups", "microsoft.network/dnszones"]);

function supportFor(rule: MigrationRule, intent: MigrationIntent): { state: SupportState; dimension: string } {
  switch (intent.desiredOperation) {
    case "resource-group-move":
      return { state: rule.support.resourceGroupMove, dimension: "resource-group move" };
    case "subscription-move":
      return { state: rule.support.subscriptionMove, dimension: "subscription move" };
    case "region-relocation":
      return { state: rule.support.regionRelocation, dimension: "region relocation" };
    case "cross-tenant-migration":
      return { state: rule.support.crossTenant, dimension: "cross-tenant migration" };
    case "modernization":
    case "disaster-recovery":
      return { state: "conditional", dimension: intent.desiredOperation };
  }
}

export function classifyResource(r: NormalizedResource, ctx: ClassifyContext): ResourceDecisionRecord {
  const { intent } = ctx;
  const found = findRule(ctx.rules, r.type);
  const evidence: EvidenceItem[] = [];
  const assumptions: string[] = [];
  const missing: string[] = [];
  const reasonCodes: string[] = [];
  const rationale: string[] = [];
  const deps = ctx.dependencies.get(r.key) ?? [];

  // Evidence that is always present from the CSV
  for (const p of r.provenance) if (p.normalizedValue !== null && p.evidence !== "missing") evidence.push({ state: p.evidence, statement: `${p.normalizedHeader} = ${p.normalizedValue}` });
  for (const f of intent.assumedFields) if (["destinationRegion", "sameTenant", "sameSubscription", "downtimeTolerance", "migrationMode"].includes(f)) assumptions.push(`Questionnaire field '${f}' was not supplied; default used.`);
  if (!r.resourceId) missing.push("Resource ID (parent/child relationships and scope cannot be derived)");
  if (!r.location) missing.push("Location");
  if (!r.sku) missing.push("SKU/tier (affects regional availability, move eligibility and data-copy method)");
  if (!r.kind) missing.push("Kind (e.g. functionapp vs app, StorageV2 vs BlobStorage)");
  if (!ctx.authenticated) {
    missing.push("Network topology, private endpoints, encryption/CMK, managed identities, RBAC, locks, policy, data size, backup/replication state — require authenticated inspection");
    evidence.push({ state: "requires-authenticated-validation", statement: "Analysis is based on an exported inventory only; configuration-dependent conclusions must be validated against the live environment." });
  }

  const base: ResourceDecisionRecord = {
    resourceKey: r.key,
    resourceId: r.resourceId,
    displayName: r.name,
    provider: r.provider,
    resourceType: r.type,
    parentResource: r.parsedId.parentId ?? null,
    childResources: deps.filter((d) => d.relationship === "child").map((d) => d.targetKey),
    resourceGroup: r.resourceGroup,
    subscriptionName: r.subscriptionName,
    subscriptionId: r.subscriptionId,
    tenantContext: intent.sameTenant === null ? "unknown" : intent.sameTenant ? "same-tenant" : "cross-tenant",
    region: r.location,
    availabilityZone: null,
    sku: r.sku,
    kind: r.kind,
    tags: r.tags,
    // Own tags only: a key such as "constructor" must not read a member of Object.prototype.
    applicationGroup: intent.applicationGroupTagKey && Object.hasOwn(r.tags, intent.applicationGroupTagKey) ? r.tags[intent.applicationGroupTagKey] : null,
    dependencyGroup: r.resourceGroup,
    sourceScope: r.subscriptionId ? `/subscriptions/${r.subscriptionId}/resourceGroups/${r.resourceGroup ?? "?"}` : null,
    destinationScope: intent.destinationRegion ? `region:${intent.destinationRegion}` : null,
    desiredOperation: intent.desiredOperation,
    nativeMoveSupport: "unknown",
    regionalRelocationSupport: "unknown",
    crossSubscriptionSupport: "unknown",
    crossTenantImplications: [],
    targetRegionAvailability: ctx.authenticated ? "unknown" : "unknown",
    targetSkuAvailability: "unknown",
    disposition: "unknown-requires-validation",
    secondaryActions: [],
    infrastructureDisposition: "unknown",
    configurationDisposition: "unknown",
    identityDisposition: "unknown",
    dataDisposition: "unknown",
    recommendedTool: "none",
    alternativeMethods: [],
    reasonCodes,
    dependencies: deps,
    sequencePosition: ctx.sequence.get(r.key) ?? null,
    expectedDowntime: "unknown",
    rtoCompatibility: "unknown",
    rpoCompatibility: "unknown",
    prerequisites: landingZonePrerequisites(ctx.profile, intent),
    blockers: [],
    risks: [],
    mitigations: [],
    validationMethod: [],
    rollbackMethod: [],
    generatedArtifacts: [],
    evidence,
    evidenceDate: ctx.today,
    ruleId: null,
    ruleVersion: null,
    confidence: { score: 0.2, band: "low", rationale },
    confidenceByOperation: emptyByOperation(),
    assumptions,
    missingInformation: missing,
    humanApprovalRequired: true,
    implementationStatus: "requires-validation",
  };

  if (!found.rule) {
    reasonCodes.push("NO_RULE_FOR_TYPE");
    rationale.push("No versioned rule exists for this resource type; the engine does not guess support.");
    missing.unshift(`Support rule for ${r.type} — add one under rules/azure or escalate for manual review`);
    base.secondaryActions.push("Escalate for manual review against the Microsoft Learn move-support matrix.");
    base.alternativeMethods = ["manual-reconstruction"];
    base.blockers.push("No rule coverage: disposition cannot be determined automatically.");
    return finalize(base, ctx);
  }

  const rule = found.rule;
  base.ruleId = rule.ruleId;
  base.ruleVersion = rule.ruleVersion;
  base.nativeMoveSupport = rule.support.resourceGroupMove;
  base.crossSubscriptionSupport = rule.support.subscriptionMove;
  base.regionalRelocationSupport = rule.support.regionRelocation;
  base.crossTenantImplications = rule.crossTenantImplications ?? [];
  base.alternativeMethods = [...rule.alternatives];
  for (const s of rule.documentationSources) evidence.push({ state: "general-rule", statement: s.title, source: s.url, date: s.retrievedOn, ruleId: rule.ruleId });
  reasonCodes.push(found.via === "exact" ? "RULE_MATCH" : "PARENT_RULE_FALLBACK");
  if (found.via === "parent") {
    assumptions.push(`No rule for ${r.type}; applied the parent-type rule (${found.parentType}) on the basis that child resources move with their parent.`);
    rationale.push("parent-type fallback (-0.15)");
  }

  const { state, dimension } = supportFor(rule, intent);
  let pattern = rule.recommendedPattern;
  if (intent.desiredOperation === "region-relocation") {
    if (GLOBAL_TYPES.has(r.type.toLowerCase())) {
      pattern = rule.regionRelocationPattern ?? pattern;
      reasonCodes.push("GLOBAL_RESOURCE");
    } else if (state === "unsupported" || state === "conditional") {
      pattern = rule.regionRelocationPattern ?? pattern;
      reasonCodes.push(state === "unsupported" ? "REGION_MOVE_UNSUPPORTED_ALTERNATIVE_SELECTED" : "REGION_MOVE_CONDITIONAL");
    } else if (state === "supported") {
      pattern = rule.regionRelocationPattern ?? pattern;
      reasonCodes.push("REGION_MOVE_SUPPORTED");
    }
  } else if (intent.desiredOperation === "cross-tenant-migration") {
    pattern = rule.crossTenantPattern ?? pattern;
    reasonCodes.push(state === "unsupported" ? "CROSS_TENANT_RECREATE" : "CROSS_TENANT_CONDITIONAL");
    base.prerequisites.push("Decide between whole-subscription transfer to the destination directory and recreate-and-migrate; the choice applies to every resource in the subscription.");
  } else if (intent.desiredOperation === "modernization") {
    reasonCodes.push("MODERNIZATION_INTENT_REQUIRES_ARCHITECTURE_REVIEW");
    base.secondaryActions.push("Modernization intent: evaluate replace/redesign options with an architect; the rule's move pattern is the fallback.");
  } else if (intent.desiredOperation === "disaster-recovery") {
    reasonCodes.push("DR_INTENT_NOT_MIGRATION");
    base.secondaryActions.push("Disaster-recovery intent is not a migration: evaluate Azure Backup / Azure Site Recovery / native geo-redundancy for this resource and keep it in place.");
    pattern = { disposition: "retain", tool: "none", infrastructure: "retain-in-source", configuration: "retain-in-source", identity: "retain-in-source", data: "retain-in-source", expectedDowntime: "none" };
  } else {
    reasonCodes.push(`${intent.desiredOperation.toUpperCase().replace(/-/g, "_")}_${state.toUpperCase()}`);
  }
  if (state === "unknown") {
    reasonCodes.push("SUPPORT_UNKNOWN");
    base.blockers.push(`Support for ${dimension} is recorded as unknown in rule ${rule.ruleId}.`);
    pattern = { ...pattern, disposition: "unknown-requires-validation" };
  }
  if (r.parsedId.parentId && found.via === "parent") reasonCodes.push("CHILD_MOVES_WITH_PARENT");

  base.disposition = pattern.disposition;
  base.recommendedTool = pattern.tool;
  base.infrastructureDisposition = pattern.infrastructure;
  base.configurationDisposition = pattern.configuration;
  base.identityDisposition = pattern.identity;
  base.dataDisposition = pattern.data;
  base.expectedDowntime = pattern.expectedDowntime;
  base.alternativeMethods = base.alternativeMethods.filter((a) => a !== pattern.tool);
  base.prerequisites.push(...(rule.prerequisites ?? []));
  base.risks.push(...(rule.risks ?? []), ...(rule.featureConstraints ?? []).map((f) => `Constraint: ${f}`));
  base.mitigations.push(...(rule.mitigations ?? []));
  base.validationMethod.push(...(rule.validation ?? []));
  base.rollbackMethod.push(...(rule.rollback ?? []));
  if (rule.notes) for (const n of rule.notes) evidence.push({ state: "general-rule", statement: n, ruleId: rule.ruleId });
  if (rule.humanReviewRequired) base.blockers.push("Rule requires human review before this disposition is accepted.");

  // Data is a separate decision dimension; make it visible.
  if (DATA_DIMENSIONS.has(pattern.data)) {
    base.secondaryActions.push(`Data path: ${pattern.data} — plan initial copy, delta/sync, freeze, final sync, reconciliation and rollback separately from the infrastructure move.`);
    missing.push("Data volume, change rate and consistency requirements (needed to size the sync window)");
  }
  if (pattern.identity === "reconstruct") base.secondaryActions.push("Identity path: managed identities / Entra bindings are recreated; every RBAC assignment and Key Vault access must be rebound.");
  if (pattern.disposition !== "retain" && pattern.disposition !== "retire") base.secondaryActions.push("After cutover: re-establish backup and DR protection in the destination (Azure Backup / ASR / native redundancy). This is DR, not migration.");

  // RTO / RPO compatibility
  const dt = pattern.expectedDowntime;
  if (intent.rtoHours === null) base.rtoCompatibility = "unknown";
  else base.rtoCompatibility = dt === "none" || dt === "minutes" ? "supported" : dt === "hours" ? (intent.rtoHours >= 4 ? "conditional" : "unsupported") : "unknown";
  if (intent.rpoMinutes === null) base.rpoCompatibility = "unknown";
  else base.rpoCompatibility = pattern.data === "replicate" || pattern.data === "move-with-resource" || pattern.data === "not-applicable" ? "supported" : pattern.data === "sync-and-cutover" ? "conditional" : "unsupported";
  if (intent.downtimeTolerance === "none" && dt !== "none") base.blockers.push(`Downtime tolerance is 'none' but the pattern implies ${dt} of downtime.`);

  // Confidence: rule confidence × evidence penalties, capped when unauthenticated
  let score = rule.confidence;
  rationale.push(`rule confidence ${rule.confidence}`);
  const penal = (n: number, why: string) => {
    score -= n;
    rationale.push(`${why} (-${n})`);
  };
  if (found.via === "parent") score -= 0.15;
  if (!r.resourceId) penal(0.1, "no resource id");
  if (!r.location) penal(0.1, "no location");
  if (!r.sku && (rule.relevantSku ?? []).some((s) => s !== "*")) penal(0.05, "SKU-dependent rule without SKU");
  if (state === "conditional") penal(0.1, "conditional support");
  if (intent.assumedFields.includes("destinationRegion") && intent.desiredOperation === "region-relocation") penal(0.1, "destination region assumed");
  if (intent.assumedFields.includes("sameTenant")) penal(0.05, "tenant relationship assumed");
  if (!ctx.authenticated && score > UNAUTHENTICATED_CONFIDENCE_CAP) {
    score = UNAUTHENTICATED_CONFIDENCE_CAP;
    rationale.push(`capped at ${UNAUTHENTICATED_CONFIDENCE_CAP}: inventory-only evidence cannot yield high confidence`);
  }
  if (pattern.disposition === "unknown-requires-validation") score = Math.min(score, 0.3);
  base.confidence = { score: Math.max(0, Math.round(score * 100) / 100), band: bandFor(Math.max(0, score)), rationale };
  base.confidenceByOperation = confidenceByOperation(rule, r, found.via, ctx.authenticated);

  base.humanApprovalRequired = rule.humanReviewRequired || DATA_DIMENSIONS.has(pattern.data) || pattern.disposition !== "native-move" || pattern.tool === "azure-resource-mover";
  base.implementationStatus = base.blockers.length ? "blocked" : pattern.disposition === "unknown-requires-validation" ? "requires-validation" : pattern.disposition === "retain" ? "not-applicable" : "planned";
  return finalize(base, ctx);
}

function finalize(d: ResourceDecisionRecord, ctx: ClassifyContext): ResourceDecisionRecord {
  if (ctx.edition === "demo") d.assumptions.push("Demo edition: this is a CSV-based illustration, not an authoritative Azure assessment.");
  d.evidence = dedupe(d.evidence, (e) => e.state + e.statement);
  d.missingInformation = [...new Set(d.missingInformation)];
  d.prerequisites = [...new Set(d.prerequisites)];
  d.secondaryActions = [...new Set(d.secondaryActions)];
  return d;
}
function dedupe<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((a) => (seen.has(key(a)) ? false : (seen.add(key(a)), true)));
}

function emptyByOperation(): ResourceDecisionRecord["confidenceByOperation"] {
  const low = { score: 0.2, band: "low" as const };
  return { "resource-group-move": low, "subscription-move": low, "region-relocation": low, "cross-tenant-migration": low, modernization: low, "disaster-recovery": low };
}

/** Per-operation confidence: rule confidence adjusted by that operation's support state and shared evidence penalties. */
function confidenceByOperation(rule: MigrationRule, r: NormalizedResource, via: "exact" | "parent" | "none", authenticated: boolean): ResourceDecisionRecord["confidenceByOperation"] {
  const evidencePenalty = (via === "parent" ? 0.15 : 0) + (r.resourceId ? 0 : 0.1) + (r.location ? 0 : 0.1);
  const forState = (state: SupportState): { score: number; band: ReturnType<typeof bandFor> } => {
    let score = rule.confidence - evidencePenalty;
    if (state === "conditional") score -= 0.1;
    if (state === "unsupported") score -= 0.05; // confident it is unsupported; the alternative pattern carries the rest
    if (state === "unknown") score = Math.min(score, 0.3);
    if (!authenticated) score = Math.min(score, UNAUTHENTICATED_CONFIDENCE_CAP);
    score = Math.max(0, Math.round(score * 100) / 100);
    return { score, band: bandFor(score) };
  };
  const review = { score: Math.max(0, Math.min(0.4, rule.confidence - evidencePenalty)), band: "low" as const };
  return {
    "resource-group-move": forState(rule.support.resourceGroupMove),
    "subscription-move": forState(rule.support.subscriptionMove),
    "region-relocation": forState(rule.support.regionRelocation),
    "cross-tenant-migration": forState(rule.support.crossTenant),
    modernization: review,
    "disaster-recovery": review,
  };
}
