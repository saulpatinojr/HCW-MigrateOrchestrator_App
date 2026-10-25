/**
 * Cross-origin access to the appliance API (ADR-0033, ticket #44): an exact-match allow-list, nothing else.
 *
 * CORS (Cross-Origin Resource Sharing) is the browser rule that decides which websites may read an API's answers. The
 * list comes from AMO_ALLOWED_ORIGINS, a comma-separated list of exact origins (scheme, host and, when it is not the
 * default for the scheme, port; no path, no trailing slash; https, or http for a loopback host only). The default is empty, which means no CORS headers at all:
 * a web UI served from the same address as the API needs none. There is no wildcard, an Origin header is never copied
 * into a response unless it equals an entry of the list, and credentials (cookies) are never allowed: the API takes a
 * bearer token in the Authorization header, which the browser only sends because the preflight allowed that header.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const ALLOWED_ORIGINS_VAR = "AMO_ALLOWED_ORIGINS";
/** The only hosts for which an http:// origin is accepted (a web UI started on the same machine). */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** The methods the API really uses: GET and POST (OPTIONS is the preflight itself). */
export const CORS_METHODS = "GET, POST, OPTIONS";
export const CORS_HEADERS = "Authorization, Content-Type";
/** Ten minutes: long enough to save a preflight per call, short enough that a change of list is seen soon. */
export const CORS_MAX_AGE_SECONDS = "600";

/**
 * Parse AMO_ALLOWED_ORIGINS. Empty or unset gives no origins. Anything malformed throws an error that names the variable
 * and the entry, so the API refuses to start instead of running with a list that does not mean what the deployer wrote.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const origins: string[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    const bad = (why: string): never => { throw new Error(`refusing to start: ${ALLOWED_ORIGINS_VAR} entry ${JSON.stringify(entry)} ${why}; it takes a comma-separated list of exact origins such as https://app.example.com (docs/deployment/enterprise.md)`); };
    if (entry === "") bad("is empty (a stray comma?)");
    if (entry.includes("*")) bad("contains a wildcard, which is never accepted");
    if (entry.toLowerCase() === "null") bad("is the opaque origin \"null\", which is never accepted");
    let url: URL;
    try { url = new URL(entry); } catch { return bad("is not a URL"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") bad("must start with https:// or http://");
    // The browser sends the origin in its canonical form: lower-case scheme and host, no default port, no path. Only that form can ever match.
    if (url.origin !== entry) bad(`is not an exact origin (no path, no trailing slash, no user name, no default port, lower case); write it as ${url.origin}`);
    // Plain http is for a web UI on the developer's own machine only; any other web UI must be served over https.
    if (url.protocol === "http:" && !LOOPBACK_HOSTS.includes(url.hostname)) bad(`uses http:// for a host that is not loopback (${LOOPBACK_HOSTS.join(", ")}); use https://`);
    if (!origins.includes(entry)) origins.push(entry);
  }
  return origins;
}

/**
 * Set the headers every answer needs, without answering anything: with an empty list nothing is touched; otherwise
 * `Vary: Origin` (the answer depends on the Origin header, so a shared cache must not reuse it) and, only when the Origin
 * header equals an entry of the list, `Access-Control-Allow-Origin` with that exact origin. Returns true for such an origin.
 * The handler also uses this alone for a request whose URL could not be parsed, so that even that 400 can be read by an
 * allowed page.
 */
export function applyCorsHeaders(allowed: readonly string[], req: IncomingMessage, res: ServerResponse): boolean {
  if (allowed.length === 0) return false;
  res.setHeader("vary", "Origin");
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !allowed.includes(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  return true;
}

/**
 * Apply the allow-list to one request. Returns true when the request was a preflight that has been answered (the caller
 * stops there, before any authentication: a preflight never carries a token).
 */
export function applyCors(allowed: readonly string[], req: IncomingMessage, res: ServerResponse): boolean {
  if (!applyCorsHeaders(allowed, req, res)) return false;
  const isPreflight = req.method === "OPTIONS" && typeof req.headers["access-control-request-method"] === "string";
  if (!isPreflight) return false;
  res.setHeader("access-control-allow-methods", CORS_METHODS);
  res.setHeader("access-control-allow-headers", CORS_HEADERS);
  res.setHeader("access-control-max-age", CORS_MAX_AGE_SECONDS);
  // Private Network Access (F9 of issue 83): Chrome asks, with this request header, whether a public page may reach a
  // private or loopback address. Say yes only to that exact question, and only here, where the Origin is already on the
  // list; the answer depends on the request header, so a cache must key on it.
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("access-control-allow-private-network", "true");
    res.setHeader("vary", "Origin, Access-Control-Request-Private-Network");
  }
  res.writeHead(204);
  res.end();
  return true;
}
