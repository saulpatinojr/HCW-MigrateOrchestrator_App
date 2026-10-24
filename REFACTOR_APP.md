# REFACTOR_APP.md: pane-ready explorer and the shared AddOn health contract

| | |
|---|---|
| Date | 2026-10-10 |
| Program | HCW App-to-AddOn initiative |
| Repository role | `saulpatinojr/HCW-MigrateOrchestrator_App`, upstream product, read-only during the program |
| Rule | This file is the only file the program adds to this repository. Every other change below is an instruction for the owner to implement; nothing else in the tree was touched. |
| Implementation target | This repository's next release, `v0.3.0` |
| Baseline read | commit `ef4a515` (v0.2.1); every line number below refers to that commit |
| Binding inputs | HCW AddOn Integration Standard (website `docs/standards/addon-integration-standard.md`), the program's contract decisions of 2026-10-10 (flat `/api/health`, four pane states, Docker Hub images), ADR-0028, ADR-0029 |

## 1. Purpose

Make `@hybridcloudworks/migration-ui` mountable inside the HCW site pane model without changing engine behaviour, and put the health envelope and pane message shape that every HCW AddOn serves into `packages/contracts` so the downstream edition and the website's status proxy key on one definition. The website no longer installs the UI package; it frames the downstream edition at `/tools/migration`. This repository ships the props, the contract, ADR-0030 and the plan rewrite, then tags `v0.3.0` so the downstream `core-update` workflow can adopt it.

## 2. Current-state summary

| Item | State at `ef4a515` | Evidence |
|---|---|---|
| `MigrationExplorer` API base | `apiBaseUrl: string` is required; the doc comment names `labs-api.hybridcloudworks.com` | `packages/ui/src/components/MigrationExplorer.tsx:15-16` |
| Partner panel | `<PoweredBy compact={stage !== "results"} />` renders unconditionally; `PARTNERS` names Hostinger, Cloudflare and Coder | `MigrationExplorer.tsx:119`, `packages/ui/src/components/PoweredBy.tsx:2-10` |
| Enterprise CTA | `<a href={contactUrl}>` navigates inside whatever frame hosts the explorer | `MigrationExplorer.tsx:115` |
| Stage | `type Stage` is module-private; no callback reports stage changes | `MigrationExplorer.tsx:25,33` |
| Client health type | `health(): Promise<{ ok: boolean; workspace?: string }>` | `packages/ui/src/client.ts:55-57` |
| Contracts | `CreateAssessmentRequest`, `CreateAssessmentResponse`, `GetAssessmentResponse`, `ApiError`, `API_LIMITS`, `parseCreateAssessmentRequest`; no health or pane types | `packages/contracts/src/index.ts:5-52` |
| Package exports | `MigrationExplorer`, step components, `PoweredBy`, `PARTNERS`, `LabApiClient`, `previewCsv`; `Stage` not exported | `packages/ui/src/index.ts:1-12` |
| UI README | Example `<MigrationExplorer apiBaseUrl="https://migration-api.lab.example.com" />` | `scripts/assemble-packages.mjs:108-111` |
| Plan | Phase 3 says "do not frame a second explorer UI", names `migration-api.lab.hybridcloudworks.com` and `/education/migration-labs`; rate limiting and concurrency are open items here | `WORKING-PLAN.md:79-90` |
| ADR log | ADR-0028 consequence: "Website integration installs `@hybridcloudworks/migration-ui` from npm"; `CLAUDE.md` next ADR 0030 | `docs/adr/ADR-0028-appliance-upstream-web-front-downstream.md:52-53`, `CLAUDE.md:24` |
| README diagram | `W[hybridcloudworks.com]` receives `migration-ui` directly; lab image on GHCR | `README.md:45-52` |
| Appliance use of the package | `apps/appliance-web/src/App.tsx:3,47,112` imports `PoweredBy` and the table components; it does not mount `MigrationExplorer` | cited lines |
| Tests | `ui.test.tsx` renders with `renderToStaticMarkup` only (no DOM, no effects); `contracts.test.ts` covers `parseCreateAssessmentRequest` only | `packages/ui/src/ui.test.tsx:7-13`, `packages/contracts/src/contracts.test.ts:5-29` |

Nothing in this repository can be framed or deployed to the site today, and nothing needs to be: the deployable is downstream. What blocks the downstream pane app is the explorer's required base URL, its vendor copy and its in-frame CTA.

## 3. Target-state summary

```
hybridcloudworks.com /tools/migration (AddOnPanePage, sandboxed <iframe>)
   |  status proxy GET /api/public/addons/migration/status  (Function App, reads /api/health, projects 6 fields)
   v
https://migration.lab.hybridcloudworks.com   (lab host, Caddy, container hcw-addon-migration, port 18081)
   apps/lab-web  (Vite + React pane app)  --mounts-->  <MigrationExplorer apiBaseUrl="" partners={false}
                                                         onStageChange={(s) => reportPaneState(s === "running" ? "working" : "ready")}
                                                         onNavigate={(path) => requestNavigate(path)} />
   apps/lab-api  (same origin /api/*)     --serves-->  AddOnHealth at GET /api/health
            ^ consumes @hybridcloudworks/migration-core and migration-ui at APP_REF = v0.3.0
```

After `v0.3.0`: `MigrationExplorer` renders with no props; the pane app passes `partners={false}`, maps stages onto the pane protocol, and hands the CTA path to the host; `AddOnHealth` is the one definition of the health envelope; ADR-0030 records the model; WORKING-PLAN Phase 3 matches the website change spec.

## 4. Constraints

- No engine, rule, limit, confidence-cap, authorization or edition-boundary change (`CLAUDE.md:17-19`). `packages/azure-*` stay unpublished.
- The assembled core stays dependency-free (`dependencies: {}`, `tests/packaging/assembled-packages.test.mjs:22`, ADR-0002, ADR-0029) and the UI package keeps no runtime import of the core (`assembled-packages.test.mjs:42-44`); React and React DOM stay peers (`:41`). The UI package's two Radix dependencies (`packages/ui/package.json:13-14`) are existing and allowed; this release adds no new runtime dependency to any package.
- Every new prop is optional and additive; `apps/appliance-web` and the downstream harness must compile unchanged.
- `renderToStaticMarkup` tests must not touch `window`; no effect or fetch at module scope (`MigrationExplorer.tsx:27-30`).
- A `packages/*` public-surface change requires `npm run packages:verify` and a PR note (`CLAUDE.md:11-14`).
- Node 26 floor (ADR-0029); ESM-only, Node16 resolution.
- Releases are semver tags `v*`; the downstream adopts through `core-update` against `APP_REF`, never `main`.
- No secrets, tenant ids or real hostnames beyond the agreed `migration.lab.hybridcloudworks.com` and the two site origins.
- Owner-pasteable commands carry no placeholders.

## 5. Architectural issues

1. **The documented site path cannot open.** ADR-0028's npm island depends on a paused npm bootstrap, and the website would refuse it anyway: its CSP closes `connect-src` to its own origin, and its public-copy rule forbids the vendor names in `PARTNERS` (`PoweredBy.tsx:4-5,8`).
2. **The explorer assumes it is the page.** A required absolute `apiBaseUrl` and an in-frame `<a href>` CTA are page assumptions; inside a sandboxed cross-origin frame the CTA would navigate the frame to a site that answers `frame-ancestors 'none'`.
3. **No shared health contract.** The lab API's health shape is defined only by its implementation; the website proxy and the pane app would each re-derive it.
4. **Stage changes are invisible to a host.** The pane protocol needs `working` while an assessment runs; the explorer keeps `stage` private.
5. **Plan drift.** WORKING-PLAN Phase 3, the README diagram and the UI README describe three different integration stories (npm island, `migration-api.lab`, `/education/migration-labs`).

## 6. Required refactoring

| # | Change | Where | Priority |
|---|---|---|---|
| A | Optional, additive explorer props: `apiBaseUrl=""`, `partners`, `cta`, `onStageChange`, `onNavigate`, `contactPath`; `Stage` and `EnterpriseCta` exported | `packages/ui` | P1 |
| B | `AddOnHealth`, `ADDON_HEALTH_FIELDS`, `isAddOnHealth`, `ADDON_PANE_STATES`, `AddOnPaneState`, `AddOnPaneMessage` | `packages/contracts` | P1 |
| C | `LabApiClient.health()` typed on `AddOnHealth` | `packages/ui/src/client.ts` | P1 |
| D | Tests for A, B, C, and the packed-consumer gate extended to use every new export | `ui.test.tsx`, `contracts.test.ts`, `scripts/verify-packed-consumer.mjs` | P1 |
| E | ADR-0030; WORKING-PLAN Phase 3 rewrite; `CLAUDE.md` next ADR 0031 | `docs/adr`, root | P2 |
| F | CHANGELOG 0.3.0, VALIDATION entry, README diagram, editions row, UI README text | root, `docs/product`, `scripts` | P2, P3 |
| G | Version `0.3.0`, tag `v0.3.0` | `package.json`, `package-lock.json` | P1 |
| H | Optional: appliance image to Docker Hub | `.github/workflows/publish-images.yml` | Optional |

## 7. File-by-file implementation instructions

### packages/ui/src/components/MigrationExplorer.tsx

