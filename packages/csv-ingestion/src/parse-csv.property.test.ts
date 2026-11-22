// Property-based tests (fuzzing) for CSV ingestion. The CSV comes from a person's upload, so the parser must never throw or
// hang on whatever it is given, and the formula guard must survive a round trip. fast-check prints the seed of a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { parseCsv, csvSafe, looksLikeFormula, ingestResourcesCsv } from "./index.js";

// fast-check's default size ("small") keeps arrays to about 10 items whatever maxLength says; files need more rows than that.
fc.configureGlobal({ baseSize: "medium" });

const BOM = "\uFEFF"; // the byte-order mark, written as an escape so the file holds no invisible character
// A file built line by line from the pieces real exports and hostile uploads contain, so files have many rows.
const piece = fc.oneof(fc.constantFrom(",", ";", "\t", "|", "\"", "\"\"", "\r", BOM, "=", "+", "-", "@", "__proto__", "constructor",
  "Name", "Type", "Resource ID", "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm"),
fc.string({ maxLength: 6 }));
const csvLike = fc.tuple(fc.array(fc.array(piece, { maxLength: 8 }).map((p) => p.join("")), { maxLength: 60 }), fc.constantFrom("\n", "\r\n"))
  .map(([lines, newline]) => lines.join(newline));

// A file that starts with a real header row, so rows go all the way through ingestion instead of stopping at the header check.
const HEADER = ["Name", "Type", "Resource ID", "Resource group", "Location", "Tags"];
const cellValue = fc.oneof(fc.string({ unit: "binary", maxLength: 12 }), fc.constantFrom("=1+1", "+cmd", "-2", "@SUM(A1)", " =x", "\t=1", "vm1", "vm2",
  "Microsoft.Compute/virtualMachines", "__proto__", "constructor", "Constructor", "toString",
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1", "eastus", "a=b;c=d", "__proto__=x",
  "{\"k\":\"v\"}", "{\"__proto__\":\"v\"}", ""));
const exportLike = fc.array(fc.array(cellValue, { minLength: HEADER.length, maxLength: HEADER.length }), { maxLength: 60 })
  .map((rows) => [HEADER.join(","), ...rows.map((r) => r.map(csvSafe).join(","))].join("\n"));

// The independent formula rule: what a spreadsheet would run. Written out here instead of reusing looksLikeFormula, so a
// change to looksLikeFormula is checked against something other than itself.
const runsAsFormula = (cell: string): boolean => /^[\s"]*[=+@\t\r]/.test(cell) || /^[\s"]*-(?!\d)/.test(cell);

test("the file generators reach multi-row files and full ingestion (so the properties below are not empty)", () => {
  const files = fc.sample(csvLike, { numRuns: 300, seed: 1 });
  const big = files.filter((f) => parseCsv(f).rows.length > 20).length;
  assert.ok(big > 30, `${big} of 300 files have more than 20 rows`);
  const exports = fc.sample(exportLike, { numRuns: 300, seed: 1 });
  const ingested = exports.filter((f) => ingestResourcesCsv(f, { maxRows: 50 }).resources.length > 5).length;
  assert.ok(ingested > 30, `${ingested} of 300 exports ingest more than 5 resources`);
});

test("property: parseCsv never throws, every row has the header's width, and the row limit holds", () => {
  fc.assert(fc.property(fc.oneof(csvLike, fc.string({ unit: "binary", maxLength: 1500 })), fc.integer({ min: 1, max: 20 }), (text, maxRows) => {
    const p = parseCsv(text, { maxRows });
    for (const r of p.rows) assert.equal(r.length, p.headers.length);
    assert.ok(p.rows.length <= maxRows, `${p.rows.length} rows with maxRows ${maxRows}`);
  }), { numRuns: 400 });
});

