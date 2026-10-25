/**
 * Appliance worker (ADR-0026): polls Azure long-running operations recorded by the API (Resource Mover actions),
 * updates their status in the repository and writes audit events on completion. Read-only against Azure: it only GETs
 * operation status URLs. Runs as a separate Container App job/replica sharing the same repository and identity.
 */
import { configFromEnv, type AssessmentRepository, type EnterpriseConfig } from "@amo/appliance-api";
import type { TokenCredential } from "@amo/azure-auth";
import { pollOperation, isTerminal, type TrackedOperation } from "@amo/azure-execution";
import { noopLogger, type Logger } from "@amo/observability";

/** Startup check for the worker: the same credential-style environment refusals as the API (client secrets, passwords, certificate path, user name). Throws before anything connects. */
export function workerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EnterpriseConfig {
  // The worker serves no web requests, so the API-only allow-lists are left out: a bad value meant for the API must not stop it.
  return configFromEnv({ ...env, AMO_ALLOWED_ORIGINS: undefined, AMO_ALLOWED_HOSTS: undefined, AMO_ALLOW_SELF_APPROVAL: undefined });
}

export interface WorkerOptions {
  repository: AssessmentRepository;
  credential: TokenCredential;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  now?: () => Date;
  /** Floor between polls of the same operation, seconds. */
  minIntervalSeconds?: number;
}

export async function runOnce(opts: WorkerOptions): Promise<{ polled: number; completed: TrackedOperation[] }> {
  const log = opts.logger ?? noopLogger;
  const now = opts.now ?? (() => new Date());
  const pending = await opts.repository.pendingOperations();
  const completed: TrackedOperation[] = [];
  let polled = 0;
  for (const op of pending) {
    const due = new Date(op.updatedAt).getTime() + Math.max(opts.minIntervalSeconds ?? 5, op.retryAfterSeconds) * 1000;
    if (due > now().getTime()) continue;
    polled++;
    const next = await pollOperation(opts.credential, op, opts.fetchImpl ?? fetch, now);
    await opts.repository.saveOperation(next);
    if (isTerminal(next.status)) {
      completed.push(next);
      await opts.repository.audit({ at: next.updatedAt, actor: "worker", event: `operation.${next.status.toLowerCase()}`, details: { id: next.id, kind: next.kind, targetKey: next.targetKey, error: next.error } });
      log.info("operation finished", { id: next.id, kind: next.kind, status: next.status });
    }
  }
  return { polled, completed };
}

export async function runForever(opts: WorkerOptions, intervalMs = 15000, signal?: AbortSignal): Promise<void> {
  const log = opts.logger ?? noopLogger;
  while (!signal?.aborted) {
    try { await runOnce(opts); } catch (e) { log.error("worker iteration failed", { message: (e as Error).message }); }
    await new Promise<void>((r) => { const t = setTimeout(r, intervalMs); signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  }
}
