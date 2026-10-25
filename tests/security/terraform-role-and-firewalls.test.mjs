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
});

test("the app roles in Terraform and the roles the API recognises are the same set, and none maps below planning", () => {
  const app = block(main, "resource", "azuread_application", "api");
  const tfRoles = [...app.matchAll(/^\s*"(Migration\.[A-Za-z.]+)"\s*=\s*"/gm)].map((m) => m[1]).sort();
  const apiBlock = api.match(/export const APP_ROLE_LEVELS[\s\S]*?\n\];/)?.[0] ?? "";
  const apiRoles = [...apiBlock.matchAll(/\["(Migration\.[A-Za-z.]+)",\s*"([a-z-]+)"\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(apiRoles.map(([r]) => r).sort(), tfRoles, "Terraform app roles and APP_ROLE_LEVELS must match exactly");
  assert.equal(tfRoles.length, 3);
  for (const [, level] of apiRoles) assert.ok(["planning", "controlled-execution", "destructive-execution"].includes(level), `a role must not grant ${level}`);
  assert.ok(!/:\s*"discovery"|"discovery"\s*;/.test(api.slice(api.indexOf("export function principalFromClaims"), api.indexOf("export interface ApplianceDeps"))), "principalFromClaims must never hand out a default level");
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
  for (const r of ["Migration.Plan", "Migration.Execute", "Migration.Execute.Destructive"]) assert.ok(v.includes(`"${r}"`), r);
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
  assert.equal(attr(https, "source_address_prefixes"), "var.ingress_allowed_source_prefixes");
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
  assert.match(v, /"Internet"/);
});

test("geo-redundant backup is opt-in, defaults off, and is the only thing the flexible server reads it from", () => {
  const v = block(variables, "variable", "postgres_geo_redundant_backup_enabled");
  assert.equal(attr(v, "default"), "false");
  assert.match(v, /DESTROY and recreate/, "the variable must warn that switching it on later recreates the database");
  assert.equal(attr(block(main, "resource", "azurerm_postgresql_flexible_server", "db"), "geo_redundant_backup_enabled"), "var.postgres_geo_redundant_backup_enabled");
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