test("property: a real-looking export ingests without throwing, keys are unique, types are text, and formula-like values are flagged", () => {
  fc.assert(fc.property(exportLike, (text) => {
    const result = ingestResourcesCsv(text, { maxRows: 50 });
    const keys = result.resources.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const r of result.resources) {
      assert.equal(typeof r.type, "string");
      assert.equal(Object.getPrototypeOf(r.tags), Object.prototype);
      // Tags are split into keys and values, and each key and value is checked on its own ("tag k: formula-like content ...").
      for (const [k, v] of Object.entries(r.tags)) {
        assert.equal(typeof v, "string");
        if (looksLikeFormula(k) || looksLikeFormula(v)) assert.ok(r.warnings.some((w) => w.startsWith(`tag ${k}:`)), `tag ${k}=${v}`);
      }
      for (const p of r.provenance) {
        if (p.normalizedHeader !== "tags" && typeof p.originalValue === "string" && looksLikeFormula(p.originalValue)) {
          assert.ok(r.warnings.some((w) => w.startsWith(`${p.normalizedHeader}:`) && w.includes("formula")), `${p.normalizedHeader}=${p.originalValue}`);
        }
      }
    }
  }), { numRuns: 300 });
});

test("property: ingestResourcesCsv never throws on arbitrary input and keeps within its row limit", () => {
  fc.assert(fc.property(fc.oneof(csvLike, fc.string({ unit: "binary", maxLength: 1500 })), (text) => {
    const result = ingestResourcesCsv(text, { maxRows: 50 });
    assert.ok(Array.isArray(result.resources));
    assert.ok(result.resources.length <= 50);
  }), { numRuns: 400 });
});

test("property: a value written with csvSafe reads back as itself, or with a leading ' when it looked like a formula", () => {
  // A cell that is only whitespace is dropped as an empty row by the parser, so the value carries a visible character.
  const value = fc.oneof(fc.constantFrom("@SUM(A1)", "+cmd", "\t=1", " =x", "-x", "-1", "=1+1"), fc.string({ unit: "binary", maxLength: 40 })).filter((v) => v.trim().length > 0);
  fc.assert(fc.property(value, (v) => {
    const back = parseCsv(`h\n${csvSafe(v)}\n`).rows[0]?.[0];
    assert.equal(back, looksLikeFormula(v) ? `'${v}` : v);
    // Independent of looksLikeFormula: what comes back is either neutralised with a leading ' or would not run as a formula.
    assert.ok(back?.startsWith("'") || !runsAsFormula(back ?? ""), `${JSON.stringify(v)} reads back as ${JSON.stringify(back)}`);
  }), { numRuns: 500 });
});

test("the formula guard catches the usual spreadsheet formula starts", () => {
  for (const v of ["=1+1", "+cmd", "@SUM(A1)", "\t=1", "\r=1", " =x", "-cmd", "\"=1"]) assert.ok(csvSafe(v).replace(/^"/, "").startsWith("'"), v);
  for (const v of ["-1", "-2.5", "vm1", "a=b"]) assert.ok(!csvSafe(v).startsWith("'"), v);
});

test("property: a table of plain cells written with csvSafe parses back cell for cell", () => {
  const plain = fc.stringMatching(/^[A-Za-z0-9 ,"./_:=+@-]{1,12}$/).filter((v) => v.trim().length > 0);
  fc.assert(fc.property(fc.integer({ min: 1, max: 5 }).chain((w) => fc.tuple(fc.constant(w), fc.array(fc.array(plain, { minLength: w, maxLength: w }), { minLength: 1, maxLength: 30 }))), ([w, rows]) => {
    const headers = Array.from({ length: w }, (_, i) => `c${i}`);
    const text = [headers.join(","), ...rows.map((r) => r.map(csvSafe).join(","))].join("\n");
    const p = parseCsv(text);
    assert.deepEqual(p.headers, headers);
    assert.deepEqual(p.rows, rows.map((r) => r.map((v) => (looksLikeFormula(v) ? `'${v}` : v))));
  }), { numRuns: 300 });
});
