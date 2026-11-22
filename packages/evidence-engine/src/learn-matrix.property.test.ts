// Property-based tests (fuzzing) for the Microsoft Learn move-support parser. fast-check generates many inputs per run and,
// when a property fails, shrinks the input to a small failing case and prints the seed to replay it.
// The parser reads a page fetched from the internet every week, so it must never throw or hang on whatever it is given.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { SUPPORT_STATES } from "@amo/domain";
import { parseLearnMoveSupport, normalizeLearnCell, learnLinkToUrl, diffRulesAgainstMatrix, loadRules, defaultRulesDir, type LearnMatrixRow } from "./index.js";

// fast-check's default size ("small") keeps arrays to about 10 items whatever maxLength says; pages need more than that.
fc.configureGlobal({ baseSize: "medium" });

const STATES = new Set<string>(SUPPORT_STATES);
const LEARN = "https://learn.microsoft.com/";
const rules = loadRules(defaultRulesDir()).rules;

// A page built line by line from the shapes the real page uses, each line optionally inside a quote block ("> "), so the
// generated text reaches headings, notes, tables, rows, guidance and the diff instead of being skipped.
const cellA = fc.constantFrom("**Yes**", "Yes", "No", "Pending", "Yes - with restrictions", "**Yes** - Full <br> No - Incremental", "No <br/> See notes", "-", "");
const typeA = fc.oneof(fc.constantFrom("virtualmachines", "disks", "availabilitysets", "networkinterfaces", "virtualnetworks", "sites", "storageaccounts",
  "virtualmachines (Cloud Services)", "virtualmachines / extensions", "certificates (managed)"), fc.string({ maxLength: 8 }));
const hrefA = fc.oneof(fc.constantFrom("./move-limitations/x.md", "/azure/x?toc=/a", "../../backup/y.md", "http://[", "javascript:alert(1)", "//evil.example/move",
  "https://user@learn.microsoft.com/x", "https://learn.microsoft.com:8443/x", "https://fakelearn.microsoft.com/x", "data:text/html,move"), fc.string({ maxLength: 12 }));
const lineA = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom("## Microsoft.Compute", "## Microsoft.Network", "## Microsoft.Web", "## Microsoft.Storage", "## microsoft.aadiam", "## Next steps",
    "", "<!--", "-->", "[!IMPORTANT]", "[!NOTE]", "[!div class=\"mx-tableFixed\"]",
    "| Resource type | Resource group | Subscription | Region move |", "| ------------- | ----------- | ---------- | ----------- |", "| :--- | :---: | ---: | --- |") },
  { weight: 1, arbitrary: hrefA.map((h) => `See [move guidance](${h}) to learn more.`) },
  // A whole note, as on the page: a quoted [!IMPORTANT] line followed by a quoted "See [...](...)" line.
  { weight: 2, arbitrary: hrefA.map((h) => `> [!IMPORTANT]\n> See [move guidance](${h}) to learn more.\n`) },
  { weight: 4, arbitrary: fc.tuple(typeA, cellA, cellA, cellA).map(([t, a, b, c]) => `| ${t} | ${a} | ${b} | ${c} |`) },
  { weight: 1, arbitrary: fc.string({ maxLength: 20 }) },
);
const pageA = fc.array(fc.tuple(fc.boolean(), lineA).map(([q, l]) => (q ? `> ${l}` : l)), { maxLength: 80 }).map((ls) => ls.join("\n"));

const checkRows = (rows: LearnMatrixRow[]): void => {
  for (const r of rows) {
    assert.ok(r.resourceType.startsWith("microsoft."), r.resourceType);
    assert.equal(r.resourceType, r.resourceType.toLowerCase());
    for (const s of [r.resourceGroupMove, r.subscriptionMove, r.regionRelocation]) assert.ok(STATES.has(s), s);
    if (r.guidance) assert.ok(r.guidance.url.startsWith(LEARN), r.guidance.url);
  }
};

test("the page generator reaches rows, guidance and disagreements (so the properties below are not empty)", () => {
  const pages = fc.sample(pageA, { numRuns: 500, seed: 1 });
  const parsed = pages.map((p) => parseLearnMoveSupport(p));
  const withRows = parsed.filter((r) => r.length > 0).length;
  const withGuidance = parsed.filter((r) => r.some((x) => x.guidance)).length;
  const withDiffs = parsed.filter((r) => diffRulesAgainstMatrix(rules, r).diffs.length > 0).length;
  assert.ok(withRows > 150 && withGuidance > 10 && withDiffs > 50, `rows ${withRows}, guidance ${withGuidance}, diffs ${withDiffs} of 500`);
});

