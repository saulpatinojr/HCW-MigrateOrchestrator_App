/**
 * Which Host header values the API answers (AMO_ALLOWED_HOSTS), as a defence against DNS rebinding.
 *
 * DNS rebinding: a web page on another site gets its own name to resolve, after the page has loaded, to an address on the
 * developer's own machine. The browser then sends requests to the local API under the attacker's name, and treats the
 * answers as coming from the attacker's own site, so it lets the page read them. The API cannot see the page, but it can
 * see the name in the Host header, and refuse a name that is not its own.
 *
 * The variable is a comma-separated list of exact `host` or `host:port` values, as a browser writes them in the Host
 * header (lower case, no scheme, no path, no wildcard). It is empty by default, which turns the check off: in Azure the
 * Host header is whatever address the platform and its probes use, which the application cannot know. The local
 * composition sets it (docker-compose.appliance.yml).
 */
import type { IncomingMessage } from "node:http";

export const ALLOWED_HOSTS_VAR = "AMO_ALLOWED_HOSTS";

export function parseAllowedHosts(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const hosts: string[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim().toLowerCase();
    const bad = (why: string): never => { throw new Error(`refusing to start: ${ALLOWED_HOSTS_VAR} entry ${JSON.stringify(entry)} ${why}; it takes a comma-separated list of host or host:port values such as localhost:8081`); };
    if (entry === "") bad("is empty (a stray comma?)");
    if (entry.length > 255) bad("is too long");
    if (entry.includes("*")) bad("contains a wildcard, which is never accepted");
    let canonical: string;
    try { canonical = new URL(`http://${entry}`).host; } catch { return bad("is not a host name"); }
    // The URL parser drops a default port and anything that is not a host (a user name, a path), so only an exact host[:port] survives the comparison.
    if (canonical !== entry) bad(`is not a plain host or host:port (write it as ${JSON.stringify(canonical)} if that is what you meant)`);
    if (!hosts.includes(entry)) hosts.push(entry);
  }
  return hosts;
}

/** True when the list is empty (check off) or the whole Host header equals an entry, ignoring case. */
export function hostAllowed(allowed: readonly string[], hostHeader: IncomingMessage["headers"]["host"]): boolean {
  if (allowed.length === 0) return true;
  return typeof hostHeader === "string" && allowed.includes(hostHeader.toLowerCase());
}
