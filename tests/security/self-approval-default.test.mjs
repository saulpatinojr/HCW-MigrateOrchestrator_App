import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * F-05 (issue 83, ADR-0031): the two-person rule is the default everywhere it is deployed, and the opt-out
 * (AMO_ALLOW_SELF_APPROVAL=true) is never set by anything this repository ships. These read the files; the behaviour is in
 * apps/appliance-api/src/two-person-approval.test.ts.
 */
const read = (f) => readFileSync(f, "utf8").replaceAll("\r\n", "\n");
const OPT_OUT = "AMO_ALLOW_SELF_APPROVAL";

test("nothing the repository ships turns the opt-out on", () => {
  const terraform = readdirSync("infrastructure/terraform/appliance-azure").filter((f) => f.endsWith(".tf") || f.endsWith(".example"));
  for (const f of terraform) assert.doesNotMatch(read(`infrastructure/terraform/appliance-azure/${f}`), new RegExp(OPT_OUT), `${f}: Terraform must not set ${OPT_OUT}`);
  assert.doesNotMatch(read("infrastructure/docker/Dockerfile.appliance"), new RegExp(OPT_OUT), "the image must not set it");
  // Compose only passes through what the operator sets, and the default is empty (off).
  assert.match(read("docker-compose.appliance.yml"), new RegExp(`${OPT_OUT}: "\\$\\{${OPT_OUT}:-\\}"`));
  assert.match(read(".env.example"), new RegExp(`^${OPT_OUT}=$`, "m"), "the example leaves it empty");
});

test("the execution route hydrates approvals only through the two-person policy", () => {
  const src = read("apps/appliance-api/src/index.ts");
  const hydrations = [...src.matchAll(/principal\.approvals\.add\(/g)];
  assert.equal(hydrations.length, 1, "exactly one place adds approvals to the principal");
  const at = hydrations[0].index;
  const policy = src.indexOf("countableApprovals(await repo.approvalsFor(");
  assert.ok(policy > 0 && policy < at, "the approvals come from countableApprovals, before they are added");
  assert.match(src, /countableApprovals\(await repo\.approvalsFor\(body\.collection\.name\), actor, cfg\.allowSelfApproval\)/);
  assert.doesNotMatch(src, /for \(const a of await repo\.approvalsFor/, "no raw loop over the stored approvals");
});

test("the documentation names the rule, the opt-out and its default", () => {
  const doc = read("docs/deployment/enterprise.md");
  assert.match(doc, new RegExp(OPT_OUT));
  assert.match(doc, /two-person/i);
  const adr = read("docs/adr/ADR-0031-appliance-requires-an-entra-app-role-and-fails-closed.md");
  assert.match(adr, new RegExp(OPT_OUT));
  assert.doesNotMatch(adr, /so there is no separation of duties yet/, "the known limitation was replaced");
});
