/**
 * Turns a display name (which comes from an uploaded CSV, so it is untrusted) into a Terraform identifier.
 *
 * Leading and trailing underscores are trimmed with a loop rather than a `^_+|_+$` expression: that expression rescans
 * the rest of an underscore run from every underscore in it, so a crafted name could stall the generator (CodeQL
 * js/polynomial-redos). The loop touches each character once.
 */
export function tfName(s: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  let start = 0;
  let end = cleaned.length;
  while (start < end && cleaned.charCodeAt(start) === 95) start++;
  while (end > start && cleaned.charCodeAt(end - 1) === 95) end--;
  return cleaned.slice(start, end).replace(/^(\d)/, "r$1") || "resource";
}
