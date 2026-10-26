import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Found by the first sandbox apply (2026-10-26): the database server has no pinned availability zone, Azure picks one, and Terraform
// then plans to remove it on every run. The zone cannot change without recreating the server, so the attribute is ignored.
const main = readFileSync(new URL("../../infrastructure/terraform/appliance-azure/main.tf", import.meta.url), "utf8");
const start = main.indexOf('resource "azurerm_postgresql_flexible_server" "db"');
const end = main.indexOf("\nresource ", start + 10);
const server = main.slice(start, end);

test("the database server ignores the zone Azure assigns, and does not pin one", () => {
  assert.ok(start > 0 && end > start, "the server resource must exist");
  assert.match(server, /lifecycle\s*\{[^}]*ignore_changes\s*=\s*\[\s*zone\s*\]/, "ignore_changes = [zone] must stay on the server");
  assert.doesNotMatch(server, /^\s*zone\s*=/m, "no zone is pinned; a pinned zone would need a different decision (ADR-0032)");
});
