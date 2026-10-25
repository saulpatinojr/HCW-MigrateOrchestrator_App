/**
 * Appliance API (Azure edition). Shares the orchestrator with the lab; adds Entra-validated identity, authenticated
 * Resource Graph discovery, ARM move validation as evidence, approvals, and Resource Mover as the first gated execution
 * surface (ADR-0022). Fails closed whenever sign-in is not configured.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Orchestrator, AGENTS } from "@amo/agents";
import { FixtureDiscoveryProvider, type DiscoveryProvider } from "@amo/azure-discovery";
import { ResourceGraphDiscoveryProvider, MoveValidator, ScopeInventory } from "@amo/azure-arm";
import { credentialFromEnv, refuseUnsupportedIdentityEnv, EntraTokenValidator, StaticTokenCredential, type TokenCredential } from "@amo/azure-auth";
import { ResourceMoverClient, type MoverAction } from "@amo/azure-execution";
import { gate, isAllowed, APPROVAL_REQUIRED_OPERATIONS, type Principal, type AuthorizationLevel, type ApprovalOperation } from "@amo/authorization";
import { createLogger, type Logger } from "@amo/observability";
import { InMemoryRepository, type AssessmentRepository } from "./repository.js";
export * from "./repository.js";

export interface EnterpriseConfig {
  tenantId: string | null;
  clientId: string | null;
  /** Accepted token audiences (API app ID URI and/or client ID). */
  audiences: string[];
  credentialKind: "managed-identity" | "workload-identity-federation" | "azure-cli";
  useFixture: boolean;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): EnterpriseConfig {
  refuseUnsupportedIdentityEnv(env);
  for (const k of Object.keys(env)) if (/^(AMO_|AZURE_).*(SECRET|PASSWORD)$/i.test(k)) throw new Error(`refusing to start: ${k} looks like a client secret; use managed identity or workload identity federation`);
  const clientId = env.AMO_ENTRA_CLIENT_ID ?? null;
  return { tenantId: env.AMO_ENTRA_TENANT_ID ?? null, clientId, audiences: [env.AMO_ENTRA_AUDIENCE, clientId, clientId ? `api://${clientId}` : null].filter((x): x is string => !!x), credentialKind: (env.AMO_CREDENTIAL_KIND as EnterpriseConfig["credentialKind"]) ?? "managed-identity", useFixture: env.AMO_DISCOVERY_FIXTURE === "1" };
}

/**
 * Startup refusal for production (ticket #51). In production (NODE_ENV=production, which the appliance image sets) the API
 * must not come up half configured: without a tenant and an app registration every route would answer 401 while
 * /api/health looked fine. Empty values count as missing. Outside production the API still starts unconfigured, as the
 * tests and local exploration rely on; the routes fail closed either way, and this check never relaxes that.
 */
export function assertProductionConfig(cfg: EnterpriseConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const missing: string[] = [];
  if (!cfg.tenantId) missing.push("AMO_ENTRA_TENANT_ID");
  if (!cfg.clientId) missing.push("AMO_ENTRA_CLIENT_ID");
  if (missing.length) throw new Error(`refusing to start in production: Entra ID sign-in is not configured (missing ${missing.join(" and ")}); set them as described in docs/deployment/enterprise.md`);
}

/**
 * The Entra app roles the API recognises, highest first, and the authorization level each grants (ADR-0031). Role values
 * are matched exactly (case-sensitive), as Entra issues them in the `roles` claim. The lowest role is `Migration.Read` (assess only);
 * a token with none of these roles is not a principal at all.
 */
export const APP_ROLE_LEVELS: ReadonlyArray<readonly [role: string, level: AuthorizationLevel]> = [
  ["Migration.Execute.Destructive", "destructive-execution"],
  ["Migration.Execute", "controlled-execution"],
  ["Migration.Plan", "planning"],
  ["Migration.Read", "discovery"],
];

/**
 * Maps validated token claims to a principal. Fails closed (ticket #46, ADR-0031): no object id, no `roles` array, or no
 * recognised app role gives `null`, and the API answers 403. A signed-in user without a role gets no access, not
 * "discovery". A `roles` claim that is not an array of strings counts as no roles (a string would otherwise match by
 * substring).
 */
export function principalFromClaims(claims: { oid?: string; roles?: unknown } | null): Principal | null {
  if (!claims?.oid) return null;
  const held = new Set(Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === "string") : []);
  const level = APP_ROLE_LEVELS.find(([role]) => held.has(role))?.[1];
  if (!level) return null;
  return { id: claims.oid, edition: "enterprise", grantedLevel: level, approvals: new Set() };
}

