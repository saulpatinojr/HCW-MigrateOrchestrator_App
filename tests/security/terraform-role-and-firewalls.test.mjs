import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Tickets #46 and #53 (ADR-0031, ADR-0032). Static checks of the real Terraform and API source, so a loosened firewall,
 * a dropped "assignment required" setting or a role the API does not know fails here without needing Terraform on the
 * machine. The plan-level checks (`terraform test`, mock providers) run in the iac-validate workflow; neither proves how
 * Azure or Microsoft Entra ID behave once the configuration is applied.
 */
const dir = "infrastructure/terraform/appliance-azure";
const main = readFileSync(`${dir}/main.tf`, "utf8").replace(/\r\n/g, "\n");
const variables = readFileSync(`${dir}/variables.tf`, "utf8").replace(/\r\n/g, "\n");
const api = readFileSync("apps/appliance-api/src/index.ts", "utf8");

/** The body of `kind "type" "name" { ... }`, found by matching braces (quoted strings are skipped). */
function block(src, kind, ...labels) {
  const head = new RegExp(`^${kind}${labels.map((l) => ` "${l}"`).join("")} \\{`, "m").exec(src);
  assert.ok(head, `${kind} ${labels.join(" ")} not found`);
  let depth = 0;
  let inString = false;
  for (let i = head.index + head[0].length - 1; i < src.length; i++) {
    const c = src[i];
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(head.index, i + 1);
  }
  throw new Error(`unterminated block ${kind} ${labels.join(" ")}`);
}
const attr = (body, name) => body.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"))?.[1];
const rule = (name) => block(main, "resource", "azurerm_network_security_rule", name);

// ---------------------------------------------------------------- ticket #46: app role required

test("the Entra enterprise application requires an assigned app role", () => {
  const sp = block(main, "resource", "azuread_service_principal", "api");
  assert.equal(attr(sp, "app_role_assignment_required"), "true", "app_role_assignment_required must be true");
  assert.equal(attr(sp, "client_id"), "azuread_application.api.client_id", "the service principal must belong to the API registration");
  assert.equal(attr(sp, "use_existing"), "true", "an existing service principal must be adopted, not fail the apply");
  assert.ok(sp.replace(/\s+/g, " ").includes("lifecycle { prevent_destroy = true }"), "destroying the enterprise application deletes every role assignment");
});

