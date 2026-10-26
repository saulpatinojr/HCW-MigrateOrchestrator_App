import { createRequire } from "node:module";
import type { Assessment } from "@amo/domain";
import type { TokenCredential } from "@amo/azure-auth";
import type { TrackedOperation } from "@amo/azure-execution";
import { embedsPassword, isLocalDatabaseUrl } from "./database-url.js";

/** Scope for Microsoft Entra authentication to Azure Database for PostgreSQL. */
export const POSTGRES_ENTRA_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

/** `pg` accepts `password` as an async function: each new connection fetches a fresh Entra access token (ADR-0025). */
export function pgEntraPasswordProvider(credential: TokenCredential): () => Promise<string> {
  return async () => (await credential.getToken(POSTGRES_ENTRA_SCOPE)).token;
}

/** Persistence for the appliance (ADR-0004). Assessments, approvals and audit events. */
export interface ApprovalRecord { id: string; operation: string; targetKey: string; approvedBy: string; approvedAt: string; note: string | null }
export interface AuditEvent { at: string; actor: string; event: string; details: Record<string, unknown> }

export interface AssessmentRepository {
  init(): Promise<void>;
  saveAssessment(a: Assessment, ownerOid: string): Promise<void>;
  getAssessment(id: string): Promise<{ assessment: Assessment; ownerOid: string } | null>;
  listAssessments(ownerOid: string): Promise<Array<{ id: string; createdAt: string; resourceCount: number; operation: string }>>;
  recordApproval(r: ApprovalRecord): Promise<void>;
  approvalsFor(targetKey: string): Promise<ApprovalRecord[]>;
  audit(e: AuditEvent): Promise<void>;
  saveOperation(op: TrackedOperation): Promise<void>;
  pendingOperations(): Promise<TrackedOperation[]>;
  operationsFor(targetKey: string): Promise<TrackedOperation[]>;
}

export class InMemoryRepository implements AssessmentRepository {
  private a = new Map<string, { assessment: Assessment; ownerOid: string }>();
  private approvals: ApprovalRecord[] = [];
  readonly events: AuditEvent[] = [];
  async init(): Promise<void> {}
  async saveAssessment(assessment: Assessment, ownerOid: string): Promise<void> { this.a.set(assessment.id, { assessment, ownerOid }); }
  async getAssessment(id: string) { return this.a.get(id) ?? null; }
  async listAssessments(ownerOid: string) { return [...this.a.values()].filter((x) => x.ownerOid === ownerOid).map(({ assessment: x }) => ({ id: x.id, createdAt: x.createdAt, resourceCount: x.summary.resourceCount, operation: x.intent.desiredOperation })); }
  async recordApproval(r: ApprovalRecord): Promise<void> { this.approvals.push(r); }
  async approvalsFor(targetKey: string) { return this.approvals.filter((r) => r.targetKey === targetKey); }
  async audit(e: AuditEvent): Promise<void> { this.events.push(e); }
  private ops = new Map<string, TrackedOperation>();
  async saveOperation(op: TrackedOperation): Promise<void> { this.ops.set(op.id, op); }
  async pendingOperations() { return [...this.ops.values()].filter((o) => o.status === "InProgress" || o.status === "Unknown"); }
  async operationsFor(targetKey: string) { return [...this.ops.values()].filter((o) => o.targetKey === targetKey); }
}

/** Minimal query interface so the PostgreSQL repository can be tested without a server. */
export interface SqlClient { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> }

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY,
  owner_oid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  operation TEXT NOT NULL,
  resource_count INTEGER NOT NULL,
  body JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS assessments_owner_idx ON assessments(owner_oid, created_at DESC);
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY,
  operation TEXT NOT NULL,
  target_key TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS approvals_target_idx ON approvals(target_key);