**Current behavior.** `MigrationExplorerProps` (lines 14-23) requires `apiBaseUrl`; `Stage` (line 25) is not exported; the component signature (line 31) defaults only `contactUrl`; `setStage` is called at lines 56, 61, 70, 74 and 92 with no observer; the CTA (lines 112-116) is an `<a href={contactUrl}>`; `<PoweredBy>` renders at line 119 regardless of host.

**Required behavior.** Renders with no props against the same origin; hides the partner panel and the CTA on request; reports every stage change from a client effect; when a host handles navigation the CTA is a button that hands a host-chosen site path to the host and never navigates the frame.

**Exact code-level change.**

```tsx
export type Stage = "upload" | "questions" | "running" | "results";

export interface MigrationExplorerProps {
  /** Base URL of the lab API, never the appliance. Default "" (same origin): the pane app is served by the lab API itself. */
  apiBaseUrl?: string;
  /** Rendered inside the upload step. The pane app that mounts the explorer (downstream apps/lab-web, same origin as the lab API)
   *  owns the Turnstile script, renders the widget into this node with the site key from /api/health, and passes the token via
   *  getTurnstileToken. The website is a cross-origin sandboxed frame host and can inject nothing into the pane. */
  turnstile?: React.ReactNode;
  getTurnstileToken?: () => string | undefined;
  /** Where the enterprise CTA links when no host handles navigation. */
  contactUrl?: string;
  /** Site path handed to onNavigate when the host handles navigation. A literal chosen by the host, never read from the API. */
  contactPath?: string;
  /** Render the partner panel. The HCW site pane passes false: vendor names are not visitor copy there. */
  partners?: boolean;
  /** Render the enterprise CTA on the results stage. */
  cta?: boolean;
  /** Called after every stage change from a client effect; never during server rendering. */
  onStageChange?: (stage: Stage) => void;
  /** When set, the CTA is a button that hands contactPath to the host instead of navigating inside the frame. */
  onNavigate?: (path: string) => void;
  fetchImpl?: typeof fetch;
}

export function MigrationExplorer({ apiBaseUrl = "", turnstile, getTurnstileToken, contactUrl = "https://hybridcloudworks.com/contact", contactPath = "/contact", partners = true, cta = true, onStageChange, onNavigate, fetchImpl }: MigrationExplorerProps) {
  // ... existing state (lines 32-42) unchanged ...
  // Notify on stage transitions only. The callback is read through a ref so an inline handler from the parent
  // (a new function identity on every parent render) never re-fires the effect; the dependency list is [stage] alone.
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;
  useEffect(() => { onStageChangeRef.current?.(stage); }, [stage]);
```

Extend the React import at line 1 to `import { useCallback, useEffect, useMemo, useRef, useState } from "react";`. This effect reports every stage change, including `upload → questions` when a file is chosen; deduplication is the pane's job, not the explorer's. The downstream reporter (`apps/lab-web/src/pane.ts`, `reportPaneState`) posts a message only when the *mapped* state changes, so `upload` and `questions` (both `ready`) produce one `ready`, a run produces `working` then `ready`, and a failed run that returns to `questions` produces exactly one `ready` after `working`. The downstream browser-level check is the AddOn's e2e: the host page records exactly one `hcw-addon` message per mapped transition (`ready` on mount, `working` when the assessment starts, `ready` when results or the error render), never a repeat for a parent rerender or for a stage change that maps to the same state.

Replace lines 105-117 (the `stage === "results" && assessment` fragment) with one element, `{stage === "results" && assessment && <ResultsStage assessment={assessment} expiresAt={expiresAt} files={files} loadFile={(p) => client.file(p)} onDownload={download} onDelete={remove} onOpenWorkspace={workspaceAvailable ? openWorkspace : undefined} workspaceBusy={workspaceBusy} cta={cta} contactUrl={contactUrl} contactPath={contactPath} onNavigate={onNavigate} />}`, and line 119 with `{partners && <PoweredBy compact={stage !== "results"} />}`. `ResultsStage` is the former fragment made an exported, state-free-at-the-boundary component so the results markup can be rendered without driving an upload; it owns the `selected` decision state (moved from the explorer, lines 40 and 108-109) and renders `{cta && <EnterpriseCta contactUrl={contactUrl} contactPath={contactPath} onNavigate={onNavigate} />}` where the CTA section stood:

```tsx
export interface ResultsStageProps {
  assessment: Assessment; expiresAt: string | null; files: string[]; loadFile: (path: string) => Promise<string>;
  onDownload: () => void; onDelete: () => void; onOpenWorkspace?: () => void; workspaceBusy?: boolean;
  cta?: boolean; contactUrl: string; contactPath: string; onNavigate?: (path: string) => void;
}
export function ResultsStage({ assessment, expiresAt, files, loadFile, onDownload, onDelete, onOpenWorkspace, workspaceBusy, cta = true, contactUrl, contactPath, onNavigate }: ResultsStageProps) {
  const [selected, setSelected] = useState<ResourceDecisionRecord | null>(null);
  return (
    <>
      <SummaryPanel summary={assessment.summary} expiresAt={expiresAt} onDownload={onDownload} onDelete={onDelete} onOpenWorkspace={onOpenWorkspace} workspaceBusy={workspaceBusy} />
      <DecisionTable decisions={assessment.decisions} onSelect={setSelected} />
      <DecisionDetail decision={selected} onClose={() => setSelected(null)} />
      <WavePlanView plan={assessment.wavePlan} decisions={assessment.decisions} />
      <GeneratedFiles files={files} load={loadFile} />
      {cta && <EnterpriseCta contactUrl={contactUrl} contactPath={contactPath} onNavigate={onNavigate} />}
    </>
  );
}
```

Add the exported CTA component in the same file (the copy at lines 113-114 is kept verbatim):

```tsx
export interface EnterpriseCtaProps { contactUrl: string; contactPath: string; onNavigate?: (path: string) => void }

export function EnterpriseCta({ contactUrl, contactPath, onNavigate }: EnterpriseCtaProps) {
  const cls = "mt-3 inline-block rounded-lg bg-sky-700 px-4 py-2 text-white";
  return (
    <section className="rounded-xl border p-6 text-center">
      <h2 className="text-lg font-semibold">Need an assessment you can act on?</h2>
      <p className="text-sm">The <strong>Azure Migration Orchestrator</strong> appliance connects read-only to your tenant with Microsoft Entra ID, validates every rule against live configuration, and carries each resource through approval-gated migration waves.</p>
      {onNavigate
        ? <button type="button" className={cls} onClick={() => onNavigate(contactPath)}>Talk to Hybrid Cloud Works</button>
        : <a className={cls} href={contactUrl}>Talk to Hybrid Cloud Works</a>}
    </section>
  );
}
```

Line 101 (`sampleUrl={`${apiBaseUrl}/api/sample.csv`}`) is unchanged: with the default it yields `/api/sample.csv`. The `client` memo (line 32) is unchanged: `LabApiClient` strips a trailing slash and prefixes paths, so `baseUrl: ""` is same-origin. Update the comment at line 15 to drop `labs-api.hybridcloudworks.com`, and replace the comment at line 17 (which says "the host site owns the Turnstile script") with the `turnstile` doc comment above: the owner of the widget, script and token is the pane app that mounts the explorer, not the site.

**Components/functions affected.** `MigrationExplorer`, new `ResultsStage` and `EnterpriseCta`, `Stage` (now exported). `UploadStep`: the doc comment on `UploadStepProps.turnstile` (`packages/ui/src/components/UploadStep.tsx:8`, "rendered by the host site") becomes "rendered by whoever mounts the explorer: the AddOn's pane app, which owns the widget script and token (ADR-0030)"; no code change. `SummaryPanel`, `LabApiClient` unchanged.

**Tests** (`packages/ui/src/ui.test.tsx`):
- `MigrationExplorer renders with no props and points the sample link at the same origin`
- `MigrationExplorer renders the partner panel by default`
- `MigrationExplorer with partners={false} renders no partner name and no "Powered by"`
- `MigrationExplorer calls no stage callback during server rendering`
- `ResultsStage renders the enterprise CTA by default` (`renderToStaticMarkup(<ResultsStage assessment={RESULTS_FIXTURE} expiresAt={null} files={[]} loadFile={async () => ""} onDownload={() => {}} onDelete={() => {}} contactUrl="https://hybridcloudworks.com/contact" contactPath="/contact" />)` contains "Talk to Hybrid Cloud Works")
- `ResultsStage with cta={false} renders no enterprise CTA` (same render with `cta={false}` contains neither "Talk to Hybrid Cloud Works" nor "Need an assessment you can act on?"); `RESULTS_FIXTURE` is a minimal `Assessment` (the type the explorer already holds in state, from `@amo/domain`) built in the test file from the existing `AssessmentSummary` and `ResourceDecisionRecord` fixtures
- `EnterpriseCta renders a button and no href when a host handles navigation`
- `EnterpriseCta renders an in-frame link when no host handles navigation`

**Acceptance criteria.** `renderToStaticMarkup(<MigrationExplorer />)` contains `href="/api/sample.csv"` and "Powered by"; with `partners={false}` it contains none of `PARTNERS[*].name`; `ResultsStage` with `cta={false}` renders no CTA markup and with the default renders it (the explorer passes its `cta` prop straight through, so the two tests cover the gate at the only stage where it is visible); the AddOn's e2e additionally asserts the CTA is present on the results stage of the real journey; the existing first test (line 7-13) still passes with its explicit `apiBaseUrl`; `tsc -b` passes for `apps/appliance-web`.

