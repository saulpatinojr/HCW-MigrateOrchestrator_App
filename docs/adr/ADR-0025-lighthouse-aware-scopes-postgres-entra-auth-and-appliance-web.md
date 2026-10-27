# ADR-0025: Lighthouse-aware scopes, PostgreSQL Entra authentication, and the appliance web UI

**Status:** Accepted · **Date:** 2026-10-03

## Decisions
1. **Scopes across tenants.** `ScopeInventory` lists subscriptions through Resource Graph (`resourcecontainers`), marking
   those whose `tenantId` differs from the home tenant as Lighthouse-delegated. `POST /api/assessments` derives
   `sameTenant`/`sameSubscription` from the source and destination subscriptions when both are known, so cross-tenant
   planning is driven by observed directory membership instead of a questionnaire answer.
2. **PostgreSQL without passwords.** `pg` receives `password` as an async function that exchanges the appliance's credential
   for a token in the `https://ossrdbms-aad.database.windows.net/.default` scope on every new connection. Non-local
   `DATABASE_URL`s with embedded passwords are refused; Azure hosts require a `TokenCredential`.
3. **Appliance web.** `apps/appliance-web` is a Vite + React SPA using `@azure/msal-browser` (authorization code + PKCE,
   session-storage cache, no secret) against a separate public-client app registration, calling the API with the
   `access_as_user` scope. It reuses `@amo/ui` for decisions, detail and waves and adds scope selection, validate-move,
   approval recording and the four Resource Mover actions with the gate's reason surfaced on refusal. Tailwind is loaded
   from the play CDN for now; a compiled Tailwind build is a follow-up before production.

## Consequences
Cross-tenant intent stops being self-reported in the appliance; database credentials vanish from configuration; operators
have a UI that cannot bypass the gate because it only calls the same API. Live validation of MSAL and Lighthouse projection remains pending (VALIDATION.md). The PostgreSQL token exchange was indicated, not directly shown, by the 2026-10-27 sandbox run (`docs/deployment/enterprise.md`, section 5).