CREATE TABLE IF NOT EXISTS operations (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  operation_url TEXT NOT NULL,
  status TEXT NOT NULL,
  started_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  retry_after_seconds INTEGER NOT NULL DEFAULT 15,
  error TEXT
);
CREATE INDEX IF NOT EXISTS operations_status_idx ON operations(status);
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  details JSONB NOT NULL
);
`;

export class PostgresRepository implements AssessmentRepository {
  constructor(private readonly sql: SqlClient) {}
  async init(): Promise<void> { await this.sql.query(SCHEMA_SQL); }
  async saveAssessment(a: Assessment, ownerOid: string): Promise<void> {
    await this.sql.query("INSERT INTO assessments(id, owner_oid, created_at, operation, resource_count, body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body", [a.id, ownerOid, a.createdAt, a.intent.desiredOperation, a.summary.resourceCount, JSON.stringify(a)]);
  }
  async getAssessment(id: string) {
    const { rows } = await this.sql.query("SELECT owner_oid, body FROM assessments WHERE id = $1", [id]);
    if (!rows[0]) return null;
    const body = rows[0].body;
    return { assessment: (typeof body === "string" ? JSON.parse(body) : body) as Assessment, ownerOid: String(rows[0].owner_oid) };
  }
  async listAssessments(ownerOid: string) {
    const { rows } = await this.sql.query("SELECT id, created_at, resource_count, operation FROM assessments WHERE owner_oid = $1 ORDER BY created_at DESC LIMIT 100", [ownerOid]);
    return rows.map((r) => ({ id: String(r.id), createdAt: String(r.created_at), resourceCount: Number(r.resource_count), operation: String(r.operation) }));
  }
  async recordApproval(r: ApprovalRecord): Promise<void> {
    await this.sql.query("INSERT INTO approvals(id, operation, target_key, approved_by, approved_at, note) VALUES ($1,$2,$3,$4,$5,$6)", [r.id, r.operation, r.targetKey, r.approvedBy, r.approvedAt, r.note]);
  }
  async approvalsFor(targetKey: string) {
    const { rows } = await this.sql.query("SELECT id, operation, target_key, approved_by, approved_at, note FROM approvals WHERE target_key = $1", [targetKey]);
    return rows.map((r) => ({ id: String(r.id), operation: String(r.operation), targetKey: String(r.target_key), approvedBy: String(r.approved_by), approvedAt: String(r.approved_at), note: r.note == null ? null : String(r.note) }));
  }
  async audit(e: AuditEvent): Promise<void> { await this.sql.query("INSERT INTO audit_events(at, actor, event, details) VALUES ($1,$2,$3,$4)", [e.at, e.actor, e.event, JSON.stringify(e.details)]); }
  async saveOperation(o: TrackedOperation): Promise<void> {
    await this.sql.query("INSERT INTO operations(id, kind, target_key, operation_url, status, started_by, started_at, updated_at, retry_after_seconds, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, retry_after_seconds = EXCLUDED.retry_after_seconds, error = EXCLUDED.error", [o.id, o.kind, o.targetKey, o.operationUrl, o.status, o.startedBy, o.startedAt, o.updatedAt, o.retryAfterSeconds, o.error]);
  }
  private rowToOp(r: Record<string, unknown>): TrackedOperation { return { id: String(r.id), kind: String(r.kind), targetKey: String(r.target_key), operationUrl: String(r.operation_url), status: r.status as TrackedOperation["status"], startedBy: String(r.started_by), startedAt: String(r.started_at), updatedAt: String(r.updated_at), retryAfterSeconds: Number(r.retry_after_seconds), error: r.error == null ? null : String(r.error) }; }
  async pendingOperations() { const { rows } = await this.sql.query("SELECT * FROM operations WHERE status IN ('InProgress','Unknown') ORDER BY updated_at ASC LIMIT 200"); return rows.map((r) => this.rowToOp(r)); }
  async operationsFor(targetKey: string) { const { rows } = await this.sql.query("SELECT * FROM operations WHERE target_key = $1 ORDER BY started_at DESC", [targetKey]); return rows.map((r) => this.rowToOp(r)); }
}

/**
 * What the API hands to `pg.Pool`. A database reached with an Entra token is described by separate fields, never by a
 * `connectionString`: with `pg` 8.23.1 a connection string next to a `password` function silently replaces the function with
 * `null`, so the server receives an empty password and answers "Password returned by client is empty". The first sandbox
 * apply (2026-10-26) showed this: the container exited at start. A local database (no token) keeps the connection string.
 */
export interface PoolConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  application_name?: string;
  options?: string;
  ssl?: { rejectUnauthorized: boolean };
  password?: () => Promise<string>;
}
export interface PoolFactory { (config: PoolConfig): SqlClient }

/**
 * The options an Azure address may carry. `sslmode` is accepted only as a verified mode (TLS is always verified), and
 * `application_name` and `options` (server settings such as `-c search_path=...`) are passed on. Any other option is refused
 * by name: dropping a setting silently would let a deployment run without something it asked for.
 */
const PASSED_ON_OPTIONS = new Set(["sslmode", "application_name", "options"]);
const VERIFIED_SSLMODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * The pool settings for an Azure database address (`postgres://<identity name>@<server>.postgres.database.azure.com:5432/<database>`).
 * TLS is always on and always verified: the password is an access token and must never cross the network in the clear, so an
 * address that asks for a weaker `sslmode` is refused. Options the appliance does not pass on are refused by name. A malformed
 * address is refused without echoing it (it can carry a user name).
 */