**Priority.** P1. **Dependencies.** None inbound; `packages/ui/src/index.ts` exports (below). **Rollback.** Revert the file; every prop is optional, so no caller breaks in either direction.

### packages/ui/src/index.ts

**Current behavior.** Lines 1-12 export the components, `PoweredBy`, `PARTNERS`, `LabApiClient`, `previewCsv`; `MigrationExplorerProps` and `Stage` are not exported.

**Required behavior.** Export the new public types and the CTA so the pane app can type its stage mapping and the appliance can reuse the CTA.

**Exact code-level change.** Replace line 1 with:

```ts
export { MigrationExplorer, EnterpriseCta, type MigrationExplorerProps, type EnterpriseCtaProps, type Stage } from "./components/MigrationExplorer.js";
```

and line 11 with:

```ts
export { LabApiClient, type LabApiClientOptions, type MigrationAddOnHealth } from "./client.js";
```

**Components/functions affected.** Package entry only. **Tests.** Covered by the type-level use `const s: Stage = "upload"` in `ui.test.tsx` and by the strict consumer in `scripts/verify-packed-consumer.mjs` once it is extended (next subsection). **Acceptance criteria.** `npm run packages:verify` passes; `dist-packages/migration-ui/dist/index.d.ts` names `Stage` and `MigrationAddOnHealth`. **Priority.** P1. **Dependencies.** The explorer and client changes. **Rollback.** Revert with them.

### scripts/verify-packed-consumer.mjs

**Current behavior.** The clean-consumer gate packs both packages, installs them from tarballs, runs an assessment (lines 34-50) and type-checks a strict consumer (lines 53-65) that imports `MigrationExplorer`, `Orchestrator`, `CreateAssessmentRequest`, `ResourceDecisionRecord` and `MigrationIntent` only. It would pass even if the new exports were missing from the packed declarations.

**Required behavior.** The strict consumer uses every new public name, so `npm run packages:verify` is proof that the packed `.d.ts` files carry them and that the `@amo/contracts` type reference in `client.ts` was rewritten to `@hybridcloudworks/migration-core/contracts`.

**Exact code-level change.** Replace the `consumer.ts` template at lines 53-63 with:

```ts
import type { ResourceDecisionRecord, MigrationIntent } from "@hybridcloudworks/migration-core/domain";
import type { CreateAssessmentRequest, AddOnHealth, AddOnPaneMessage, AddOnPaneState } from "@hybridcloudworks/migration-core/contracts";
import { ADDON_HEALTH_FIELDS, ADDON_PANE_STATES, isAddOnHealth } from "@hybridcloudworks/migration-core/contracts";
import { Orchestrator } from "@hybridcloudworks/migration-core/agents";
import { MigrationExplorer, EnterpriseCta, LabApiClient, type MigrationExplorerProps, type EnterpriseCtaProps, type Stage, type MigrationAddOnHealth } from "@hybridcloudworks/migration-ui";
const intent: Partial<MigrationIntent> = { destinationRegion: "westus3" };
const req: CreateAssessmentRequest = { csv: "a,b", intent };
const o: Orchestrator = new Orchestrator({ edition: "demo" });
const pick = (d: ResourceDecisionRecord) => d.disposition;
const stage: Stage = "upload";
const paneState: AddOnPaneState = ADDON_PANE_STATES[0];
const message: AddOnPaneMessage = { type: "hcw-addon", id: "migration", state: paneState };
const props: MigrationExplorerProps = { apiBaseUrl: "", partners: false, cta: true, contactPath: "/contact", onStageChange: (s: Stage) => void s, onNavigate: (p: string) => void p };
const ctaProps: EnterpriseCtaProps = { contactUrl: "https://hybridcloudworks.com/contact", contactPath: "/contact" };
const fields: readonly string[] = ADDON_HEALTH_FIELDS;
const check = (x: unknown): x is AddOnHealth => isAddOnHealth(x);
const health = (): Promise<MigrationAddOnHealth> => new LabApiClient({ baseUrl: "" }).health();
export { req, o, pick, stage, message, props, ctaProps, fields, check, health, MigrationExplorer, EnterpriseCta };
```

Add to the runtime check at line 46: `if (typeof ui.EnterpriseCta !== "function") throw new Error("EnterpriseCta missing from the UI package");` and, beside the `API_LIMITS` import at line 39, `import { isAddOnHealth } from "@hybridcloudworks/migration-core/contracts";` with `if (isAddOnHealth({}) !== false) throw new Error("isAddOnHealth broken");`.

**Components/functions affected.** The gate script only; `tests/packaging` unchanged. **Tests.** The script is the test; CI job `packed-consumer` runs it. **Acceptance criteria.** `npm run packages:verify` prints `packed-consumer verification passed`; removing any new export from `index.ts` makes it fail. **Priority.** P1. **Dependencies.** The `packages/ui` and `packages/contracts` changes. **Rollback.** Revert with them.

### packages/ui/src/components/PoweredBy.tsx

**Current behavior.** `PARTNERS` (lines 2-10) names Microsoft Azure, Hostinger, Cloudflare, HashiCorp Terraform, GitHub, Coder and Docker with role sentences; `PoweredBy` (lines 12-26) renders them under `aria-label="Powered by"`. Used by `apps/appliance-web/src/App.tsx:47,112`.

**Required behavior.** No content change. The panel must not render in the HCW site pane: the website's public-copy rule forbids the host, edge, human-verification and workspace vendor names on anything a visitor can read, on either side of the frame. The explorer's `partners` prop is the switch; the downstream pane app passes `false`. The Hostinger and Cloudflare role sentences (lines 4-5) also describe the retired tunnel model; leave them for the appliance and revisit when the panel moves.

**Exact code-level change.** Add one comment line above line 2: `/** Not rendered in the HCW site pane (MigrationExplorer partners={false}); the appliance web shows it. */`. Nothing else.

**Components/functions affected.** None. **Tests.** Existing `PoweredBy lists every partner with an honest role statement` (`ui.test.tsx:15-19`) stays as is. **Acceptance criteria.** Appliance web still renders it; `partners={false}` test passes. **Priority.** P3 (comment only). **Dependencies.** None. **Rollback.** None needed.

Recommendation for a later release: move `PoweredBy` and `PARTNERS` out of `packages/ui` into `apps/appliance-web`, where their only remaining consumer lives, and drop them from the published package (a major change for the package; see section 22).

### packages/ui/src/client.ts

**Current behavior.** `health()` at lines 55-57 returns `Promise<{ ok: boolean; workspace?: string }>`; the explorer reads only `workspace` (`MigrationExplorer.tsx:45`).

**Required behavior.** The return type names the shared envelope plus the migration AddOn's extras, so the pane app gets `turnstile.siteKey` and `siteOrigins` typed from the same client.

**Exact code-level change.** Replace the existing line 1 import with this one (it adds `AddOnHealth` to the four types already imported; never insert a second import of `@amo/contracts`), then replace lines 55-57:

```ts
import type { AddOnHealth, ApiError, CreateAssessmentRequest, CreateAssessmentResponse, GetAssessmentResponse } from "@amo/contracts";

/** The migration AddOn's health: the shared envelope plus its own extras. Not validated here; call isAddOnHealth when the shape matters. */
export type MigrationAddOnHealth = AddOnHealth & { workspace?: string; rulesLoaded?: number; azureConnectivity?: string };

async health(): Promise<MigrationAddOnHealth> {
  return this.call("/api/health");
}
```

Export `MigrationAddOnHealth` from `index.ts` beside `LabApiClientOptions`. The `@amo/contracts` import is types-only, so the assembled package keeps "no runtime core import" (`assembled-packages.test.mjs:42-44`); `assemble-packages.mjs:90` rewrites the specifier to `@hybridcloudworks/migration-core/contracts` in the `.d.ts`.

**Components/functions affected.** `LabApiClient.health`. **Tests.** `LabApiClient.health returns the body as the typed envelope` (fake fetch returning a full `AddOnHealth` body; assert `turnstile.siteKey` and `siteOrigins` come through untouched). **Acceptance criteria.** `tsc -b` passes; packed consumer type-checks. **Priority.** P1. **Dependencies.** `AddOnHealth` in contracts. **Rollback.** Revert to the two-field type; callers that only read `workspace` are unaffected.

### packages/ui/src/ui.test.tsx

**Current behavior.** Five tests, all through `renderToStaticMarkup` (no DOM, no effects, no events); the first test (lines 7-13) asserts "Powered by" and the absolute sample URL.

**Required behavior.** Cover the new props at the markup level. Effects and click handlers do not run under static rendering; the stage sequence and the `navigate` message are observed by the downstream e2e (section 21), and `VALIDATION.md` says so.

**Exact code-level change.** The existing import at line 4 already brings in `MigrationExplorer`, `PoweredBy`, `PARTNERS`, `previewCsv`, `LabApiClient`, `SummaryPanel` and `DecisionTable`; extend that one line by adding `EnterpriseCta` and `type Stage` to its braces (do not add a second import of `./index.js`), keep the existing five tests, and append only these test declarations:

