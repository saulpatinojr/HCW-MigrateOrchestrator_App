#!/usr/bin/env node
/**
 * Write the CycloneDX SBOMs that release-cli.yml attests (ADR-0032). Uses `npm sbom` (built into npm), so no extra tool is
 * installed. Run after `npm ci` and `npm run build`.
 *
 *   node scripts/generate-sbom.mjs cli --version X.Y.Z --out amo-cli-X.Y.Z.cdx.json
 *       The command-line tool (the single-executable `amo` binaries). The code is bundled from this repository's own
 *       workspace packages (zero third-party runtime dependencies, ADR-0002), and each binary embeds the Node runtime,
 *       which is added as a component.
 *   node scripts/generate-sbom.mjs packages --version X.Y.Z --tarballs DIR --out hybridcloudworks-migration-packages-X.Y.Z.cdx.json
 *       The two package tarballs: they are installed from DIR into an empty project exactly as a consumer would (with the
 *       React peers) and the installed tree is described, so the SBOM lists what a consumer actually gets.
 *
 * The tool refuses to write an SBOM that does not name the things it must (a CycloneDX document of the wrong tree would
 * be attested and trusted). Node standard library only.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** Run npm; on Windows through the .cmd shim without a shell string. */
const runNpm = (args, cwd, capture = false) => {
  const r = spawnSync(process.platform === "win32" ? "cmd.exe" : npm, process.platform === "win32" ? ["/d", "/s", "/c", npm, ...args] : args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (r.status !== 0) throw new Error(`npm ${args.join(" ")} failed (${r.status})`);
  return r.stdout;
};

/** Replace the root component npm derived from the folder name with the artifact this SBOM is about. */
export function retitle(bom, { name, version, description, type = "application", purlType = "generic" }) {
  const ref = `${name}@${version}`;
  const old = bom.metadata?.component?.["bom-ref"];
  bom.metadata = { ...bom.metadata, component: { "bom-ref": ref, type, name, version, description, purl: `pkg:${purlType}/${name}@${version}`, licenses: [{ license: { id: "MIT" } }], externalReferences: [{ type: "vcs", url: REPO }] } };
  for (const d of bom.dependencies ?? []) if (d.ref === old) d.ref = ref;
  return bom;
}

export function addComponent(bom, component, dependsOnIt = true) {
  bom.components = [...(bom.components ?? []), component];
  if (dependsOnIt) {
    const root = bom.dependencies?.find((d) => d.ref === bom.metadata.component["bom-ref"]);
    if (root) root.dependsOn = [...(root.dependsOn ?? []), component["bom-ref"]];
  }
  return bom;
}

/** Throws when the document is not a CycloneDX BOM that names each of `mustContain` (bom-ref or name). */
export function assertBom(bom, { rootName, rootVersion, mustContain }) {
  if (bom?.bomFormat !== "CycloneDX" || !/^1\.\d+$/.test(String(bom.specVersion))) throw new Error("not a CycloneDX 1.x document");
  const root = bom.metadata?.component;
  if (root?.name !== rootName || root?.version !== rootVersion) throw new Error(`the SBOM root is ${root?.name}@${root?.version}, expected ${rootName}@${rootVersion}`);
  // npm puts the scope only in the bom-ref ("@amo/domain@0.1.0"), so list each component by its ref without the version
  const names = new Set((bom.components ?? []).map((c) => String(c["bom-ref"] ?? c.name).replace(/@[^@/]+$/, "")));
  for (const need of mustContain) if (!names.has(need)) throw new Error(`the SBOM does not list ${need}; it describes the wrong tree`);
  return bom;
}

export function cliSbom(version, nodeVersion = process.versions.node) {
  const out = runNpm(["sbom", "--sbom-format", "cyclonedx", "--omit", "dev", "--workspace", "apps/cli"], ROOT, true);
  const bom = retitle(JSON.parse(out), { name: "amo", version, description: "Azure Migration Orchestrator command-line tool (single-executable build, Node SEA)" });
  addComponent(bom, {
    "bom-ref": `node@${nodeVersion}`, type: "platform", name: "node", version: nodeVersion, purl: `pkg:generic/node@${nodeVersion}`,
    description: "Node.js runtime embedded in each single-executable binary",
    properties: [{ name: "hcw:note", value: "the Node version on the runner that generated this SBOM; each binary embeds the Node of its own build job, normally the same release" }],
  });
  return assertBom(bom, { rootName: "amo", rootVersion: version, mustContain: ["@amo/domain", "@amo/agents", "node"] });
}

export function packagesSbom(version, tarballs) {
  const tmp = mkdtempSync(join(tmpdir(), "amo-sbom-"));
  try {
    const core = join(tarballs, `hybridcloudworks-migration-core-${version}.tgz`);
    const ui = join(tarballs, `hybridcloudworks-migration-ui-${version}.tgz`);
    for (const f of [core, ui]) if (!existsSync(f)) throw new Error(`${f} is missing`);
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0", private: true, type: "module" }));
    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--silent", core, ui, "react@^19", "react-dom@^19"], tmp);
    const bom = JSON.parse(runNpm(["sbom", "--sbom-format", "cyclonedx", "--omit", "dev"], tmp, true));
    retitle(bom, { name: "hybridcloudworks-migration-packages", version, description: "@hybridcloudworks/migration-core and @hybridcloudworks/migration-ui as installed from the release tarballs, with their React peers" });
    return assertBom(bom, { rootName: "hybridcloudworks-migration-packages", rootVersion: version, mustContain: ["@hybridcloudworks/migration-core", "@hybridcloudworks/migration-ui", "react", "react-dom"] });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const [mode, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i += 2) opt[rest[i]?.replace(/^--/, "")] = rest[i + 1];
  if (!/^\d+\.\d+\.\d+$/.test(opt.version ?? "")) throw new Error("--version X.Y.Z is required");
  if (!opt.out) throw new Error("--out FILE is required");
  let bom;
  if (mode === "cli") bom = cliSbom(opt.version);
  else if (mode === "packages") { if (!opt.tarballs) throw new Error("--tarballs DIR is required"); bom = packagesSbom(opt.version, resolve(opt.tarballs)); }
  else throw new Error("usage: generate-sbom.mjs cli|packages --version X.Y.Z [--tarballs DIR] --out FILE");
  writeFileSync(opt.out, JSON.stringify(bom, null, 2) + "\n");
  console.log(`wrote ${opt.out}: ${bom.components.length} components, root ${bom.metadata.component.name}@${bom.metadata.component.version}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.log(`error: ${error.message}`); process.exitCode = 1; }
}
