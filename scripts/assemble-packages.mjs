#!/usr/bin/env node
/**
 * Assemble the two publishable packages from the built workspaces (ADR-0028):
 *   dist-packages/migration-core  — @hybridcloudworks/migration-core: the engine (every core package as a subpath export) + the rule corpus
 *   dist-packages/migration-ui    — @hybridcloudworks/migration-ui: the React explorer components (types reference migration-core)
 * The Azure clients (azure-auth, azure-arm, azure-execution) are deliberately NOT published: the web-front edition must be
 * technically unable to reach Azure (ADR-0008). Run after `tsc -b`. `--version X.Y.Z` overrides the root package version.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const argv = process.argv.slice(2);
const VERSION = argv.includes("--version") ? argv[argv.indexOf("--version") + 1] : JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(VERSION)) throw new Error(`invalid version: ${VERSION}`);

export const CORE = ["domain", "contracts", "observability", "csv-ingestion", "evidence-engine", "dependency-graph", "landing-zone", "classification-engine", "validation-engine", "report-engine", "terraform-generator", "runbook-generator", "artifact-generator", "authorization", "workspace-provider", "azure-discovery", "agents"];
export const NEVER_PUBLISHED = ["azure-auth", "azure-arm", "azure-execution"];
const CORE_NAME = "@hybridcloudworks/migration-core";
const UI_NAME = "@hybridcloudworks/migration-ui";
const REPO = "https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App";
const OUT = join(ROOT, "dist-packages");

const isShipped = (f) => !/\.test\.(js|d\.ts)$/.test(f) && !f.endsWith(".map") && !f.endsWith(".tsbuildinfo");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const toPosix = (p) => p.split(sep).join("/");

function copyDist(pkg, destDir) {
  const src = join(ROOT, "packages", pkg, "dist");
  if (!existsSync(src)) throw new Error(`packages/${pkg}/dist missing — run tsc -b first`);
  for (const f of walk(src)) {
    if (!isShipped(f)) continue;
    const rel = relative(src, f); const d = join(destDir, rel);
    mkdirSync(dirname(d), { recursive: true }); cpSync(f, d);
  }
}

/** Rewrite "@amo/<name>" specifiers in a shipped .js/.d.ts file. */
function rewrite(file, mapper) {
  const s = readFileSync(file, "utf8");
  const n = s.replace(/(["'])@amo\/([a-z-]+)\1/g, (_, q, name) => `${q}${mapper(name, file)}${q}`);
  if (n !== s) writeFileSync(file, n);
}

// ---- migration-core ----
rmSync(OUT, { recursive: true, force: true });
const coreDir = join(OUT, "migration-core");
for (const pkg of CORE) copyDist(pkg, join(coreDir, "dist", pkg));
const coreDist = join(coreDir, "dist");
for (const f of walk(coreDist)) {
  if (!/\.(js|d\.ts)$/.test(f)) continue;
  rewrite(f, (name, file) => {
    if (!CORE.includes(name)) throw new Error(`${relative(ROOT, file)} imports @amo/${name}, which is not part of the published core`);
    let rel = posix.relative(toPosix(dirname(relative(coreDist, file))), `${name}/index.js`);
    if (!rel.startsWith(".")) rel = "./" + rel;
    return rel; // intra-package imports are relative so the package works without self-resolution
  });
}
for (const d of ["azure", "organization", "schemas", "snapshots"]) cpSync(join(ROOT, "rules", d), join(coreDir, "rules", d), { recursive: true });
const exportsMap = Object.fromEntries(CORE.map((p) => [`./${p}`, { types: `./dist/${p}/index.d.ts`, default: `./dist/${p}/index.js` }]));
exportsMap["./rules/*"] = "./rules/*";
exportsMap["./package.json"] = "./package.json";
writeFileSync(join(coreDir, "package.json"), JSON.stringify({
  name: CORE_NAME, version: VERSION,
  description: "Azure Migration Orchestrator — migration intelligence core: taxonomy, versioned Microsoft-Learn-sourced rules, classification, agents, report/Terraform/runbook generators, API contracts. Deterministic rules decide; nothing here reaches Azure.",
  license: "MIT", type: "module", sideEffects: false, engines: { node: ">=26" },
  repository: { type: "git", url: `${REPO}.git` }, homepage: REPO, bugs: `${REPO}/issues`,
  keywords: ["azure", "migration", "resource-mover", "azure-migrate", "assessment", "terraform"],
  files: ["dist", "rules", "README.md"], exports: exportsMap, dependencies: {}
}, null, 2) + "\n");
writeFileSync(join(coreDir, "README.md"), `# ${CORE_NAME}

The migration intelligence core of the Azure Migration Orchestrator (${REPO}). Every package of the engine is a subpath export:

\`\`\`js
import { Orchestrator } from "${CORE_NAME}/agents";
import { defaultRulesDir, loadRules } from "${CORE_NAME}/evidence-engine";
\`\`\`

Subpaths: ${CORE.map((p) => `\`./${p}\``).join(", ")}. The versioned rule corpus ships under \`rules/\` and is found automatically by \`defaultRulesDir()\` (override with \`AMO_RULES_DIR\`).

This package contains no Azure SDK and no Azure client: the \`./azure-discovery\` subpath is the \`DiscoveryProvider\` interface and a fixture provider only. Authenticated discovery and execution live in the appliance and are not published (ADR-0008, ADR-0028).

Every assessment output is labelled, hashed and traceable to rule versions; generated Terraform is illustrative scaffolding, not production-approved. License: MIT.
`);

// ---- migration-ui ----
const uiDir = join(OUT, "migration-ui");
copyDist("ui", join(uiDir, "dist"));
for (const f of walk(join(uiDir, "dist"))) if (/\.(js|d\.ts)$/.test(f)) rewrite(f, (name) => { if (!CORE.includes(name)) throw new Error(`ui imports @amo/${name}`); return `${CORE_NAME}/${name}`; });
const uiSrcPkg = JSON.parse(readFileSync(join(ROOT, "packages/ui/package.json"), "utf8"));
const external = Object.fromEntries(Object.entries(uiSrcPkg.dependencies ?? {}).filter(([k]) => !k.startsWith("@amo/")));
writeFileSync(join(uiDir, "package.json"), JSON.stringify({
  name: UI_NAME, version: VERSION,
  description: "Hybrid Cloud Works Migration Explorer — React components for the CSV migration lab (upload, questionnaire, decisions, waves, generated files). Mounts as a client-only island; talks to the lab API only.",
  license: "MIT", type: "module", sideEffects: false, engines: { node: ">=26" },
  repository: { type: "git", url: `${REPO}.git`, directory: "packages/ui" }, homepage: REPO, bugs: `${REPO}/issues`,
  keywords: ["azure", "migration", "react", "explorer"],
  files: ["dist", "README.md"],
  exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" }, "./package.json": "./package.json" },
  dependencies: { [CORE_NAME]: VERSION, ...external },
  peerDependencies: uiSrcPkg.peerDependencies
}, null, 2) + "\n");
writeFileSync(join(uiDir, "README.md"), `# ${UI_NAME}

React 19 components of the Migration Explorer (${REPO}, \`packages/ui\`). Peer dependencies: \`react\`, \`react-dom\`.

\`\`\`jsx
import { MigrationExplorer } from "${UI_NAME}";
// Same origin (apiBaseUrl defaults to ""): mount it from the page the lab API serves. Inside a host's sandboxed pane,
// pass partners={false}, onStageChange to report "working" while an assessment runs, and onNavigate so the
// enterprise CTA hands a site path to the host instead of navigating the frame.
<MigrationExplorer />
\`\`\`

Styling uses Tailwind utility classes; add the package to your Tailwind source scan: \`@source "../node_modules/${UI_NAME}/dist";\` (path relative to your CSS entry). Types reference \`${CORE_NAME}\` (installed as a dependency); there is no runtime import of it.

The explorer never asks for credentials and never talks to Azure: it calls the lab API, which processes the uploaded CSV in memory only. License: MIT.
`);

const n = walk(OUT).length;
console.log(`assembled ${CORE_NAME}@${VERSION} (${CORE.length} subpaths) and ${UI_NAME}@${VERSION} → ${relative(ROOT, OUT)} (${n} files)`);