```tsx
test("MigrationExplorer renders with no props and points the sample link at the same origin", () => {
  const html = renderToStaticMarkup(<MigrationExplorer />);
  assert.ok(html.includes('href="/api/sample.csv"'));
});
test("MigrationExplorer renders the partner panel by default", () => {
  assert.ok(renderToStaticMarkup(<MigrationExplorer />).includes("Powered by"));
});
test('MigrationExplorer with partners={false} renders no partner name and no "Powered by"', () => {
  const html = renderToStaticMarkup(<MigrationExplorer partners={false} />);
  assert.ok(!html.includes("Powered by"));
  for (const p of PARTNERS) assert.ok(!html.includes(p.name), p.name);
});
test("MigrationExplorer calls no stage callback during server rendering", () => {
  const seen: Stage[] = [];
  renderToStaticMarkup(<MigrationExplorer onStageChange={(s) => seen.push(s)} onNavigate={() => {}} />);
  assert.deepEqual(seen, []);
});
test("EnterpriseCta renders a button and no href when a host handles navigation", () => {
  const html = renderToStaticMarkup(<EnterpriseCta contactUrl="https://hybridcloudworks.com/contact" contactPath="/contact" onNavigate={() => {}} />);
  assert.ok(html.includes("<button") && !html.includes("href="));
});
test("EnterpriseCta renders an in-frame link when no host handles navigation", () => {
  const html = renderToStaticMarkup(<EnterpriseCta contactUrl="https://hybridcloudworks.com/contact" contactPath="/contact" />);
  assert.ok(html.includes('href="https://hybridcloudworks.com/contact"') && !html.includes("<button"));
});
```

**Tests.** The six above plus the `health()` test under `client.ts`. **Acceptance criteria.** `npm test` passes with the previous count plus seven. **Priority.** P1. **Dependencies.** The explorer and index changes. **Rollback.** Revert with them.

### packages/contracts/src/index.ts

**Current behavior.** Lines 5-52: request and response types, `ApiError`, `API_LIMITS`, `parseCreateAssessmentRequest`. No health or pane type.

**Required behavior.** Define the envelope every HCW AddOn serves at `GET /api/health` (flat: `id` and `version` at the top level, never nested), the ordered field list, a structural type guard, and the pane message shape with its four states.

**Exact code-level change.** Append:

```ts
/** Health envelope every HCW AddOn serves at GET /api/health (HCW AddOn Integration Standard section 11). Flat: id and version at the top level. */
export interface AddOnHealth {
  ok: boolean;
  id: string;
  version: string;
  edition: string;
  capabilities: string[];
  asOf: string;
  /** Site origins the pane may post hcw-addon messages to; from the AddOn's environment, never from the image. */
  siteOrigins: string[];
  turnstile: { required: boolean; siteKey: string | null };
}

export const ADDON_HEALTH_FIELDS = ["ok", "id", "version", "edition", "capabilities", "asOf", "siteOrigins", "turnstile"] as const;

/** Structural guard; the website's proxy applies its own projection and length limits on top. */
export function isAddOnHealth(x: unknown): x is AddOnHealth {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
  const t = h.turnstile;
  if (!t || typeof t !== "object") return false;
  const { required, siteKey } = t as Record<string, unknown>;
  if (typeof required !== "boolean" || !(siteKey === null || typeof siteKey === "string")) return false;
  // Invariant: a pane cannot initialise the widget without a key, so required implies a non-empty site key.
  if (required && !siteKey) return false;
  return typeof h.ok === "boolean" && typeof h.id === "string" && typeof h.version === "string" && typeof h.edition === "string"
    && strings(h.capabilities) && typeof h.asOf === "string" && strings(h.siteOrigins);
}

/** Pane protocol (standard section 8): AddOn to site only, one shape, four states. */
export const ADDON_PANE_STATES = ["loading", "ready", "working", "unavailable"] as const;
export type AddOnPaneState = (typeof ADDON_PANE_STATES)[number];
export interface AddOnPaneMessage {
  type: "hcw-addon";
  id: string;
  state: AddOnPaneState;
  /** A site path from the website's allow-list; honoured only when the catalogue row grants `navigate`. */
  navigate?: string;
}
```

**Components/functions affected.** New exports only; `parseCreateAssessmentRequest` unchanged.

**Tests** (`packages/contracts/src/contracts.test.ts`):
- `isAddOnHealth accepts the documented flat envelope with extras`
- `isAddOnHealth accepts a not-required turnstile block with a null site key`
- `isAddOnHealth rejects turnstile required without a site key`
- `isAddOnHealth rejects a nested addon envelope`
- `isAddOnHealth rejects a missing turnstile block and a non-string site origin`
- `ADDON_HEALTH_FIELDS names exactly the eight required fields in order`
- `ADDON_PANE_STATES is loading, ready, working, unavailable`

**Acceptance criteria.** Tests pass; `dist-packages/migration-core/dist/contracts/index.d.ts` carries the new names; `npm run packages:verify` passes. **Priority.** P1. **Dependencies.** None. **Rollback.** Remove the block; nothing in this repository calls it at runtime.

### packages/contracts/src/contracts.test.ts

**Current behavior.** Five tests on `parseCreateAssessmentRequest` (lines 5-29).

**Exact code-level change.** Line 3 already imports `parseCreateAssessmentRequest` from `./index.js`; extend that line to `import { ADDON_HEALTH_FIELDS, ADDON_PANE_STATES, isAddOnHealth, parseCreateAssessmentRequest } from "./index.js";` (no second import), keep the existing five tests, and append only the fixture and tests below. The site key is Cloudflare's documented always-passes test key, a public value, not a secret:

```ts
const health = { ok: true, id: "migration", version: "0.3.0", edition: "demo", capabilities: ["assessments", "sample-csv", "bundle-download"], asOf: "2026-10-10T00:00:00.000Z", siteOrigins: ["https://hybridcloudworks.com", "https://www.hybridcloudworks.com"], turnstile: { required: true, siteKey: "1x00000000000000000000AA" }, rulesLoaded: 35, azureConnectivity: "disabled-by-design" };

test("isAddOnHealth accepts the documented flat envelope with extras", () => { assert.equal(isAddOnHealth(health), true); });
test("isAddOnHealth accepts a not-required turnstile block with a null site key", () => {
  assert.equal(isAddOnHealth({ ...health, turnstile: { required: false, siteKey: null } }), true);
});
test("isAddOnHealth rejects turnstile required without a site key", () => {
  assert.equal(isAddOnHealth({ ...health, turnstile: { required: true, siteKey: null } }), false);
  assert.equal(isAddOnHealth({ ...health, turnstile: { required: true, siteKey: "" } }), false);
});
test("isAddOnHealth rejects a nested addon envelope", () => {
  const { id, version, ...rest } = health;
  assert.equal(isAddOnHealth({ ...rest, addon: { id, version } }), false);
});
test("isAddOnHealth rejects a missing turnstile block and a non-string site origin", () => {
  assert.equal(isAddOnHealth({ ...health, turnstile: undefined }), false);
  assert.equal(isAddOnHealth({ ...health, siteOrigins: [1] }), false);
});
test("ADDON_HEALTH_FIELDS names exactly the eight required fields in order", () => {
  assert.deepEqual([...ADDON_HEALTH_FIELDS], ["ok", "id", "version", "edition", "capabilities", "asOf", "siteOrigins", "turnstile"]);
});
test("ADDON_PANE_STATES is loading, ready, working, unavailable", () => {
  assert.deepEqual([...ADDON_PANE_STATES], ["loading", "ready", "working", "unavailable"]);
});
```

**Priority.** P1. **Dependencies.** The contracts change. **Rollback.** Revert with it.

### scripts/assemble-packages.mjs

**Current behavior.** Lines 104-116 write the UI README with `<MigrationExplorer apiBaseUrl="https://migration-api.lab.example.com" />` (line 110), a hostname shape the program retired.

**Required behavior.** The example shows the same-origin default and names the pane props. No structural change: `CORE`, `NEVER_PUBLISHED`, the exports map and the rewrite rules stay as they are.

**Exact code-level change.** Replace lines 108-111 with:

````
\`\`\`jsx
import { MigrationExplorer } from "${UI_NAME}";
// Same origin (apiBaseUrl defaults to ""): mount it from the page the lab API serves. Inside a host's sandboxed pane,
// pass partners={false}, onStageChange to report "working" while an assessment runs, and onNavigate so the
// enterprise CTA hands a site path to the host instead of navigating the frame.
<MigrationExplorer />
\`\`\`
````

**Components/functions affected.** README text only. **Tests.** `tests/packaging/assembled-packages.test.mjs` unchanged. **Acceptance criteria.** `npm run build` writes the new README; `grep -c "migration-api.lab" dist-packages/migration-ui/README.md` prints `0`. **Priority.** P3. **Dependencies.** None. **Rollback.** Revert the text.

### docs/adr/ADR-0030-web-front-edition-runs-as-a-site-pane.md

**Current behavior.** Does not exist; `CLAUDE.md:24` reserves 0030.

**Required behavior.** Record the pane model in the house style of ADR-0028 and ADR-0029 (Status, Date, Context, Decision, Consequences). It supersedes ADR-0028's consequence that the website installs the UI package from npm (`ADR-0028:52-53`) and the WORKING-PLAN Phase 3 line "do not frame a second explorer UI" (`WORKING-PLAN.md:81`).

**Exact content.** Create the file with this text:

```markdown
# ADR-0030: The web-front edition runs as a site pane

