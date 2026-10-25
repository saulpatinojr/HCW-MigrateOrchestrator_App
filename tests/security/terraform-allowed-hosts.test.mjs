import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Issue 83, F8: the API Container App gets AMO_ALLOWED_HOSTS (its own address plus additional_allowed_hosts) and the worker does
 * not. A `terraform test` cannot read it (the environment's address is known only after apply, and a mocked apply cannot be torn
 * down because the enterprise application has prevent_destroy), so this reads the files. It proves what the configuration
 * declares, not what Azure does with it.
 */
const read = (f) => readFileSync(`infrastructure/terraform/appliance-azure/${f}`, "utf8").replaceAll("\r\n", "\n");
const main = read("main.tf");
const variables = read("variables.tf");

/** The text of one top-level resource block. */
function resource(type, name) {
  const start = main.indexOf(`resource "${type}" "${name}" {`);
  assert.ok(start >= 0, `${type}.${name} not found`);
  const end = main.indexOf("\n}\n", start);
  return main.slice(start, end);
}

test("the API Container App is given AMO_ALLOWED_HOSTS from the local, and the worker is given neither web-exposure variable", () => {
  const api = resource("azurerm_container_app", "api");
  const worker = resource("azurerm_container_app", "worker");
  assert.match(api, /name\s*=\s*"AMO_ALLOWED_HOSTS"\s*\n\s*value\s*=\s*local\.api_allowed_hosts/);
  assert.doesNotMatch(worker, /AMO_ALLOWED_HOSTS|AMO_ALLOWED_ORIGINS/, "the worker serves no HTTP");
  assert.match(api, /name\s*=\s*local\.api_app_name/, "the app name and the host name come from one local");
});

test("the host list is the app's own address on the environment's default domain, then additional_allowed_hosts", () => {
  assert.match(main, /api_app_name\s*=\s*"ca-\$\{local\.name\}-api"/);
  assert.match(main, /api_allowed_hosts\s*=\s*join\(",", concat\(\["\$\{local\.api_app_name\}\.\$\{azurerm_container_app_environment\.app\.default_domain\}"\], var\.additional_allowed_hosts\)\)/);
});

test("additional_allowed_hosts only takes bare lower-case host names (the validation regular expression, run on samples)", () => {
  const block = variables.slice(variables.indexOf('variable "additional_allowed_hosts"'));
  const hcl = block.match(/regex\("((?:[^"\\]|\\.)*)", h\)/)?.[1];
  assert.ok(hcl, "validation regex not found");
  const re = new RegExp(hcl.replaceAll("\\\\", "\\"));
  for (const ok of ["amo.example.com", "a", "api-2.example.co.uk", "10.0.0.5"]) assert.match(ok, re, ok);
  for (const bad of ["https://a.example.com", "a.example.com:443", "a.example.com/p", "*.example.com", "A.example.com", ".example.com", "example.com.", "", "-a.example.com"]) assert.doesNotMatch(bad, re, JSON.stringify(bad));
  assert.match(block, /default\s*=\s*\[\]/, "empty by default");
});
