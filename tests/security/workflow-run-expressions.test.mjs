import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// No `${{ }}` expression inside a `run:` script of any workflow. GitHub pastes such an expression into the script text
// before the shell runs it, so a value that contains shell syntax becomes code (zizmor's template-injection audit). The
// value goes into the step's or the job's `env:` and the script reads it as a quoted shell variable instead. Static check
// of the files (no YAML library; the workflows share one style): a `run:` line, and for `run: |` or `run: >` every line
// indented deeper than the key.

const DIR = ".github/workflows";

/** Each run script in a workflow, as { line, text } entries (1-based line numbers). */
function runScripts(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const body = [{ line: i + 1, text: m[3] }];
    if (/^[|>][-+]?\s*(#.*)?$/.test(m[3])) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() !== "" && l.length - l.trimStart().length <= keyIndent) break;
        body.push({ line: j + 1, text: l });
      }
    }
    found.push(body);
  }
  return found;
}

const offending = (source) =>
  runScripts(source)
    .flat()
    .filter(({ text }) => text.includes("${{"));

const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

test("no workflow pastes a ${{ }} expression into a run script", () => {
  assert.ok(workflows.length > 0);
  for (const file of workflows) {
    const hits = offending(readFileSync(`${DIR}/${file}`, "utf8"));
    assert.deepEqual(
      hits.map(({ line, text }) => `${file}:${line}: ${text.trim()}`),
      [],
      `${file}: move each expression into env: and read it as a quoted shell variable`,
    );
  }
});

test("scanners.yml: the OSV summary step reads the outcome from env", () => {
  const source = readFileSync(`${DIR}/scanners.yml`, "utf8").replace(/\r\n/g, "\n");
  assert.ok(runScripts(source).length >= 2, "scanners.yml has its run scripts");
  assert.match(source, /\n {8}env:\n {10}OSV_OUTCOME: \$\{\{ steps\.osv\.outcome \}\}\n {8}run: \|\n {10}if \[ "\$OSV_OUTCOME" = "success" \]/);
});

test("the check finds an expression in a one-line run, a block run and a list-item run, and ignores env and with", () => {
  const sample = [
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: echo ${{ github.ref }}",
    "      - name: block",
    "        env:",
    "          SAFE: ${{ steps.x.outcome }}",
    "        run: |",
    '          echo "$SAFE"',
    '          echo "${{ steps.x.outcome }}"',
    "      - uses: some/action@0000000000000000000000000000000000000000",
    "        with: { ref: \"${{ github.ref }}\" }",
    "      - run: >-",
    "          echo fine",
  ].join("\n");
  assert.deepEqual(
    offending(sample).map(({ line }) => line),
    [4, 10],
  );
});
