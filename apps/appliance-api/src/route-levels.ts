/**
 * Minimum authorization level per route (ADR-0031). One table, checked once, before any request body is read and before
 * any repository call, so a caller whose role is too low learns nothing about the data and costs nothing. The answer is one
 * generic `forbidden` body that names no level. The approval gate (`gate()` in `@amo/authorization`) stays as the second
 * layer inside the execution client, and the per-owner checks on assessments stay in the route.
 *
 * A path that is not listed here is not protected by this table; the router answers 404 for it. Every entry matches any
 * HTTP method, because the handlers answer 404 or 405-like errors for the methods they do not serve and a low role should
 * not be able to tell the difference.
 */
import { isAllowed, type AuthorizationLevel, type Principal } from "@amo/authorization";

export interface RouteLevel {
  /** Matched against the URL path only (no query string). */
  readonly pattern: RegExp;
  readonly level: AuthorizationLevel;
}

/** First match wins: the more specific pattern is listed first. */
export const ROUTE_LEVELS: ReadonlyArray<RouteLevel> = [
  { pattern: /^\/api\/assessments\/[0-9a-f-]{36}\/validate-move$/, level: "validation" },
  { pattern: /^\/api\/assessments(\/[0-9a-f-]{36})?$/, level: "discovery" },
  { pattern: /^\/api\/me$/, level: "discovery" },
  { pattern: /^\/api\/scopes$/, level: "discovery" },
  { pattern: /^\/api\/operations\//, level: "planning" },
  { pattern: /^\/api\/approvals$/, level: "controlled-execution" },
  { pattern: /^\/api\/execution\//, level: "controlled-execution" },
];

/** The single refusal text for a role that is too low. It deliberately names neither the needed nor the held level. */
export const FORBIDDEN_MESSAGE = "your role does not allow this action";

export function minimumLevel(pathname: string): AuthorizationLevel | null {
  return ROUTE_LEVELS.find((r) => r.pattern.test(pathname))?.level ?? null;
}

/** True when the route is not in the table, or the principal's level reaches the route's minimum. */
export function levelAllows(principal: Principal, pathname: string): boolean {
  const needed = minimumLevel(pathname);
  return needed === null || isAllowed(principal, needed);
}