**Status:** Accepted · **Date:** 2026-10-10 · **Supersedes the "website installs the UI package from npm" consequence of ADR-0028 and the WORKING-PLAN Phase 3 line "do not frame a second explorer UI"**

## Context

ADR-0028 made this repository the upstream product and left the website's integration path as an npm island: the site
would install `@hybridcloudworks/migration-ui` at an exact version once the packages were published. That path has not
opened. npm publication is paused by the owner (`docs/release/npm-publishing.md`), and the website's own rules would
refuse the island even when it resumes: its content security policy closes `connect-src` to its own origin, so an
embedded explorer could not reach a lab API on another host; its public-copy rule forbids vendor names on public pages,
which the explorer's partner panel carries; and an island ties the site's deploy to this repository's release cadence.

The website already runs independently deployed tools as sandboxed panes (its Coder labs): a catalogue row, a
`frame-src` entry, a server-side status proxy and a lab host behind Caddy. On 2026-10-09 the owner generalised that
model for every HCW AddOn (website ADR 0035 and the HCW AddOn Integration Standard) and rejected the npm island. The
downstream edition `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` therefore needs a pane app of its own that mounts
`MigrationExplorer`, and the explorer must be mountable inside a frame: same-origin API by default, no partner copy,
stage events for the pane protocol, and host-mediated navigation, because the site's `frame-ancestors 'none'` blocks
in-frame links back to the site.

## Decision

1. The web-front edition is a separately deployed web application at `https://migration.lab.hybridcloudworks.com`,
   framed by the site at `/tools/migration`. The downstream repository owns the pane app (`apps/lab-web`), the pane
   protocol implementation, the lab API's framing headers, rate limiting and concurrency, the container image
   (`docker.io/hybridcloudworks/hcw-addon-migration`, pinned by digest on the website's lab host) and the
   website-integration docs. The website owns the catalogue row, the page, the CSP entry, the status proxy and the
   Ansible `addons` role.
2. This repository makes `MigrationExplorer` pane-ready with optional, additive props: `apiBaseUrl` (default `""`),
   `partners`, `cta`, `onStageChange`, `onNavigate`, `contactPath`; it exports `Stage` and `EnterpriseCta`. Engine,
   rules, limits, the confidence cap and the edition boundary do not change.
3. The contract shared by the AddOn and the website's status proxy lives in `packages/contracts`: `AddOnHealth` (flat
   envelope `ok, id, version, edition, capabilities, asOf, siteOrigins, turnstile`), `ADDON_HEALTH_FIELDS`,
   `isAddOnHealth`, `ADDON_PANE_STATES`, `AddOnPaneState`, `AddOnPaneMessage`. The AddOn serves it; this repository
   defines it; the website reads only its six-field projection.
4. The partner panel (`PoweredBy`) stays in the package for the appliance web and the default explorer and is never
   rendered in the site pane (`partners={false}`).
5. npm publication of the two packages becomes optional for the website path. It remains the intended distribution
   for third-party consumers and the long-term replacement of the `file:` link (ADR-0028, item 4), but nothing on
   hybridcloudworks.com waits on it.

## Consequences

- The site's deploy and this repository's release cadence are decoupled: a new explorer reaches visitors when the AddOn
  adopts the release through `core-update`, tags, and the website moves one image digest.
- `MigrationExplorer` renders with no props; every existing caller (`apps/appliance-web`, the downstream harness)
  keeps working unchanged.
- The pane protocol and the health envelope are versioned by the website's standard; a breaking change to either is a
  new revision there and a major version here.
- WORKING-PLAN Phase 3 is rewritten: route `/tools/migration`, hostname `migration.lab.hybridcloudworks.com`, hosting
  by the website's `addons` role, rate limiting and concurrency delivered downstream, npm publication optional.
