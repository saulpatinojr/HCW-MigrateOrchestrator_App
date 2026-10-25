import { existsSync } from "node:fs";

/**
 * Shared by the tests that keep the requirement ledger and the traceability matrix honest: every path-looking `code span`
 * in a table row must exist in this repository, or be marked right after the span as *(downstream)* (it lives in
 * saulpatinojr/HCW-MigrateOrchestrator_AddOn) or *(retired)* (deleted from both repositories). Not a test file itself.
 */
export const expandBraces = (p) => {
  const m = p.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  return m ? m[2].split(",").flatMap((alt) => expandBraces(m[1] + alt + m[3])) : [p];
};

export const exists = (p) => {
  const base = p.replace(/\/?\*.*$/, ""); // a wildcard stands for "some of these": the directory before it must exist
  return existsSync(base || ".") || existsSync(`.github/workflows/${p}`);
};

export const looksLikePath = (t) => !/\s/.test(t) && !t.startsWith("/") && !t.includes("…") && !t.includes("://") && !t.startsWith("saulpatinojr/") && (t.includes("/") || /\.(ts|tsx|mjs|md|json|yml|tf|sh|ps1)$/.test(t));

const SPAN = /`([^`]+)`( \*\((downstream|retired)\)\*)?/g;

/**
 * The path-looking code spans in the table rows of `text`, each as { line, token, marker, row }; `marker` is "downstream",
 * "retired" or undefined.
 */
export function pathSpans(text) {
  const out = [];
  text.split("\n").forEach((row, i) => {
    if (!row.startsWith("|")) return;
    for (const m of row.matchAll(SPAN)) if (looksLikePath(m[1])) out.push({ line: i + 1, token: m[1], marker: m[3], row });
  });
  return out;
}

/** Problems for every unmarked path that does not exist; `allow(path, span)` can excuse one (a declared exception). */
export function missingPaths(text, allow = () => false) {
  const missing = [];
  for (const span of pathSpans(text)) {
    if (span.marker) continue;
    for (const p of expandBraces(span.token)) if (!exists(p) && !allow(p, span)) missing.push(`line ${span.line}: ${p}`);
  }
  return missing;
}
