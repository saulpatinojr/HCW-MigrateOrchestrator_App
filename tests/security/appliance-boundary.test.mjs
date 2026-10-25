import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * This repository is the upstream product (ADR-0028): the engine, rules, CLI, UI components and the appliance. The lab
 * (web-front edition, saulpatinojr/HCW-MigrateOrchestrator_AddOn) must stay technically unable to reach Azure (ADR-0008),
 * so the Azure clients are present here but never leave this repository, and the CLI stays lab-side.
 */
const srcFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
const AZURE_PACKAGES = ["@amo/azure-auth", "@amo/azure-arm", "@amo/azure-execution"];

test("the Azure clients exist here and are excluded from the published core", () => {
  for (const p of ["azure-auth", "azure-arm", "azure-execution", "azure-discovery"]) assert.ok(existsSync(join("packages", p, "package.json")), `packages/${p} missing`);
  const arm = JSON.parse(readFileSync("packages/azure-arm/package.json", "utf8"));
  assert.ok(Object.keys(arm.dependencies).includes("@amo/azure-discovery"), "azure-arm implements the core DiscoveryProvider interface");
  const published = JSON.parse(readFileSync("dist-packages/migration-core/package.json", "utf8"));
  for (const bad of ["./azure-auth", "./azure-arm", "./azure-execution"]) assert.ok(!(bad in published.exports), `${bad} is published`);
});

test("the lab-side apps (cli) and the engine never depend on the Azure clients", () => {
  const engine = ["domain", "contracts", "observability", "csv-ingestion", "evidence-engine", "dependency-graph", "landing-zone", "classification-engine", "validation-engine", "report-engine", "terraform-generator", "runbook-generator", "artifact-generator", "authorization", "workspace-provider", "azure-discovery", "agents", "ui"];
  for (const p of engine) {
    const pkg = JSON.parse(readFileSync(join("packages", p, "package.json"), "utf8"));
    for (const d of Object.keys(pkg.dependencies ?? {})) assert.ok(!AZURE_PACKAGES.includes(d) && !d.startsWith("@azure/"), `${p} depends on ${d}`);
  }
  const cli = JSON.parse(readFileSync("apps/cli/package.json", "utf8"));
  for (const d of Object.keys(cli.dependencies)) assert.ok(!AZURE_PACKAGES.includes(d) && d !== "@amo/azure-discovery", `cli depends on ${d}; authenticated discovery belongs to the appliance`);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync("packages/azure-discovery/package.json", "utf8")).dependencies), ["@amo/domain"]);
  for (const f of srcFiles("packages/azure-discovery/src")) for (const bad of ["management.azure.com", "fetch(", "@amo/azure-auth", "ARM_SCOPE"]) assert.ok(!readFileSync(f, "utf8").includes(bad), `${f} contains ${bad}`);
});

test("the appliance has no CSV upload surface and fails closed", () => {
  for (const a of ["appliance-api", "worker"]) {
    const pkg = JSON.parse(readFileSync(join("apps", a, "package.json"), "utf8"));
    for (const d of Object.keys(pkg.dependencies ?? {})) assert.ok(!["@amo/csv-ingestion", "@amo/workspace-provider", "@amo/ui"].includes(d), `${a} depends on lab package ${d}`);
    for (const f of srcFiles(join("apps", a, "src"))) {
      const text = readFileSync(f, "utf8");
      for (const bad of ["@amo/csv-ingestion", "parseCreateAssessmentRequest", "sample.csv", "multipart/form-data", "TURNSTILE"]) assert.ok(!text.includes(bad), `${f} contains ${bad}`);
    }
  }
  const src = readFileSync("apps/appliance-api/src/index.ts", "utf8");
  assert.ok(src.includes("EntraTokenValidator"), "token validator missing");
  assert.ok(src.includes("401"), "no 401 path");
  assert.ok(!/AMO_CLIENT_SECRET|clientSecret\s*[:=]/.test(src), "client secrets are never accepted (ADR-0007)");
});
