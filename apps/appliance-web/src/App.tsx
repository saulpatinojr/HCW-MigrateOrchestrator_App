import { useEffect, useState } from "react";
import type { Assessment, ResourceDecisionRecord } from "@amo/domain";
import { DecisionTable, DecisionDetail, WavePlanView, PoweredBy } from "@amo/ui";
import { account, ready, signIn, signInError, signOut } from "./auth.js";
import { api } from "./api.js";

type Scopes = Awaited<ReturnType<typeof api.scopes>>;

export default function App() {
  const [me, setMe] = useState<{ oid: string; level: string; roles: string[] } | null>(null);
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof api.list>>>([]);
  const [current, setCurrent] = useState<Assessment | null>(null);
  const [selected, setSelected] = useState<ResourceDecisionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ source: "", destination: "", destinationRegion: "", destinationResourceGroup: "", targetRgId: "", collection: "", note: "" });
  const canExecute = me?.level === "controlled-execution" || me?.level === "destructive-execution";

  useEffect(() => {
    ready.then(async () => {
      if (signInError) setError(signInError);
      if (!account()) return;
      try { setMe(await api.me()); setList(await api.list()); setScopes(await api.scopes()); } catch (e) { setError((e as Error).message); }
    });
  }, []);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => { setBusy(true); setError(null); try { return await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const open = async (id: string) => run(async () => setCurrent((await api.get(id)).assessment));
  const create = () => run(async () => {
    const { assessmentId } = await api.create(form.source, { destinationRegion: form.destinationRegion || null, destinationResourceGroup: form.destinationResourceGroup || null, desiredOperation: form.destinationRegion ? "region-relocation" : "subscription-move" }, form.destination || undefined);
    setList(await api.list());
    await open(assessmentId);
  });
  const validate = () => current && run(async () => { const r = await api.validateMove(current.id, form.targetRgId); alert(r.results.map((x) => `${x.sourceResourceGroup}: ${x.ok ? "OK" : x.errors.map((e) => e.code).join(", ")}`).join("\n")); await open(current.id); });
  const approve = (operation: string) => run(async () => { await api.approve(operation, form.collection, form.note); alert(`Recorded ${operation} approval for ${form.collection}`); });
  const mover = (action: string) => current && run(async () => {
    const col = { subscriptionId: form.source, resourceGroup: form.collection.split("/")[0] ?? "", name: form.collection.split("/")[1] ?? form.collection };
    const r = await api.mover(action, col, current.decisions.filter((d) => d.recommendedTool === "azure-resource-mover" && d.resourceId).map((d) => d.resourceId!));
    alert(`${action}: ${r.accepted ? "accepted" : "refused"} — ${r.reason}`);
  });

  if (!account()) return (
    <main className="mx-auto max-w-xl p-10 space-y-6 text-center">
      <h1 className="text-2xl font-semibold">Azure Migration Orchestrator</h1>
      <p className="text-slate-600">Sign in with Microsoft Entra ID. Access requires an assigned app role (Migration.Plan is read-only planning); execution needs a higher role and recorded approvals.</p>
      {error && <p role="alert" className="rounded-lg border border-red-700 p-3 text-sm text-red-700">{error}</p>}
      <button className="rounded-lg bg-sky-700 px-4 py-2 text-white" onClick={signIn}>Sign in</button>
      <PoweredBy compact />
    </main>
  );

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Azure Migration Orchestrator</h1>
        <div className="text-sm">{me ? <>{me.oid.slice(0, 8)}… · <span className="rounded-full border px-2">{me.level}</span></> : null} <button className="ml-3 underline" onClick={signOut}>Sign out</button></div>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-700 p-3 text-sm text-red-700">{error}</p>}

      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold">New assessment</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <label className="flex flex-col gap-1">Source subscription
            <select className="rounded-lg border px-2 py-1" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="">Select…</option>
              {scopes?.subscriptions.map((s) => <option key={s.subscriptionId} value={s.subscriptionId}>{s.name}{s.delegated ? " (Lighthouse-delegated)" : ""}</option>)}
            </select></label>
          <label className="flex flex-col gap-1">Destination subscription (optional)
            <select className="rounded-lg border px-2 py-1" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}>
              <option value="">Same as source</option>
              {scopes?.subscriptions.map((s) => <option key={s.subscriptionId} value={s.subscriptionId}>{s.name}{s.delegated ? " (Lighthouse-delegated)" : ""}</option>)}
            </select></label>
          <label className="flex flex-col gap-1">Destination region (for region relocation)<input className="rounded-lg border px-2 py-1" value={form.destinationRegion} onChange={(e) => setForm({ ...form, destinationRegion: e.target.value })} placeholder="westus3" /></label>
          <label className="flex flex-col gap-1">Destination resource group<input className="rounded-lg border px-2 py-1" value={form.destinationResourceGroup} onChange={(e) => setForm({ ...form, destinationResourceGroup: e.target.value })} /></label>
        </div>
        <p className="text-xs text-slate-500">{scopes ? `${scopes.subscriptions.length} subscriptions visible (${scopes.delegatedCount} delegated). Cross-tenant intent is derived from the subscriptions' directories.` : "Loading scopes…"}</p>
        <button disabled={busy || !form.source} className="rounded-lg bg-sky-700 px-4 py-2 text-white disabled:opacity-50" onClick={create}>Discover and assess (read-only)</button>
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-semibold mb-2">Assessments</h2>
        <ul className="text-sm divide-y">{list.map((a) => <li key={a.id} className="py-1 flex justify-between"><button className="underline" onClick={() => open(a.id)}>{a.id.slice(0, 8)}…</button><span>{a.operation} · {a.resourceCount} resources · {new Date(a.createdAt).toLocaleString()}</span></li>)}</ul>
      </section>

      {current && (
        <>
          <section className="rounded-xl border p-4 text-sm space-y-2">
            <h2 className="font-semibold">Assessment {current.id.slice(0, 8)}… — {current.summary.resourceCount} resources, {current.summary.unknownCount} need validation, authenticated: {String(current.authenticated)}</h2>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="flex flex-col gap-1">Target resource group ID (ARM validateMoveResources)<input className="rounded-lg border px-2 py-1 w-[32rem]" value={form.targetRgId} onChange={(e) => setForm({ ...form, targetRgId: e.target.value })} placeholder="/subscriptions/…/resourceGroups/rg-dest" /></label>
              <button disabled={busy || !form.targetRgId} className="rounded-lg border px-3 py-1" onClick={validate}>Validate move (evidence)</button>
            </div>
          </section>
          <DecisionTable decisions={current.decisions} onSelect={setSelected} />
          <DecisionDetail decision={selected} onClose={() => setSelected(null)} />
          <WavePlanView plan={current.wavePlan} decisions={current.decisions} />
          <section className="rounded-xl border p-4 text-sm space-y-3">
            <h2 className="font-semibold">Execution — Azure Resource Mover (approval-gated)</h2>
            {!canExecute && <p className="text-amber-700">Your level is {me?.level}. Recording approvals and running Resource Mover require the Migration.Execute app role.</p>}
            <div className="flex flex-wrap gap-2 items-end">
              <label className="flex flex-col gap-1">Move collection (rg/name)<input className="rounded-lg border px-2 py-1" value={form.collection} onChange={(e) => setForm({ ...form, collection: e.target.value })} placeholder="rg-mover/mc1" /></label>
              <label className="flex flex-col gap-1">Approval note (change record)<input className="rounded-lg border px-2 py-1" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="CAB-123" /></label>
              <button disabled={!canExecute || busy} className="rounded-lg border px-3 py-1" onClick={() => approve("production-deploy")}>Record approval: initiate move</button>
              <button disabled={!canExecute || busy} className="rounded-lg border px-3 py-1" onClick={() => approve("data-cutover")}>Record approval: commit</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {["prepare", "initiateMove", "commit", "discard"].map((a) => <button key={a} disabled={!canExecute || busy} className={`rounded-lg px-3 py-1 ${a === "discard" ? "border border-red-700 text-red-700" : "bg-sky-700 text-white"} disabled:opacity-50`} onClick={() => mover(a)}>{a}</button>)}
            </div>
            <p className="text-xs text-slate-500">Every action is audited. A refusal shows the gate's reason (missing level or approval). <em>discard</em> is the rollback path.</p>
          </section>
        </>
      )}
      <PoweredBy compact />
    </main>
  );
}