export interface ApplianceDeps {
  validator: EntraTokenValidator | null;
  credential: TokenCredential | null;
  repository: AssessmentRepository;
  discovery: DiscoveryProvider;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export function depsFromEnv(cfg: EnterpriseConfig, env: NodeJS.ProcessEnv = process.env, repository: AssessmentRepository = new InMemoryRepository()): ApplianceDeps {
  const validator = cfg.tenantId && cfg.audiences.length ? new EntraTokenValidator({ tenantId: cfg.tenantId, audiences: cfg.audiences }) : null;
  const credential = cfg.useFixture ? new StaticTokenCredential() : cfg.tenantId ? credentialFromEnv({ ...env, AMO_CREDENTIAL_KIND: cfg.credentialKind }) : null;
  const discovery = cfg.useFixture || !credential ? new FixtureDiscoveryProvider([]) : new ResourceGraphDiscoveryProvider(credential);
  return { validator, credential, repository, discovery };
}

const readJson = (req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> => new Promise((resolve, reject) => { const chunks: Buffer[] = []; let n = 0; req.on("data", (c: Buffer) => { n += c.length; if (n > limit) { req.destroy(); reject(new Error("too large")); } chunks.push(c); }); req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); } }); req.on("error", reject); });

export function createEnterpriseApi(cfg: EnterpriseConfig, deps: ApplianceDeps): Server {
  const log = deps.logger ?? createLogger({ app: "appliance-api" });
  const orchestrator = new Orchestrator({ edition: "enterprise", logger: log, ttlMinutes: null });
  const fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis);
  const repo = deps.repository;
  const mover = deps.credential ? new ResourceMoverClient(deps.credential, fetchImpl, "https://management.azure.com", log) : null;
  const moveValidator = deps.credential ? new MoveValidator(deps.credential, fetchImpl) : null;
  const scopes = deps.credential && cfg.tenantId ? new ScopeInventory(deps.credential, cfg.tenantId, fetchImpl) : null;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(body)); };
    const fail = (status: number, code: string, message: string) => send(status, { error: { code, message } });
    try {
      if (url.pathname === "/api/health") return send(200, { ok: true, edition: "enterprise", signIn: deps.validator ? "configured" : "not-configured", discovery: deps.discovery.name, persistence: repo.constructor.name, execution: mover ? "resource-mover (gated)" : "not-configured" });
      if (url.pathname === "/api/agents") return send(200, AGENTS.map(({ id, name, purpose, demo }) => ({ id, name, purpose, enterpriseOnly: !demo })));

      // Everything below requires a validated Entra token.
      if (!deps.validator) return fail(401, "unauthenticated", "Entra ID sign-in not configured (AMO_ENTRA_TENANT_ID, AMO_ENTRA_CLIENT_ID); see docs/deployment/enterprise.md");
      const v = await deps.validator.validate(req.headers.authorization);
      if (!v.ok) return fail(401, "unauthenticated", v.reason);
      const actor = v.claims.oid;
      // A valid token is not enough: it must carry an app role (ADR-0031). A token with no role and one with an
      // unrecognised role get the same answer, on every route below.
      const principal = principalFromClaims(v.claims);
      if (!principal) {
        log.warn("request refused: token has no recognised app role", { oid: actor });
        return fail(403, "forbidden", "no application role assigned: ask an administrator to assign you one of the Migration.* app roles (docs/deployment/enterprise.md, section 2)");
      }

      if (url.pathname === "/api/me") return send(200, { oid: actor, level: principal.grantedLevel, roles: v.claims.roles });

      if (url.pathname === "/api/scopes") {
        if (!scopes) return fail(503, "not_configured", "no Azure credential configured");
        const subs = await scopes.listSubscriptions();
        return send(200, { homeTenantId: cfg.tenantId, subscriptions: subs, delegatedCount: subs.filter((x) => x.delegated).length });
      }
      if (url.pathname === "/api/assessments" && req.method === "POST") {
        if (!isAllowed(principal, "discovery")) return fail(403, "forbidden", "discovery level required");
        const body = (await readJson(req)) as { scope?: { kind: "subscription" | "management-group" | "resource-group"; id: string }; intent?: Record<string, unknown>; destinationSubscriptionId?: string };
        if (!body.scope?.id) return fail(400, "scope_required", "scope {kind,id} required");
        const intent: Record<string, unknown> = { ...(body.intent ?? {}) };
        // Lighthouse-aware: derive the tenant relationship from the subscription inventory when both sides are known.
        if (scopes && body.scope.kind === "subscription" && (body.destinationSubscriptionId || intent.destinationSubscriptionId)) {
          const subs = await scopes.listSubscriptions();
          const dest = String(body.destinationSubscriptionId ?? intent.destinationSubscriptionId);
          const rel = ScopeInventory.relationship(subs.find((x) => x.subscriptionId.toLowerCase() === body.scope!.id.toLowerCase()), subs.find((x) => x.subscriptionId.toLowerCase() === dest.toLowerCase()));
          if (rel.sameTenant !== null) { intent.sameTenant = rel.sameTenant; intent.sameSubscription = rel.sameSubscription; intent.destinationSubscriptionId = dest; }
        }
        const { assessment } = await orchestrator.assessDiscovered(deps.discovery, body.scope, intent);
        await repo.saveAssessment(assessment, actor);
        await repo.audit({ at: new Date().toISOString(), actor, event: "assessment.created", details: { id: assessment.id, scope: body.scope, resources: assessment.summary.resourceCount } });
        return send(201, { assessmentId: assessment.id, summary: assessment.summary, progress: assessment.progress, warnings: assessment.ingestionWarnings });
      }
      if (url.pathname === "/api/assessments" && req.method === "GET") return send(200, await repo.listAssessments(actor));

      const m = url.pathname.match(/^\/api\/assessments\/([0-9a-f-]{36})(\/validate-move)?$/);
      if (m) {
        const item = await repo.getAssessment(m[1]);
        if (!item || item.ownerOid !== actor) return fail(404, "not_found", "assessment not found");
        if (!m[2]) return send(200, { assessment: item.assessment });
        // Authenticated evidence: ARM validateMoveResources for the native-move candidates.
        if (!isAllowed(principal, "validation")) return fail(403, "forbidden", "validation level required");
        if (!moveValidator) return fail(503, "not_configured", "no Azure credential configured");
        const body = (await readJson(req)) as { targetResourceGroupId?: string };
        if (!body.targetResourceGroupId) return fail(400, "target_required", "targetResourceGroupId required");
        const candidates = item.assessment.decisions.filter((d) => d.recommendedTool === "arm-move" && d.resourceId);
        const bySourceRg = new Map<string, string[]>();
        for (const d of candidates) { const rg = d.resourceId!.split("/providers/")[0]; bySourceRg.set(rg, [...(bySourceRg.get(rg) ?? []), d.resourceId!]); }
        const results = [];
        for (const [rg, ids] of bySourceRg) {
          const r = await moveValidator.validate(rg, ids, body.targetResourceGroupId);
          results.push({ sourceResourceGroup: rg, ...r });
          for (const d of candidates) if (ids.includes(d.resourceId!)) { d.evidence.push(...r.evidence); if (!r.ok) d.blockers.push(...r.errors.filter((e) => !e.target || e.target.toLowerCase() === d.resourceId!.toLowerCase()).map((e) => `ARM validateMoveResources: ${e.code} — ${e.message}`)); }
        }
        await repo.saveAssessment(item.assessment, actor);
        await repo.audit({ at: new Date().toISOString(), actor, event: "assessment.validate-move", details: { id: m[1], groups: results.length, ok: results.every((r) => r.ok) } });
        return send(200, { results });
      }

      if (url.pathname === "/api/approvals" && req.method === "POST") {
        if (!isAllowed(principal, "controlled-execution")) return fail(403, "forbidden", "controlled-execution level required to record approvals");
        const body = (await readJson(req)) as { operation?: ApprovalOperation; targetKey?: string; note?: string };
        if (!body.operation || !APPROVAL_REQUIRED_OPERATIONS.includes(body.operation) || !body.targetKey) return fail(400, "invalid", "operation and targetKey required");
        const rec = { id: randomUUID(), operation: body.operation, targetKey: body.targetKey, approvedBy: actor, approvedAt: new Date().toISOString(), note: body.note ?? null };
        await repo.recordApproval(rec);
        await repo.audit({ at: rec.approvedAt, actor, event: "approval.granted", details: { operation: rec.operation, targetKey: rec.targetKey } });
        return send(201, rec);
      }

      const mv = url.pathname.match(/^\/api\/execution\/resource-mover\/(prepare|initiateMove|commit|discard)$/);
      if (mv && req.method === "POST") {
        if (!mover) return fail(503, "not_configured", "no Azure credential configured");
        const body = (await readJson(req)) as { collection?: { subscriptionId: string; resourceGroup: string; name: string }; moveResourceIds?: string[] };
        if (!body.collection?.name || !body.moveResourceIds?.length) return fail(400, "invalid", "collection and moveResourceIds required");
        // Hydrate approvals from the repository so the gate sees recorded human decisions.
        for (const a of await repo.approvalsFor(body.collection.name)) principal.approvals.add(`${a.operation}:${a.targetKey}`);
        const r = await mover.run(principal, body.collection, mv[1] as MoverAction, body.moveResourceIds);
        await repo.audit({ at: new Date().toISOString(), actor, event: `execution.resource-mover.${mv[1]}`, details: { collection: body.collection.name, accepted: r.accepted, reason: r.reason } });
        let operationId: string | null = null;
        if (r.accepted && r.operationUrl) {
          const now = new Date().toISOString();
          operationId = randomUUID();
          await repo.saveOperation({ id: operationId, kind: `resource-mover.${mv[1]}`, targetKey: body.collection.name, operationUrl: r.operationUrl, status: "InProgress", startedBy: actor, startedAt: now, updatedAt: now, retryAfterSeconds: 15, error: null });
        }
        return send(r.accepted ? 202 : 403, { ...r, operationId });
      }
      const ops = url.pathname.match(/^\/api\/operations\/([^/]+)$/);
      if (ops && req.method === "GET") {
        if (!isAllowed(principal, "planning")) return fail(403, "forbidden", "planning level required");
        return send(200, await repo.operationsFor(decodeURIComponent(ops[1])));
      }
      if (url.pathname.startsWith("/api/execution/")) return fail(403, "approval_required", gate(principal, "production-deploy", url.pathname).reason);
      return fail(404, "not_found", "unknown route");
    } catch (e) {
      log.error("request failed", { message: (e as Error).message });
      return fail(500, "internal", "unexpected error");
    }
  });
}