test("property: the parser never throws on arbitrary text, and every row it returns is well formed", () => {
  fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 2000 }), (text) => { checkRows(parseLearnMoveSupport(text)); }));
});

test("property: the parser never throws on a page-shaped text, and every row it returns is well formed", () => {
  fc.assert(fc.property(pageA, (text) => { checkRows(parseLearnMoveSupport(text)); }), { numRuns: 500 });
});

test("property: every Learn cell normalises to a known support state", () => {
  fc.assert(fc.property(fc.oneof(cellA, fc.string({ unit: "binary", maxLength: 300 })), (cell) => { assert.ok(STATES.has(normalizeLearnCell(cell))); }));
});

test("property: a link becomes a learn.microsoft.com address or nothing, and never throws", () => {
  fc.assert(fc.property(fc.oneof(hrefA, fc.string({ maxLength: 80 })), (h) => {
    const url = learnLinkToUrl(h);
    if (url !== undefined) assert.ok(url.startsWith(LEARN), `${h} -> ${url}`);
  }), { numRuns: 300 });
});

test("property: a guidance note with any link never breaks the parse, and only a Learn link counts as guidance", () => {
  fc.assert(fc.property(hrefA, (h) => {
    const rows = parseLearnMoveSupport(`## Microsoft.X\n\n> [!IMPORTANT]\n> See [move guidance](${h}) to learn more.\n\n| Resource type | Resource group | Subscription | Region move |\n| --- | --- | --- | --- |\n| things | Yes | Yes | No |\n`);
    assert.equal(rows.length, 1);
    if (rows[0].guidance) assert.ok(rows[0].guidance.url.startsWith(LEARN), rows[0].guidance.url);
    assert.equal(rows[0].resourceGroupMove, rows[0].guidance ? "conditional" : "supported");
  }), { numRuns: 300 });
});

// Well-formed tables: a provider heading and rows of plain type names and cells.
const table = fc.record({
  provider: fc.stringMatching(/^[A-Z][A-Za-z]{1,10}$/),
  rows: fc.array(fc.tuple(fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/), cellA, cellA, cellA), { minLength: 1, maxLength: 12 }),
}).map(({ provider, rows }) => [
  `## Microsoft.${provider}`, "",
  "| Resource type | Resource group | Subscription | Region move |", "| ------------- | ----------- | ---------- | ----------- |",
  ...rows.map(([t, a, b, c]) => `| ${t} | ${a} | ${b} | ${c} |`), "",
].join("\n"));

test("property: a table reads the same inside a quote block as outside it", () => {
  fc.assert(fc.property(table, (md) => {
    const quoted = md.split("\n").map((l) => (l ? `> ${l}` : l)).join("\n");
    assert.deepEqual(parseLearnMoveSupport(quoted), parseLearnMoveSupport(md));
  }));
});

test("property: an HTML comment hides exactly what it wraps", () => {
  fc.assert(fc.property(table, table, (shown, hidden) => {
    assert.deepEqual(parseLearnMoveSupport(`${shown}\n<!--\n${hidden}\n-->\n`), parseLearnMoveSupport(shown));
  }));
});

test("property: the diff reports exactly the fields where a rule and the chosen Learn row disagree", () => {
  fc.assert(fc.property(pageA, (text) => {
    const matrix = parseLearnMoveSupport(text);
    // The row the diff compares with: the first for a type, except that a plain row beats a labelled one ("certificates (managed)").
    const chosen = new Map<string, LearnMatrixRow>();
    for (const m of matrix) {
      const seen = chosen.get(m.resourceType);
      if (!seen || (seen.variant !== undefined && m.variant === undefined)) chosen.set(m.resourceType, m);
    }
    const reported = new Set<string>();
    for (const d of diffRulesAgainstMatrix(rules, matrix).diffs) {
      const row = chosen.get(d.resourceType.toLowerCase());
      assert.ok(row, d.resourceType);
      assert.notEqual(d.rule, d.learn);
      assert.equal(row[d.field], d.learn);
      reported.add(`${d.ruleId}|${d.field}`);
    }
    // And nothing is missed: every disagreement on a known state is reported.
    for (const r of rules) {
      const row = chosen.get(r.resourceType.toLowerCase());
      if (!row) continue;
      for (const f of ["resourceGroupMove", "subscriptionMove", "regionRelocation"] as const) {
        if (row[f] !== "unknown" && row[f] !== r.support[f]) assert.ok(reported.has(`${r.ruleId}|${f}`), `${r.ruleId} ${f} missed`);
      }
    }
  }), { numRuns: 400 });
});
