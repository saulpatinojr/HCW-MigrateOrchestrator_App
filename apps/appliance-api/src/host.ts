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
import { isIP } from "node:net";

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

/** The host part of a Host header value: `[::1]:8081` gives `::1`, `127.0.0.1:8081` gives `127.0.0.1`, `name:80` gives `name`. */
function hostPart(value: string): string {
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : "";
  }
  const colon = value.lastIndexOf(":");
  return colon < 0 ? value : value.slice(0, colon);
}

/**
 * True when the list is empty (check off), the whole Host header equals an entry (ignoring case), or the Host is an IP
 * address. DNS rebinding needs a domain name, so an IP address is never a rebinding attempt; letting it through also keeps
 * the image's own health check (which calls 127.0.0.1) working whatever port or name the list names.
 */
export function hostAllowed(allowed: readonly string[], hostHeader: IncomingMessage["headers"]["host"]): boolean {
  if (allowed.length === 0) return true;
  if (typeof hostHeader !== "string") return false;
  const host = hostHeader.toLowerCase();
  return allowed.includes(host) || isIP(hostPart(host)) !== 0;
}