test("the app roles in Terraform and the roles the API recognises are the same set, and the lowest role is Migration.Read at the discovery level", () => {
  const app = block(main, "resource", "azuread_application", "api");
  const tfRoles = [...app.matchAll(/^\s*"(Migration\.[A-Za-z.]+)"\s*=\s*"/gm)].map((m) => m[1]).sort();
  const apiBlock = api.match(/export const APP_ROLE_LEVELS[\s\S]*?\n\];/)?.[0] ?? "";
  const apiRoles = [...apiBlock.matchAll(/\["(Migration\.[A-Za-z.]+)",\s*"([a-z-]+)"\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(apiRoles.map(([r]) => r).sort(), tfRoles, "Terraform app roles and APP_ROLE_LEVELS must match exactly");
  assert.equal(tfRoles.length, 4);
  assert.deepEqual(apiRoles, [["Migration.Execute.Destructive", "destructive-execution"], ["Migration.Execute", "controlled-execution"], ["Migration.Plan", "planning"], ["Migration.Read", "discovery"]], "highest first; Migration.Read is the lowest role and grants discovery only");
  for (const [, level] of apiRoles) assert.ok(["discovery", "planning", "controlled-execution", "destructive-execution"].includes(level), `a role must not grant ${level}`);
  assert.ok(!/:\s*"discovery"|"discovery"\s*;/.test(api.slice(api.indexOf("export function principalFromClaims"), api.indexOf("export interface ApplianceDeps"))), "principalFromClaims must never hand out a default level");
});

test("the app role descriptions admins see when assigning match what the code does (commit is Execute, Destructive is reserved)", () => {
  const app = block(main, "resource", "azuread_application", "api");
  const desc = Object.fromEntries([...app.matchAll(/^\s*"(Migration\.[A-Za-z.]+)"\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  // Pinned on purpose: changing what a role is said to allow should be a deliberate edit of this test.
  assert.deepEqual(desc, {
    "Migration.Read": "Assess only: run discovery assessments and read your own results (no move validation, plans or execution)",
    "Migration.Plan": "Plan migrations (validation evidence, plans and bundles; no execution)",
    "Migration.Execute": "Record approvals and run gated Resource Mover actions: prepare, initiateMove, commit (each with its recorded approval) and discard",
    "Migration.Execute.Destructive": "Reserved for irreversible operations such as source deletion; the API exposes none yet, so today it grants nothing beyond Migration.Execute",
  });
  // The facts behind the wording, read from the code: commit needs only controlled execution plus a recorded approval.
  const mover = readFileSync("packages/azure-execution/src/resource-mover.ts", "utf8");
  assert.ok(mover.includes('commit: "data-cutover"'));
  const authz = readFileSync("packages/authorization/src/index.ts", "utf8");
  assert.ok(authz.includes('operation === "source-delete" || operation === "destructive-change" || operation === "irreversible-operation" ? "destructive-execution" : "controlled-execution"'));
  assert.ok(!/commit cutover/i.test(desc["Migration.Execute.Destructive"]), "Destructive must not claim commit");
  const guide = readFileSync("docs/deployment/enterprise.md", "utf8").replace(/\r\n/g, "\n");
  const row = (r) => guide.split("\n").find((l) => l.startsWith("| `" + r + "` |")) ?? "";
  assert.ok(row("Migration.Execute").includes("commit (approval `data-cutover`)"), "the guide must say Execute can commit");
  assert.ok(!/commit/i.test(row("Migration.Execute.Destructive")), "the guide must not give commit to Destructive");
});

test("the API fails closed when the principal is null, before any route runs", () => {
  const guard = api.indexOf("const principal = principalFromClaims(v.claims);");
  assert.ok(guard > 0, "principalFromClaims(v.claims) not found");
  assert.ok(!api.includes("principalFromClaims(v.claims)!"), "a non-null assertion would let a roleless token through");
  const after = api.slice(guard, guard + 400);
  assert.match(after, /if \(!principal\) \{[\s\S]*return fail\(403, "forbidden"/);
  const firstRoute = api.indexOf('url.pathname === "/api/me"');
  assert.ok(guard < firstRoute, "the role check must come before the first protected route");
});

test("role assignments are validated against the three roles and empty by default", () => {
  const v = block(variables, "variable", "app_role_assignments");
  assert.equal(attr(v, "default"), "{}");
  for (const r of ["Migration.Read", "Migration.Plan", "Migration.Execute", "Migration.Execute.Destructive"]) assert.ok(v.includes(`"${r}"`), r);
});

// ---------------------------------------------------------------- ticket #53: subnet firewalls and opt-in costs

test("each subnet is attached to a network security group that is created with its rules first", () => {
  for (const s of ["aca", "db"]) {
    const assoc = block(main, "resource", "azurerm_subnet_network_security_group_association", s);
    assert.equal(attr(assoc, "subnet_id"), `azurerm_subnet.${s}.id`);
    assert.equal(attr(assoc, "network_security_group_id"), `azurerm_network_security_group.${s}.id`);
    assert.match(assoc, new RegExp(`azurerm_network_security_rule\\.${s}_deny_all_inbound`), "the association must wait for the deny rule");
  }
  assert.match(block(main, "resource", "azurerm_container_app_environment", "app"), /depends_on = \[azurerm_subnet_network_security_group_association\.aca\]/);
  assert.match(block(main, "resource", "azurerm_postgresql_flexible_server", "db"), /azurerm_subnet_network_security_group_association\.db/);
});

test("both firewalls end in an explicit deny-all-inbound rule at priority 4096", () => {
  for (const s of ["aca", "db"]) {
    const r = rule(`${s}_deny_all_inbound`);
    assert.equal(attr(r, "access"), '"Deny"');
    assert.equal(attr(r, "direction"), '"Inbound"');
    assert.equal(attr(r, "priority"), "4096");
    assert.equal(attr(r, "source_address_prefix"), '"*"');
    assert.equal(attr(r, "destination_address_prefix"), '"*"');
    assert.equal(attr(r, "destination_port_range"), '"*"');
  }
});

test("allow rules are the minimum: HTTPS and probes in, PostgreSQL only from the Container Apps subnet", () => {
  const allowed = [...main.matchAll(/^resource "azurerm_network_security_rule" "([a-z0-9_]+)"/gm)].map((m) => m[1]).filter((n) => !n.endsWith("_deny_all_inbound")).sort();
  assert.deepEqual(allowed, ["aca_allow_https_from_clients", "aca_allow_load_balancer_probes", "aca_allow_subnet_internal", "db_allow_postgres_from_aca", "db_allow_postgres_within_subnet"]);
  const https = rule("aca_allow_https_from_clients");
  assert.equal(attr(https, "destination_port_range"), '"443"', "only 443 is opened; port 80 stays closed");
  // A service tag is only accepted in the singular argument (azurerm docs: the plural one "may not" use tags), so the rule
  // switches between the two and nulls the other.
  assert.equal(attr(https, "source_address_prefix"), 'local.ingress_from_tag ? "Internet" : null');
  assert.equal(attr(https, "source_address_prefixes"), "local.ingress_from_tag ? null : var.ingress_allowed_source_prefixes");
  assert.ok(main.includes('ingress_from_tag = length(var.ingress_allowed_source_prefixes) == 1 && try(var.ingress_allowed_source_prefixes[0], "") == "Internet"'));
  assert.equal(attr(rule("aca_allow_load_balancer_probes"), "source_address_prefix"), '"AzureLoadBalancer"');
  const pg = rule("db_allow_postgres_from_aca");
  assert.equal(attr(pg, "destination_port_range"), '"5432"');
  assert.equal(attr(pg, "source_address_prefixes"), "[local.aca_subnet_cidr]");
  assert.equal(attr(pg, "destination_address_prefixes"), "[local.db_subnet_cidr]");
  assert.equal(attr(rule("db_allow_postgres_within_subnet"), "source_address_prefixes"), "[local.db_subnet_cidr]");
  // No allow rule may name a wildcard or the internet except the one HTTPS ingress rule, which takes it from a variable.
  for (const n of allowed.filter((x) => x !== "aca_allow_https_from_clients")) {
    const src = attr(rule(n), "source_address_prefix") ?? attr(rule(n), "source_address_prefixes") ?? "";
    assert.ok(!/"\*"|Internet|0\.0\.0\.0\/0|Any/.test(src), `${n} must not allow a wildcard source (${src})`);
  }
});

test("the only trivy suppression is the documented public HTTPS ingress", () => {
  const ignores = [...main.matchAll(/^\s*#trivy:ignore:(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(ignores, ["AVD-AZU-0047"]);
  const at = main.indexOf("#trivy:ignore:AVD-AZU-0047");
  assert.match(main.slice(at, at + 200), /resource "azurerm_network_security_rule" "aca_allow_https_from_clients"/, "the suppression must sit on the HTTPS ingress rule only");
  assert.ok(!existsDefaultIgnoreFile(), "no .trivyignore file may hide further findings");
});
function existsDefaultIgnoreFile() {
  for (const f of [".trivyignore", ".trivyignore.yaml", ".trivyignore.yml", `${dir}/.trivyignore`]) {
    try { readFileSync(f); return true; } catch { /* absent */ }
  }
  return false;
}

test("the ingress source variable defaults to Internet and refuses wildcards and mixed lists", () => {
  const v = block(variables, "variable", "ingress_allowed_source_prefixes");
  assert.equal(attr(v, "default"), '["Internet"]');
  assert.match(v, /cidrhost/);
  assert.ok(v.includes('split("/", p)[1] != "0"'), "0.0.0.0/0 must be refused (use the Internet tag)");
  assert.ok(v.includes("25[0-5]|2[0-4][0-9]"), "an IPv4-only pattern is required");
  assert.ok(v.includes('cidrhost(p, 0) == split("/", p)[0]'), "ranges must be in network form");
  assert.match(v, /"Internet"/);
});

test("geo-redundant backup is opt-in, defaults off, and is the only thing the flexible server reads it from", () => {
  const v = block(variables, "variable", "postgres_geo_redundant_backup_enabled");
  assert.equal(attr(v, "default"), "false");
  assert.match(v, /DESTROY and recreate/, "the variable must warn that switching it on later recreates the database");
  assert.equal(attr(block(main, "resource", "azurerm_postgresql_flexible_server", "db"), "geo_redundant_backup_enabled"), "var.postgres_geo_redundant_backup_enabled");
});

test("the aca firewall is marked provisional where it is defined", () => {
  const at = main.indexOf('resource "azurerm_network_security_group" "aca"');
  assert.match(main.slice(Math.max(0, at - 1200), at), /PROVISIONAL, NOT VALIDATED/);
});

test("the invalid Container Apps environment stops the plan unless a loudly named variable acknowledges it (issue 82)", () => {
  const v = block(variables, "variable", "acknowledge_container_apps_environment_is_invalid_issue_82");
  assert.equal(attr(v, "default"), "false", "the stop must be on by default");
  assert.equal(attr(v, "type"), "bool");
  const env = block(main, "resource", "azurerm_container_app_environment", "app");
  assert.ok(env.includes("precondition {"), "the environment needs a precondition");
  assert.ok(env.includes("condition     = var.acknowledge_container_apps_environment_is_invalid_issue_82"), "the precondition must depend only on the acknowledgement");
  assert.ok(env.includes("https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/issues/82"), "the message must point at the decision ticket");
  // While the environment is consumption-only on a delegated /26, the stop must stay: this fails if someone adds a
  // workload_profile block (the decision is then made) without also removing the stop on purpose.
  const envCode = env.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!envCode.includes("workload_profile"),"a workload_profile block means the environment decision was made: remove the stop, the variable, this test and the PROVISIONAL notes together (ADR-0032)");
  const subnet = block(main, "resource", "azurerm_subnet", "aca");
  assert.ok(subnet.includes("Microsoft.App/environments") && main.includes("aca_subnet_cidr = cidrsubnet(var.vnet_cidr, 4, 0)"));
});

test("providers stay pinned to a major version and the database stays private", () => {
  assert.match(main, /azuread = \{ source = "hashicorp\/azuread", version = "~> 3\.0" \}/);
  assert.match(main, /azurerm = \{ source = "hashicorp\/azurerm", version = "~> 4\.0" \}/);
  const pg = block(main, "resource", "azurerm_postgresql_flexible_server", "db");
  assert.equal(attr(pg, "public_network_access_enabled"), "false");
  assert.equal(attr(pg, "delegated_subnet_id"), "azurerm_subnet.db.id");
});

test("the deployment guide no longer says a signed-in user without a role gets discovery", () => {
  const guide = readFileSync("docs/deployment/enterprise.md", "utf8");
  assert.ok(!/signed in, no role\)\s*\|\s*discovery/.test(guide), "the guide still maps no role to discovery");
  assert.match(guide, /no role[\s\S]{0,200}403|403[\s\S]{0,200}no (app )?role/i);
});
