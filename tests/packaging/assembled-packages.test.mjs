import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The assembled packages (scripts/assemble-packages.mjs, ADR-0028) are what the web-front edition and the website consume. */
const OUT = "dist-packages";
const CORE = ["domain", "contracts", "observability", "csv-ingestion", "evidence-engine", "dependency-graph", "landing-zone", "classification-engine", "validation-engine", "report-engine", "terraform-generator", "runbook-generator", "artifact-generator", "authorization", "workspace-provider", "azure-discovery", "agents"];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const rootVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

test("migration-core exports exactly the engine subpaths and never the Azure clients", () => {
  const pkg = JSON.parse(readFileSync(join(OUT, "migration-core/package.json"), "utf8"));
  assert.equal(pkg.name, "@hybridcloudworks/migration-core");
  assert.equal(pkg.version, rootVersion);
  for (const p of CORE) {
    assert.ok(pkg.exports[`./${p}`], `missing export ./${p}`);
    assert.ok(existsSync(join(OUT, "migration-core", pkg.exports[`./${p}`].default)), `missing file for ./${p}`);
    assert.ok(existsSync(join(OUT, "migration-core", pkg.exports[`./${p}`].types)), `missing types for ./${p}`);
  }
  for (const bad of ["./azure-auth", "./azure-arm", "./azure-execution", "./ui"]) assert.ok(!(bad in pkg.exports), `${bad} must not be published from the core`);
  assert.deepEqual(pkg.dependencies, {}, "the core is dependency-free");
  assert.ok(existsSync(join(OUT, "migration-core/rules/azure")) && existsSync(join(OUT, "migration-core/rules/snapshots/current.json")), "rule corpus ships with the core");
});

test("no internal @amo/ specifier, Azure endpoint or test file leaks into the published packages", () => {
  for (const f of walk(OUT)) {
    assert.ok(!/\.test\.(js|d\.ts)$/.test(f) && !f.endsWith(".map"), `shipped: ${f}`);
    if (!/\.(js|ts|json)$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    assert.ok(!text.includes("@amo/"), `${f} references @amo/`);
    assert.ok(!text.includes("management.azure.com"), `${f} references an Azure endpoint`);
  }
});

test("migration-ui depends on the exact core version, keeps React as a peer and has no runtime core import", () => {
  const pkg = JSON.parse(readFileSync(join(OUT, "migration-ui/package.json"), "utf8"));
  assert.equal(pkg.name, "@hybridcloudworks/migration-ui");
  assert.equal(pkg.version, rootVersion);
  assert.equal(pkg.dependencies["@hybridcloudworks/migration-core"], rootVersion);
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), ["react", "react-dom"]);
  for (const f of walk(join(OUT, "migration-ui/dist")).filter((f) => f.endsWith(".js"))) {
    assert.ok(!readFileSync(f, "utf8").includes("@hybridcloudworks/migration-core"), `${f} imports the core at runtime; the UI must only use its types`);
  }
});