export function entraPoolConfig(databaseUrl: string, credential: TokenCredential): PoolConfig {
  let u: URL;
  try { u = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL is not a valid postgres:// address"); }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new Error("DATABASE_URL must start with postgres:// or postgresql://");
  const user = decodeURIComponent(u.username);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!u.hostname || !user || !database) throw new Error("DATABASE_URL must name a host, a user (the managed identity) and a database");
  for (const name of new Set(u.searchParams.keys())) {
    if (!PASSED_ON_OPTIONS.has(name)) throw new Error(`DATABASE_URL has an option this appliance does not pass on: ${/^[a-z_]{1,40}$/.test(name) ? name : "(unsupported name)"}`);
    // A repeated option would be read from its first value here but its last value by pg's own address parser, so the setting that
    // was asked for (for example a search_path) could be silently ignored. Refuse it instead of choosing one.
    if (u.searchParams.getAll(name).length !== 1) throw new Error("DATABASE_URL must not repeat an option");
  }
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode !== null && !VERIFIED_SSLMODES.has(sslmode)) throw new Error("DATABASE_URL sslmode must be require, verify-ca or verify-full for an Azure database: TLS is always verified");
  const applicationName = u.searchParams.get("application_name");
  const options = u.searchParams.get("options");
  return {
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port ? Number(u.port) : 5432,
    user,
    database,
    ...(applicationName ? { application_name: applicationName } : {}),
    ...(options ? { options } : {}),
    ssl: { rejectUnauthorized: true },
    password: pgEntraPasswordProvider(credential),
  };
}

export async function repositoryFromEnv(env: NodeJS.ProcessEnv = process.env, credential: TokenCredential | null = null, poolFactory?: PoolFactory): Promise<AssessmentRepository> {
  if (!env.DATABASE_URL) return new InMemoryRepository();
  const local = isLocalDatabaseUrl(env.DATABASE_URL);
  if (embedsPassword(env.DATABASE_URL) && !local) throw new Error("DATABASE_URL must not embed a password for non-local hosts; use Entra authentication for PostgreSQL (docs/deployment/enterprise.md)");
  if (!local && !credential) throw new Error("Azure Database for PostgreSQL requires a TokenCredential for Entra authentication (AMO_CREDENTIAL_KIND)");
  const factory: PoolFactory = poolFactory ?? ((cfg) => new (require_pg().Pool)(cfg) as unknown as SqlClient);
  const config: PoolConfig = local
    ? { connectionString: env.DATABASE_URL, ssl: /sslmode=require/.test(env.DATABASE_URL) ? { rejectUnauthorized: true } : undefined }
    : entraPoolConfig(env.DATABASE_URL, credential!);
  const pool = factory(config);
  const repo = new PostgresRepository(pool);
  await repo.init();
  return repo;
}

// Lazy CommonJS require so the appliance can start without pg installed when DATABASE_URL is unset (tests, lab builds never import this file).
function require_pg(): { Pool: new (cfg: unknown) => unknown } {
  return createRequire(import.meta.url)("pg");
}
