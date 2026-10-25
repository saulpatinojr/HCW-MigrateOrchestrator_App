import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INGEST_LIMITS, ingestResourcesCsv } from "./index.js";

const SUB = "11111111-2222-3333-4444-555555555555";
const header = "NAME,TYPE,RESOURCE GROUP,LOCATION,SUBSCRIPTION ID,RESOURCE ID,TAGS";
const idFor = (name: string): string => `/subscriptions/${SUB}/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/${name.slice(0, 40)}`;
const line = (name: string, tags = ""): string => `${name},microsoft.compute/virtualmachines,rg-app,eastus,${SUB},${idFor(name)},${tags}`;
const csv = (...lines: string[]): string => [header, ...lines].join("\n") + "\n";

test("a cell longer than the field limit skips its row, says which row and column, and does not echo the content", () => {
  const long = "a".repeat(DEFAULT_INGEST_LIMITS.maxFieldLength + 1);
  const r = ingestResourcesCsv(csv(line("vm-ok-01"), line(long), line("vm-ok-02")));
  assert.deepEqual(r.resources.map((x) => x.name), ["vm-ok-01", "vm-ok-02"]);
  assert.deepEqual(r.resources.map((x) => x.sourceRow), [2, 4]);
  const w = r.warnings.filter((x) => x.includes("longer than"));
  assert.equal(w.length, 1);
  assert.match(w[0], /row 3/);
  assert.match(w[0], /NAME/);
  assert.ok(w[0].length < 300, "the warning must not carry the oversized value");
  assert.ok(!w[0].includes("aaaaaaaaaa"));
  assert.equal(r.errors.length, 0);
  assert.equal(r.rowCount, 3);
});

test("a cell exactly at the limit is kept, and the limit can be set per call", () => {
  const exact = "b".repeat(DEFAULT_INGEST_LIMITS.maxFieldLength);
  const r = ingestResourcesCsv(csv(line(exact)));
  assert.equal(r.resources.length, 1);
  assert.equal(r.resources[0].name.length, DEFAULT_INGEST_LIMITS.maxFieldLength);
  const tight = ingestResourcesCsv(csv(line("vm-01"), line("vm-0123456789")), { maxFieldLength: 200 });
  assert.equal(tight.resources.length, 2);
  const tighter = ingestResourcesCsv(csv(line("vm-01"), line("vm-0123456789")), { maxFieldLength: 128 });
  assert.deepEqual(tighter.resources.map((x) => x.name), ["vm-01"]);
});

test("an oversized tags cell is caught as well, and a single 4 MB cell is refused quickly", () => {
  const r = ingestResourcesCsv(csv(line("vm-01", "k=" + "v".repeat(DEFAULT_INGEST_LIMITS.maxFieldLength))));
  assert.equal(r.resources.length, 0);
  const t0 = performance.now();
  const big = ingestResourcesCsv(csv(line("_".repeat(4 * 1024 * 1024))));
  const ms = performance.now() - t0;
  assert.equal(big.resources.length, 0);
  assert.ok(ms < 2000, `took ${Math.round(ms)} ms`);
});

test("a header cell longer than the limit refuses the file, without echoing it", () => {
  const long = "H".repeat(DEFAULT_INGEST_LIMITS.maxFieldLength + 1);
  const r = ingestResourcesCsv(`${header},${long}\n${line("vm-01")},x\n`);
  assert.equal(r.resources.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /header/);
  assert.ok(r.errors[0].length < 300);
});