- `edition` stays `demo` in the lab API's health; the site's proxy treats the string as opaque.
- Next ADR number: 0031.
```

**Tests.** None (documentation). **Acceptance criteria.** File exists with the five sections; `CLAUDE.md` says 0031. **Priority.** P2. **Dependencies.** None. **Rollback.** Mark Status "Superseded" rather than deleting; ADR numbers are never reused.

### WORKING-PLAN.md (Phase 3)

**Current behavior.** Lines 77-90 describe the npm island (`/education/migration-labs`, "do not frame a second explorer UI", `migration-api.lab.hybridcloudworks.com`, a Caddy `/api/*` route) and carry the rate-limit and concurrency items (line 87) as this repository's work. Line 28 of the hosting table says "Website pages and embedded React explorer"; lines 31-32 say GHCR.

**Required behavior.** Phase 3 describes the pane model and matches the website change spec; downstream work is named as downstream.

**Exact code-level change.** Replace lines 77-90 with this text verbatim:

```markdown
## Phase 3: show the explorer on the website as a pane, hosted on the existing lab host (ADR-0030)

- [ ] Ship `v0.3.0` with the pane-ready `MigrationExplorer` props, the `AddOnHealth` contract and ADR-0030 (`REFACTOR_APP.md` section 7).
- [ ] Downstream adoption: the AddOn's `core-update` workflow bumps `APP_REF` to `v0.3.0`; its pane app `_Addon/apps/lab-web` mounts `<MigrationExplorer apiBaseUrl="" partners={false} onStageChange={(s) => reportPaneState(s === "running" ? "working" : "ready")} onNavigate={(path) => requestNavigate(path)} contactPath="/contact" />`, owns the Turnstile widget (rendered into the `turnstile` node with the site key from `/api/health`, token passed through `getTurnstileToken`), and posts `hcw-addon` messages (`loading`, `ready`, `working`, `unavailable`) to the origins in `/api/health.siteOrigins`.
- [ ] Website route `/tools/migration` renders the generic `AddOnPanePage` for the catalogue row `migration`. The site never installs the UI package; it frames the AddOn.
- [ ] Hostname `migration.lab.hybridcloudworks.com` under the existing `*.lab` wildcard DNS and certificate; no DNS or certificate change.
- [ ] Image `docker.io/hybridcloudworks/hcw-addon-migration`, published by the AddOn's `publish-images.yml` after the scan gate, pinned by digest in the website's `lab-host/ansible/group_vars/all.yml`.
- [ ] Hosting by the website's `addons` Ansible role: loopback port 18081, hardened `docker_container` (non-root, read-only, capabilities dropped, memory and pids limits, bounded logs, no socket), Caddy route with the site-only `frame-ancestors`, health wait, rollback by the previous digest.
- [ ] Turnstile on uploads with the site key published by `/api/health`; the exact-origin CORS list may be empty because the pane is same-origin with its API.
- [ ] 5 MB/5,000-row limits, owner-token isolation, 120-minute TTL, bounded memory storage and explicit deletion preserved (unchanged upstream and downstream).
- [ ] Rate limiting and bounded assessment concurrency: moved downstream to `_Addon/apps/lab-api` (`429 rate_limited`, `503 overloaded`, both with `Retry-After`) and done there; nothing in this repository.
- [ ] Telemetry and Coder workspace creation off; upload processing, expiry and restart deletion stated in the pane beside the upload control.
- [ ] Host secrets through the website's vault (`vault_addon_migration_turnstile_secret`); public values in `group_vars`; nothing in Vite bundles, Git, Terraform state or logs.
- [ ] npm publication of `@hybridcloudworks/migration-core` and `@hybridcloudworks/migration-ui` is optional for this phase; the `file:` link and `APP_REF` stay the contract until the owner resumes the bootstrap.
```

Also: line 28 becomes `| Website page `/tools/migration` framing the downstream pane | Existing Azure Static Web Apps website | Website repository |`; line 31 becomes `| Lab image | Docker Hub `docker.io/hybridcloudworks/hcw-addon-migration`, by digest | Versioned releases from `_Addon` |`; line 4 gains `Updated: 2026-10-10 (ADR-0030, pane model)`.

**Tests.** None. **Acceptance criteria.** Phase 3 names `/tools/migration`, `migration.lab.hybridcloudworks.com`, the image, the role, `apps/lab-web`; no line says "do not frame". **Priority.** P2. **Dependencies.** ADR-0030. **Rollback.** Revert the hunk.

### README.md

**Current behavior.** The Mermaid diagram (lines 31-54) has `W[hybridcloudworks.com]` (line 45), `U -- "@hybridcloudworks/migration-ui" --> W` (line 47), `H[Harness + Playwright e2e]` (line 43), `L -- "lab image (GHCR)" --> V[(Hostinger VPS)]` (line 51) and `W -- "/api/*" --> L` (line 52).

**Required behavior.** The node label says the site frames the pane; the UI package flows to the downstream pane app, not to the site.

**Exact code-level change.** Line 45: `W["hybridcloudworks.com /tools/migration (pane)"]`. Line 43: `H[Pane app apps/lab-web + Playwright e2e]`. Delete line 47. Line 51: `L -- "lab image (Docker Hub, by digest)" --> V[(lab host)]`. Line 52: `W -- "sandboxed frame, same-origin /api/*" --> L`. Line 59 (Addon row): "CSV lab API and the pane framed at hybridcloudworks.com/tools/migration".

**Tests.** None. **Acceptance criteria.** Diagram renders; no edge from `U` to `W`. **Priority.** P3. **Dependencies.** None. **Rollback.** Revert.

### CHANGELOG.md

**Current behavior.** `## Unreleased` at line 5 holds the README rewrite entry (line 7). Line 3 carries a stale split header that says this repository is `_Addon` (the owner may correct it in the same edit; optional).

**Exact code-level change.** Insert directly under line 5, before the existing bullet:

```markdown
### 0.3.0 (unreleased): the web-front edition runs as a site pane (ADR-0030)

- `packages/ui`: `MigrationExplorer` is pane-ready. `apiBaseUrl` is optional and defaults to `""` (same origin); new optional props `partners` (default `true`), `cta` (default `true`), `onStageChange`, `onNavigate`, `contactPath`; `Stage`, `MigrationExplorerProps`, `EnterpriseCta` and `MigrationAddOnHealth` exported. With `onNavigate` set the enterprise CTA is a button that hands `contactPath` to the host instead of navigating inside a frame. `LabApiClient.health()` is typed on `AddOnHealth`. **Public surface change:** the downstream edition adopts it through `core-update`.
- `packages/contracts`: `AddOnHealth`, `ADDON_HEALTH_FIELDS`, `isAddOnHealth`, `ADDON_PANE_STATES`, `AddOnPaneState`, `AddOnPaneMessage`: the flat health envelope every HCW AddOn serves at `GET /api/health` and the pane message shape, shared with the website's status proxy.
- ADR-0030 supersedes the ADR-0028 consequence that the website installs the UI package from npm; WORKING-PLAN Phase 3 rewritten for the pane model (`/tools/migration`, `migration.lab.hybridcloudworks.com`, hosting by the website's `addons` role, rate limiting and concurrency downstream, npm publication optional); README diagram updated; `docs/product/editions.md` gains a hosting row; the UI package README shows the same-origin default.
```

At release, rename the heading to `## 0.3.0 (2026-MM-DD, ADR-0030)` with the tag date. **Priority.** P2. **Dependencies.** The code changes. **Rollback.** Revert.

### VALIDATION.md

**Current behavior.** Sections per milestone (`## Node 26 runtime floor (2026-10-04, ADR-0029)` at line 97 is the latest); `## Not implemented` (line 103) says "rate limiting at the API (recommended at Caddy)". Line 3 carries the same stale split header as the changelog.

**Exact code-level change.** Insert before `## Not implemented`:

```markdown
## Pane-ready explorer and AddOn health contract (2026-10-10, ADR-0030, v0.3.0)

- **Executed:** `npm ci`; `npm test` (record the count the run prints: the previous 88 plus the seven new `ui` and seven new `contracts` tests); `npm run rules:validate` (35 rules, snapshot unchanged); `npm run packages:verify` (public surface changed: the packed `migration-ui` declarations carry the new optional props and `Stage`; the strict consumer type-checks); `npm run web:build` (`apps/appliance-web` compiles with the unchanged `PoweredBy` and the new optional props).
- **Not executed here:** the stage callback sequence and the CTA click path. `renderToStaticMarkup` runs no effects and no event handlers, so `ui.test.tsx` asserts markup only (no callback during server rendering; `<button>` versus `<a>`). The sequence `loading, ready, working, ready` and the `navigate` message are observed by the downstream e2e (`_Addon/tests/e2e`, host page with the production sandbox).
- **Limitation:** `LabApiClient.health()`'s type describes AddOn `v0.3.0` and later; against an older lab API the new fields are absent at runtime and the explorer reads only `workspace`.
```

In `## Not implemented`, replace "rate limiting at the API (recommended at Caddy)" with "rate limiting and concurrency bounds (delivered downstream in `_Addon/apps/lab-api`, ADR-0030)". **Priority.** P2. **Dependencies.** The runs in section 20. **Rollback.** Revert.

### CLAUDE.md

**Current behavior.** Line 24: `(next number: 0030)`.

**Exact code-level change.** Line 24: `(next number: 0031)`. **Priority.** P2. **Dependencies.** ADR-0030 committed in the same change. **Rollback.** Revert with the ADR.

### docs/product/editions.md

**Current behavior.** The table (lines 3-11) compares the enterprise and demo editions by input, authentication, authorization, confidence, persistence, output and execution; no hosting row.

**Exact code-level change.** Append after line 11:

```markdown
| Hosting | One Azure Container App, same origin for API and web (appliance image) | Site pane: framed at hybridcloudworks.com/tools/migration from migration.lab.hybridcloudworks.com on the lab host, run by the downstream edition (ADR-0030) |
```

**Priority.** P3. **Dependencies.** None. **Rollback.** Revert.

### package.json and package-lock.json

**Current behavior.** Root `version` is `0.2.1`; `scripts/assemble-packages.mjs:14` stamps the packages with it and `tests/packaging/assembled-packages.test.mjs:15,39` assert equality.

**Exact code-level change.** `npm version 0.3.0 --no-git-tag-version` (updates both files; workspace package versions stay `0.1.0`, as today). Tag `v0.3.0` only after the checks in section 20 pass. **Priority.** P1. **Dependencies.** Everything above merged. **Rollback.** Section 17.

### .github/workflows/publish-images.yml (Optional)

**Current behavior.** Publishes the appliance image to `ghcr.io/<owner>/azure-migration-orchestrator-appliance` (line 14) with `GITHUB_TOKEN` (line 22), scan before push (lines 30-40), provenance and SBOM (lines 41-57), digest in the summary (line 59).

**Required behavior (optional).** The program moved every AddOn image to Docker Hub by digest. Moving the appliance image too keeps one registry convention across both repositories. Not required for `v0.3.0`: the appliance image is not on the site's path.

**Exact code-level change, if taken.** `IMAGE: docker.io/hybridcloudworks/hcw-app-migration-appliance` [VERIFY the image name with the owner]; gate the job with `if: vars.DOCKERHUB_ENABLED == 'true'`; replace the login step with `docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0`, `env: { DOCKERHUB_OIDC_CONNECTIONID: "${{ vars.DOCKERHUB_CONNECTION }}", DOCKERHUB_OIDC_EXPIREIN: "900" }`, `with: { registry: docker.io, username: hybridcloudworks }`; drop `packages: write`. No long-lived registry secret: workload identity through the Docker OIDC connection, as the website's `publish-lab-image.yml` does. Owner steps: create the OIDC connection in Docker Home trusting this repository's tag refs; set the repository variables `DOCKERHUB_CONNECTION` and `DOCKERHUB_ENABLED`. Also update `README.md:49` and `WORKING-PLAN.md:32` if taken.

**Priority.** Optional. **Dependencies.** Owner's Docker Hub connection. **Rollback.** Revert to the GHCR workflow; images already pushed stay where they are.

## 8. Required API changes

None in this repository: no route in `apps/appliance-api` or the lab API changes here. The downstream lab API will serve the shape below at `GET /api/health`; it is documented here only because `packages/contracts` defines it and the website's proxy reads it.

```json
{
  "ok": true,
  "id": "migration",
  "version": "0.3.0",
  "edition": "demo",
  "capabilities": ["assessments", "sample-csv", "bundle-download"],
  "asOf": "2026-10-10T00:00:00.000Z",
  "siteOrigins": ["https://hybridcloudworks.com", "https://www.hybridcloudworks.com"],
  "turnstile": { "required": true, "siteKey": "1x00000000000000000000AA" },
  "rulesLoaded": 35,
  "azureConnectivity": "disabled-by-design",
  "workspace": "disabled"
}
```

Rules: 200 within one second with no upstream dependency; `ok: false` with 503 when the rule corpus failed to load; `id` and `version` flat, never under `addon`; `turnstile.siteKey` is the public widget key (the value above is Cloudflare's documented always-passes test key; production carries the real public site key from `AMO_TURNSTILE_SITE_KEY`) and must be non-empty whenever `required` is true; extras allowed (`rulesLoaded`, `azureConnectivity`, `workspace`) and ignored by the website.

The website's status proxy answers `{ configured, reachable, version, edition, capabilities, asOf }` and derives the two flags itself; neither is in the health body:

| Proxy field | Derivation |
|---|---|
| `configured` | `true` when the Function App setting `ADDON_MIGRATION_URL` is present, resolved and `https:`; otherwise the answer is `{ configured: false }` with no network call |
| `reachable` | `true` when a `GET` of the setting's value followed by `/api/health` returned HTTP 200 with a JSON body whose `ok` is `true`, within 5 seconds, without a redirect; otherwise `false` with `version: null`, `edition: null`, `capabilities: []` |
| `version`, `edition`, `capabilities`, `asOf` | Copied from the health body (`version` must match `^\d+\.\d+\.\d+`; strings capped at 40 characters, at most 20 capabilities) |
| anything else | Never forwarded: not `siteOrigins`, not `turnstile`, not the extras, not the URL |

The response is a discriminated contract with three complete shapes, so a consumer never meets an undocumented missing field:

| Branch | Exact body |
|---|---|
| Not configured | `{ "configured": false }` (no other key; the consumer stops at `configured`) |
| Configured, unreachable | `{ "configured": true, "reachable": false, "version": null, "edition": null, "capabilities": [], "asOf": "<ISO timestamp of the failed read>" }` |
| Configured, reachable | `{ "configured": true, "reachable": true, "version": "0.3.0", "edition": "demo", "capabilities": [...], "asOf": "<ISO timestamp from health>" }` |

The website's `fetchAddonStatus` and the pane page read `configured` first, then `reachable`, and treat any other shape as unreachable.

The appliance's own `/api/health` (`apps/appliance-api/src/index.ts:71`, `edition: "enterprise"`) is unchanged and is never framed.

## 9. Required data contract changes

| Addition | Package | Shape |
|---|---|---|
| `AddOnHealth` | `@amo/contracts` (published as `migration-core/contracts`) | `{ ok, id, version, edition, capabilities, asOf, siteOrigins, turnstile: { required, siteKey } }` |
| `ADDON_HEALTH_FIELDS` | same | the eight keys above, in that order, `as const` |
| `isAddOnHealth(x)` | same | structural type guard |
| `ADDON_PANE_STATES`, `AddOnPaneState` | same | `["loading", "ready", "working", "unavailable"]` |
| `AddOnPaneMessage` | same | `{ type: "hcw-addon", id, state, navigate? }` |
| `MigrationExplorerProps` (widened), `Stage`, `EnterpriseCtaProps`, `MigrationAddOnHealth` | `@amo/ui` (published as `migration-ui`) | section 7 |

All additive. `CreateAssessmentRequest`, `CreateAssessmentResponse`, `GetAssessmentResponse`, `ApiError` and `API_LIMITS` are unchanged.

## 10. Configuration changes

None beyond the contract. No environment variable, app setting or build flag changes in this repository. The `AMO_*` variables that configure the health envelope (`AMO_SITE_ORIGINS`, `AMO_TURNSTILE_SITE_KEY`, `AMO_FRAME_ANCESTORS`) belong to the downstream lab API.

## 11. Dependency changes

None. The zero-runtime-dependency rule (ADR-0002, ADR-0029) holds: `@amo/contracts` keeps `dependencies: { "@amo/domain" }`, `@amo/ui` keeps React as a peer and Radix as its only runtime dependency, and the assembled core keeps `dependencies: {}` (`assembled-packages.test.mjs:22`). No dev dependency is added either: the new tests use `node:test` and `react-dom/server` as the existing ones do.

## 12. Infrastructure changes

None required. The appliance Terraform, `Dockerfile.appliance`, `publish-npm.yml` (still gated on `NPM_TRUSTED_PUBLISHING`), `release-cli.yml` and `rules-refresh.yml` are untouched. Optional: the Docker Hub move of the appliance image (section 7, last subsection).

## 13. Security changes

- No boundary change. `azure-auth`, `azure-arm`, `azure-execution` stay unpublished; `tests/security/appliance-boundary.test.mjs` and `tests/packaging` are unchanged and must stay green.
- `onNavigate` never receives an API-supplied value. Its only argument is `contactPath`, a literal the host passes as a prop (default `"/contact"`). The explorer must not derive a navigation target from any response body, and the website's page honours `navigate` only from its own allow-list.
- `partners={false}` is copy only. It removes vendor names from visitor-visible text; it does not alter requests, headers or data flow.
- `isAddOnHealth` is structural plus one invariant (`turnstile.required` implies a non-empty public `siteKey`, so a pane never runs an unverifiable upload path). It does not trust `siteOrigins` or `siteKey` beyond that; the downstream pane posts only to origins the AddOn's own environment listed, and the website's proxy applies its length and regex limits independently. The site key is public by design; the secret never leaves the lab host's vault.
- The Turnstile widget, script and token are owned by the downstream pane app, same origin as the lab API. The website cannot and does not inject anything into the cross-origin sandboxed frame.
- The CTA button has `type="button"` so it never submits a surrounding form.
- Nothing new reads `window`, storage or the clock during render; the stage effect is client-only.

## 14. Testing requirements

| Command | Why | Required |
|---|---|---|
| `npm test` | Builds everything and runs the unit, golden, packaging and security suites, including the fourteen new tests | Yes |
| `npm run rules:validate` | `CLAUDE.md:11` requires it before claiming anything works, even though rules do not change | Yes |
| `npm run packages:verify` | The public surface of both packages changes (`CLAUDE.md:11-12`); the packed consumer must import `MigrationExplorer` and type-check against the new declarations | Yes |
| `npm run web:build` | `apps/appliance-web` still compiles with the unchanged `PoweredBy` import and the widened props | Yes |
| CI jobs `build-test`, `packed-consumer`, `generated-terraform`, `security` | Must be green on the release head | Yes |
| Downstream e2e (`_Addon`, `npm run e2e`) | The only place the stage sequence and `navigate` are exercised in a browser | After `core-update` adopts `v0.3.0` |

## 15. Migration sequence

1. Branch from `main` at or after `ef4a515`.
2. `packages/contracts`: add the health and pane types and their five tests.
3. `packages/ui`: explorer props, `EnterpriseCta`, `Stage` export, `index.ts`, `client.ts`, seven tests; `scripts/verify-packed-consumer.mjs` strict consumer extended.
4. `scripts/assemble-packages.mjs` README text; `README.md` diagram; `docs/product/editions.md` row.
5. `docs/adr/ADR-0030-web-front-edition-runs-as-a-site-pane.md`; `CLAUDE.md` next number 0031; `WORKING-PLAN.md` Phase 3 and hosting table.
6. `CHANGELOG.md` and `VALIDATION.md` entries.
7. Run section 20; fix until green; record the counts in `VALIDATION.md`.
8. `npm version 0.3.0 --no-git-tag-version`; commit; open one PR, ready for review, stating the public-surface change; work the review bots; merge.
9. Tag `v0.3.0` on `main` and push the tag. `publish-images.yml` and `release-cli.yml` run on the tag; `publish-npm.yml` skips while gated.
10. Downstream: `core-update` detects the release, builds it, runs the AddOn's tests and e2e, and opens the `APP_REF: v0.3.0` bump PR. The AddOn's pane app then replaces its interim CSS hide with `partners={false}` and wires `onStageChange` and `onNavigate`.

## 16. Compatibility considerations

- Every new prop is optional with a default equal to today's behaviour except `apiBaseUrl`, which goes from required to `""`. A caller that passed it keeps passing it; a caller that relied on the compile error for a missing `apiBaseUrl` does not exist (`apps/appliance-web` does not mount the explorer; the downstream harness passes `VITE_LABS_API_URL`).
- `health()`'s return type widens. Callers that read `ok` and `workspace` compile unchanged. Against a lab API older than AddOn `v0.3.0` the new fields are missing at runtime; nothing in this repository dereferences them.
- The `@amo/contracts` type import in `client.ts` is erased at build time; the "no runtime core import" test for the assembled UI package stays satisfied.
- Semver: additive exports and a loosened required prop are a minor bump, hence `0.3.0`. Removing `PoweredBy` from the package later is a major bump.
- `edition` stays `demo` in the lab API; renaming it would be a downstream change and the website treats the string as opaque.

## 17. Rollback considerations

- Code: the props are optional and additive; reverting the `packages/ui` and `packages/contracts` commits breaks no caller in this repository. The downstream pane app would fall back to its interim CSS hide of the partner panel and its own stage handling.
- Release: do not delete the `v0.3.0` tag. Cut `v0.3.1` with the revert, or leave `v0.3.0` and have the downstream keep `APP_REF` at `v0.2.1` (its `core-update` PR is simply not merged). Image and CLI artifacts already published for `v0.3.0` stay immutable.
- After downstream adoption (section 21), the rollback is coordinated, because the pane app then passes `partners`, `cta`, `onStageChange`, `onNavigate` and `contactPath`, which a reverted core rejects at `tsc`. Order: (1) the AddOn stays pinned at `v0.3.0`, which keeps compiling and running; (2) the AddOn reverts its prop wiring in one PR (restoring the interim CSS hide and its own stage handling, the state it shipped in `_Addon` 0.3.0 before adoption) and merges it; (3) only then does its `APP_REF` move to the revert release (`v0.3.1`). The AddOn's `core-update` workflow enforces the order mechanically: its test run against the candidate tag fails at `tsc` while the prop wiring is present, so the bump PR cannot merge first.
- Docs: ADR-0030 is marked Superseded, never deleted; WORKING-PLAN Phase 3 is reverted by hunk.
- Optional Docker Hub move: revert the workflow; GHCR images remain pullable.

## 18. Prioritized implementation backlog

| Pri | Item | Files | Depends on |
|---|---|---|---|
| P1 | Health and pane types with tests | `packages/contracts/src/index.ts`, `contracts.test.ts` | none |
| P1 | Explorer props, `EnterpriseCta`, `Stage` export, `index.ts`, `client.ts`, tests | `packages/ui/src/**` | contracts |
| P1 | Packed-consumer gate uses every new export | `scripts/verify-packed-consumer.mjs` | ui, contracts |
| P1 | Version `0.3.0`, PR, tag | `package.json`, `package-lock.json` | all P1 |
| P2 | ADR-0030, `CLAUDE.md` 0031, WORKING-PLAN Phase 3 | `docs/adr`, root | none |
| P2 | CHANGELOG, VALIDATION entries | root | section 20 runs |
| P3 | UI README text, README diagram, editions row, `PoweredBy` comment | `scripts/assemble-packages.mjs`, `README.md`, `docs/product/editions.md`, `PoweredBy.tsx` | none |
| Optional | Appliance image to Docker Hub | `.github/workflows/publish-images.yml` | owner's OIDC connection |
| Later | Extract `PoweredBy` to `apps/appliance-web` (major) | `packages/ui`, `apps/appliance-web` | section 22 |

## 19. Acceptance criteria

1. `renderToStaticMarkup(<MigrationExplorer />)` renders without props and links the sample at `/api/sample.csv`.
2. With `partners={false}` the markup contains no `PARTNERS[*].name` and no "Powered by"; by default it still does.
3. `EnterpriseCta` with `onNavigate` renders a `<button type="button">` and no `href`; without it, the `<a href={contactUrl}>`.
4. No `onStageChange` call happens during server rendering; the client effect fires once per `stage` transition and not on parent rerenders (observed downstream as one message per transition: `questions`, `running`, `results`).
5. `isAddOnHealth` accepts the flat envelope with extras, rejects the nested `addon` form and rejects `required: true` with a null or empty `siteKey`; `ADDON_HEALTH_FIELDS` and `ADDON_PANE_STATES` match sections 8 and 9.
10. `npm run packages:verify` fails when any of `Stage`, `EnterpriseCta`, `EnterpriseCtaProps`, `MigrationAddOnHealth`, `AddOnHealth`, `isAddOnHealth`, `ADDON_HEALTH_FIELDS`, `ADDON_PANE_STATES` or `AddOnPaneMessage` is missing from the packed declarations.
6. `npm test`, `npm run rules:validate`, `npm run packages:verify` and `npm run web:build` pass; CI green on the release head.
7. ADR-0030 exists in house style; `CLAUDE.md` says next ADR 0031; WORKING-PLAN Phase 3 contains no "do not frame" line and names `/tools/migration`, `migration.lab.hybridcloudworks.com`, `docker.io/hybridcloudworks/hcw-addon-migration`, the `addons` role and `_Addon/apps/lab-web`.
8. `dist-packages/migration-ui/README.md` contains no `migration-api.lab`.
9. Tag `v0.3.0` exists on `main`; the downstream `core-update` PR for `APP_REF: v0.3.0` is labelled `compatible`.

## 20. Validation commands or procedures

Run from the repository root on Node 26 or newer. Each line stops at the first failed check and ends by failing unless the retired hostname is absent from the packed UI README. Success looks like: `npm test` ends with `fail 0`; `rules:validate` prints `35 rules` and no issues; `packages:verify` prints `packed-consumer verification passed`; `web:build` ends with the Vite `built in` line; the last command prints `README clean` and the shell's exit code is `0`. A missing README (the build did not run) is reported as a file-read error, not as a clean result.

PowerShell:

```powershell
$ErrorActionPreference = 'Stop'; npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }; npm test; if ($LASTEXITCODE -ne 0) { throw "npm test failed" }; npm run rules:validate; if ($LASTEXITCODE -ne 0) { throw "rules:validate failed" }; npm run packages:verify; if ($LASTEXITCODE -ne 0) { throw "packages:verify failed" }; npm run web:build; if ($LASTEXITCODE -ne 0) { throw "web:build failed" }; $readme = Get-Content -Raw -Path dist-packages/migration-ui/README.md; $hits = ([regex]::Matches($readme, 'migration-api\.lab')).Count; if ($hits -ne 0) { throw "retired hostname still in the UI README ($hits occurrences)" }; Write-Output "README clean"
```

bash (Git Bash):

```bash
set -euo pipefail && npm ci && npm test && npm run rules:validate && npm run packages:verify && npm run web:build && readme="$(cat dist-packages/migration-ui/README.md)" && hits="$(printf '%s' "$readme" | grep -c 'migration-api\.lab' || true)" && [ "$hits" -eq 0 ] && echo "README clean"
```

Release, after the PR is merged and `main` is checked out (both shells):

```powershell
git checkout main; if ($LASTEXITCODE) { throw "checkout failed" }; git pull; if ($LASTEXITCODE) { throw "pull failed" }; npm version 0.3.0 --no-git-tag-version; if ($LASTEXITCODE) { throw "npm version failed" }; git commit -am "release: v0.3.0 (ADR-0030, pane-ready explorer and AddOn health contract)"; if ($LASTEXITCODE) { throw "commit failed" }; git push origin main; if ($LASTEXITCODE) { throw "push failed" }; git tag v0.3.0; if ($LASTEXITCODE) { throw "tag failed" }; git push origin v0.3.0; if ($LASTEXITCODE) { throw "tag push failed" }
```

Each step stops the line on a non-zero exit code, so a failed checkout or pull never commits, tags or pushes from a stale branch, and a failed push leaves no tag behind (the tag is created only after `main` is pushed). Successful output ends with `* [new tag] v0.3.0 -> v0.3.0`.

```bash
git checkout main && git pull && npm version 0.3.0 --no-git-tag-version && git commit -am "release: v0.3.0 (ADR-0030, pane-ready explorer and AddOn health contract)" && git push origin main && git tag v0.3.0 && git push origin v0.3.0
```

Success: `gh release list` or the Actions page shows `publish-images` and `release-cli` green for `v0.3.0`; within six hours the downstream repository has a `core-update` PR titled with `APP_REF v0.3.0`.

## 21. Dependencies on AddOn work

- The AddOn's pane app (`_Addon/apps/lab-web`, Vite + React, replacing `apps/ui-harness`) consumes the new props: `<MigrationExplorer apiBaseUrl="" turnstile={<div ref={turnstileNode} />} getTurnstileToken={getToken} partners={false} onStageChange={(s) => reportPaneState(s === "running" ? "working" : "ready")} onNavigate={(path) => requestNavigate(path)} contactPath="/contact" />`. The pane app owns the Turnstile script, widget and token (`src/turnstile.ts`: loads the script, renders into the node with `turnstile.siteKey` from `/api/health`, keeps the token in a ref and re-renders on expiry); the website, a cross-origin sandboxed frame host, injects nothing into the pane.
- Until `APP_REF` reaches `v0.3.0`, the AddOn mounts the explorer as it is today and hides `[aria-label="Powered by"]` with CSS (interim, recorded in its `VALIDATION.md`); the CTA stays an in-frame link that the site blocks, so the AddOn also hides it in the interim.
- The AddOn's lab API serves `AddOnHealth` (section 8) and imports `isAddOnHealth` from `@hybridcloudworks/migration-core/contracts` for its own contract test once `v0.3.0` is adopted.
- The AddOn's e2e observes the stage sequence and the `navigate` message that this repository's static tests cannot.
- The AddOn tags its own `v0.3.0` after adoption; its image digest is what the website pins. Nothing in this repository waits on the website.

## 22. Open questions and assumptions

| # | Question | Recommendation |
|---|---|---|
| 1 | Keep `edition: "demo"` in the lab API's health or rename it to `web-front` or `lab`? | Keep `demo`. It is an upstream constant (`Orchestrator({ edition: "demo" })`, the confidence cap and `DEMO-NOT-FOR-PRODUCTION.md` key on it), the website's proxy treats the string as opaque, and the two Python AddOns reporting `lab` does not require parity. Revisit only with a major release. |
| 2 | Move `PoweredBy` and `PARTNERS` out of `MigrationExplorer` and out of the package into `apps/appliance-web`? | Yes, later. The appliance web is the only remaining consumer; removing a published export is a major bump, so do it at `v1.0.0` or the next major, not in `v0.3.0`. The `partners` prop stays meanwhile. |
| 3 | A separate Turnstile widget for the AddOn, or reuse the site's? | Separate (owner decision, [REVIEW REQUIRED]). The widget is bound to the AddOn's hostname, the secret's boundary is the lab host's vault (`vault_addon_migration_turnstile_secret`) and rotation stays independent of the site's. Nothing in this repository changes either way; the explorer only passes the token it is given. |
| 4 | Should `/api/health` publish `siteOrigins` for the pane's `postMessage` targets? | Yes, env-driven (`AMO_SITE_ORIGINS`, derived on the lab host from `caddy_frame_ancestors` minus `'self'`), so the image carries no hostnames and one image serves any host. `AddOnHealth.siteOrigins` is required for that reason. |
| 5 | Assumption: `apps/appliance-web` compiles unchanged. | Verified by reading `App.tsx:3,47,112` (imports `PoweredBy` and table components only); `npm run web:build` confirms at implementation. |
| 6 | Assumption: a `contactPath` prop is acceptable beyond the five props the program named. | Needed so `onNavigate` receives a host-chosen literal rather than a value derived from `contactUrl`; default `"/contact"` matches the website's navigation allow-list [VERIFY against `ADDON_NAVIGATION_TARGETS` in the website PR]. |
| 7 | Assumption: the stage effect cannot be unit-tested here without a DOM. | True for `react-dom/server`; adding a DOM dev dependency was rejected to keep section 11 at none. The downstream e2e is the observation point. |
| 8 | Assumption: the stale split headers at `CHANGELOG.md:3` and `VALIDATION.md:3` (they name this repository as `_Addon`) are corrected opportunistically. | Optional in the same PR; not required for `v0.3.0`. |
