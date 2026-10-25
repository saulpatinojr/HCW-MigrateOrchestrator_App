# ADR-0033: The appliance API allows cross-origin browser calls only from an exact-match allow-list

**Status:** Accepted · **Date:** 2026-10-25 · **Decided by:** the owner, 2026-10-25 (row C3 of [HCW-HybridCloudWorks issue 1373](https://github.com/saulpatinojr/HCW-HybridCloudWorks/issues/1373)). This replaces an earlier, reversible same-origin-only decision made by the orchestrator the same day, which the owner overruled before anything of it was merged.

**ADR number.** `docs/adr/` ended at ADR-0030. Pull request 78 already uses ADR-0031 (Entra app role) and ADR-0032 (subnet firewalls), so this one is ADR-0033 and the release pipeline decision of the same pull request is ADR-0034. Pull request 78 must merge first, or the numbers must be reconciled by whoever merges second.

## Context

CORS (Cross-Origin Resource Sharing) is the browser rule that decides which websites may read an API's answers. A page on one
address (an origin: scheme, host and port together) that calls an API on another address works only if the API answers with the
right `Access-Control-*` headers.

`docs/deployment/enterprise.md` told operators to "add the web origin to the API's allowed origins when hosted separately", but
`apps/appliance-api` had no such setting and no CORS code (ticket 44, AMO-3): an `OPTIONS` (preflight) request was answered by the
same handler as everything else, with no CORS headers. The ticket warned that a later "quick fix" with a wildcard (`*`) would make
the API callable from any website's page.

## Decision

The API implements CORS as an **exact-match allow-list** and nothing broader.

1. **The setting.** `AMO_ALLOWED_ORIGINS` is a comma-separated list of exact origins, for example
   `https://app.example.com,http://localhost:5174`.
   - An entry is `scheme://host` or `scheme://host:port`: `https` or `http`, lower case, no path, no trailing slash, no query, no
     user name, and no port that is the default for the scheme (browsers never send one, so it could never match).
   - Spaces around entries are ignored and repeated entries count once.
   - A wildcard (`*`, including `https://*.example.com`), `null`, an empty entry (a stray comma), a path or trailing slash, an upper
     case host and anything that is not a URL are **refused at startup**: the API (and the worker, which reads the same
     configuration) exits with code 1 and a message that starts `refusing to start: AMO_ALLOWED_ORIGINS entry "..."`, says what is
     wrong and, where the fix is mechanical, how to write it.
2. **The default is empty, and empty means no CORS at all.** With the variable unset, empty or blank the API sends no
   `Access-Control-*` header and no `Vary` header, and does not treat `OPTIONS` specially. A web UI served from the same address
   as the API (a reverse proxy routing `/api/*`, which is what `WORKING-PLAN.md` plans for the appliance) needs nothing and keeps
   working.
3. **What an allowed origin gets.** When the request's `Origin` header equals an entry of the list exactly, every response to a
   `/api/` request carries `Access-Control-Allow-Origin: <that exact origin>` and `Vary: Origin`, errors included (so the browser
   can read a 401). A preflight (`OPTIONS` with `Access-Control-Request-Method`) from an allowed origin is answered `204` with
   `Access-Control-Allow-Methods: GET, POST, OPTIONS` (the methods the API uses), `Access-Control-Allow-Headers: Authorization,
   Content-Type` and `Access-Control-Max-Age: 600`.
4. **What nothing gets.** The `Origin` header is never copied into a response unless it equals a list entry. There is no
   `Access-Control-Allow-Credentials`: the API takes a bearer token in the `Authorization` header, not cookies. A disallowed origin,
   a look-alike (`https://app.example.com.evil.test`, another port, `http` for `https`, another case) and a request with no `Origin`
   get no `Access-Control-*` header. When the list is not empty, every `/api/` response carries `Vary: Origin` so a shared cache
   cannot hand one origin's answer to another.
5. **Preflight is answered before authentication**, because a preflight carries no token, and only for allowed origins. A
   preflight from a disallowed origin is not answered as one: it meets the authentication guard like any other request.
   `/api/health` and `/api/agents` behave as before.
6. **Authentication is unchanged.** Every route except `/api/health` and `/api/agents` still requires a valid Entra token
   (signature, issuer, audience, expiry, not-before). CORS only tells a browser what a page may read; the server never uses
   `Origin` to decide whether to accept a token, and a valid token works with or without an `Origin` header. CORS is not access
   control: other clients are unaffected by it.
7. **What a deployer must set.** Nothing for a same-origin deployment. For a web UI on a different address, set
   `AMO_ALLOWED_ORIGINS` to that address on the API's Container App (and register the same address as the Entra single-page-app
   redirect URI). `docs/deployment/enterprise.md` section 2b has the steps. The repository's Terraform does not yet expose the
   variable; it is an environment variable on the Container App.
8. **Tests keep this true.** `apps/appliance-api/src/cors.test.ts` runs the real Node request handler over `node:http` with the
   `Origin` header set by hand: allowed origin, disallowed origin and look-alikes, no `Origin`, preflight allowed and disallowed,
   wildcard and malformed configuration refused (also as a real process exit), no headers when the variable is empty, `Vary`
   present, no credentials header, and authentication still enforced after a preflight. `tests/security/cors-allow-list.test.mjs`
   scans the source (no wildcard, no credentials header, the origin is only echoed after an exact list match) and the documents
   (the variable is documented and no document suggests a wildcard).

## What would reopen this decision

A new ADR that supersedes this one, before any code changes, if any of these happens:

- A browser client needs a **wildcard or pattern** (for example every preview deployment of a web app on its own subdomain).
- A client needs **cookies or other credentials** rather than a bearer token (`Access-Control-Allow-Credentials`).
- The API needs to be callable by **non-browser origins that cannot be listed**, or the list becomes long enough that it should
  live in a store rather than an environment variable.
- A hosting platform's front door (Front Door, Application Gateway, Static Web Apps) is chosen to handle CORS itself, in which case
  the API should keep the list empty and the front door must be reviewed instead.

## Consequences

- A web UI on a different origin now works once the deployer lists its exact address. A mistake in the list fails at startup, not at
  the first browser call.
- The downstream web-front edition is unaffected: it has its own server and is same-origin with it (ADR-0030).
- A proxy, Front Door or Static Web Apps in front of the API may add, replace or strip headers; the tests prove the Node handler,
  not the platform in front of it. The Static Web Apps linked-backend option is **untested here and comes with limits** from
  Microsoft Learn ([Container Apps backend](https://learn.microsoft.com/azure/static-web-apps/apis-container-apps),
  [API overview](https://learn.microsoft.com/azure/static-web-apps/apis-overview), read 2026-10-25): the Standard plan (bring your
  own API), API paths starting with `/api`, an `Azure Static Web Apps (Linked)` identity provider on the Container App that by
  default accepts only traffic proxied through the static web app, HTTP only, and a 45 second cap per request. Whether the proxy
  forwards the `Authorization` header unchanged is not verified.
- Validation limit: no browser, Azure tenant or real front door was used; the behaviour is proven against the Node handler only
  (`VALIDATION.md`).
