import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Ticket #43: the appliance must be deployed by immutable digest. This reads the real variable block in
 * variables.tf, checks it has no default, and runs the very regular expression Terraform runs against sample values,
 * so a loosened rule fails here without needing terraform on the machine (CI's iac-validate job covers fmt/validate).
 */
const tf = readFileSync("infrastructure/terraform/appliance-azure/variables.tf", "utf8");
const block = tf.match(/variable "image_ref" \{([\s\S]*?)\n\}\n/)?.[1] ?? "";
const hcl = block.match(/regex\("((?:[^"\\]|\\.)*)"/)?.[1];
// Terraform uses RE2; the only construct JavaScript lacks is the POSIX class [:space:].
const re = new RegExp((hcl ?? "").replace(/\\\\/g, "\\").replace("[:space:]", "\\s"));
const digest = "a".repeat(64);
const name = "docker.io/hybridcloudworks/hcw-migrateorchestrator";

test("image_ref is a required variable with no default", () => {
  assert.ok(block, "variable image_ref not found");
  assert.ok(!/^\s*default\s*=/m.test(block), "image_ref must not have a default");
  assert.ok(hcl, "image_ref must carry a validation regex");
});

test("image_ref validation accepts only an exact sha256 digest", () => {
  assert.ok(re.test(`${name}@sha256:${digest}`), "full digest must be accepted");
  for (const bad of ["", `${name}:latest`, `${name}:v0.3.1`, `${name}@sha256:abc123`, `${name}@sha256:${"A".repeat(64)}`, `${name}@sha256:${digest}0`, `${name}:latest@sha256:${digest} x`, `@sha256:${digest}`, name]) {
    assert.ok(!re.test(bad), `must be refused: ${JSON.stringify(bad)}`);
  }
});

test("terraform.tfvars.example does not set image_ref to a tag", () => {
  const ex = readFileSync("infrastructure/terraform/appliance-azure/terraform.tfvars.example", "utf8");
  assert.ok(!/^\s*image_ref\s*=\s*"[^"]*:latest/m.test(ex));
  for (const m of ex.matchAll(/^\s*image_ref\s*=\s*"([^"]*)"/gm)) assert.ok(re.test(m[1]), "an example value must itself be a digest");
});
