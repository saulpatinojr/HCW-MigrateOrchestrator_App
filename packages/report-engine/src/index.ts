import type { Assessment, ResourceDecisionRecord } from "@amo/domain";
import { esc } from "./markdown.js";

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[\s'"]*[=+\-@\t\r]/.test(s) && !/^[\s'"]*-\d/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function executiveSummary(a: Assessment): string {
  const s = a.summary;
  const rows = Object.entries(s.dispositionTotals).filter(([, n]) => n > 0).map(([d, n]) => `| ${d} | ${n} |`);
  return [
    `# Executive summary — ${a.edition === "demo" ? "Hybrid Cloud Works Migration Explorer" : "Azure Migration Orchestrator"}`,
    "",
    ...s.disclaimers.map((d) => `> ${d}`),
    "",
    `- Assessment ID: \`${a.id}\``,
    `- Generated: ${a.createdAt}`,
    `- Input hash (sha256): \`${a.inputHash}\``,
    `- Rules: ${a.rulesVersion} (checksum \`${a.rulesChecksum.slice(0, 12)}…\`)`,
    `- Operation assessed: **${a.intent.desiredOperation}**${a.intent.destinationRegion ? ` → ${a.intent.destinationRegion}` : ""}`,
    `- Authenticated against Azure: **${a.authenticated ? "yes" : "no"}**`,
    "",
    "## Totals",
    "",
    `- Resources: **${s.resourceCount}**`,
    `- Unknown / requires validation: **${s.unknownCount}**`,
    `- Confidence: high ${s.confidenceTotals.high}, medium ${s.confidenceTotals.medium}, low ${s.confidenceTotals.low}`,
    `- Complexity band: **${s.complexityBand}**`,
    "",
    "| Disposition | Count |", "|---|---|", ...rows,
    "",
    "## Key blockers",
    "",
    ...(s.keyBlockers.length ? s.keyBlockers.map((b) => `- ${b}`) : ["- None recorded"]),
    "",
    "## Assumptions from the questionnaire",
    "",
    ...(a.intent.assumedFields.length ? a.intent.assumedFields.map((f) => `- \`${f}\` was not supplied; a default was assumed`) : ["- All questionnaire fields were supplied"]),
    "",
  ].join("\n");
}

