import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every workflow job that runs Node.js or Python chooses its version (saulpatinojr/HCW-HybridCloudWorks#1707).
//
// A job that runs `node`, `npm`, `npx`, `python3`, `pip`, `uv` or `uvx` without actions/setup-node or
// actions/setup-python gets whatever the runner image ships: on ubuntu-26.04 that was Node.js 24 and Python 3.14 in
// November 2026, both below the program's floors (Node.js 26, Python 3.15). Nothing else notices, because a job that
// names no version has nothing to read. This is a copy of HCW-MigrateOrchestrator_AddOn's
// tests/security/workflow-runtime-setup.test.mjs, itself a port of the website's check (scripts/workflow-runtime-setup.test.mjs
// in HCW-HybridCloudWorks); keep the logic the same in each copy and change only the lists and comments. The three Python
// add-ons carry the same check as tests/security/test_workflow_runtime_setup.py, and the Python App repositories as
// tests/unit/test_workflow_runtime_setup.py; INDIRECT_RUNTIME below comes from those. `uv` and `uvx` count as Python, because
// uv runs the interpreter it finds, the runner's own unless one was set up; so astral-sh/setup-uv counts as setting
// Python up only when it is given a `python-version` at or above the floor.
//
// A command counts when it is in command position on a line of a `run:` step: at the start, after `$(`, `<(`, a
// backtick, `(`, `{`, `|`, `&` or `;`, after a `case` pattern at the start of a line (`check)`), after leading
// `NAME=value` assignments (the value plain text, a quoted string, or both run together), or after a word that runs the
// next one (`env`, `sudo`, `xargs`, `exec`, `time`, `nice`, `!`, `if`, `then`, `do` and the like) and that word's
// options (`sudo -u nobody`, `env -i`). It counts with a path in front too (`/usr/bin/python3`, `./venv/bin/python`),
// because a path to the runner's interpreter is still the runner's, and `python3.15.2` counts like `python3`. It does
// not count in a comment, a heredoc's body, a quoted string (unless a double-quoted string runs a command with `$(`,
// `<(` or a backtick; a single-quoted one may run over several lines, as a `docker run image bash -c '...'` script
// does) or as an argument (`docker run image python ...`, or the first word of a line that continues the one before
// it). The set-up step must come before the first such step. Limits, on purpose: a job that runs in a `container:` uses
// that image's runtime and is not checked; and a script or program a step calls (a `.sh` file, `pipx`) is not read, so a
// step that starts a runtime that way is listed in INDIRECT_RUNTIME.
//
// A set-up step with its own `if:` may be skipped while a later command still runs on the runner's own interpreter
// (Copilot on HCW-NetworkEyes_AddOn#100), so it covers a later step only when that step's `if:` is the same condition,
// or is one of the terms the set-up's condition joins with a top-level `||` (whenever that step runs, so did the
// set-up). Conditions are compared without a surrounding `${{ }}`, with runs of spaces made one, and a term without
// one pair of parentheses around the whole of it. A set-up step with no `if:` covers every later step whose condition
// does not test the job's status. A job's own `if:` does not matter here, because it decides whether every step of the
// job runs, alike.
//
// The job's status is compared on its own. Without `always()`, `failure()`, `cancelled()` or `success()` in it, a step's
// condition includes an unwritten `success()`, so a set-up step with no `if:` is skipped once an earlier step has
// failed, while a later `if: always()`, `failure()` or `!cancelled()` step still runs (Copilot on
// HCW-MigrateOrchestrator_AddOn#72). So after each job status (success, a failure, a cancel) a later step may run
// after, its set-up step must surely run, or depend on the same thing by the rule above, applied to the conditions with
// their status-only `&&` terms taken out. `||`, `&&`, `!` and parentheses are followed: `always() && !cancelled()` runs
// after success and failure, not after a cancel.
//
// Each set-up step must also ask for the floor or newer (Copilot on HCW-CloudCrawler_App#81): `python-version` or
// `python-version-file`, `node-version` or `node-version-file`, read through `${{ env.X }}` (the step's, job's or
// workflow's `env:`), `${{ matrix.X }}` (every entry of the job's matrix list) and the named file. A version that names
// a line only (`26`, `26.x`, `3.15`) stands for that line's newest release, so it passes when the line is at or above
// the floor's; an exact version (`26.10.0`) must be at or above the floor itself; anything else (`26.11.0-rc.1`,
// `26.11.0.0`, `lts/*`) cannot be compared. A value this test cannot work out fails it, naming the step, rather than
// passing unchecked.
//
// The workflows are read with a small line reader rather than a YAML library, because none is a dependency here. It
// relies on the layout every workflow in this repository has (a `jobs:` key at the top level, a `steps:` list, block
// `run: |` scripts, `with:` and `env:` written `{ ... }` or as indented `key: value` lines); a file it cannot read that
// way fails the test rather than being skipped.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

// Steps that use the runner's own interpreter on purpose, each with its reason, keyed by
// "file > job > step name > runtime". Keyed by step, not job, so a new step in the same job is still checked. A new
// entry needs a reason a reviewer can check, and a comment above the step in the workflow saying the same.
const RUNNER_DEFAULT_ALLOWED = {};

// Steps that start a runtime indirectly, through a program the step runs, which the command check cannot see in the
// `run:` text. Each counts as running that runtime, so its set-up step must come first. Same keys, each with a reason.
const INDIRECT_RUNTIME = {
  "iac-validate.yml > terraform > checkov > python":
    "pipx is a Python program, and `pipx run` installs checkov into a virtual environment of the Python it is given",
  "release-cli.yml > sea > Build the single-file binary > node": "`bash scripts/build-sea.sh` runs `node` and `npx esbuild`, and copies that node into the binary",
};

// Where a command may start: the line's start or an opening or joining character, then any `NAME=value` assignments
// (the value plain text, a quoted string, or both run together: `FOO="a b"`) and words that run the next word
// (`env FOO=1 node`, `sudo node`, `if node ...; then`).
const ASSIGNMENT = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'])*\s+`;
// Words that run the next word, each with the options it may take first: the letters of the options that take an
// argument (`sudo -u nobody`, `nice -n 10`), any other `-x`/`--long` flag, and the `--` that ends the options
// (`env -- node`). `timeout` also takes its duration (`timeout 60 node`). `command` only with `-p` or `--`, because
// `command -v node` looks node up and runs nothing. Ported from the website's copy (HCW-HybridCloudWorks#1707).
const WRAPPER_OPTIONS = {
  env: "uCS",
  sudo: "ugCDhprtU",
  xargs: "InPLdaEs",
  exec: "a",
  time: "of",
  nice: "n",
  nohup: "",
  stdbuf: "ioe",
  timeout: "sk",
};
const optionsOf = (takes) =>
  String.raw`(?:\s+(?:${takes ? String.raw`-[A-Za-z]*[${takes}]\s*[^\s-]\S*|` : ""}--?\w[\w-]*(?:=\S+)?|--(?=\s)))*`;
const WRAPPERS = [
  ...Object.entries(WRAPPER_OPTIONS).map(([word, takes]) =>
    word === "timeout"
      ? String.raw`timeout${optionsOf(takes)}\s+\d+(?:\.\d+)?[smhd]?\s+`
      : String.raw`${word}${optionsOf(takes)}\s+`,
  ),
  String.raw`command(?:\s+(?:-p|--(?=\s)))*\s+`,
  String.raw`(?:if|then|else|elif|do|while|until|!)\s+`,
].join("|");
// A `case` pattern that ends at the start of a line (`check)`, `a|b)`), after which a command may follow.
const CASE_PATTERN = String.raw`^[^()\s|]+(?:\|[^()\s|]+)*\)\s*`;
const START = String.raw`(?:^|[$<]\(\s*|\`\s*|[({|;&]\s*|${CASE_PATTERN})(?:${ASSIGNMENT}|${WRAPPERS})*`;
// A runtime may be named with a path in front (`/usr/bin/python3`, `./venv/bin/python`): a path to the runner's own
// interpreter is still the runner's. The path holds no `=`, so an assignment (`NODE=/x/node`) is not a command.
const PATH = String.raw`(?:[^\s=]*/)?`;
const COMMAND = {
  node: new RegExp(`${START}${PATH}(?:node|npm|npx)(?=\\s|$)`),
  python: new RegExp(`${START}${PATH}(?:python(?:3(?:\\.\\d+){0,2})?|pip3?|uvx?)(?=\\s|$)`),
};
const SETUP = { node: /^actions\/setup-node@/, python: /^actions\/setup-python@/ };
// astral-sh/setup-uv sets Python up only when given a `python-version` (see `setsUp`).
const SETUP_UV = /^astral-sh\/setup-uv@/;

// The lowest versions a set-up step may ask for. The program's floors are kept in scripts/version-floors.json in
// HCW-HybridCloudWorks; change them there first, then here.
const PYTHON_FLOOR = [3, 15, 0];
const NODE_FLOOR = [26, 11, 0];
const FLOORS = { python: PYTHON_FLOOR, node: NODE_FLOOR };
// The job statuses a step can run after, and the status functions that name them.
const STATUSES = ["success", "failure", "cancelled"];
const STATUS_CALL = /(!?)\s*\b(always|failure|cancelled|success)\(\s*\)/g;
const HAS_STATUS = /\b(?:always|failure|cancelled|success)\(\s*\)/;
// The set-up step's inputs that name the version, directly or through a file in the repository.
const VERSION_INPUTS = {
  python: ["python-version", "python-version-file"],
  node: ["node-version", "node-version-file"],
};

/**
 * The script as the shell reads it, for finding commands: comments and heredoc bodies dropped, a line that ends in `\`
 * joined to the next (so the next line's first word is still an argument), single-quoted text emptied, and double-quoted
 * text emptied unless it runs a command (`"$(node x)"`, or the older "`node x`"). An escaped backtick (`\``, as in
 * Markdown written to the step summary) is a plain character. A quoted string may run over several lines, as the script
 * of `docker run image bash -c '...'` does; what it runs is the container's, not the runner's.
 */
export function shellText(run) {
  const out = [];
  let heredocs = [];
  let i = 0;
  const n = run.length;
  while (i < n) {
    const char = run[i];
    if (char === "\\" && i + 1 < n) {
      out.push(run[i + 1] === "\n" ? " " : run[i + 1] === "`" ? "" : run.slice(i, i + 2));
      i += 2;
    } else if (char === "'") {
      const end = run.indexOf("'", i + 1);
      out.push("''");
      i = end === -1 ? n : end + 1;
    } else if (char === '"') {
      let j = i + 1;
      let text = "";
      while (j < n && run[j] !== '"') {
        const step = run[j] === "\\" && j + 1 < n ? 2 : 1;
        text += run.slice(j, j + 2) === "\\`" ? "" : run.slice(j, j + step);
        j += step;
      }
      out.push(/[$<]\(|`/.test(text) ? `"${text}"` : '""');
      i = j + 1;
    } else if (char === "#" && (i === 0 || " \t\n;".includes(run[i - 1]))) {
      const end = run.indexOf("\n", i);
      i = end === -1 ? n : end;
    } else if (run.startsWith("<<", i) && !run.startsWith("<<<", i)) {
      const found = run.slice(i).match(/^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (found) heredocs.push(found[2]);
      out.push("<<");
      i += found ? found[0].length : 2;
    } else if (char === "\n" && heredocs.length) {
      out.push("\n");
      i += 1;
      for (const delimiter of heredocs) {
        while (i < n) {
          const end = run.indexOf("\n", i) === -1 ? n : run.indexOf("\n", i);
          const line = run.slice(i, end);
          i = end + 1;
          if (line.trim() === delimiter) break;
        }
      }
      heredocs = [];
    } else {
      out.push(char);
      i += 1;
    }
  }
  return out.join("");
}

/** True when a run script calls the runtime in command position (see `shellText` for what is left out). */
export function runsRuntime(run, kind) {
  return shellText(String(run ?? ""))
    .split("\n")
    .some((line) => COMMAND[kind].test(line.trim()));
}

const indentOf = (line) => line.length - line.trimStart().length;
const meaningful = (line) => line.trim() !== "" && !line.trimStart().startsWith("#");
const unquote = (value) => {
  const v = value.trim();
  return v.length >= 2 && v[0] === v.at(-1) && `'"`.includes(v[0]) ? v.slice(1, -1) : v;
};
// The common leading spaces of the non-blank lines removed, as Python's textwrap.dedent does.
const dedent = (lines) => {
  const width = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
  return lines.map((l) => (l.trim() ? l.slice(width) : "")).join("\n");
};

const withoutComment = (text) => text.replace(/\s+#.*$/, "");

/** A one-line `{ key: value, ... }` mapping, split on the commas outside quotes and `${{ }}`. */
function flowMapping(text) {
  const inner = text.slice(text.indexOf("{") + 1, text.lastIndexOf("}"));
  const parts = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  const mapping = {};
  for (const part of parts.filter((p) => p.trim())) {
    const colon = part.indexOf(":");
    mapping[part.slice(0, colon).trim()] = unquote(part.slice(colon + 1));
  }
  return mapping;
}

/** The lines under the key on line `at` (at `indent` spaces), up to the next line at that indent or less. */
function blockUnder(lines, at, indent) {
  const block = [];
  for (const line of lines.slice(at + 1)) {
    if (meaningful(line) && indentOf(line) <= indent) break;
    block.push(line);
  }
  return block;
}

/** The mapping under the key on line `at`: a `{ ... }` on the same line, or the `key: value` lines below it. */
function mappingAt(lines, at, indent) {
  const rest = withoutComment(lines[at].slice(lines[at].indexOf(":") + 1)).trim();
  if (rest.startsWith("{")) return flowMapping(rest);
  const block = blockUnder(lines, at, indent);
  const keyed = block.filter(meaningful);
  const inner = keyed.length ? Math.min(...keyed.map(indentOf)) : indent + 2;
  const mapping = {};
  for (const line of block) {
    const m = line.match(new RegExp(`^ {${inner}}([A-Za-z0-9_.-]+):[ \\t]*(.*)$`));
    if (m) mapping[m[1]] = unquote(withoutComment(m[2]));
  }
  return mapping;
}

/** The lists of a job's `strategy: matrix:`, each written `[a, b]` or as `- a` lines; {} when it has none. */
function matrixOf(job, keyIndent) {
  const strategy = job.findIndex((line) => new RegExp(`^ {${keyIndent}}strategy:\\s*(?:#.*)?$`).test(line));
  if (strategy === -1) return {};
  const block = blockUnder(job, strategy, keyIndent);
  const at = block.findIndex((line) => /^\s+matrix:\s*(?:#.*)?$/.test(line));
  if (at === -1) return {};
  const lines = blockUnder(block, at, indentOf(block[at]));
  const keyed = lines.filter(meaningful);
  const inner = keyed.length ? Math.min(...keyed.map(indentOf)) : 0;
  const found = {};
  lines.forEach((line, i) => {
    const m = line.match(new RegExp(`^ {${inner}}([A-Za-z0-9_-]+):[ \\t]*(.*)$`));
    if (!m) return;
    const rest = withoutComment(m[2]).trim();
    found[m[1]] = rest.startsWith("[")
      ? rest
          .replace(/^\[|\]$/g, "")
          .split(",")
          .filter((v) => v.trim())
          .map(unquote)
      : blockUnder(lines, i, inner)
          .filter((item) => item.trim().startsWith("- "))
          .map((item) => unquote(item.trim().slice(2)));
  });
  return found;
}

/**
 * Every key of one step, among them `name`, `uses`, `run`, `if`, and `with` and `env` as mappings (its first line's
 * `- ` already turned into spaces).
 */
function stepKeys(lines, keyIndent) {
  const keys = {};
  const keyLine = new RegExp(`^ {${keyIndent}}([A-Za-z_-]+):[ \\t]*(.*)$`);
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(keyLine);
    i += 1;
    if (!match) continue;
    const [, key, rest] = match;
    if (key === "with" || key === "env") {
      keys[key] = mappingAt(lines, i - 1, keyIndent);
      i += blockUnder(lines, i - 1, keyIndent).length;
    } else if (/^[|>][+-]?\d?\s*(?:#.*)?$/.test(rest)) {
      const block = [];
      while (i < lines.length && (!lines[i].trim() || indentOf(lines[i]) > keyIndent)) block.push(lines[i++]);
      keys[key] = block.some((l) => l.trim()) ? dedent(block).replace(/^\n+|\n+$/g, "") : "";
    } else if (key === "uses") {
      keys[key] = rest.split(/\s+/)[0] ?? "";
    } else {
      keys[key] = unquote(key === "run" ? rest : withoutComment(rest));
    }
  }
  return keys;
}

/**
 * Every job of a workflow: {name: {container, env, matrix, steps: [{name, uses, run, if, with, env}, ...]}}. A job's
 * `env` holds the workflow's `env:` with the job's own on top.
 */
export function readJobs(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const topEnv = lines.findIndex((line) => /^env:\s*(?:#.*)?$|^env:\s*\{/.test(line));
  const workflowEnv = topEnv === -1 ? {} : mappingAt(lines, topEnv, 0);
  const starts = lines.flatMap((line, i) => (/^jobs:\s*(?:#.*)?$/.test(line) ? [i] : []));
  assert.equal(starts.length, 1, "expected one top-level jobs: key");
  const body = [];
  for (const line of lines.slice(starts[0] + 1)) {
    if (meaningful(line) && indentOf(line) === 0) break;
    body.push(line);
  }
  const jobIndent = Math.min(...body.filter(meaningful).map(indentOf));
  const heads = body.flatMap((line, i) => (meaningful(line) && indentOf(line) === jobIndent ? [i] : []));
  const jobs = {};
  heads.forEach((head, n) => {
    const match = body[head].match(new RegExp(`^ {${jobIndent}}([A-Za-z0-9_-]+):\\s*(?:#.*)?$`));
    assert.ok(match, `cannot read the job line ${JSON.stringify(body[head])}`);
    const job = body.slice(head + 1, n + 1 < heads.length ? heads[n + 1] : body.length);
    const keyLines = job.filter(meaningful);
    const keyIndent = keyLines.length ? Math.min(...keyLines.map(indentOf)) : jobIndent + 2;
    const container = job.some((line) => new RegExp(`^ {${keyIndent}}container:`).test(line));
    const envAt = job.findIndex((line) => new RegExp(`^ {${keyIndent}}env:`).test(line));
    const env = { ...workflowEnv, ...(envAt === -1 ? {} : mappingAt(job, envAt, keyIndent)) };
    const stepsAt = job.findIndex((line) => new RegExp(`^ {${keyIndent}}steps:\\s*(?:#.*)?$`).test(line));
    const steps = [];
    if (stepsAt !== -1) {
      const rest = job.slice(stepsAt + 1);
      const first = rest.find(meaningful);
      assert.ok(first?.trimStart().startsWith("- "), `job ${match[1]}: steps: is not a list`);
      const dash = indentOf(first);
      let current = null;
      for (const line of rest) {
        if (meaningful(line) && (indentOf(line) < dash || (indentOf(line) === dash && !line.trimStart().startsWith("- ")))) break;
        if (meaningful(line) && indentOf(line) === dash) {
          if (current) steps.push(stepKeys(current, dash + 2));
          current = [" ".repeat(dash + 2) + line.slice(dash + 2)];
        } else if (current) {
          current.push(line);
        }
      }
      if (current) steps.push(stepKeys(current, dash + 2));
    }
    jobs[match[1]] = { container, env, matrix: matrixOf(job, keyIndent), steps };
  });
  return jobs;
}

/** An `if:` expression without a surrounding `${{ }}` and with runs of spaces made one. */
const normalized = (expression) =>
  expression
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** The term without one pair of parentheses, when that pair encloses the whole of it. */
function withoutOuterParentheses(term) {
  if (!(term.startsWith("(") && term.endsWith(")"))) return term;
  let depth = 0;
  for (let i = 0; i < term.length; i += 1) {
    if (term[i] === "(") depth += 1;
    if (term[i] === ")") depth -= 1;
    if (depth === 0 && i < term.length - 1) return term;
  }
  return term.slice(1, -1).trim();
}

/**
 * The terms an expression joins with `||` (or `&&`) outside parentheses and quotes, each without one pair of
 * parentheses around the whole of it (unless `unwrap` is false); one item when there is no such operator.
 */
function topLevelTerms(expression, operator = "||", unwrap = true) {
  const terms = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (depth === 0 && expression.startsWith(operator, i)) {
      terms.push(expression.slice(start, i));
      start = i + operator.length;
      i += operator.length - 1;
    }
  }
  terms.push(expression.slice(start));
  return terms.map((term) => (unwrap ? withoutOuterParentheses(term.trim()) : term.trim()));
}

/** A step's `if:` as one comparable expression ("" when it has none). */
export const condition = (step) => normalized(String(step?.if ?? ""));

/**
 * Whether a condition holds after the job so far ended in `status` (success, failure or cancelled): true, false, or
 * null when it also depends on something else (`steps.x.outputs.y == 'true'`). `||`, `&&`, `!` and parentheses are
 * followed, so `always() && !cancelled()` holds after success and failure only; anything that is not a status function
 * or `true`/`false` is unknown.
 */
function statusValue(expression, status) {
  let text = expression.trim();
  while (withoutOuterParentheses(text) !== text) text = withoutOuterParentheses(text);
  for (const [operator, decides] of [
    ["||", true],
    ["&&", false],
  ]) {
    const terms = topLevelTerms(text, operator, false);
    if (terms.length > 1) {
      const values = terms.map((term) => statusValue(term, status));
      if (values.includes(decides)) return decides;
      return values.includes(null) ? null : !decides;
    }
  }
  if (text.startsWith("!") && !text.startsWith("!=")) {
    const value = statusValue(text.slice(1), status);
    return value === null ? null : !value;
  }
  const call = text.match(/^(always|failure|cancelled|success)\(\s*\)$/);
  if (call) return call[1] === "always" || call[1] === status;
  return text === "true" ? true : text === "false" ? false : null;
}

/**
 * `statusValue` of a step's whole condition, with GitHub's unwritten `success() &&` in front of one that names no status
 * function (and of no condition at all).
 */
function runsAfter(expression, status) {
  if (!HAS_STATUS.test(expression) && status !== "success") return false;
  return expression ? statusValue(expression, status) : true;
}

/** The job statuses a step with this condition may run after (`success` alone for no status function). */
export const statuses = (expression) => new Set(STATUSES.filter((status) => runsAfter(expression, status) !== false));

/** The condition without its top-level `&&` terms that test only the job's status (`always()`, `!cancelled()`). */
function withoutStatus(expression) {
  const terms = topLevelTerms(expression, "&&", false);
  const kept = terms.filter((term) => term.replace(STATUS_CALL, "").replace(/[\s!()&|]/g, ""));
  return kept.length === terms.length ? expression : kept.join(" && ");
}

/**
 * True when a set-up step runs whenever the later step does: after every job status the later step may run after, the
 * set-up step surely runs, or its condition depends on the same thing (status terms aside: the same condition, or one
 * of the terms it joins with a top-level `||`).
 */
export function covers(setup, step) {
  const [given, wanted] = [condition(setup), condition(step)];
  for (const status of [...STATUSES].sort()) {
    if (runsAfter(wanted, status) === false) continue;
    const runs = runsAfter(given, status);
    if (runs === false) return false;
    if (runs === null) {
      const [rest, need] = [withoutStatus(given), withoutStatus(wanted)];
      if (!(rest === "" || rest === need || topLevelTerms(rest, "||").includes(need))) return false;
    }
  }
  return true;
}

/** The key a step is named by in the lists above and in failures: "file > job > step > kind". */
const stepKey = (file, name, step, i, kind) => `${file} > ${name} > ${step.name || `step ${i + 1}`} > ${kind}`;

/**
 * The steps of one workflow that run a runtime before (or without) setting it up: "file > job > step > kind". A step
 * needs an earlier set-up step that covers it (see `covers`). A step named in `indirect` counts as running its runtime
 * even when its `run:` text does not show it.
 */
export function unsetSteps(file, jobs, indirect = INDIRECT_RUNTIME) {
  const found = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (job.container) continue;
    for (const kind of Object.keys(COMMAND)) {
      job.steps.forEach((step, i) => {
        const key = stepKey(file, name, step, i, kind);
        if (!(runsRuntime(step.run, kind) || key in indirect)) return;
        const covered = job.steps
          .slice(0, i)
          .some((earlier) => setsUp(earlier, job, kind) && covers(earlier, step));
        if (!covered) found.push(key);
      });
    }
  }
  return found;
}

/**
 * The plain values an input stands for: itself, or what `${{ env.X }}` (the step's, job's or workflow's `env:`) or
 * `${{ matrix.X }}` (every entry of the job's matrix list) holds. null when it cannot be worked out here.
 */
function resolved(value, step, job, depth = 0) {
  const found = String(value)
    .trim()
    .match(/^\$\{\{\s*(env|matrix)\.([A-Za-z0-9_-]+)\s*\}\}$/);
  if (!found) return String(value).includes("${{") ? null : [String(value).trim()];
  const [, source, name] = found;
  if (source === "env") {
    const env = { ...(job.env ?? {}), ...(step.env ?? {}) };
    return name in env && depth < 5 ? resolved(env[name], step, job, depth + 1) : null;
  }
  return job.matrix?.[name]?.length ? job.matrix[name] : null;
}

/**
 * True for a step that sets the runtime up: actions/setup-node or actions/setup-python, or, for Python,
 * astral-sh/setup-uv given a `python-version`.
 */
export function isSetUp(step, kind) {
  if (kind === "python" && SETUP_UV.test(step.uses ?? "")) return "python-version" in (step.with ?? {});
  return SETUP[kind].test(step.uses ?? "");
}

/**
 * True when the step chooses the runtime for the steps after it. setup-uv counts only with a `python-version` at or
 * above the floor (a lower one is also reported by the floor test); without one uv uses the runner's Python.
 */
export function setsUp(step, job, kind, root = ROOT) {
  if (!isSetUp(step, kind)) return false;
  if (!SETUP_UV.test(step.uses ?? "")) return true;
  const versions = requestedVersions(step, job, kind, root);
  return Boolean(versions) && versions.every((version) => belowFloor(version, kind) === false);
}

/** The versions a set-up step asks for, read through `env`, `matrix` and a version file; null when unreadable. */
export function requestedVersions(step, job, kind, root = ROOT) {
  const [direct, fromFile] = VERSION_INPUTS[kind];
  const given = step.with ?? {};
  if (direct in given) return resolved(given[direct], step, job);
  if (!(fromFile in given)) return null;
  const paths = resolved(given[fromFile], step, job) ?? [];
  if (paths.length !== 1 || !existsSync(join(root, paths[0]))) return null;
  const lines = readFileSync(join(root, paths[0]), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return lines.length ? lines : null;
}

/**
 * true when the version is under the floor, false when at or above it, null when it is not one of the forms this test
 * reads: `N`, `N.x` and `N.M` name a line and mean its newest release, so only their numbers are compared with the
 * floor's (`26` with 26, `3.15` with 3.15); `N.M.P` is exact and compared in full. Anything else, trailing text included
 * (`26.11.0-rc.1`, `26.11.0.0`, `lts/*`), is null, so the floor test names the step.
 */
export function belowFloor(version, kind) {
  const found = String(version)
    .trim()
    .match(/^v?(\d+)(?:\.x|\.(\d+)(?:\.(\d+))?)?$/);
  if (!found) return null;
  const numbers = found
    .slice(1)
    .filter((number) => number !== undefined)
    .map(Number);
  const floor = FLOORS[kind];
  for (let i = 0; i < numbers.length; i += 1) if (numbers[i] !== floor[i]) return numbers[i] < floor[i];
  return false;
}

/** Every set-up step that asks for a version below the floor, or one this test cannot read, with the reason. */
export function floorProblems(file, jobs, root = ROOT) {
  const problems = [];
  for (const [name, job] of Object.entries(jobs)) {
    job.steps.forEach((step, i) => {
      for (const kind of Object.keys(COMMAND)) {
        if (!isSetUp(step, kind)) continue;
        const label = `${file} > ${name} > ${step.name || `step ${i + 1}`} > ${kind}`;
        const versions = requestedVersions(step, job, kind, root);
        if (!versions) problems.push(`${label}: cannot work out the version it asks for`);
        for (const version of versions ?? []) {
          const below = belowFloor(version, kind);
          if (below === null) problems.push(`${label}: '${version}' is not a version number this test can compare`);
          else if (below) problems.push(`${label}: asks for ${version}, below the floor`);
        }
      }
    });
  }
  return problems;
}

test("runsRuntime finds node and python in command position", () => {
  const node = [
    'token="$(node scripts/github-app-token.mjs)"',
    "npm ci --no-audit",
    "FOO=1 node x",
    "env FOO=1 node x",
    "env FOO='bar baz' node x.js",
    'FOO="a b"\'c d\'e node x.js',
    "/opt/node/bin/node x.js",
    "env -i npm ci",
    "nice -n 10 node x.js",
    "xargs -n 1 node",
    "env -- node script.mjs",
    "command -- node scripts/x.mjs",
    "command -p -- npm ci",
    "sudo -u nobody -- node x.js",
    "timeout 60 node x.js",
    "nohup node x.js",
    "a|b) node x.js ;;",
    "sudo node x",
    "xargs node x",
    "diff a <(node x)",
    "(node x)",
    "if node x; then",
    "! node x",
    "time node x",
    "exec node x",
    "cd y && npm ci",
    'echo "`node --version`"',
  ];
  for (const line of node) assert.equal(runsRuntime(line, "node"), true, line);
  const python = [
    "cat x | python3 -I check.py",
    "python3.15 -I x.py",
    'compare_out="$(python3 -I scripts/follow_website_base.py --check)"',
    "python -m pip install uv",
    "python3 -m venv zizmor-env",
    "version=`python3 scripts/check.py`",
    'echo "`python3 --version`"',
    "uv sync --frozen",
    "uvx zizmor .github",
    "uv run python scripts/check.py",
    'FOO="bar baz" python3 check.py',
    'STAMP="$(date +%s) run" python3 check.py',
    "/usr/bin/python3 -I check.py",
    "/opt/az/bin/python3 -Im pip check",
    "./venv/bin/python x.py",
    "zizmor-env/bin/python -m pip install zizmor",
    "python3.15.2 -c 'print(1)'",
    "/usr/bin/python3 -c 'print(1)'",
    "env -i python3 check.py",
    "sudo -u nobody python3 check.py",
    "sudo -u runner python3 check.py",
    "time -p python3 check.py",
    "sudo -- python3 check.py",
    "timeout -k 5 1m python3 x.py",
    "stdbuf -oL python3 x.py",
    "check) python3 scripts/check.py ;;",
    "docker run --rm img bash -c 'x' && python3 y.py",
  ];
  for (const line of python) assert.equal(runsRuntime(line, "python"), true, line);
});

test("runsRuntime does not count words that are not commands", () => {
  const cases = [
    ['echo "run \\`node scripts/x.mjs\\` by hand"', "node"],
    ['docker run --rm img python -c "import azure"', "python"],
    ["# node is not run here", "node"],
    ['for node in items["nodes"]:', "node"],
    ['echo "$NODE_VERSION"', "node"],
    ["nodes=3 nodejs-check", "node"],
    ['echo "the stage is wrong; if pip named the file differently, look"', "python"],
    ["echo 'literal `python3` text'", "python"],
    ["uvicorn app:main", "python"],
    ['FOO="python3 x" true', "python"],
    ["NODE_BIN=/opt/node/bin/node", "node"],
    ["command -v node", "node"],
    ["echo $(foo) python3 x", "python"],
    ["docker run --rm img bash -c '\n  /opt/az/bin/python3 -Im pip check\n'", "python"],
    ["docker run --rm img \\\n  /opt/az/bin/python3 -Im pip check", "python"],
    ["cat > x.txt <<'EOF'\npython3 is named here\nEOF", "python"],
    ["echo x # node y", "node"],
  ];
  for (const [line, kind] of cases) assert.equal(runsRuntime(line, kind), false, line);
});

test("a job that sets the runtime up late or never is flagged", () => {
  const text = [
    "name: x",
    "on: push",
    "jobs:",
    "  late:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - name: Early",
    "        run: node a.mjs",
    "      - uses: actions/setup-node@abc # v7",
    "  none:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - run: python3 b.py",
    "  other-setup:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: astral-sh/setup-uv@abc",
    "      # A comment between steps does not end the list.",
    "      - name: Run",
    "        run: |",
    "          set -e",
    "          python3 c.py",
    "  good:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-node@abc",
    "      - run: node a.mjs",
    "  boxed:",
    "    runs-on: ubuntu-26.04",
    "    container: node:26",
    "    steps:",
    "      - run: node a.mjs",
    "",
  ].join("\n");
  assert.deepEqual(unsetSteps("x.yml", readJobs(text)), [
    "x.yml > late > Early > node",
    "x.yml > none > step 1 > python",
    "x.yml > other-setup > Run > python",
  ]);
});

test("a step listed as starting a runtime indirectly counts as running it", () => {
  const text = [
    "name: x",
    "on: push",
    "jobs:",
    "  scan:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - name: Scan",
    "        run: pipx run --spec checkov==3.3.30 checkov --directory .",
    "      - uses: actions/setup-python@abc",
    '        with: { python-version: "3.15" }',
    "",
  ].join("\n");
  const key = "x.yml > scan > Scan > python";
  assert.deepEqual(unsetSteps("x.yml", readJobs(text), { [key]: "pipx runs Python" }), [key]);
  assert.deepEqual(unsetSteps("x.yml", readJobs(text), {}), []);
});

test("a set-up step with its own condition covers only steps it always runs before", () => {
  const text = [
    "name: x",
    "on: push",
    "jobs:",
    "  skipped:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "        if: false",
    "      - name: Run",
    "        run: python3 a.py",
    "  same-condition:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "        if: ${{ !cancelled() }}",
    "      - name: Run",
    '        if: "!cancelled()"',
    "        run: python3 a.py",
    "  unconditional-setup:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "      - name: Run",
    "        if: github.ref == 'refs/heads/main'",
    "        run: python3 a.py",
    "  after-a-failure:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "      - name: Run",
    "        if: always()",
    "        run: python3 a.py",
    "  after-a-failure-set-up-too:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "        if: always()",
    "      - name: Run",
    "        if: failure()",
    "        run: python3 a.py",
    "  other-condition:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "        if: github.event_name == 'push'",
    "      - name: Run",
    "        if: failure()",
    "        run: python3 a.py",
    "  or-term:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-node@abc",
    "        if: matrix.relevant == 'true' || (matrix.name == 'scripts (operations)')",
    "      - name: Run",
    "        if: matrix.name == 'scripts (operations)'",
    "        run: node a.mjs",
    "  and-term:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-node@abc",
    "        if: matrix.relevant == 'true' && matrix.name == 'scripts'",
    "      - name: Run",
    "        if: matrix.name == 'scripts'",
    "        run: node a.mjs",
    "  job-condition:",
    "    if: github.event_name == 'push'",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-node@abc",
    "      - run: node a.mjs",
    "",
  ].join("\n");
  assert.deepEqual(unsetSteps("x.yml", readJobs(text)), [
    "x.yml > skipped > Run > python",
    "x.yml > after-a-failure > Run > python",
    "x.yml > other-condition > Run > python",
    "x.yml > and-term > Run > node",
  ]);
});

test("covers compares normalised conditions and top-level || terms", () => {
  const cases = [
    ["${{  a &&   b }}", "a && b", true],
    ["a || b", "b", true],
    ["(a) || (b && c)", "b && c", true],
    ["x == 'p || q' || r", "x == 'p", false],
    ["(a || b) && c", "a", false],
    ["a || b", "a || c", false],
    ["", "anything", true],
    // The job's status: a set-up step with no `if:` runs only after success (the unwritten `success()`).
    ["", "", true],
    ["", "always()", false],
    ["", "${{ !cancelled() }}", false],
    ["", "failure()", false],
    ["${{ !cancelled() }}", "${{ !cancelled() }}", true],
    ["always()", "failure()", true],
    ["always()", "cancelled()", true],
    ["!cancelled()", "always()", false],
    ["!cancelled()", "cancelled()", false],
    ["failure()", "", false],
    ["always() && a", "a", true],
    ["always() && a", "!cancelled() && a", true],
    ["a", "failure() && a", false],
    ["always()", "a || b", true],
    // Status functions joined by `&&` and `||` (Copilot on HCW-CloudAssessor_AddOn#89).
    ["always() && !cancelled()", "cancelled()", false],
    ["always() && !cancelled()", "failure()", true],
    ["failure() || cancelled()", "cancelled()", true],
    ["failure() || cancelled()", "", false],
    ["success() || failure()", "!cancelled()", true],
  ];
  for (const [setup, step, covered] of cases) {
    assert.equal(covers({ if: setup }, { if: step }), covered, `${setup} / ${step}`);
  }
});

test("statuses follow &&, || and !", () => {
  const cases = [
    ["", ["success"]],
    ["a", ["success"]],
    ["always()", ["success", "failure", "cancelled"]],
    ["!cancelled()", ["success", "failure"]],
    ["always() && !cancelled()", ["success", "failure"]],
    ["failure() || cancelled()", ["failure", "cancelled"]],
    ["(failure() || cancelled()) && a", ["failure", "cancelled"]],
    ["!(failure() || cancelled())", ["success"]],
    ["false", []],
  ];
  for (const [expression, expected] of cases) {
    assert.deepEqual([...statuses(expression)].sort(), [...expected].sort(), expression);
  }
});

test("a line meets the floor by its line, an exact version in full", () => {
  const cases = [
    ["26.0.0", "node", true],
    ["26.10.0", "node", true],
    ["26.11.0", "node", false],
    ["26", "node", false],
    ["26.x", "node", false],
    ["v27.0.0", "node", false],
    ["24", "node", true],
    ["3.15", "python", false],
    ["3.15.0", "python", false],
    ["3.14.9", "python", true],
    ["3.14", "python", true],
    ["lts/*", "node", null],
    ["26.11.0-not-a-version", "node", null],
    ["26.11.0garbage", "node", null],
    ["26.11.0-rc.1", "node", null],
    ["26.11.0.0", "node", null],
    ["3.15.0b4", "python", null],
  ];
  for (const [version, kind, below] of cases) assert.equal(belowFloor(version, kind), below, version);
});

test("setup-uv sets Python up only with a python-version at the floor", () => {
  const text = [
    "name: x",
    "on: push",
    "jobs:",
    "  no-version:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: astral-sh/setup-uv@abc",
    "      - name: Test",
    "        run: uv run pytest",
    "  new:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: astral-sh/setup-uv@abc",
    '        with: { python-version: "3.15", enable-cache: false }',
    "      - name: Test",
    "        run: uv run pytest",
    "  old:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: astral-sh/setup-uv@abc",
    '        with: { python-version: "3.14" }',
    "      - name: Test",
    "        run: uv run pytest",
    "",
  ].join("\n");
  const jobs = readJobs(text);
  assert.deepEqual(unsetSteps("x.yml", jobs), ["x.yml > no-version > Test > python", "x.yml > old > Test > python"]);
  assert.deepEqual(floorProblems("x.yml", jobs), ["x.yml > old > step 1 > python: asks for 3.14, below the floor"]);
});

test("a set-up step must ask for the floor or newer", () => {
  const root = mkdtempSync(join(tmpdir(), "condfix-1707-floor-"));
  writeFileSync(join(root, ".python-version"), "# the line uv and setup-python read\n3.15\n");
  writeFileSync(join(root, ".old-version"), "3.14\n");
  const text = [
    "name: x",
    "on: push",
    "env:",
    '  PYTHON_VERSION: "3.15"',
    '  OLD: "3.14"',
    "jobs:",
    "  old:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    '        with: { python-version: "3.14" }',
    "  new:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc # v6",
    "        with:",
    '          python-version: "3.15"',
    "      - uses: actions/setup-python@abc",
    "        with: { python-version-file: .python-version }",
    "      - uses: actions/setup-python@abc",
    '        with: { python-version: "${{ env.PYTHON_VERSION }}" }',
    "      - uses: actions/setup-node@abc",
    "        with: { node-version: 26, package-manager-cache: false }",
    "  old-node:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - name: Node",
    "        uses: actions/setup-node@abc",
    '        with: { node-version: "24" }',
    "  through-env:",
    "    runs-on: ubuntu-26.04",
    "    env:",
    "      PYTHON_VERSION: ${{ env.OLD }}",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    '        with: { python-version: "${{ env.PYTHON_VERSION }}" }',
    "      - uses: actions/setup-python@abc",
    "        with: { python-version-file: .old-version }",
    "  matrix:",
    "    runs-on: ubuntu-26.04",
    "    strategy:",
    "      matrix:",
    '        python-version: ["3.15", "3.14"]',
    "    steps:",
    "      - uses: actions/setup-python@abc",
    '        with: { python-version: "${{ matrix.python-version }}" }',
    "  unreadable:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-python@abc",
    "      - uses: actions/setup-node@abc",
    '        with: { node-version: "${{ inputs.node }}" }',
    "      - uses: actions/setup-node@abc",
    "        with: { node-version: lts/* }",
    "",
  ].join("\n");
  assert.deepEqual(floorProblems("x.yml", readJobs(text), root), [
    "x.yml > old > step 1 > python: asks for 3.14, below the floor",
    "x.yml > old-node > Node > node: asks for 24, below the floor",
    "x.yml > through-env > step 1 > python: asks for 3.14, below the floor",
    "x.yml > through-env > step 2 > python: asks for 3.14, below the floor",
    "x.yml > matrix > step 1 > python: asks for 3.14, below the floor",
    "x.yml > unreadable > step 1 > python: cannot work out the version it asks for",
    "x.yml > unreadable > step 2 > node: cannot work out the version it asks for",
    "x.yml > unreadable > step 3 > node: 'lts/*' is not a version number this test can compare",
  ]);
  rmSync(root, { recursive: true, force: true });
});

const files = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();
const texts = Object.fromEntries(files.map((file) => [file, readFileSync(join(WORKFLOWS, file), "utf8")]));
const unset = files.flatMap((file) => unsetSteps(file, readJobs(texts[file])));

test("the reader finds every job and every steps: list", () => {
  for (const file of files) {
    const jobs = readJobs(texts[file]);
    const runners = (texts[file].match(/^\s+runs-on:/gm) ?? []).length;
    assert.ok(Object.keys(jobs).length >= runners, `${file}: read fewer jobs than the file has runs-on lines`);
    const stepLists = (texts[file].match(/^\s+steps:\s*$/gm) ?? []).length;
    assert.equal(Object.values(jobs).filter((job) => job.steps.length).length, stepLists, file);
  }
});

test("every set-up step asks for the floor or newer", () => {
  assert.deepEqual(
    files.flatMap((file) => floorProblems(file, readJobs(texts[file]))),
    [],
  );
});

test("every step that runs Node.js or Python comes after its version is set up", () => {
  assert.deepEqual(
    unset.filter((entry) => !(entry in RUNNER_DEFAULT_ALLOWED)),
    [],
  );
});

test("every indirect step still exists and says why, so a renamed or removed step cannot leave the list pointing at nothing", () => {
  const keys = new Set(
    files.flatMap((file) =>
      Object.entries(readJobs(texts[file])).flatMap(([name, job]) =>
        job.steps.flatMap((step, i) => Object.keys(COMMAND).map((kind) => stepKey(file, name, step, i, kind))),
      ),
    ),
  );
  for (const [entry, reason] of Object.entries(INDIRECT_RUNTIME)) {
    assert.ok(typeof reason === "string" && reason.trim(), `${entry}: an indirect step needs a reason`);
    assert.ok(keys.has(entry), entry);
  }
});

test("every allowed exception still exists and says why, so the list cannot hide a step that has since changed", () => {
  for (const [entry, reason] of Object.entries(RUNNER_DEFAULT_ALLOWED)) {
    assert.ok(typeof reason === "string" && reason.trim(), `${entry}: an exception needs a reason`);
    assert.ok(unset.includes(entry), entry);
  }
});
