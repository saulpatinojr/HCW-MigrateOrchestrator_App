import { createHash } from "node:crypto";
import type { FieldProvenance, IngestionResult, NormalizedResource } from "@amo/domain";
import { looksLikeFormula, parseCsv } from "./parse-csv.js";
import { parseResourceId, resourceIdFromPortalLink } from "./resource-id.js";
import { canonicalType, mapHeaders, parseTags, REQUIRED_COLUMNS } from "./normalize.js";

export interface IngestOptions {
  maxRows?: number;
  maxBytes?: number;
  /** Longest single cell, in characters. A row with a longer cell is skipped with a warning. */
  maxFieldLength?: number;
}

export const DEFAULT_INGEST_LIMITS = { maxRows: 5000, maxBytes: 5 * 1024 * 1024, maxFieldLength: 65536 };

/** Ingest a resources.csv export into normalized resources with full provenance (§16). */
export function ingestResourcesCsv(text: string, opts: IngestOptions = {}): IngestionResult {
  const maxRows = opts.maxRows ?? DEFAULT_INGEST_LIMITS.maxRows;
  const maxBytes = opts.maxBytes ?? DEFAULT_INGEST_LIMITS.maxBytes;
  const maxFieldLength = opts.maxFieldLength ?? DEFAULT_INGEST_LIMITS.maxFieldLength;
  const errors: string[] = [];
  const warnings: string[] = [];
  const bytes = Buffer.byteLength(text, "utf8");
  const inputHash = createHash("sha256").update(text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")).digest("hex");
  if (bytes > maxBytes) {
    return emptyResult(inputHash, [`input exceeds ${maxBytes} bytes`]);
  }
  if (/\u0000/.test(text)) return emptyResult(inputHash, ["input contains NUL bytes; not a text CSV"]);
  const parsed = parseCsv(text, { maxRows });
  warnings.push(...parsed.warnings);
  if (parsed.headers.length === 0) return emptyResult(inputHash, ["no header row found"], warnings);
  const { map, extra, missing } = mapHeaders(parsed.headers);
  const hardMissing = REQUIRED_COLUMNS.filter((c) => map[c] === null);
  if (hardMissing.length) return emptyResult(inputHash, [`required columns missing: ${hardMissing.join(", ")}`], warnings, map, missing, extra);
  if (!map.resourceId && map.resourceLink) warnings.push(`no Resource ID column: resource ids derived from the '${map.resourceLink}' column of the portal export`);
  else if (!map.resourceId) warnings.push("no Resource ID column: subscription/resource-group context derived only from other columns; parent/child relationships cannot be discovered");

  const colIdx = (canon: string): number => (map[canon] ? parsed.headers.indexOf(map[canon] as string) : -1);
  const idx = Object.fromEntries(Object.keys(map).map((k) => [k, colIdx(k)])) as Record<string, number>;

  const resources: NormalizedResource[] = [];
  const seen = new Map<string, number>();
  let duplicateCount = 0;
  parsed.rows.forEach((row, i) => {
    const rowNo = i + 2;
    // A single cell can be as long as the whole upload (5 MB). Nothing downstream needs that: an Azure resource id is
    // about 2,000 characters and a name at most 260. Skip the row rather than truncate it, so a cut-off id is never used.
    const tooLong = row.findIndex((cell) => cell.length > maxFieldLength);
    if (tooLong >= 0) {
      warnings.push(`row ${rowNo}: column '${(parsed.headers[tooLong] ?? "").slice(0, 40)}' has a value longer than ${maxFieldLength} characters; row skipped`);
      return;
    }
    const rowWarnings: string[] = [];
    const prov: FieldProvenance[] = [];
    const get = (canon: string): string | undefined => (idx[canon] >= 0 ? row[idx[canon]] : undefined);
    const field = (canon: string, transform: (v: string) => string | null, transformation: string): string | null => {
      const raw = get(canon);
      if (raw === undefined) {
        prov.push({ normalizedHeader: canon, normalizedValue: null, transformation: "column-missing", evidence: "missing" });
        return null;
      }
      if (looksLikeFormula(raw)) rowWarnings.push(`${canon}: value looks like a spreadsheet formula and was neutralised`);
      const v = raw.trim() === "" ? null : transform(raw.trim());
      prov.push({ originalHeader: map[canon] ?? undefined, normalizedHeader: canon, originalValue: raw, normalizedValue: v, transformation, evidence: v === null ? "missing" : "observed-from-csv" });
      return v;
    };
    const name = field("name", (v) => v, "trim") ?? `row-${rowNo}`;
    const rawType = field("type", (v) => v, "trim");
    let resourceId = field("resourceId", (v) => v, "trim");
    if (resourceId === null && idx.resourceLink >= 0) {
      const link = get("resourceLink") ?? "";
      const derived = resourceIdFromPortalLink(link);
      if (derived) {
        resourceId = derived;
        prov.push({ originalHeader: map.resourceLink ?? undefined, normalizedHeader: "resourceId", originalValue: link, normalizedValue: derived, transformation: "derived-from-resource-link", evidence: "derived-from-resource-id" });
      } else if (link.trim()) rowWarnings.push("resource link is not a portal resource link; no resource id derived");
    }
    const parsedId = parseResourceId(resourceId);
    if (resourceId && !parsedId.valid) rowWarnings.push(`invalid resource id: ${parsedId.issues.join("; ")}`);
    const type = canonicalType(rawType ?? parsedId.fullType ?? "unknown/unknown");
    if (parsedId.fullType && rawType && parsedId.fullType.toLowerCase() !== canonicalType(rawType).toLowerCase()) rowWarnings.push(`type column (${rawType}) disagrees with resource id type (${parsedId.fullType}); using resource id`);
    const finalType = parsedId.valid && parsedId.fullType ? canonicalType(parsedId.fullType) : type;
    const rg = field("resourceGroup", (v) => v, "trim") ?? parsedId.resourceGroup ?? null;
    if (!get("resourceGroup") && parsedId.resourceGroup) prov.push({ normalizedHeader: "resourceGroup", normalizedValue: rg, transformation: "derived-from-resource-id", evidence: "derived-from-resource-id" });
    const subscriptionId = field("subscriptionId", (v) => v, "trim") ?? parsedId.subscriptionId ?? null;
    if (!get("subscriptionId") && parsedId.subscriptionId) prov.push({ normalizedHeader: "subscriptionId", normalizedValue: subscriptionId, transformation: "derived-from-resource-id", evidence: "derived-from-resource-id" });
    const location = field("location", (v) => v.toLowerCase().replace(/\s+/g, ""), "lowercase-no-spaces");
    const subscriptionName = field("subscriptionName", (v) => v, "trim");
    const kind = field("kind", (v) => v, "trim");
    const sku = field("sku", (v) => v, "trim");
    const status = field("status", (v) => v, "trim");
    const tagsRaw = get("tags");
    const { tags, transformation } = parseTags(tagsRaw);
    prov.push({ originalHeader: map.tags ?? undefined, normalizedHeader: "tags", originalValue: tagsRaw, normalizedValue: Object.keys(tags).length ? JSON.stringify(tags) : null, transformation, evidence: tagsRaw ? "observed-from-csv" : "missing" });
    for (const [k, v] of Object.entries(tags)) if (looksLikeFormula(k) || looksLikeFormula(v)) rowWarnings.push(`tag ${k}: formula-like content neutralised`);

    const key = parsedId.valid && resourceId ? resourceId.toLowerCase() : `${(subscriptionId ?? "?").toLowerCase()}/${(rg ?? "?").toLowerCase()}/${finalType.toLowerCase()}/${name.toLowerCase()}`;
    if (seen.has(key)) {
      duplicateCount++;
      rowWarnings.push(`duplicate of row ${seen.get(key)}; skipped`);
      warnings.push(`row ${rowNo}: duplicate of row ${seen.get(key)} (${name}); skipped`);
      return;
    }
    seen.set(key, rowNo);
    resources.push({
      key,
      resourceId: parsedId.valid ? resourceId : null,
      name,
      type: finalType,
      provider: finalType.split("/")[0],
      resourceGroup: rg,
      location,
      subscriptionName,
      subscriptionId,
      kind,
      sku,
      status,
      tags,
      parsedId,
      provenance: prov,
      warnings: rowWarnings,
      sourceRow: rowNo,
    });
  });
  for (const m of missing) {
    if (m === "resourceId") continue;
    const derived = m === "subscriptionId" || m === "resourceGroup" ? resources.filter((r) => r[m] !== null).length : 0;
    if (derived === 0) warnings.push(`column '${m}' not present in export; related conclusions will be labelled missing`);
    else if (derived === resources.length) warnings.push(`column '${m}' not present in export; derived from the resource id of every row`);
    else warnings.push(`column '${m}' not present in export; derived from the resource id of ${derived} of ${resources.length} rows, the rest labelled missing`);
  }
  return { resources, warnings, errors, inputHash, rowCount: parsed.rows.length, duplicateCount, headerMap: map, missingColumns: missing, extraColumns: extra };
}

function emptyResult(inputHash: string, errors: string[], warnings: string[] = [], headerMap: Record<string, string | null> = {}, missing: string[] = [], extra: string[] = []): IngestionResult {
  return { resources: [], warnings, errors, inputHash, rowCount: 0, duplicateCount: 0, headerMap, missingColumns: missing, extraColumns: extra };
}
