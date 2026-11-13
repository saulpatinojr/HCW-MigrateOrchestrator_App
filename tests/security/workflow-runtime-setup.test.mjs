import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every workflow job that runs Node.js or Python chooses its version (saulpatinojr/HCW-HybridCloudWorks#1707).
//
// The canonical twin of this check is the website's, scripts/workflow-runtime-setup.test.mjs in
// saulpatinojr/HCW-HybridCloudWorks: change the logic there first, then copy it here unchanged. This file is taken from
// the node:test copy in HCW-MigrateOrchestrator_AddOn (tests/security/workflow-runtime-setup.test.mjs), which carries the
// same logic. This copy keeps only its own parts: the lists below, the floors written in (the website reads
// scripts/version-floors.json), the workflow reader (the website parses with the `yaml` package, which is no dependency
// here), the set-up version checks, the paths and these comments. It runs under `node --test` (`npm test`) rather than
// vitest. The three Python add-ons carry the same check as tests/security/test_workflow_runtime_setup.py, and the two
// Python App repositories as tests/unit/test_workflow_runtime_setup.py.
//
// A job that runs `node`, `npm`, `npx`, `yarn`, `pnpm`, `python3`, `pip`, `pipx`, `pytest`, `uv` or `uvx` without
// actions/setup-node or actions/setup-python gets whatever the runner image ships: on ubuntu-26.04 that was Node.js 24
// and Python 3.14 in November 2026, both below the program's floors (Node.js 26, Python 3.15). Nothing else notices,
// because a job that names no version has nothing to read. `uv` and `uvx` count as Python, because uv runs the
// interpreter it finds, the runner's own unless one was set up; so astral-sh/setup-uv counts as setting Python up only
// when it is given a `python-version` at or above the floor. `yarn` and `pnpm` are Node.js programs and count as Node.js;
// `pytest` and `pipx` are Python programs and count as Python. pipx makes each tool's virtual environment from the
// interpreter pipx itself runs on unless it is given `--python` or `PIPX_DEFAULT_PYTHON`
// (https://pipx.pypa.io/latest/reference/environment-variables.html), and GitHub's Ubuntu runner images install pipx
// with the image's own python3 (actions/runner-images#14654), so setting Python up is not enough. A step that runs `pipx`
// in command position must also choose its interpreter: `--python` among that pipx command's own words (`pipx run
// --python "$PYTHON_PATH" ...`, with actions/setup-python's `python-path` output), or `PIPX_DEFAULT_PYTHON` set to a
// non-empty value in front of it (`PIPX_DEFAULT_PYTHON=/p pipx ...`; an empty one, `PIPX_DEFAULT_PYTHON= pipx ...`,
// leaves pipx on its own interpreter, Copilot on HCW-NetworkEyes_App#394) or in the step's, job's or workflow's `env:`
// (Copilot on HCW-NetworkEyes_App#393). A step that does not is reported, named; one kept that way on purpose is listed, with its
// reason, in PIPX_ALLOWED. An `export PIPX_DEFAULT_PYTHON=...` earlier in the script is not read; use `env:` instead.
//
// A command counts when it is in command position on a line of a `run:` step: at the start, after `$(`, `<(`, a
// backtick, `(`, `{`, `|`, `&&`, `||` or `;`, after leading `NAME=value` assignments (the value plain text, a quoted
// string, or both run together), after a `case` pattern at the start of a line (`check)`), or after a word that runs the
// next one (`env`, `sudo`, `xargs`, `exec`, `time`, `nice`, `nohup`, `stdbuf`, `timeout`, `!`, `if`, `then`, `do` and
// the like) and that word's options (`sudo -u nobody`, `env -i`, `env --`). It counts with a path in front too
// (`/usr/bin/python3`, `./venv/bin/python`), because a path to the runner's interpreter is still the runner's, and
// `python3.15.2` counts like `python3`. It does not count in a comment, a heredoc's body, a quoted string (unless a
// double-quoted one runs a command with `$(`, `<(` or a backtick; a single-quoted one may run over several lines, as the
// `bash -c '...'` script of a `docker run` does) or as an argument (`docker run image python ...`, or the first word of
// a line that continues the one before it). One more quoted string is read: the script of a shell that is itself in
// command position and given `-c` (`bash -c 'node x'`, `sh -euo pipefail -c "..."`, `sudo bash -lc '...'`, `bash -c --
// '...'`). That script runs on the runner, so its commands count, while the same words after `docker run image` stay a
// container's; an unquoted script is the one word after `-c` (`bash -c node x.js` runs `node`, while `bash -c echo node`
// does not). A double-quoted `-c` script is read both ways: as the outer shell reads it (its `$(...)` and backticks run
// first) and as the inner shell does. The set-up step must come before the first such step. Limits, on purpose: a job
// that runs in a `container:` uses that image's runtime and is not checked; a script a step calls (a `.sh` file) is not
// read, so a step that starts a runtime that way is listed in INDIRECT_RUNTIME. A command substitution inside a
// double-quoted string (`"$(...)"`, or a backtick pair) runs on the runner, so it is read like any other script, a `-c`
// script in it included (`echo "$(bash -c 'node x')"`); one that hands its script to a container (`"$(docker run img
// bash -c '...')"`) stays unread.
//
// A set-up step with its own `if:` covers a later step only when that step's condition makes the set-up's true: the same
// condition, one of the terms the set-up's condition joins with a top-level `||`, or a condition that joins one of those
// with a top-level `&&` and has no top-level `||` of its own (`a && b` runs only when `a` holds; `a && b || d` can run
// through `d` alone, so it is not split; Copilot on HCW-NetworkEyes_App#393). Otherwise the set-up could be skipped
// while the command still runs (Copilot on HCW-NetworkEyes_AddOn#100). A set-up step with no `if:` covers every later
// step whose condition does not test the job's status. Equal text means equal value only for values that stay fixed
// during a job (`matrix`, `github`, `inputs`, `needs`, `vars`, `secrets`); a term that reads anything else (`env.*`,
// which a step can change through `$GITHUB_ENV`, `steps.*`, `job`, `runner`, `hashFiles()`) is never matched by its text,
// so its step is reported (Copilot on HCW-MigrateOrchestrator_AddOn#74). The one exception is `steps.<id>` of a step
// that comes before the set-up step: its outputs, outcome and conclusion are fixed once it has run (the `core-update.yml`
// jobs' `steps.refs.outputs.changed`). Prefer the fixed values in such conditions. A job's own `if:` does not matter
// here, because it decides whether every step of the job runs, alike.
//
// The job's status is compared on its own. Without `always()`, `failure()`, `cancelled()` or `success()` in it, a step's
// condition includes an unwritten `success()`, so a set-up step with no `if:` is skipped once an earlier step has
// failed, while a later `if: always()`, `failure()` or `!cancelled()` step still runs (Copilot on
// HCW-MigrateOrchestrator_AddOn#72). So the statuses a later step can run under (after success, after a failure, after a
// cancel) must all be ones its set-up step runs under too, and the rule above is applied to the conditions with their
// status-only `&&` terms taken out, but only from a condition with no top-level `||`: `failure() && a || b` is
// `(failure() && a) || b`, so taking `failure()` out would change it (Copilot on HCW-MigrateOrchestrator_AddOn#74).
// `||`, `&&`, `!` and parentheses are followed: `always() && !cancelled()` runs after
// success and failure, not after a cancel.
//
// This copy also checks that each set-up step asks for the floor or newer (Copilot on HCW-CloudCrawler_App#81):
// `python-version` or `python-version-file`, `node-version` or `node-version-file`, read through `${{ env.X }}` (the
// step's, job's or workflow's `env:`), `${{ matrix.X }}` (every entry of the job's matrix list) and the named file. A
// version that names a line only (`26`, `26.x`, `3.15`) stands for that line's newest release, so it passes when the
// line is at or above the floor's; an exact version (`26.10.0`) must be at or above the floor itself; anything else
// (`26.11.0-rc.1`, `26.11.0.0`, `lts/*`) cannot be compared. A value this test cannot work out fails it, naming the
// step, rather than passing unchecked. setup-uv's `python-version` is read the same way.
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

// Steps that start a runtime indirectly, through a script or program the check cannot read in the `run:` text (`bash
// scripts/build.sh` that runs `node`, say). Each counts as running that runtime, so its set-up step must come first.
// Same keys as above, each with a reason; a key that no longer names a step fails the test, so a renamed or removed step
// cannot leave the list pointing at nothing. Read on 2026-11-13: every other script a workflow step here calls starts no
// runtime the check cannot see. scripts/package-repository.sh (ci.yml, build-test) runs zip, unzip and the like only;
// every scripts/*.mjs is started with `node`, which the check sees; every `npm run` and `npx` is itself seen as Node.js;
// the composite action .github/actions/self-merging-pr runs gh only. iac-validate.yml's checkov step needs no entry:
// it runs `pipx`, which the check counts as Python, and gives it `--python`.
const INDIRECT_RUNTIME = {
  "release-cli.yml > sea > Build the single-file binary > node": "`bash scripts/build-sea.sh` runs `node` and `npx esbuild`, and copies that node into the binary",
};

// Steps that run `pipx` without choosing its interpreter (`--python` or PIPX_DEFAULT_PYTHON) on purpose, keyed by
// "file > job > step name > pipx", each with its reason. Empty: the one pipx step here (iac-validate.yml, checkov) is
// given actions/setup-python's interpreter with `--python`.
const PIPX_ALLOWED = {};

// Where a command may start: the line's start or an opening or joining character, then any `NAME=value` assignments
// (the value plain text, a quoted string, or both run together: `FOO="a b"`) and words that run the next word
// (`env FOO=1 node`, `sudo node`, `if node ...; then`).
const ASSIGNMENT = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'])*\s+`;
// Words that run the next word, each with the options it may take first: the letters of the options that take an
// argument (`sudo -u nobody`, `nice -n 10`), any other `-x`/`--long` flag, and the `--` that ends the options (`env --
// node`). `timeout` also takes its duration (`timeout 60 node`). `command` only with `-p` or `--`, because `command -v
// node` looks node up and runs nothing. An option that takes an argument always takes the next word (so `sudo -u node
// whoami` runs whoami, not node), and an option can be read only one way: otherwise twenty `-oL`s make the match try
// every split (the same pattern as the Python copies, HCW-NetworkEyes_App's tests/security/test_workflow_runtime_setup.py).
// `env -S` (`--split-string`) is read as a flag, not as one that takes a value, because its value is the command it runs:
// unquoted, the next word is in command position (`env -S node x.js`); quoted, see ENV_SPLIT_SCRIPT.
const WRAPPER_OPTIONS = { env: "uC", sudo: "ugCDhprtU", xargs: "InPLdaEs", exec: "a", time: "of", nice: "n", nohup: "", stdbuf: "ioe", timeout: "sk" };
// The long options of those words that take a value (`timeout --kill-after 5 10 node`, `sudo --user nobody node`), the
// long forms of the letters above: the value follows `=` or is the next word, which never starts with `-`. Any other
// `--long[=value]` is a flag, so each long option too can be read only one way (Copilot on
// HCW-MigrateOrchestrator_AddOn#74).
const WRAPPER_LONG_OPTIONS = {
  env: ["unset", "chdir"],
  sudo: ["user", "group", "close-from", "chdir", "host", "prompt", "role", "type", "other-user"],
  xargs: ["max-args", "max-procs", "delimiter", "arg-file", "max-chars", "process-slot-var"],
  time: ["output", "format"],
  nice: ["adjustment"],
  stdbuf: ["input", "output", "error"],
  timeout: ["signal", "kill-after"],
};
const longOptionsOf = (names) =>
  names.length
    ? String.raw`--(?:${names.join("|")})(?:=\S*|\s+[^\s-]\S*)|--(?!(?:${names.join("|")})(?![\w-]))\w[\w-]*(?:=\S+)?`
    : String.raw`--\w[\w-]*(?:=\S+)?`;
const optionsOf = (takes, long = []) =>
  takes
    ? String.raw`(?:\s+(?:-(?:(?![${takes}])[A-Za-z])*[${takes}](?:\s+[^\s-]\S*|\S+)|${longOptionsOf(long)}|-(?:(?![${takes}])\w)+|--(?=\s)))*`
    : String.raw`(?:\s+(?:${longOptionsOf(long)}|-\w+|--(?=\s)))*`;
// A shell option (`-e`, `-o pipefail`, `-O extglob`, `--rcfile /tmp/rc`, `--login`, the `--` that ends them), `letters`
// being the letters a short option may hold. The options that take an argument (`-o`, `-O`, `--rcfile`, `--init-file`)
// never take one starting with `-`, so an option can be read only one way (otherwise `-o -o -o ...` makes the match try
// every split).
const shellOption = (letters) =>
  String.raw`(?:[-+]${letters}*[oO]\s+[^\s-][\w-]*|--(?:rcfile|init-file)\s+[^\s-]\S*|[-+]${letters}+|--[\w-]+|--(?=\s))`;
// A shell given `-c`, with its options. The options before it hold no `c`, so the first short option that holds one is
// the `-c` (`-c`, `-lc`, `-ec`), and a long run of options can be read only one way.
const SHELL_GIVEN_C = String.raw`(?:ba|da|k|z)?sh(?:\s+${shellOption("(?:(?!c)[A-Za-z])")})*\s+-(?:(?!c)[A-Za-z])*c[A-Za-z]*(?:\s+${shellOption("[A-Za-z]")})*\s+`;
// A shell given `-c` is also a word that runs the next one: an unquoted script is that one word (`bash -c node x.js`
// runs `node`, with `x.js` as its `$0`). A quoted script is read by `shellText` instead.
const SHELL_C = String.raw`(?:[^\s=]*/)?${SHELL_GIVEN_C}`;
const WRAPPERS = [
  ...Object.entries(WRAPPER_OPTIONS).map(([word, takes]) =>
    word === "timeout"
      ? String.raw`timeout${optionsOf(takes, WRAPPER_LONG_OPTIONS[word])}\s+\d+(?:\.\d+)?[smhd]?\s+`
      : String.raw`${word}${optionsOf(takes, WRAPPER_LONG_OPTIONS[word])}\s+`,
  ),
  String.raw`command(?:\s+(?:-p|--(?=\s)))*\s+`,
  String.raw`(?:if|then|else|elif|do|while|until|!)\s+`,
  SHELL_C,
].join("|");
// A `case` pattern that ends at the start of a line (`check)`, `a|b)`), after which a command may follow.
const CASE_PATTERN = String.raw`^[^()\s|]+(?:\|[^()\s|]+)*\)\s*`;
const START = String.raw`(?:^|[$<]\(\s*|[\x60({|;&]\s*|${CASE_PATTERN})(?:${ASSIGNMENT}|${WRAPPERS})*`;
// A runtime may be named with a path in front (`/usr/bin/python3`, `./venv/bin/python`): a path to the runner's own
// interpreter is still the runner's. The path holds no `=`, so an assignment (`NODE=/x/node`) is not a command.
const PATH = String.raw`(?:[^\s=]*/)?`;
// yarn and pnpm are Node.js programs; pytest and pipx are Python programs, so they run on the interpreter they were
// installed with, which is the runner's own unless a set-up step came first (pipx also builds each tool's virtual
// environment from that interpreter unless it is given `--python`).
const COMMAND = {
  node: new RegExp(`${START}${PATH}(?:node|npm|npx|yarn|pnpm)(?=\\s|$)`),
  python: new RegExp(`${START}${PATH}(?:python(?:3(?:\\.\\d+){0,2})?|pip3?|pipx|pytest|uvx?)(?=\\s|$)`),
};
// A shell in command position given a script with `-c` (`bash -c '...'`, `sh -euo pipefail -c "..."`, `sudo bash -lc
// '...'`): the script runs on the runner too, so its commands count. The same words after `docker run image` are not in
// command position, so a container's script stays unread.
const SHELL_SCRIPT = new RegExp(`${START}${PATH}${SHELL_GIVEN_C}$`);
// `env -S` (`--split-string`) in command position: env splits its value into words and runs them, so a quoted value there
// is read as a script, like a `-c` shell's (`env -S 'node x.js'`, `env --split-string='python3 x.py'`; Copilot on
// HCW-MigrateOrchestrator_AddOn#74). An unquoted value is the next word, which is in command position already.
const ENV_SPLIT_SCRIPT = new RegExp(
  String.raw`${START}${PATH}env${optionsOf(WRAPPER_OPTIONS.env, WRAPPER_LONG_OPTIONS.env)}\s+(?:-(?:(?![uCS])[A-Za-z])*S|--split-string=?)\s*$`,
);
// `pipx` in command position, with what comes before it (its assignments and wrappers) and its words, up to the end of
// the command (`;`, `&`, `|` or `)`). It has chosen its interpreter when `--python` is one of pipx's own options (see
// `pipxOptionChoosesPython`) or `PIPX_DEFAULT_PYTHON` is one of the assignments in front of it.
const PIPX = new RegExp(`(?<before>${START})${PATH}pipx(?=\\s|$)(?<words>[^;&|)]*)`, "g");
// One word of a command as `shellText` leaves it: plain text and quoted strings run together. The first word in front of
// a command may start with what opened it (`(`, `$(`, `&&`, `;`), which is not part of the word.
const WORD = /(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'])+/g;
const OPENING = /^(?:[$<]?\(|[`{|;&])+/;
// pipx's options that take a value as the next word, so that word is not read as an option or as the app's name.
const PIPX_VALUE_OPTIONS = new Set(["--spec", "--python", "--index-url", "--pip-args", "--suffix", "--preinstall", "--backend", "--fetch-python"]);
// Where `((` opens an arithmetic command rather than two subshells: at the start of a command.
const ARITHMETIC_COMMAND = /(?:^|[;&|({]|\b(?:then|else|do|if|elif|while|until|for))\s*$/;
// The escapes `$'...'` turns into other characters; any other `\x` is left as it is.
const ANSI_C = { n: "\n", t: "\t", "'": "'", '"': '"', "\\": "\\" };
const SETUP = { node: /^actions\/setup-node@/, python: /^actions\/setup-python@/ };
// astral-sh/setup-uv sets Python up only when given a `python-version` at or above the floor (see `setsUp`).
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
 * The index of the `)` that closes the `$(` at `at`, or the end of the text: escapes, quoted strings and the
 * substitutions inside them are skipped, so their quotes and parentheses do not count.
 */
function substitutionClose(run, at) {
  const n = run.length;
  let depth = 0;
  let k = at + 1;
  while (k < n) {
    const char = run[k];
    if (char === "\\") k += 2;
    else if (char === "'") {
      const end = run.indexOf("'", k + 1);
      k = end === -1 ? n : end + 1;
    } else if (char === '"') {
      k += 1;
      while (k < n && run[k] !== '"') {
        if (run[k] === "\\") k += 2;
        else if (run.startsWith("$(", k)) k = substitutionClose(run, k) + 1;
        else k += 1;
      }
      k += 1;
    } else {
      depth += char === "(" ? 1 : char === ")" ? -1 : 0;
      if (depth === 0) return k;
      k += 1;
    }
  }
  return n;
}

/** The index of the backtick that closes the one at `at` (an escaped one does not), or the end of the text. */
function backtickClose(run, at) {
  let k = at + 1;
  while (k < run.length && run[k] !== "`") k += run[k] === "\\" ? 2 : 1;
  return Math.min(k, run.length);
}

/**
 * The script as the shell reads it, for finding commands: comments and heredoc bodies dropped (`<<EOF`, `<<'EOF'`,
 * `<<"EOF"`, `<<\EOF`, `<<-EOF`, but not the shift `<<` inside `$((...))` or `((...))`), a line that ends in `\` joined
 * to the next (so the next line's first word is still an argument), single-quoted text and `$'...'` text written as `'_'` (`''` when empty), and
 * double-quoted text as `"_"` (`""` when empty) unless it runs a command (`"$(node x)"`, or the older "`node x`"). An escaped backtick
 * (`\``, a Markdown summary line) is a plain character. A quoted string may run over several lines, as the script of
 * `docker run image bash -c '...'` does; what it runs is the container's. The one quoted string that is read is the
 * script of a shell in command position given `-c` (`bash -c 'node x'`): it is read the same way, on lines of its own,
 * and the line after it starts with `:` so that the words after the script (the inner shell's `$0` and arguments) are
 * still arguments.
 */
export function shellText(run) {
  const out = [];
  let heredocs = [];
  // Open parentheses inside `$((...))` or `((...))`, where `<<` is a shift; 0 outside.
  let arithmetic = 0;
  let i = 0;
  const n = run.length;
  const line = () => {
    const text = out.join("");
    return text.slice(text.lastIndexOf("\n") + 1);
  };
  // A `-c` script (or an `env -S` value) keeps the outer reading too: the outer shell runs a `$(...)` or backtick in a
  // double-quoted script before the inner shell starts (`bash -c "echo '$(node x)'"`).
  const quoted = (script, text) => {
    const isScript = SHELL_SCRIPT.test(line().trimStart()) || ENV_SPLIT_SCRIPT.test(line().trimStart());
    out.push(isScript ? `${text}\n${shellText(script)}\n:` : text);
  };
  while (i < n) {
    const char = run[i];
    if (char === "\\" && i + 1 < n) {
      out.push(run[i + 1] === "\n" ? " " : run[i + 1] === "`" ? "" : run.slice(i, i + 2));
      i += 2;
    } else if (char === "$" && run[i + 1] === "'") {
      // `$'...'` may hold `\'`, which does not end it.
      let j = i + 2;
      while (j < n && run[j] !== "'") j += run[j] === "\\" ? 2 : 1;
      quoted(run.slice(i + 2, j).replace(/\\([\s\S])/g, (escape, c) => ANSI_C[c] ?? escape), j > i + 2 ? "'_'" : "''");
      i = j + 1;
    } else if (char === "'") {
      const end = run.indexOf("'", i + 1) === -1 ? n : run.indexOf("'", i + 1);
      quoted(run.slice(i + 1, end), end > i + 1 ? "'_'" : "''");
      i = end + 1;
    } else if (char === '"') {
      // A command substitution in the string (`$(...)`, or a backtick pair) may hold quotes of its own, and it runs on
      // the runner, so its script is read like any other. As text, an escaped backtick prints.
      let j = i + 1;
      const parts = [];
      while (j < n && run[j] !== '"') {
        if (run[j] === "\\") {
          parts.push(run.slice(j, j + 2) === "\\`" ? "" : run.slice(j, j + 2));
          j += 2;
        } else if (run.startsWith("$(", j) && !run.startsWith("$((", j)) {
          const close = substitutionClose(run, j);
          parts.push(`$(${shellText(run.slice(j + 2, close))})`);
          j = close + 1;
        } else if (run[j] === "`") {
          const close = backtickClose(run, j);
          parts.push(`\`${shellText(run.slice(j + 1, close))}\``);
          j = close + 1;
        } else {
          parts.push(run[j]);
          j += 1;
        }
      }
      const raw = run.slice(i + 1, Math.min(j, n));
      const text = parts.join("");
      // Given to `-c`, the inner shell runs the script, an escaped backtick included.
      quoted(raw.replace(/\\([\\"$`\n])/g, (escape, c) => (c === "\n" ? "" : c)), /[$<]\(|`/.test(text) ? `"${text}"` : text ? '"_"' : '""');
      i = j + 1;
    } else if (char === "#" && (i === 0 || " \t\n;".includes(run[i - 1]))) {
      const end = run.indexOf("\n", i);
      i = end === -1 ? n : end;
    } else if (!arithmetic && (run.startsWith("$((", i) || (run.startsWith("((", i) && ARITHMETIC_COMMAND.test(line())))) {
      const open = char === "$" ? "$((" : "((";
      out.push(open);
      i += open.length;
      arithmetic = 2;
    } else if (arithmetic && (char === "(" || char === ")")) {
      arithmetic += char === "(" ? 1 : -1;
      out.push(char);
      i += 1;
    } else if (!arithmetic && run.startsWith("<<", i) && !run.startsWith("<<<", i)) {
      const found = run.slice(i).match(/^<<-?\s*(\\?)(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/);
      if (found) heredocs.push(found[3]);
      out.push("<<");
      i += found ? found[0].length : 2;
    } else if (char === "\n" && heredocs.length) {
      out.push("\n");
      i += 1;
      for (const delimiter of heredocs) {
        while (i < n) {
          const end = run.indexOf("\n", i) === -1 ? n : run.indexOf("\n", i);
          const text = run.slice(i, end);
          i = end + 1;
          if (text.trim() === delimiter) break;
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

/** True when a run step calls the runtime in command position (see `shellText` for what is left out). */
export function runsRuntime(run, kind) {
  return shellText(String(run ?? ""))
    .split("\n")
    .some((line) => COMMAND[kind].test(line.trim()));
}

/** A step's `if:` as one comparable expression: no `${{ }}` around it, whitespace collapsed; "" when it has none. */
export const condition = (step) =>
  String(step?.if ?? "")
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** Strips one pair of parentheses that wraps the whole expression. */
const unwrap = (text) => {
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    if (depth === 0) return text; // the opening parenthesis closes before the end
  }
  return text.slice(1, -1).trim();
};

/** The terms a condition joins with `||` (or `&&`) at its top level (outside parentheses and quotes). */
export function orTerms(text, operator = "||", unwrapEach = true) {
  const terms = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && text.startsWith(operator, i)) {
      terms.push(text.slice(start, i).trim());
      start = i + operator.length;
      i += operator.length - 1;
    }
  }
  terms.push(text.slice(start).trim());
  return unwrapEach ? terms.map(unwrap) : terms;
}

/**
 * The job statuses a step with this condition can run after: `success` alone when it names no status function (the
 * unwritten `success()`), all three for `always()`, `success` and `failure` for `!cancelled()`, and so on.
 */
export const statuses = (text) => new Set(STATUSES.filter((status) => runsAfter(text, status) !== false));

/**
 * Whether a condition holds after the job so far ended in `status`: true, false, or null when it also depends on
 * something else. `||`, `&&`, `!` and parentheses are followed; anything that is not a status function or
 * `true`/`false` is unknown.
 */
function statusValue(expression, status) {
  let text = expression.trim();
  while (unwrap(text) !== text) text = unwrap(text);
  for (const [operator, decides] of [
    ["||", true],
    ["&&", false],
  ]) {
    const terms = orTerms(text, operator, false);
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

/** `statusValue` of a whole condition, with GitHub's unwritten `success() &&` when it names no status function. */
function runsAfter(expression, status) {
  if (!HAS_STATUS.test(expression) && status !== "success") return false;
  return expression ? statusValue(expression, status) : true;
}

/**
 * The condition without its top-level `&&` terms that test only the job's status (`always()`, `!cancelled()`), when
 * it has no top-level `||`: `failure() && a || b` is `(failure() && a) || b`, and `a || b` holds when it does not
 * (Copilot on HCW-MigrateOrchestrator_AddOn#74).
 */
const withoutStatus = (text) => {
  if (orTerms(text).length > 1) return text;
  const terms = orTerms(text, "&&", false);
  const kept = terms.filter((term) => term.replace(STATUS_CALL, "").replace(/[\s!()&|]/g, ""));
  return kept.length === terms.length ? text : kept.join(" && ");
};

// A name in a condition whose value is not fixed for the whole job: `env` (a step can write `$GITHUB_ENV`), `steps`,
// `job`, `jobs` and `hashFiles()`. `runner` and `strategy` are fixed for the whole job, like `matrix`. Outside quoted strings and not after a `.`, so
// `needs.build.outputs.env` and `'env.x'` are not one.
const CHANGING = /(?<![\w.-])(?:env|steps|job|jobs|hashfiles)(?![\w-])/i;
/**
 * True when a term reads only values fixed from the set-up step on, so equal text means an equal value: no name in
 * CHANGING, apart from `steps.<id>` of a step in `ran` (the ids of the steps before the set-up step, whose outputs,
 * outcome and conclusion no longer change).
 */
const fixedTerm = (term, ran = new Set()) =>
  !CHANGING.test(term.replace(/'(?:[^']|'')*'/g, "''").replace(/(?<![\w.-])steps\.([\w-]+)/gi, (whole, id) => (ran.has(id) ? "ran" : whole)));
/** The ids of these steps, for `setupCovers`. */
export const stepIds = (steps) => new Set((steps ?? []).map((step) => step?.id).filter((id) => id !== undefined && id !== null).map(String));

/**
 * True when a set-up step with condition `setup` is sure to have run before a step with condition `step`. Apart from
 * the job status, the set-up step covers the later step when the later condition is the same, is one of the set-up
 * condition's `||` terms, or, when it has no top-level `||` of its own, is joined by `&&` with one of them: a step that
 * runs only when `a && b` holds can run only when `a` holds, so a set-up step under `a || c` has run, while
 * `a && b || d` can run through `d`. The term matched must read only values fixed from the set-up step on
 * (`fixedTerm`, with `ran` the ids of the steps before it): `env.RUN == 'true'` can be false at the set-up step and
 * true later.
 */
export const setupCovers = (setup, step, ran = new Set()) => {
  for (const status of [...STATUSES].sort()) {
    if (runsAfter(step, status) === false) continue;
    const runs = runsAfter(setup, status);
    if (runs === false) return false;
    if (runs === null) {
      const [rest, wanted] = [withoutStatus(setup), withoutStatus(step)];
      const setupTerms = new Set([rest, ...orTerms(rest)].map(unwrap));
      // Split on `&&` only when the later condition has no top-level `||`: `a && c || d` can run through `d`.
      const andTerms = orTerms(wanted).length === 1 ? orTerms(wanted, "&&") : [];
      const stepTerms = [wanted, ...andTerms].map(unwrap);
      if (!(rest === "" || stepTerms.some((term) => setupTerms.has(term) && fixedTerm(term, ran)))) return false;
    }
  }
  return true;
};

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
 * `env` holds the workflow's `env:` with the job's own on top, so `pipxProblems` reads the workflow's too.
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
    const env = { ...(job?.env ?? {}), ...(step?.env ?? {}) };
    return name in env && depth < 5 ? resolved(env[name], step, job, depth + 1) : null;
  }
  return job?.matrix?.[name]?.length ? job.matrix[name] : null;
}

/**
 * True for a step that sets the runtime up: actions/setup-node or actions/setup-python, or, for Python,
 * astral-sh/setup-uv given a `python-version`.
 */
export function isSetUp(step, kind) {
  const uses = String(step?.uses ?? "");
  if (kind === "python" && SETUP_UV.test(uses)) return "python-version" in (step.with ?? {});
  return SETUP[kind].test(uses);
}

/**
 * True when the step chooses the runtime for the steps after it: actions/setup-node or actions/setup-python, or, for
 * Python, astral-sh/setup-uv given a `python-version` at or above the floor (without one, uv uses the runner's Python; a
 * lower one is also reported by the floor test). This copy reads the version through `env`, `matrix` and a version
 * file, as `floorProblems` does, where the website reads a literal only.
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

/** The key a step is named by in the lists above and in failures: "file > job > step > kind". */
export const stepKey = (file, name, step, i, kind) => `${file} > ${name} > ${step?.name || `step ${i + 1}`} > ${kind}`;

/**
 * The steps of one workflow's `jobs` that run a runtime before (or without) setting it up, by `stepKey`. A step named
 * in `indirect` counts as running its runtime even when its `run:` text does not show it.
 */
export function unsetSteps(file, jobs, indirect = INDIRECT_RUNTIME) {
  const found = [];
  for (const [name, job] of Object.entries(jobs ?? {})) {
    if (!Array.isArray(job?.steps) || job.container) continue;
    for (const kind of Object.keys(COMMAND)) {
      job.steps.forEach((step, i) => {
        const key = stepKey(file, name, step, i, kind);
        if (!(runsRuntime(step?.run, kind) || key in indirect)) return;
        // Covered by an earlier set-up step that always runs, or that runs under the same condition as this step.
        const covered = job.steps
          .slice(0, i)
          .some((earlier, j) => setsUp(earlier, job, kind) && setupCovers(condition(earlier), condition(step), stepIds(job.steps.slice(0, j))));
        if (!covered) found.push(key);
      });
    }
  }
  return found;
}

/** Every set-up step that asks for a version below the floor, or one this test cannot read, with the reason. */
export function floorProblems(file, jobs, root = ROOT) {
  const problems = [];
  for (const [name, job] of Object.entries(jobs)) {
    job.steps.forEach((step, i) => {
      for (const kind of Object.keys(COMMAND)) {
        if (!isSetUp(step, kind)) continue;
        const label = stepKey(file, name, step, i, kind);
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

/**
 * True when `--python` (or `--python=...`) is one of pipx's own options among the words after `pipx`. Reading stops at a
 * bare `--`, after which every word is the app's, and, for `pipx run`, at the app's name (the first word after `run`
 * that is not an option or an option's value), after which every word is the app's argument (`pipx run tool --python
 * x` gives `--python` to the tool).
 */
export function pipxOptionChoosesPython(words) {
  let command = null;
  let valueNext = false;
  for (const word of words.split(/\s+/).filter(Boolean)) {
    if (valueNext) valueNext = false;
    else if (word === "--") return false;
    else if (word === "--python" || word.startsWith("--python=")) return true;
    else if (PIPX_VALUE_OPTIONS.has(word)) valueNext = true;
    else if (word.startsWith("-")) continue;
    else if (command === null) command = word;
    else if (command === "run") return false;
  }
  return false;
}

/**
 * What the words in front of `pipx` do to PIPX_DEFAULT_PYTHON, read in order, the last one that touches it winning as
 * in the shell: true when an assignment sets it to something; false when one sets it empty (`PIPX_DEFAULT_PYTHON=`,
 * `PIPX_DEFAULT_PYTHON=''`, `PIPX_DEFAULT_PYTHON=''""`; Copilot on HCW-NetworkEyes_App#394 and HCW-HybridCloudWorks#1718),
 * or `env` unsets it (`-u`, `--unset`) or clears the whole environment (`-i`, `-`, `--ignore-environment`); null when
 * none of them touches it, so the inherited value (the step's, job's or workflow's `env:`) applies (Copilot on
 * HCW-NetworkEyes_App#394). `shellText` writes an empty quoted string as `''` or `""` and any other as `'_'` or `"_"`,
 * so a value made only of empty quotes is empty.
 */
function localDefaultPython(before) {
  let chosen = null;
  let inEnv = false; // reading the options of an `env` word
  let next = ""; // the next word is the value of `-u`/`--unset` ("unset") or of `-C`/`--chdir` ("skip")
  for (const word of (before.match(WORD) ?? []).map((w) => w.replace(OPENING, ""))) {
    // An assignment word (`NAME=value`): in `FOO=PIPX_DEFAULT_PYTHON=/p` the name is FOO, and the rest is its value.
    const assignment = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
    if (next) {
      if (next === "unset" && word === "PIPX_DEFAULT_PYTHON") chosen = false;
      next = "";
    } else if (assignment) {
      if (assignment[1] === "PIPX_DEFAULT_PYTHON") chosen = assignment[2].replace(/''|""/g, "") !== "";
      inEnv = false;
    } else if (/^(?:\S*\/)?env$/.test(word)) inEnv = true;
    else if (!inEnv || word === "--") inEnv = false;
    else if (word === "-" || word === "--ignore-environment") chosen = false;
    else if (word === "--unset" || word === "--chdir") next = word === "--unset" ? "unset" : "skip";
    else if (word.startsWith("--")) {
      if (word === "--unset=PIPX_DEFAULT_PYTHON") chosen = false;
    } else if (word.startsWith("-")) {
      for (let k = 1; k < word.length; k++) {
        if (word[k] === "i") chosen = false;
        else if ("uCS".includes(word[k])) {
          const value = word.slice(k + 1);
          if (word[k] !== "S" && !value) next = word[k] === "u" ? "unset" : "skip";
          else if (word[k] === "u" && value === "PIPX_DEFAULT_PYTHON") chosen = false;
          break;
        }
      }
    } else inEnv = false;
  }
  return chosen;
}

/**
 * True when a run script runs `pipx` in command position without choosing its interpreter: no `--python` among pipx's
 * own options, and no non-empty `PIPX_DEFAULT_PYTHON`, read first from the words in front of that `pipx` (a whole
 * assignment word, not a value that happens to hold the text, and `env`'s unset and clear options, see
 * `localDefaultPython`) and only when they leave it alone from `env` (the step's, job's and workflow's): a setting on
 * the command overrides the inherited one (Copilot on HCW-NetworkEyes_App#394). A `${{ }}` expression
 * counts as a value on purpose (`PIPX_DEFAULT_PYTHON: ${{ steps.python.outputs.python-path }}`): passing
 * setup-python's `python-path` output that way is the documented way to point pipx at the Python it set up
 * (https://github.com/actions/setup-python/blob/main/docs/advanced-usage.md#python-path).
 */
export function pipxWithoutPython(run, env = {}) {
  const inherited = String(env?.PIPX_DEFAULT_PYTHON ?? "").trim() !== "";
  return shellText(String(run ?? ""))
    .split("\n")
    .some((line) =>
      [...line.trim().matchAll(PIPX)].some(
        (found) => !(pipxOptionChoosesPython(found.groups.words) || (localDefaultPython(found.groups.before) ?? inherited)),
      ),
    );
}

/**
 * The steps of one workflow that run `pipx` without choosing its interpreter, by `stepKey` with the kind `pipx`. A job
 * in a `container:` is skipped, as `unsetSteps` skips it. `workflow` is `{ env, jobs }`; the jobs `readJobs` returns
 * already carry the workflow's `env:` in their own.
 */
export function pipxProblems(file, workflow) {
  const found = [];
  for (const [name, job] of Object.entries(workflow?.jobs ?? {})) {
    if (!Array.isArray(job?.steps) || job.container) continue;
    job.steps.forEach((step, i) => {
      const env = { ...(workflow?.env ?? {}), ...(job?.env ?? {}), ...(step?.env ?? {}) };
      if (pipxWithoutPython(step?.run, env)) found.push(stepKey(file, name, step, i, "pipx"));
    });
  }
  return found;
}

// Tests ported from the website's copy (the `describe('runsRuntime and unsetSteps')` and `describe('pipx chooses its
// Python')` blocks), case for case.

test("finds node and python in command position, not inside strings or arguments", () => {
  assert.equal(runsRuntime("token=$(node scripts/github-app-token.mjs)", "node"), true);
  assert.equal(runsRuntime("npm ci --no-audit", "node"), true);
  assert.equal(runsRuntime("cat x | python3 -I check.py", "python"), true);
  // Escaped backticks print as text (a Markdown summary line); unescaped ones run a command.
  assert.equal(runsRuntime('echo "run \\`node scripts/x.mjs\\` by hand"', "node"), false);
  assert.equal(runsRuntime('docker run --rm img python -c "import azure"', "python"), false);
  // A path in front still names the runner's interpreter (Copilot on HCW-NetworkEyes_AddOn#100).
  for (const line of [
    "/opt/az/bin/python3 -Im pip check",
    "/usr/bin/python3 -I check.py",
    "./venv/bin/python x.py",
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
  ]) {
    assert.equal(runsRuntime(line, "python"), true, line);
  }
  for (const line of [
    "/opt/node/bin/node x.js",
    "env -i npm ci",
    "nice -n 10 node x.js",
    "env -- node script.mjs",
    "command -- node scripts/x.mjs",
    "command -p -- npm ci",
    "sudo -u nobody -- node x.js",
    "timeout 60 node x.js",
    "nohup node x.js",
    "xargs -n 1 node",
    "a|b) node x.js ;;",
  ]) {
    assert.equal(runsRuntime(line, "node"), true, line);
  }
  // A container's script, a continued line's argument, a heredoc's body, a lookup and an assignment are not commands.
  assert.equal(runsRuntime("docker run --rm img bash -c '\n  /opt/az/bin/python3 -Im pip check\n'", "python"), false);
  assert.equal(runsRuntime("docker run --rm img \\\n  /opt/az/bin/python3 -Im pip check", "python"), false);
  assert.equal(runsRuntime("cat > x.txt <<'EOF'\npython3 is named here\nEOF", "python"), false);
  assert.equal(runsRuntime("command -v node", "node"), false);
  assert.equal(runsRuntime("sudo -u node whoami", "node"), false);
  // Long options that take a value, after `=` or as the next word (Copilot on HCW-MigrateOrchestrator_AddOn#74).
  for (const [line, kind] of [
    ["timeout --kill-after 5 10 python3 check.py", "python"],
    ["timeout --kill-after=5 10 node x", "node"],
    ["timeout --signal KILL 10 node x", "node"],
    ["timeout -s KILL 10 node x", "node"],
    ["timeout --foreground --signal=TERM 1m python3 x.py", "python"],
    ["sudo --user nobody node x", "node"],
    ["sudo --user=nobody -- python3 x.py", "python"],
    ["env --unset FOO node x", "node"],
    ["env --chdir=/tmp python3 x.py", "python"],
    ["nice --adjustment 5 node x", "node"],
    ["xargs --max-args 1 node", "node"],
    ["xargs --process-slot-var SLOT node x", "node"],
    ["xargs --process-slot-var=SLOT node x", "node"],
    ["stdbuf --output L node x", "node"],
    ["time --output t.txt python3 x.py", "python"],
  ]) {
    assert.equal(runsRuntime(line, kind), true, line);
  }
  for (const line of ["sudo --user node whoami", "timeout --signal node 10 x", "env --unset node x", "stdbuf --output node x"]) {
    assert.equal(runsRuntime(line, "node"), false, line);
  }
  // `env -S` runs its value as a command, so a quoted value is read like a `-c` script (Copilot on
  // HCW-MigrateOrchestrator_AddOn#74).
  for (const [line, kind] of [
    ["env -S 'node x.js'", "node"],
    ['env -S "python3 x.py"', "python"],
    ["env --split-string='node x'", "node"],
    ["env --split-string 'node x'", "node"],
    ["env -S'node x'", "node"],
    ["env -iS 'python3 x.py'", "python"],
    ["sudo env -S 'FOO=1 node x'", "node"],
    ["env -S node x.js", "node"],
    ["env -S 'pipx run x'", "python"],
  ]) {
    assert.equal(runsRuntime(line, kind), true, line);
  }
  for (const line of ["env -S 'echo node'", "env -S echo node", "echo env -S 'node x'", "docker run img env -S 'node x'"]) {
    assert.equal(runsRuntime(line, "node"), false, line);
  }
  assert.equal(runsRuntime("NODE_BIN=/opt/node/bin/node", "node"), false);
  assert.equal(runsRuntime("echo $(foo) python3 x", "python"), false);
  assert.equal(runsRuntime("echo x # node y", "node"), false);
  assert.equal(runsRuntime("# node is not run here", "node"), false);
  assert.equal(runsRuntime('for node in items["nodes"]:', "node"), false);
  // The forms a pre-PR review found the first version missed.
  for (const line of ["FOO=1 node x", "env FOO=1 node x", "sudo node x", "xargs node x", "diff a <(node x)", "(node x)", "if node x; then", "! node x", "time node x", "exec node x", "cd y && npm ci"]) {
    assert.equal(runsRuntime(line, "node"), true, line);
  }
  assert.equal(runsRuntime("python3.15 -I x.py", "python"), true);
  assert.equal(runsRuntime("uv sync --frozen", "python"), true);
  // Backtick command substitution, bare and inside double quotes; single quotes stay literal.
  assert.equal(runsRuntime("version=`python3 scripts/check.py`", "python"), true);
  assert.equal(runsRuntime('echo "`node --version`"', "node"), true);
  assert.equal(runsRuntime("echo 'literal `python3` text'", "python"), false);
  assert.equal(runsRuntime("uvicorn app:main", "python"), false);
  assert.equal(runsRuntime('echo "$NODE_VERSION"', "node"), false);
  assert.equal(runsRuntime("nodes=3 nodejs-check", "node"), false);
  assert.equal(runsRuntime('echo "the stage is wrong; if pip named the file differently, look"', "python"), false);
  assert.equal(runsRuntime('token="$(node scripts/github-app-token.mjs)"', "node"), true);
  // An assignment's value may be quoted (Copilot on HCW-MigrateOrchestrator_AddOn#72), and uv runs Python.
  assert.equal(runsRuntime('FOO="bar baz" python3 check.py', "python"), true);
  assert.equal(runsRuntime("env FOO='bar baz' node x.js", "node"), true);
  assert.equal(runsRuntime('STAMP="$(date +%s) run" python3 check.py', "python"), true);
  assert.equal(runsRuntime('FOO="python3 x" true', "python"), false);
  assert.equal(runsRuntime("uv run python scripts/check.py", "python"), true);
  assert.equal(runsRuntime("uvx zizmor .github", "python"), true);
});

test("reads the script a shell is given with -c on the runner, and not one given to a container", () => {
  const runs = [
    ["bash -c 'node x.js'", "node"],
    ['sh -c "python3 x.py"', "python"],
    ["bash -lc 'npm ci'", "node"],
    ["bash -euo pipefail -c 'python3 x.py'", "python"],
    ["bash -O extglob -c 'node x'", "node"],
    ["bash +O nullglob -c 'node x'", "node"],
    ["bash --rcfile /tmp/empty -c 'node x'", "node"],
    ["bash --init-file ./rc.sh -eo pipefail -c 'python3 x.py'", "python"],
    ["sudo -u runner bash -c 'python3 x.py'", "python"],
    ['/bin/bash -c "cd app && npm test"', "node"],
    ["version=$(sh -c 'node --version')", "node"],
    ["bash -c '\n  set -e\n  python3 x.py\n'", "python"],
    // Inside double quotes `\`` is a backtick the inner shell runs; `$'...'` turns `\n` into a new line.
    ['bash -c "echo \\`node --version\\`"', "node"],
    ["bash -c $'echo start\\nnode x.js'", "node"],
    ["if true; then\n  bash -c 'node x.js'\nfi", "node"],
    ["bash -c -- 'node x.js'", "node"],
    // An unquoted script is the one word after `-c` (Copilot on HCW-HybridCloudWorks#1716).
    ["bash -c node x.js", "node"],
    ["sh -c python3 x.py", "python"],
    ["sudo bash -lc -e pytest", "python"],
    // The outer shell runs `$(...)` and backticks in a double-quoted script first, whatever the inner one makes of them.
    ["bash -c \"echo '$(node x)'\"", "node"],
    ["sh -c \"echo '`node x`' > v\"", "node"],
    ['bash -c "x=1 # $(node y)"', "node"],
    ['bash -c "cat <<EOF\n$(python3 v)\nEOF"', "python"],
    // A substitution inside double quotes runs on the runner, so a `-c` script in it is read (Copilot on #1716).
    [`echo "$(bash -c 'node x')"`, "node"],
    [`FOO="$(sh -c 'node x')" true`, "node"],
    ['FOO="$(sh -c "node x")" true', "node"],
    ["v=`bash -c 'python3 y'`", "python"],
    ["echo \"`bash -c 'python3 y'`\"", "python"],
    [`x=$(echo "$(bash -c 'node x')")`, "node"],
  ];
  const notRuns = [
    ["docker run --rm img bash -c 'node x.js'", "node"],
    ['docker exec web sh -c "python3 x.py"', "python"],
    ["echo bash -c 'node x.js'", "node"],
    ["bash -c 'echo node is named here'", "node"],
    // The word after the script is the inner shell's `$0`, an argument.
    ["bash -c 'echo \"$0\"' python3", "python"],
    ["bash scripts/check.sh 'node x.js'", "node"],
    ["bash -c echo node", "node"],
    [`echo "$(docker run img bash -c 'node x')"`, "node"],
    [`echo "$(echo 'node x')"`, "node"],
    ["docker run img bash -c node x.js", "node"],
  ];
  for (const [line, kind] of runs) assert.equal(runsRuntime(line, kind), true, line);
  for (const [line, kind] of notRuns) assert.equal(runsRuntime(line, kind), false, line);
});

test("reads a long run of shell options quickly", () => {
  // Each `-o -o` could once be split two ways, so 18 of them took seconds.
  const started = performance.now();
  assert.equal(runsRuntime(`bash ${"-o -o ".repeat(200)}x'y'`, "node"), false);
  assert.equal(runsRuntime(`bash ${"-c ".repeat(200)}x'node y'`, "node"), false);
  // The same for a wrapper's options, each of which could be read with or without an argument (twenty `-oL`s took
  // seconds; `sudo -uuu` repeated took minutes).
  assert.equal(runsRuntime(`stdbuf${" -oL".repeat(40)} -`, "node"), false);
  assert.equal(runsRuntime(`nice${" -n10".repeat(40)} -`, "node"), false);
  // 200 nested substitutions, quoted and not, each read once per level.
  assert.equal(runsRuntime(`x="${'$(echo "'.repeat(200)}$(bash -c 'node y')${'")'.repeat(200)}"`, "node"), true);
  assert.equal(runsRuntime(`${"$(".repeat(200)}node y${")".repeat(200)}`, "node"), true);
  assert.equal(runsRuntime(`sudo${" -uuu".repeat(40)} -`, "node"), false);
  assert.equal(runsRuntime(`timeout${" --signal KILL --kill-after=5".repeat(40)} -`, "node"), false);
  assert.equal(runsRuntime(`sudo${" --user u --user=u --userx".repeat(40)} -`, "node"), false);
  assert.equal(runsRuntime(`env${" -S -i -u X".repeat(40)} -`, "node"), false);
  assert.equal(runsRuntime(`env${" -S 'x'".repeat(40)} -`, "node"), false);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
});

test("counts yarn and pnpm as Node.js, and pytest and pipx as Python, only as whole words in command position", () => {
  for (const line of ["yarn install --frozen-lockfile", "pnpm install", "cd web && pnpm test", "CI=1 yarn build"]) {
    assert.equal(runsRuntime(line, "node"), true, line);
  }
  for (const line of ["pytest -q", "PYTHONPATH=src pytest tests", "/usr/local/bin/pytest -q", "pipx run --spec checkov==3.3.30 checkov -d ."]) {
    assert.equal(runsRuntime(line, "python"), true, line);
  }
  for (const line of ["echo yarn", "./scripts/yarn-audit.sh", "myyarn install", "docker run img pnpm test"]) {
    assert.equal(runsRuntime(line, "node"), false, line);
  }
  for (const line of ["echo pytest -q", "grep pytest requirements.txt", "pytest-runner --help", "docker run img pytest"]) {
    assert.equal(runsRuntime(line, "python"), false, line);
  }
});

test("reads arithmetic shifts, backslash-quoted heredocs and $'...' strings the way the shell does", () => {
  // `<<` inside `$((...))` or `((...))` is a shift, not a heredoc, so the next line is still read.
  assert.equal(runsRuntime("size=$((1<<k))\nnode a.js", "node"), true);
  assert.equal(runsRuntime("(( n = 1 << k ))\nnode a.js", "node"), true);
  assert.equal(runsRuntime('for ((i = 0; i < 1<<k; i++)); do echo "$i"; done\nnode a.js', "node"), true);
  // `<<\EOF` is a heredoc whose body is not run.
  assert.equal(runsRuntime("cat <<\\EOF\nnode is named here\nEOF", "node"), false);
  assert.equal(runsRuntime("cat <<\\EOF\ntext\nEOF\nnode a.js", "node"), true);
  // `\'` inside `$'...'` does not end the string.
  assert.equal(runsRuntime("echo $'it\\'s'\nnode a.js", "node"), true);
  assert.equal(runsRuntime("echo $'it\\'s' 'node x'", "node"), false);
});

test("flags a job that sets the runtime up after first using it, or not at all", () => {
  const wf = {
    jobs: {
      late: { steps: [{ name: "Early", run: "node a.mjs" }, { uses: "actions/setup-node@abc" }] },
      none: { steps: [{ run: "python3 b.py" }] },
      uvOnly: { steps: [{ uses: "astral-sh/setup-uv@abc" }, { name: "Run", run: "python3 c.py" }] },
      uvNew: { steps: [{ uses: "astral-sh/setup-uv@abc", with: { "python-version": "3.15" } }, { name: "Run", run: "uv run pytest" }] },
      uvOld: { steps: [{ uses: "astral-sh/setup-uv@abc", with: { "python-version": "3.14" } }, { name: "Run", run: "uv run pytest" }] },
      good: { steps: [{ uses: "actions/setup-node@abc" }, { run: "node a.mjs" }] },
      boxed: { container: "node:26", steps: [{ run: "node a.mjs" }] },
    },
  };
  assert.deepEqual(unsetSteps("x.yml", wf.jobs), ["x.yml > late > Early > node", "x.yml > none > step 1 > python", "x.yml > uvOnly > Run > python", "x.yml > uvOld > Run > python"]);
});

test("counts a step listed as starting a runtime indirectly as running it", () => {
  const jobs = {
    scan: { steps: [{ name: "Build", run: "bash scripts/build.sh" }, { uses: "actions/setup-node@abc" }] },
    ready: { steps: [{ uses: "actions/setup-node@abc" }, { name: "Build", run: "bash scripts/build.sh" }] },
  };
  const key = "x.yml > scan > Build > node";
  assert.deepEqual(unsetSteps("x.yml", jobs, { [key]: "build.sh runs node", "x.yml > ready > Build > node": "build.sh runs node" }), [key]);
  assert.deepEqual(unsetSteps("x.yml", jobs, {}), []);
  // A step with no name, or an empty one, is named by its place in the job.
  assert.equal(stepKey("x.yml", "scan", { name: "" }, 2, "python"), "x.yml > scan > step 3 > python");
});

test("counts a set-up step with its own condition only for steps under the same condition", () => {
  const py = { uses: "actions/setup-python@abc" };
  const wf = {
    jobs: {
      skipped: { steps: [{ ...py, if: false }, { name: "Run", run: "python3 a.py" }] },
      sameCondition: { steps: [{ ...py, if: "${{ !cancelled() }}" }, { name: "Run", if: "!cancelled()", run: "python3 a.py" }] },
      unconditionalSetup: { steps: [py, { name: "Run", if: "github.ref == 'refs/heads/main'", run: "python3 a.py" }] },
      // The unwritten success(): a set-up step with no `if:` is skipped after a failure, an always() step is not.
      afterAFailure: { steps: [py, { name: "Run", if: "always()", run: "python3 a.py" }] },
      afterAFailureSetUpToo: { steps: [{ ...py, if: "always()" }, { name: "Run", if: "failure()", run: "python3 a.py" }] },
      otherCondition: { steps: [{ ...py, if: "github.event_name == 'push'" }, { name: "Run", if: "failure()", run: "python3 a.py" }] },
      // The website's ci.yml verify job: the set-up runs for either term, the step for the second.
      orTerm: { steps: [{ ...py, if: "matrix.relevant == 'true' || matrix.name == 'scripts (operations)'" }, { name: "Run", if: "matrix.name == 'scripts (operations)'", run: "python3 a.py" }] },
      andTerm: { steps: [{ ...py, if: "a == 'x' && b == 'y'" }, { name: "Run", if: "b == 'y'", run: "python3 a.py" }] },
      // A condition on `env` proves nothing; one on a step's outputs does once that step has run before the set-up step
      // (Copilot on HCW-MigrateOrchestrator_AddOn#74).
      envCondition: { steps: [{ ...py, if: "env.RUN == 'true'" }, { name: "Run", if: "env.RUN == 'true'", run: "python3 a.py" }] },
      stepRanFirst: {
        steps: [{ id: "refs", run: "echo x" }, { ...py, if: "steps.refs.outputs.changed == 'true'" }, { name: "Run", if: "steps.refs.outputs.changed == 'true'", run: "python3 a.py" }],
      },
      stepRanLater: {
        steps: [{ ...py, if: "steps.refs.outputs.changed == 'true'" }, { id: "refs", run: "echo x" }, { name: "Run", if: "steps.refs.outputs.changed == 'true'", run: "python3 a.py" }],
      },
    },
  };
  assert.deepEqual(unsetSteps("x.yml", wf.jobs), ["x.yml > skipped > Run > python", "x.yml > afterAFailure > Run > python", "x.yml > otherCondition > Run > python", "x.yml > andTerm > Run > python", "x.yml > envCondition > Run > python", "x.yml > stepRanLater > Run > python"]);
  assert.deepEqual(orTerms("(a || b) || c == 'x || y'"), ["a || b", "c == 'x || y'"]);
  assert.equal(condition({ if: "${{  a &&   b }}" }), "a && b");
});

test("compares the job status a set-up step runs after with the later step's", () => {
  const cases = [
    ["", "", true],
    ["", "always()", false],
    ["", "!cancelled()", false],
    ["", "failure()", false],
    ["!cancelled()", "!cancelled()", true],
    ["always()", "failure()", true],
    ["always()", "cancelled()", true],
    ["!cancelled()", "always()", false],
    ["!cancelled()", "cancelled()", false],
    ["failure()", "", false],
    ["always() && a", "a", true],
    ["always() && a", "!cancelled() && a", true],
    ["a", "failure() && a", false],
    ["always()", "a || b", true],
    ["(a || b) && c", "a", false],
    // A later step joined by `&&` with the set-up condition, or with one of its `||` terms, needs it to hold (Copilot
    // on HCW-HybridCloudWorks#1716: the website's ci.yml verify job sets up Node under `relevant || operations` and
    // runs `relevant && lint`).
    ["a || b", "a && c", true],
    ["a", "a && c", true],
    ["a || b", "c && (a)", true],
    ["a || b", "a || c", false],
    ["a && b", "a && c", false],
    ["a || b", "c && d", false],
    // The later condition is split on `&&` only when it has no top-level `||` (Copilot on HCW-NetworkEyes_App#393):
    // `a && c || d` can run through `d` alone.
    ["a || b", "a && c || d", false],
    ["a || b", "d || a && c", false],
    ["a || b", "(a && c) || d", false],
    ["a || b", "a && (c || d)", true],
    // Status functions joined by `&&` and `||` (Copilot on HCW-CloudAssessor_AddOn#89).
    ["always() && !cancelled()", "cancelled()", false],
    ["always() && !cancelled()", "failure()", true],
    ["failure() || cancelled()", "cancelled()", true],
    ["failure() || cancelled()", "", false],
    ["success() || failure()", "!cancelled()", true],
    // Status terms come out only of a condition with no top-level `||` (Copilot on HCW-MigrateOrchestrator_AddOn#74):
    // after success with `a` true and `b` false, `failure() && a || b` is false while `a` is true.
    ["failure() && a || b", "a", false],
    ["always() && a || b", "b", true],
    // A term that reads something a step can change is never matched by its text (Copilot on
    // HCW-MigrateOrchestrator_AddOn#74): an earlier step can write `RUN=true` to `$GITHUB_ENV` after the set-up was
    // skipped.
    ["runner.os == 'Linux'", "runner.os == 'Linux'", true],
    ["strategy.job-index == 0", "strategy.job-index == 0", true],
    ["job.status == 'success'", "job.status == 'success'", false],
    ["env.RUN == 'true'", "env.RUN == 'true'", false],
    ["steps.changes.outputs.py == 'true'", "steps.changes.outputs.py == 'true'", false],
    ["github.event_name == 'push' && env.RUN", "github.event_name == 'push' && env.RUN", false],
    ["matrix.os == 'linux' || env.RUN == 'true'", "matrix.os == 'linux'", true],
    ["matrix.os == 'linux'", "matrix.os == 'linux' && env.RUN == 'true'", true],
    ["needs.build.outputs.env == 'x'", "needs.build.outputs.env == 'x'", true],
    ["inputs.mode == 'env.RUN'", "inputs.mode == 'env.RUN'", true],
    // `steps.<id>` is fixed once that step has run before the set-up step; the fourth item is those steps' ids.
    ["steps.refs.outputs.changed == 'true'", "steps.refs.outputs.changed == 'true'", true, ["refs"]],
    ["steps.refs.outputs.changed == 'true'", "steps.refs.outputs.changed == 'true'", false, ["other"]],
    ["steps.refs.outputs.changed == 'true' && env.RUN", "steps.refs.outputs.changed == 'true' && env.RUN", false, ["refs"]],
  ];
  for (const [setup, step, covered, ran = []] of cases) assert.equal(setupCovers(setup, step, new Set(ran)), covered, `${setup} / ${step}`);
  assert.deepEqual([...statuses("always() && !cancelled()")].sort(), ["failure", "success"]);
  assert.deepEqual([...statuses("failure() || cancelled()")].sort(), ["cancelled", "failure"]);
  assert.deepEqual([...statuses("!(failure() || cancelled())")], ["success"]);
});

test("reports a pipx command that names no interpreter, and not one that does", () => {
  const cases = [
    ["pipx run --spec checkov==3.3.30 checkov -d .", {}, true],
    ["cd y && pipx install zizmor", {}, true],
    ["bash -c 'pipx run x'", {}, true],
    ['pipx run --python "$P" a && pipx run b', {}, true],
    ["MY_PIPX_DEFAULT_PYTHON=/p pipx run x", {}, true],
    ["pipx run x", { PIPX_DEFAULT_PYTHON: "" }, true],
    // Only pipx's own options and assignments count (Copilot on HCW-NetworkEyes_App#394): after `--`, and after the
    // app's name for `pipx run`, `--python` is the app's; a value holding the text sets nothing.
    ["pipx run --spec tool -- tool --python", {}, true],
    ["pipx run tool --python x", {}, true],
    ['pipx run --pip-args "--python" tool', {}, true],
    ["env FOO=PIPX_DEFAULT_PYTHON=/p pipx run x", {}, true],
    ['FOO="PIPX_DEFAULT_PYTHON=/p" pipx run x', {}, true],
    ['pipx run --python "$P" tool', {}, false],
    ["pipx run --python=/p tool", {}, false],
    ["pipx run --spec checkov==3.3.30 --python /p checkov -d .", {}, false],
    ["pipx install --python /p tool", {}, false],
    ["pipx install tool --python /p", {}, false],
    ["FOO=1 PIPX_DEFAULT_PYTHON=/p pipx run x", {}, false],
    // An empty value leaves pipx on its own interpreter (Copilot on HCW-NetworkEyes_App#394); a quoted non-empty one
    // still counts, though the shell reading empties it.
    ["PIPX_DEFAULT_PYTHON= pipx run x", {}, true],
    ["PIPX_DEFAULT_PYTHON='' pipx run x", {}, true],
    ['PIPX_DEFAULT_PYTHON="" pipx run x', {}, true],
    ['PIPX_DEFAULT_PYTHON="$P" pipx run x', {}, false],
    ["PIPX_DEFAULT_PYTHON='/opt/py/bin/python3' pipx run x", {}, false],
    ["env PIPX_DEFAULT_PYTHON= pipx run x", {}, true],
    // Empty quotes run together are still empty, a quoted value elsewhere in the script does not vouch for this
    // command's, and the last assignment of the name wins (Copilot on HCW-HybridCloudWorks#1718).
    ["PIPX_DEFAULT_PYTHON=''\"\" pipx run x", {}, true],
    ["PIPX_DEFAULT_PYTHON=\"\"'' pipx run x", {}, true],
    ["PIPX_DEFAULT_PYTHON='' pipx run x; PIPX_DEFAULT_PYTHON=\"$P\" echo", {}, true],
    ["PIPX_DEFAULT_PYTHON='' pipx a; PIPX_DEFAULT_PYTHON='/p' pipx b", {}, true],
    ["PIPX_DEFAULT_PYTHON='/p' PIPX_DEFAULT_PYTHON= pipx run x", {}, true],
    ["PIPX_DEFAULT_PYTHON= PIPX_DEFAULT_PYTHON='/p' pipx run x", {}, false],
    ['PIPX_DEFAULT_PYTHON=""/p pipx run x', {}, false],
    ['pipx run --python "$P" --spec x x', {}, false],
    ["pipx run --python=/opt/py/bin/python3 x", {}, false],
    ["PIPX_DEFAULT_PYTHON=/p pipx run x", {}, false],
    ["env PIPX_DEFAULT_PYTHON=/p pipx run x", {}, false],
    ["pipx run x", { PIPX_DEFAULT_PYTHON: "/p" }, false],
    // A setting on the command overrides the inherited one (Copilot on HCW-NetworkEyes_App#394): set empty, unset or
    // cleared by `env`, it chooses nothing; `--python` still chooses.
    ["PIPX_DEFAULT_PYTHON= pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["PIPX_DEFAULT_PYTHON='' pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env -u PIPX_DEFAULT_PYTHON pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env -uPIPX_DEFAULT_PYTHON pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env --unset PIPX_DEFAULT_PYTHON pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env --unset=PIPX_DEFAULT_PYTHON pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env -i pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env --ignore-environment pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["env --chdir /tmp -u PIPX_DEFAULT_PYTHON pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["PIPX_DEFAULT_PYTHON=/p env -u PIPX_DEFAULT_PYTHON pipx run x", {}, true],
    ["pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, false],
    ["env -u PIPX_DEFAULT_PYTHON pipx run --python /p x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, false],
    ["env -i PIPX_DEFAULT_PYTHON=/p pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, false],
    ["env -u OTHER pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, false],
    ["sudo -u PIPX_DEFAULT_PYTHON pipx run x", { PIPX_DEFAULT_PYTHON: "/opt/py" }, false],
    ["env -S 'pipx run x'", {}, true],
    ["env -S 'pipx run x'", { PIPX_DEFAULT_PYTHON: "/opt/py" }, false],
    ["(PIPX_DEFAULT_PYTHON=/p pipx run x)", {}, false],
    ["cd y &&PIPX_DEFAULT_PYTHON=/p pipx run x", {}, false],
    ["(PIPX_DEFAULT_PYTHON= pipx run x)", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["x=$(env -i pipx run x)", { PIPX_DEFAULT_PYTHON: "/opt/py" }, true],
    ["echo pipx", {}, false],
    ["docker run img pipx run x", {}, false],
    ["python3 -m pip install pipx", {}, false],
  ];
  for (const [run, env, flagged] of cases) assert.equal(pipxWithoutPython(run, env), flagged, run);
});

test("reads the step's, job's and workflow's env for pipx", () => {
  const scan = "pipx run checkov -d .";
  const workflow = {
    env: { FROM_WORKFLOW: "1" },
    jobs: {
      bare: { steps: [{ name: "Scan", run: "pipx run --spec checkov==3.3.30 checkov -d ." }] },
      stepEnv: { steps: [{ name: "Scan", env: { PIPX_DEFAULT_PYTHON: "${{ steps.python.outputs.python-path }}" }, run: scan }] },
      jobEnv: { env: { PIPX_DEFAULT_PYTHON: "/opt/py/bin/python3" }, steps: [{ run: scan }] },
      option: { steps: [{ name: "Scan", env: { PYTHON_PATH: "${{ steps.python.outputs.python-path }}" }, run: 'pipx run --python "$PYTHON_PATH" --spec checkov==3.3.30 checkov -d .' }] },
      boxed: { container: "python:3.15", steps: [{ run: scan }] },
    },
  };
  assert.deepEqual(pipxProblems("x.yml", workflow), ["x.yml > bare > Scan > pipx"]);
  assert.deepEqual(pipxProblems("x.yml", { ...workflow, env: { PIPX_DEFAULT_PYTHON: "/opt/py/bin/python3" } }), []);
});

// This repository's own tests: more command forms, the workflow reader, the set-up versions and the floors.

test("runsRuntime finds this repository's own command forms", () => {
  const node = ['FOO="a b"\'c d\'e node x.js'];
  for (const line of node) assert.equal(runsRuntime(line, "node"), true, line);
  const python = [
    'compare_out="$(python3 -I scripts/follow_website_base.py --check)"',
    "python -m pip install uv",
    "python3 -m venv zizmor-env",
    'echo "`python3 --version`"',
    "zizmor-env/bin/python -m pip install zizmor",
    "docker run --rm img bash -c 'x' && python3 y.py",
  ];
  for (const line of python) assert.equal(runsRuntime(line, "python"), true, line);
});

test("a job read from YAML that sets the runtime up late or never is flagged", () => {
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

test("a set-up step read from YAML with its own condition covers only steps it always runs before", () => {
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
    "  and-covered:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - uses: actions/setup-node@abc",
    "        if: matrix.relevant == 'true' || matrix.name == 'scripts'",
    "      - name: Run",
    "        if: matrix.relevant == 'true' && matrix.lint == 'true'",
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

test("setupCovers compares normalised conditions and top-level || terms", () => {
  const cases = [
    ["${{  a &&   b }}", "a && b", true],
    ["a || b", "b", true],
    ["(a) || (b && c)", "b && c", true],
    ["x == 'p || q' || r", "x == 'p", false],
    ["", "anything", true],
    ["", "${{ !cancelled() }}", false],
    ["${{ !cancelled() }}", "${{ !cancelled() }}", true],
  ];
  for (const [setup, step, covered] of cases) {
    assert.equal(setupCovers(condition({ if: setup }), condition({ if: step })), covered, `${setup} / ${step}`);
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

test("pipx reads the workflow's env through the jobs readJobs returns", () => {
  const text = [
    "name: x",
    "on: push",
    "env:",
    "  PIPX_DEFAULT_PYTHON: /opt/py/bin/python3",
    "jobs:",
    "  scan:",
    "    runs-on: ubuntu-26.04",
    "    steps:",
    "      - run: pipx run checkov -d .",
    "",
  ].join("\n");
  assert.deepEqual(pipxProblems("x.yml", { jobs: readJobs(text) }), []);
  assert.deepEqual(pipxProblems("x.yml", { jobs: readJobs(text.replace(/^env:\n.*\n/m, "")) }), ["x.yml > scan > step 1 > pipx"]);
});

// The workflows in this repository.

const files = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();
const texts = Object.fromEntries(files.map((file) => [file, readFileSync(join(WORKFLOWS, file), "utf8")]));
const workflows = Object.fromEntries(files.map((file) => [file, readJobs(texts[file])]));
const unset = files.flatMap((file) => unsetSteps(file, workflows[file]));
const pipx = files.flatMap((file) => pipxProblems(file, { jobs: workflows[file] }));

test("the reader finds every job and every steps: list", () => {
  for (const file of files) {
    const jobs = workflows[file];
    const runners = (texts[file].match(/^\s+runs-on:/gm) ?? []).length;
    assert.ok(Object.keys(jobs).length >= runners, `${file}: read fewer jobs than the file has runs-on lines`);
    const stepLists = (texts[file].match(/^\s+steps:\s*$/gm) ?? []).length;
    assert.equal(Object.values(jobs).filter((job) => job.steps.length).length, stepLists, file);
  }
});

test("every set-up step asks for the floor or newer", () => {
  assert.deepEqual(
    files.flatMap((file) => floorProblems(file, workflows[file])),
    [],
  );
});

test("every step that runs Node.js or Python comes after its version is set up, so the runner image never chooses it", () => {
  assert.deepEqual(
    unset.filter((entry) => !(entry in RUNNER_DEFAULT_ALLOWED)),
    [],
  );
});

test("every step that runs pipx chooses its Python, so pipx never falls back to the runner image's own", () => {
  assert.deepEqual(
    pipx.filter((entry) => !(entry in PIPX_ALLOWED)),
    [],
  );
});

test("every allowed exception still exists and says why, so the list cannot hide a step that has since changed", () => {
  for (const [entry, reason] of Object.entries(RUNNER_DEFAULT_ALLOWED)) {
    assert.ok(typeof reason === "string" && reason.trim(), `${entry}: an exception needs a reason`);
    assert.ok(unset.includes(entry), entry);
  }
  for (const [entry, reason] of Object.entries(PIPX_ALLOWED)) {
    assert.ok(typeof reason === "string" && reason.trim(), `${entry}: an exception needs a reason`);
    assert.ok(pipx.includes(entry), entry);
  }
});

test("every indirect step still exists and says why, so a renamed or removed step cannot leave the list pointing at nothing", () => {
  const keys = new Set(
    files.flatMap((file) =>
      Object.entries(workflows[file]).flatMap(([name, job]) => job.steps.flatMap((step, i) => Object.keys(COMMAND).map((kind) => stepKey(file, name, step, i, kind)))),
    ),
  );
  for (const [entry, reason] of Object.entries(INDIRECT_RUNTIME)) {
    assert.ok(typeof reason === "string" && reason.trim(), `${entry}: an indirect step needs a reason`);
    assert.ok(keys.has(entry), entry);
  }
});
