// Property-based tests (fuzzing) for the Microsoft Learn move-support parser. fast-check generates many inputs per run and,
// when a property fails, shrinks the input to a small failing case and prints the seed to replay it.
// The parser reads a page fetched from the internet every week, so it must never throw or hang on whatever it is given.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { SUPPORT_STATES } from "@amo/domain";
import { parseLearnMoveSupport, normalizeLearnCell, learnLinkToUrl, diffRulesAgainstMatrix, loadRules, defaultRulesDir } from "./index.js";

const STATES = new Set<string>(SUPPORT_STATES);
const LEARN = "https://learn.microsoft.com/";

// Fragments the real page is made of, so random text reaches the parser's branches instead of being skipped line by line.
const FRAGMENTS = ["\n", "> ", ">", "|", " | ", "## ", "## Microsoft.Compute", "## microsoft.aadiam", "## Next steps", "<!--", "-->",
  "[!IMPORTANT]", "[!NOTE]", "[!div class=\"mx-tableFixed\"]", "See ", "See the corresponding ", "[move guidance]", "(./move-limitations/x.md)",
  "(/azure/x?toc=/a)", "(../../y.md)", "(http://[)", "(javascript:alert(1))", "(//evil.example/move)", "(http://example.com/move)",
  "(data:text/html,move)", "(https://example.com/move)", "Resource type", "| --- |", "| :--- |", "**Yes**", "No", "Pending", "Yes - with restrictions",
  "virtualmachines", " / ", "extensions", "(label)", "<br/>", "-"];
const pageLike = fc.array(fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ maxLength: 8 })), { maxLength: 200 }).map((parts) => parts.join(""));

const checkRows = (rows: ReturnType<typeof parseLearnMoveSupport>): void => {
  for (const r of rows) {
    assert.ok(r.resourceType.startsWith("microsoft."), r.resourceType);
    assert.equal(r.resourceType, r.resourceType.toLowerCase());
    for (const s of [r.resourceGroupMove, r.subscriptionMove, r.regionRelocation]) assert.ok(STATES.has(s), s);
    if (r.guidance) assert.ok(r.guidance.url.startsWith(LEARN), r.guidance.url);
  }
};

test("property: the parser never throws on arbitrary text, and every row it returns is well formed", () => {
  fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 2000 }), (text) => { checkRows(parseLearnMoveSupport(text)); }));
});

test("property: the parser never throws on text built from the page's own pieces, and every row is well formed", () => {
  fc.assert(fc.property(pageLike, (text) => { checkRows(parseLearnMoveSupport(text)); }), { numRuns: 500 });
});

test("property: every Learn cell normalises to a known support state", () => {
  fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 300 }), (cell) => { assert.ok(STATES.has(normalizeLearnCell(cell))); }));
});

test("property: a link becomes a learn.microsoft.com address or nothing, and never throws", () => {
  const href = fc.oneof(fc.string({ maxLength: 80 }), fc.constantFrom("javascript:alert(1)", "//evil.example/x", "http://learn.microsoft.com/x",
    "https://learn.microsoft.com.evil.example/x", "data:text/html,x", "http://[", "./move-limitations/x.md", "/azure/x?toc=/y", "../../z.md"));
  fc.assert(fc.property(href, (h) => {
    const url = learnLinkToUrl(h);
    if (url !== undefined) assert.ok(url.startsWith(LEARN), `${h} -> ${url}`);
  }), { numRuns: 300 });
});

test("property: a guidance note with any link never breaks the parse, and only a Learn link counts as guidance", () => {
  // Random page pieces rarely line up into "See [move guidance](link)", so this builds that sentence with random links.
  const href = fc.oneof(fc.stringMatching(/^[^\s)]{1,40}$/), fc.constantFrom("http://[", "javascript:alert(1", "//evil.example/move", "https://learn.microsoft.com.evil.example/x",
    "./move-limitations/x.md", "/azure/x?toc=/y", "../../backup/z.md"));
  fc.assert(fc.property(href, (h) => {
    const rows = parseLearnMoveSupport(`## Microsoft.X\n\n> [!IMPORTANT]\n> See [move guidance](${h}) to learn more.\n\n| Resource type | Resource group | Subscription | Region move |\n| --- | --- | --- | --- |\n| things | Yes | Yes | No |\n`);
    assert.equal(rows.length, 1);
    if (rows[0].guidance) assert.ok(rows[0].guidance.url.startsWith(LEARN), rows[0].guidance.url);
    assert.equal(rows[0].resourceGroupMove, rows[0].guidance ? "conditional" : "supported");
  }), { numRuns: 300 });
});

// Well-formed tables: a provider heading and rows of plain type names and cells.
const typeName = fc.stringMatching(/^[a-z][a-z0-9]{0,11}$/);
const cell = fc.constantFrom("**Yes**", "Yes", "No", "Pending", "Yes - with restrictions", "No <br/> See notes", "-");
const table = fc.record({
  provider: fc.stringMatching(/^[A-Z][A-Za-z]{1,10}$/),
  rows: fc.array(fc.tuple(typeName, cell, cell, cell), { minLength: 1, maxLength: 12 }),
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

test("property: the diff never reports a field where the rule and the first Learn row agree", () => {
  const rules = loadRules(defaultRulesDir()).rules;
  fc.assert(fc.property(pageLike, (text) => {
    const matrix = parseLearnMoveSupport(text);
    const first = new Map<string, (typeof matrix)[number]>();
    for (const m of matrix) if (!first.has(m.resourceType)) first.set(m.resourceType, m);
    for (const d of diffRulesAgainstMatrix(rules, matrix).diffs) {
      const row = first.get(d.resourceType.toLowerCase());
      assert.ok(row, d.resourceType);
      assert.notEqual(d.rule, d.learn);
      assert.equal(row[d.field], d.learn);
    }
  }), { numRuns: 200 });
});
