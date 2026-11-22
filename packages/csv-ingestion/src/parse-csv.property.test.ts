// Property-based tests (fuzzing) for CSV ingestion. The CSV comes from a person's upload, so the parser must never throw or
// hang on whatever it is given, and the formula guard must survive a round trip. fast-check prints the seed of a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { parseCsv, csvSafe, looksLikeFormula, ingestResourcesCsv } from "./index.js";

const csvLike = fc.array(fc.oneof(fc.constantFrom(",", ";", "\t", "|", "\"", "\"\"", "\n", "\r\n", "\r", "﻿", "=", "+", "-", "@",
  "Name", "Type", "Resource ID", "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm"),
fc.string({ maxLength: 6 })), { maxLength: 150 }).map((parts) => parts.join(""));

test("property: parseCsv never throws, every row has the header's width, and the row limit holds", () => {
  fc.assert(fc.property(fc.oneof(csvLike, fc.string({ unit: "binary", maxLength: 1500 })), fc.integer({ min: 1, max: 20 }), (text, maxRows) => {
    const p = parseCsv(text, { maxRows });
    for (const r of p.rows) assert.equal(r.length, p.headers.length);
    assert.ok(p.rows.length <= maxRows, `${p.rows.length} rows with maxRows ${maxRows}`);
  }), { numRuns: 400 });
});

// A file that starts with a real header row, so rows go all the way through ingestion instead of stopping at the header check.
const HEADER = ["Name", "Type", "Resource ID", "Resource group", "Location", "Tags"];
const cellValue = fc.oneof(fc.string({ unit: "binary", maxLength: 12 }), fc.constantFrom("=1+1", "+cmd", "-2", "@SUM(A1)", " =x", "vm1", "Microsoft.Compute/virtualMachines",
  "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1", "eastus", "a=b;c=d", "{\"k\":\"v\"}", ""));
const exportLike = fc.array(fc.array(cellValue, { minLength: HEADER.length, maxLength: HEADER.length }), { maxLength: 30 })
  .map((rows) => [HEADER.join(","), ...rows.map((r) => r.map(csvSafe).join(","))].join("\n"));

test("property: a real-looking export ingests without throwing, keys are unique, and every formula-like value is flagged", () => {
  fc.assert(fc.property(exportLike, (text) => {
    const result = ingestResourcesCsv(text, { maxRows: 50 });
    const keys = result.resources.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const r of result.resources) {
      // Tags are split into keys and values, and each key and value is checked on its own ("tag k: formula-like content ...").
      for (const [k, v] of Object.entries(r.tags)) {
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
  // A cell that is only whitespace is dropped as an empty row by the parser, so the value carries at least one visible character.
  const value = fc.string({ unit: "binary", maxLength: 40 }).filter((v) => v.trim().length > 0 && !v.includes("﻿"));
  fc.assert(fc.property(value, (v) => {
    const back = parseCsv(`h\n${csvSafe(v)}\n`).rows[0]?.[0];
    assert.equal(back, looksLikeFormula(v) ? `'${v}` : v);
  }), { numRuns: 500 });
});

test("property: a table of plain cells written with csvSafe parses back cell for cell", () => {
  const plain = fc.stringMatching(/^[A-Za-z0-9 ,"./_:-]{1,12}$/).filter((v) => v.trim().length > 0);
  fc.assert(fc.property(fc.integer({ min: 1, max: 5 }).chain((w) => fc.tuple(fc.constant(w), fc.array(fc.array(plain, { minLength: w, maxLength: w }), { minLength: 1, maxLength: 10 }))), ([w, rows]) => {
    const headers = Array.from({ length: w }, (_, i) => `c${i}`);
    const text = [headers.join(","), ...rows.map((r) => r.map(csvSafe).join(","))].join("\n");
    const p = parseCsv(text);
    assert.deepEqual(p.headers, headers);
    assert.deepEqual(p.rows, rows.map((r) => r.map((v) => (looksLikeFormula(v) ? `'${v}` : v))));
  }), { numRuns: 300 });
});
