import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTHORIZATION_LEVELS, type AuthorizationLevel, type Principal } from "@amo/authorization";
import { FORBIDDEN_MESSAGE, ROUTE_LEVELS, levelAllows, minimumLevel } from "./route-levels.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const who = (grantedLevel: AuthorizationLevel): Principal => ({ id: "o", edition: "enterprise", grantedLevel, approvals: new Set() });

test("every protected route has the minimum level the handlers need (ADR-0031)", () => {
  const expected: Array<[string, AuthorizationLevel | null]> = [
    ["/api/me", "discovery"],
    ["/api/scopes", "discovery"],
    ["/api/assessments", "discovery"],
    [`/api/assessments/${ID}`, "discovery"],
    [`/api/assessments/${ID}/validate-move`, "validation"],
    ["/api/operations/mc1", "planning"],
    ["/api/operations/a%20b", "planning"],
    ["/api/approvals", "controlled-execution"],
    ["/api/execution/resource-mover/prepare", "controlled-execution"],
    ["/api/execution/anything-else", "controlled-execution"],
    // Not in the table: the router answers 404, and the public routes never reach the table.
    ["/api/nothing", null],
    ["/api/assessments/not-a-uuid", null],
    [`/api/assessments/${ID}/validate-moveX`, null],
    ["/api/health", null],
    ["/api/agents", null],
  ];
  for (const [path, level] of expected) assert.equal(minimumLevel(path), level, path);
});

test("the table is checked per level: Read cannot reach validation, planning or execution routes; Plan cannot reach execution", () => {
  const paths = {
    discovery: ["/api/me", "/api/assessments", `/api/assessments/${ID}`],
    validation: [`/api/assessments/${ID}/validate-move`],
    planning: ["/api/operations/x"],
    execution: ["/api/approvals", "/api/execution/resource-mover/commit"],
  };
  const read = who("discovery");
  const plan = who("planning");
  const exec = who("controlled-execution");
  for (const p of paths.discovery) assert.ok(levelAllows(read, p), p);
  for (const p of [...paths.validation, ...paths.planning, ...paths.execution]) assert.ok(!levelAllows(read, p), p);
  for (const p of [...paths.discovery, ...paths.validation, ...paths.planning]) assert.ok(levelAllows(plan, p), p);
  for (const p of paths.execution) assert.ok(!levelAllows(plan, p), p);
  for (const p of [...paths.discovery, ...paths.validation, ...paths.planning, ...paths.execution]) assert.ok(levelAllows(exec, p), p);
  // A level below discovery (never issued by a role) gets nothing either.
  assert.ok(!levelAllows(who("sign-in"), "/api/me"));
  // An unlisted path is not blocked by the table.
  assert.ok(levelAllows(read, "/api/nothing"));
});

test("the refusal text names no level, and no table entry or level name leaks into it", () => {
  for (const level of AUTHORIZATION_LEVELS) assert.ok(!FORBIDDEN_MESSAGE.includes(level), level);
  assert.ok(!/level|discovery|validation|planning|execution|Migration/i.test(FORBIDDEN_MESSAGE));
  assert.ok(ROUTE_LEVELS.every((r) => AUTHORIZATION_LEVELS.includes(r.level)));
});

test("index.ts checks the table once, before any route reads a body or the repository, and keeps no scattered level checks", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
  const guard = src.indexOf("levelAllows(principal, url.pathname)");
  assert.ok(guard > 0, "levelAllows call not found");
  assert.ok(guard < src.indexOf('url.pathname === "/api/me"'), "the table check must come before the first route");
  assert.ok(guard < src.indexOf("await readJson(req)"), "no body is read before the check");
  assert.ok(guard < src.indexOf("repo.getAssessment("), "no repository read happens before the check");
  assert.ok(!/isAllowed\(/.test(src), "per-route isAllowed checks must be gone; the table is the single place");
  assert.ok(!/level required/.test(src), "no response text may name a level");
});
