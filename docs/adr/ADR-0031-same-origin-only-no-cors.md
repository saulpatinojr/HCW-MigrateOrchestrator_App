# ADR-0031: The appliance web and API are same-origin only; the API has no CORS support

**Status:** Accepted · **Date:** 2026-10-25 · **Decided by:** the orchestrator, at owner level (reversible; the owner can overrule it)

The next free ADR number was 0031: `docs/adr/` ends at ADR-0030 and no open pull request adds an ADR. Ticket AMO-3 (issue 44) suggested the same number.

## Context

CORS (Cross-Origin Resource Sharing) is the browser rule that decides which websites may call an API. Without CORS headers a
browser blocks a page from calling an API on a different address (origin: scheme, host and port together).

`docs/deployment/enterprise.md` told operators to "add the web origin to the API's allowed origins when hosted separately",
but `apps/appliance-api` has no such setting and no CORS code at all. An `OPTIONS` (preflight) request is answered by the
same handler as every other request and carries no `Access-Control-*` headers. The instruction therefore described a setting
that does not exist, and it invited a later "quick fix" with a wildcard (`Access-Control-Allow-Origin: *`) that would let any
website call the API from a visitor's browser.

`WORKING-PLAN.md` already says the authenticated appliance UI and API are served from one origin ("One Azure Container App,
same origin"; "avoid introducing a cross-origin UI/API split"). The documentation contradicted the plan.

## Decision

1. **The appliance web UI and the API are served from one origin.** The API implements no CORS: it sends no
   `Access-Control-Allow-Origin` (or any other `Access-Control-*`) header on any response, including `OPTIONS`, and there is
   no `AMO_ALLOWED_ORIGINS` setting. Without those headers a browser does not let a page on another origin read the API's
   answers or send the requests that need a preflight; that is the safe default. (CORS is a browser rule, not access control:
   other clients and some simple cross-origin requests still reach the API, which is why every protected route validates an
   Entra token.)
2. **How the two are hosted.** Put one reverse proxy (or an equivalent front door) on a single address and route by path:
   `/api/*` to the API (the Container App), everything else to the compiled web UI (`apps/appliance-web/dist`). The web UI is
   built with `VITE_API_BASE_URL` empty (its default), so it calls `/api/...` on whatever address served it. The Entra
   single-page-app redirect address is that one address. Options that fit: Azure Front Door or Application Gateway path routing, a small proxy
   container (Caddy or nginx) in front of both, or Azure Static Web Apps with the Container App linked as its `/api` backend.
   The Static Web Apps option is **untested here and comes with limits** from Microsoft Learn
   ([Container Apps backend](https://learn.microsoft.com/azure/static-web-apps/apis-container-apps),
   [API overview](https://learn.microsoft.com/azure/static-web-apps/apis-overview), read 2026-10-25): it needs the Standard
   plan (bring-your-own API); the API routes must carry the `/api` prefix; linking configures an `Azure Static Web Apps (Linked)`
   identity provider on the Container App that by default accepts only traffic proxied through the static web app; only HTTP is
   supported and a request is capped at 45 seconds. Whether the proxy forwards the `Authorization` header unchanged is not
   verified. `docs/deployment/enterprise.md` section 2b gives the steps. The repository
   does not provision this front door yet; that is a deployment choice for the operator, not an API feature.
3. **Authentication is unchanged.** Every route except `/api/health` and `/api/agents` still requires a valid Entra token
   (signature, issuer, audience, expiry, not-before). Same-origin hosting is not a substitute for it, and no route was loosened.
4. **Tests keep this true.** `apps/appliance-api/src/enterprise.test.ts` starts the real Node API handler and asserts that
   normal, unauthenticated, error and preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) responses carry
   no `Access-Control-*` header and that protected routes still answer 401. `tests/security/same-origin-only.test.mjs` only
   scans files: it fails if the API source contains CORS code or a wildcard, or if a document tells an operator to configure
   CORS or allowed origins. Together they prove the Node handler and the text of the documents. They do not prove anything about a
   proxy, Front Door or Static Web Apps placed in front of the API, which may add or strip headers.

## What would reopen this decision

Any one of these is a new decision, to be recorded as an ADR that supersedes this one before any code is written:

- The owner wants the web UI hosted on a different origin than the API (for example a separate CDN host that cannot proxy `/api`).
- A second browser client on another origin needs to call the API (a partner portal, the website, a future extension).
- A hosting platform is chosen that cannot route both under one address.

If it is reopened, the required shape is an explicit allow-list of exact origins in configuration (for example
`AMO_ALLOWED_ORIGINS`), no wildcard, no reflection of the request `Origin`, `Vary: Origin`, a preflight answer limited to the
methods and headers the API uses, credentials never allowed with a broad list, and tests for allowed, denied and preflight
requests. The same-origin test above would then be replaced, not deleted.

## Consequences

- Operators cannot host the web UI on a different origin without a proxy; the documentation now says so instead of promising a setting.
- The downstream web-front edition is unaffected: it is same-origin with its own lab API (ADR-0030) and has its own server.
- Validation limit: the front door described in point 2 has not been exercised in this repository (no Azure tenant here). The
  Static Web Apps linked-backend option is taken from Microsoft Learn (pages and limits in point 2, read 2026-10-25) and is not
  tested against this appliance; in particular, that the proxy forwards the `Authorization` header unchanged is unverified. It is
  recorded in `VALIDATION.md`.