export function engineeringAssessment(a: Assessment): string {
  const out: string[] = ["# Engineering assessment", "", ...a.summary.disclaimers.map((d) => `> ${d}`), "", "## Decision table", "", "| Resource | Type | Disposition | Infra | Config | Identity | Data | Tool | Confidence | Rule |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const d of a.decisions) out.push(`| ${esc(d.displayName)} | ${esc(d.resourceType)} | ${d.disposition} | ${d.infrastructureDisposition} | ${d.configurationDisposition} | ${d.identityDisposition} | ${d.dataDisposition} | ${d.recommendedTool} | ${d.confidence.band} (${d.confidence.score}) | ${d.ruleId ?? "—"} |`);
  out.push("", "## Per-resource detail", "");
  for (const d of a.decisions) out.push(...decisionSection(d));
  out.push("## Wave plan", "", ...a.wavePlan.notes.map((n) => `> ${n}`), "");
  for (const w of a.wavePlan.waves) {
    out.push(`### Wave ${w.number}: ${w.name}`, "", `_${w.rationale}_`, "", `- Entry: ${w.entryCriteria.join("; ")}`, `- Exit: ${w.exitCriteria.join("; ")}`, `- Resources (${w.resourceKeys.length}): ${w.resourceKeys.map((k) => a.decisions.find((d) => d.resourceKey === k)?.displayName ?? k).join(", ") || "none yet"}`, "");
  }
  return out.join("\n");
}

function decisionSection(d: ResourceDecisionRecord): string[] {
  const list = (title: string, items: string[]) => (items.length ? [`**${title}**`, ...items.map((i) => `- ${i}`), ""] : []);
  return [
    `### ${d.displayName}`, "",
    `- Type: \`${d.resourceType}\` · Region: ${d.region ?? "unknown"} · RG: ${d.resourceGroup ?? "unknown"} · Application group: ${d.applicationGroup ?? "—"}`,
    `- Disposition: **${d.disposition}** via **${d.recommendedTool}** (alternatives: ${d.alternativeMethods.join(", ") || "none"})`,
    `- Paths — infrastructure: ${d.infrastructureDisposition}; configuration: ${d.configurationDisposition}; identity: ${d.identityDisposition}; data: ${d.dataDisposition}`,
    `- Support — RG move: ${d.nativeMoveSupport}; subscription move: ${d.crossSubscriptionSupport}; region: ${d.regionalRelocationSupport}; target region/SKU availability: ${d.targetRegionAvailability}/${d.targetSkuAvailability}`,
    `- Expected downtime: ${d.expectedDowntime}; RTO/RPO compatibility: ${d.rtoCompatibility}/${d.rpoCompatibility}; sequence: ${d.sequencePosition ?? "—"}`,
    `- Confidence: ${d.confidence.band} (${d.confidence.score}) — ${d.confidence.rationale.join("; ")}`,
    `- Rule: ${d.ruleId ?? "none"} v${d.ruleVersion ?? "—"} · reason codes: ${d.reasonCodes.join(", ")} · human approval: ${d.humanApprovalRequired ? "required" : "not required"}`,
    "",
    ...list("Dependencies", d.dependencies.map((x) => `${x.relationship} → ${x.targetKey.split("/").pop()} [${x.origin}]${x.note ? ` — ${x.note}` : ""}`)),
    ...list("Prerequisites", d.prerequisites),
    ...list("Blockers", d.blockers),
    ...list("Risks", d.risks),
    ...list("Mitigations", d.mitigations),
    ...list("Validation", d.validationMethod),
    ...list("Rollback", d.rollbackMethod),
    ...list("Secondary actions", d.secondaryActions),
    ...list("Evidence", d.evidence.map((e) => `[${e.state}] ${e.statement}${e.source ? ` (${e.source}${e.date ? `, ${e.date}` : ""})` : ""}`)),
    ...list("Assumptions", d.assumptions),
    ...list("Missing information", d.missingInformation),
    ...list("Cross-tenant implications", d.tenantContext === "cross-tenant" ? d.crossTenantImplications : []),
  ];
}

export const DECISION_CSV_COLUMNS: Array<keyof ResourceDecisionRecord> = ["displayName", "resourceType", "resourceGroup", "region", "subscriptionId", "applicationGroup", "desiredOperation", "disposition", "infrastructureDisposition", "configurationDisposition", "identityDisposition", "dataDisposition", "recommendedTool", "alternativeMethods", "nativeMoveSupport", "crossSubscriptionSupport", "regionalRelocationSupport", "expectedDowntime", "sequencePosition", "humanApprovalRequired", "implementationStatus", "ruleId", "ruleVersion", "reasonCodes", "blockers", "missingInformation", "resourceId"];

export function decisionsCsv(decisions: ResourceDecisionRecord[]): string {
  const header = [...DECISION_CSV_COLUMNS, "confidenceScore", "confidenceBand"].join(",");
  const rows = decisions.map((d) => [...DECISION_CSV_COLUMNS.map((c) => csvCell(d[c])), d.confidence.score, d.confidence.band].join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function risksReport(a: Assessment): string {
  const out = ["# Risks and mitigations", ""];
  const byRisk = new Map<string, string[]>();
  for (const d of a.decisions) for (const r of d.risks) byRisk.set(r, [...(byRisk.get(r) ?? []), d.displayName]);
  if (!byRisk.size) out.push("_No rule-level risks recorded._");
  for (const [r, names] of [...byRisk.entries()].sort((x, y) => y[1].length - x[1].length)) out.push(`- **${r}** — ${names.length} resource(s): ${names.slice(0, 10).join(", ")}${names.length > 10 ? "…" : ""}`);
  out.push("", "## Blockers requiring human decision", "");
  const blocked = a.decisions.filter((d) => d.blockers.length);
  if (!blocked.length) out.push("_None._");
  for (const d of blocked) out.push(`- ${d.displayName}: ${d.blockers.join("; ")}`);
  return out.join("\n") + "\n";
}

export function unknownsReport(a: Assessment): string {
  const out = ["# Unknowns and required validation", "", "Every item here is a *missing* or *requires-authenticated-validation* evidence state. Nothing below should be treated as a conclusion.", ""];
  const unknown = a.decisions.filter((d) => d.disposition === "unknown-requires-validation");
  out.push(`## Resources without a determinable disposition (${unknown.length})`, "");
  for (const d of unknown) out.push(`- ${d.displayName} (\`${d.resourceType}\`): ${d.missingInformation[0] ?? "see detail"}`);
  out.push("", "## Missing information by frequency", "");
  const freq = new Map<string, number>();
  for (const d of a.decisions) for (const m of d.missingInformation) freq.set(m, (freq.get(m) ?? 0) + 1);
  for (const [m, n] of [...freq.entries()].sort((x, y) => y[1] - x[1])) out.push(`- ${m} — ${n}`);
  if (a.ingestionWarnings.length) out.push("", "## Ingestion warnings", "", ...a.ingestionWarnings.slice(0, 50).map((w) => `- ${w}`));
  return out.join("\n") + "\n";
}
