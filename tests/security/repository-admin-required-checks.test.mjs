import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/*
 * The repository-admin workflow cannot drift from the live rulesets, or silently weaken them.
 *
 * `repository-admin.yml` builds the "Protect main" ruleset from a hard-coded REQUIRED_CHECKS list and replaces the
 * live ruleset with a PUT. On 2026-10-25 the live rulesets were tightened (one approving review, code-owner review,
 * last-push approval, thread resolution, a `creation` rule and a bypass actor on the release tags) while this file
 * still held the old payloads: running `protect-main` or `protect-release-tags` with `apply` would have lowered the
 * live policy without a word. Two things stop that from happening again, and both are pinned here:
 *
 * - The list is pinned twice. Every name in REQUIRED_CHECKS must be a real job name in `ci.yml` or `security.yml`
 *   (a name that no job reports blocks every pull request for good), and the list must equal
 *   EXPECTED_REQUIRED_CHECKS below. The second pin is deliberate friction: the live ruleset cannot be read from a
 *   test, so the list in the test is the record of what the ruleset is supposed to say.
 * - The payloads are the live policy, and the task reads before it writes. The payloads of `protect-main` and
 *   `protect-release-tags` equal EXPECTED_MAIN and EXPECTED_TAGS below (the live rulesets, read 2026-10-25), so an
 *   apply is a no-op today. Both tasks read the live ruleset, print what the update would remove, weaken, add or
 *   change, and in apply mode refuse (exit non-zero, no write) to remove a rule, a required check, a bypass actor or
 *   a ref pattern, to lower an approval count, or to switch off a protection, unless the input `allow_weakening` is
 *   ticked. The behaviour tests run the real step body with a stand-in `gh` that answers from sample rulesets and
 *   records every call, and mutate the payload builder one setting at a time to prove each mutation is refused.
 *
 * They need `bash` and `jq`. GitHub's runners have both; a machine without them skips the behaviour tests, and the
 * first test fails on CI if either is missing so a skip can never hide there.
 */

const WORKFLOWS = ".github/workflows";
const ADMIN_WORKFLOW = `${WORKFLOWS}/repository-admin.yml`;
const CHECK_WORKFLOWS = [`${WORKFLOWS}/ci.yml`, `${WORKFLOWS}/security.yml`];
const STEP_NAME = "Run the chosen task";

// The required status checks of the live "Protect main" ruleset (read 2026-10-25, ruleset 25778324), in the order the
// ruleset lists them. CHANGING THE LIVE RULESET AND THIS LIST MUST HAPPEN TOGETHER: add or remove a check in the
// ruleset, in REQUIRED_CHECKS of repository-admin.yml and here, in one pull request. Otherwise the next `protect-main`
// run undoes (or never applies) the change.
const EXPECTED_REQUIRED_CHECKS = [
  "build-test",
  "codeql",
  "secret-scan",
  "packed-consumer",
  "generated-terraform",
  "appliance-image",
];

// The live rulesets (read 2026-10-25, ids 25778324 and 25778331) as the payload builders of repository-admin.yml must
// produce them, apart from `required_status_checks`, which comes from REQUIRED_CHECKS above. CHANGING A LIVE RULESET
// AND THESE TWO BASELINES MUST HAPPEN TOGETHER, like the check list.
const EXPECTED_MAIN = {
  name: "Protect main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        required_reviewers: [],
        require_code_owner_review: true,
        require_last_push_approval: true,
        required_review_thread_resolution: true,
        require_extra_approval_for_unattributed_changes: true,
        allowed_merge_methods: ["merge", "squash", "rebase"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: EXPECTED_REQUIRED_CHECKS.map((context) => ({ context })),
      },
    },
  ],
};
const EXPECTED_TAGS = {
  name: "Protect release tags",
  target: "tag",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } },
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
  rules: [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "update" }, { type: "creation" }],
};

// A list that lacks the last two live checks: what REQUIRED_CHECKS would hold if two checks were added to the ruleset
// by hand and not to the file.
const STALE_REQUIRED_CHECKS = EXPECTED_REQUIRED_CHECKS.slice(0, -2);
const MISSING_FROM_STALE = EXPECTED_REQUIRED_CHECKS.slice(-2);

const HAS_TOOLS = ["bash", "jq"].every((tool) => spawnSync("bash", ["-c", `command -v ${tool}`]).status === 0);
const needsTools = { skip: HAS_TOOLS ? false : "bash and jq are required" };

// --- reading the workflow files (no YAML library in this repository; the files share one style) ---

const text = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** Map each job id to its text: a job starts at two spaces and a name inside the top-level `jobs:` block. */
function jobsOf(path) {
  const rest = text(path).split("\njobs:\n")[1] ?? "";
  const jobs = {};
  for (const piece of rest.split(/^(?=  [A-Za-z0-9_-]+:\s*$)/m)) {
    if (piece.trim()) jobs[piece.split(":")[0].trim()] = piece;
  }
  return jobs;
}

/** The one step named STEP_NAME of the admin job, as { env: { NAME: value }, run: shell text }. */
function step() {
  const steps = jobsOf(ADMIN_WORKFLOW).admin.split(/^(?=      - )/m).slice(1);
  const matches = steps.filter((s) => s.startsWith(`      - name: ${STEP_NAME}\n`));
  assert.equal(matches.length, 1, `expected exactly one step named '${STEP_NAME}'`);
  const envBlock = matches[0].match(/^        env:\n([\s\S]*?)^        run: \|\n/m);
  const runBlock = matches[0].match(/^        run: \|\n([\s\S]*)$/m);
  assert.ok(envBlock && runBlock, "the step needs an env: block followed by a run: | block");
  const env = {};
  for (const [, name, raw] of envBlock[1].matchAll(/^          ([A-Z_]+): (.*)$/gm)) {
    const value = raw.trim();
    env[name] = value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  }
  // remove the YAML indentation of the block scalar (ten spaces); blank lines stay blank
  const run = runBlock[1]
    .split("\n")
    .map((line) => (line.startsWith(" ".repeat(10)) ? line.slice(10) : line.trim()))
    .join("\n")
    .replace(/\n+$/, "\n");
  return { env, run };
}

/** The `type` and `default` of one workflow_dispatch input. */
function input(name) {
  const block = text(ADMIN_WORKFLOW).match(new RegExp(`^      ${name}:\\n([\\s\\S]*?)(?=^      \\S|^\\S)`, "m"));
  assert.ok(block, `no workflow_dispatch input ${name}`);
  return Object.fromEntries([...block[1].matchAll(/^        (type|default): (\S+)\s*$/gm)].map((m) => [m[1], m[2]]));
}

const requiredChecks = () => JSON.parse(step().env.REQUIRED_CHECKS);

/** Every check name the jobs of the CI workflows report, with ${{ matrix.<key> }} rendered for each value. */
function jobNamesInCi() {
  const names = new Set();
  for (const path of CHECK_WORKFLOWS) {
    for (const [jobId, job] of Object.entries(jobsOf(path))) {
      const found = job.match(/^    name: (.+?)\s*$/m);
      const name = found ? found[1].replace(/^["']|["']$/g, "") : jobId;
      const matrix = Object.fromEntries([...job.matchAll(/^        (\w+): \[(.*)\]\s*$/gm)].map((m) => [m[1], m[2]]));
      let rendered = [name];
      for (const [key, values] of Object.entries(matrix)) {
        const placeholder = `\${{ matrix.${key} }}`;
        if (name.includes(placeholder)) {
          rendered = rendered.flatMap((t) => values.split(",").map((value) => t.replaceAll(placeholder, value.trim())));
        }
      }
      for (const t of rendered) {
        assert.ok(!t.includes("${{"), `${path}: job '${jobId}' has a name this test cannot render: '${t}'`);
        names.add(t);
      }
    }
  }
  return names;
}

test("CI has the tools the behaviour tests need", () => {
  if (process.env.CI === "true") {
    assert.ok(HAS_TOOLS, "bash and jq must be on the CI runner; the behaviour tests would otherwise skip");
  }
});

// --- the list: real job names, and exactly the expected set ---

test("every required check is a job name in ci.yml or security.yml", () => {
  const jobs = jobNamesInCi();
  const missing = requiredChecks().filter((name) => !jobs.has(name));
  assert.deepEqual(
    missing,
    [],
    `REQUIRED_CHECKS names no job of ci.yml or security.yml: ${JSON.stringify(missing)}. A required check that no job reports blocks every pull request.`,
  );
});

test("the required checks equal the expected list", () => {
  const required = requiredChecks();
  assert.equal(new Set(required).size, required.length, "REQUIRED_CHECKS has a duplicate");
  assert.deepEqual(
    [...required].sort(),
    [...EXPECTED_REQUIRED_CHECKS].sort(),
    "REQUIRED_CHECKS in repository-admin.yml differs from EXPECTED_REQUIRED_CHECKS in this test. The live 'Protect main' ruleset, REQUIRED_CHECKS and this list change together, in one pull request.",
  );
});

test("the expected list is itself made of job names", () => {
  const jobs = jobNamesInCi();
  assert.deepEqual(
    EXPECTED_REQUIRED_CHECKS.filter((name) => !jobs.has(name)),
    [],
  );
});

// --- the inputs and the shape of the step ---

test("allow_weakening is an explicit boolean that defaults to false, and the dry run stays the default", () => {
  assert.deepEqual(input("allow_weakening"), { type: "boolean", default: "false" });
  assert.deepEqual(input("apply"), { type: "boolean", default: "false" });
  assert.equal(step().env.ALLOW_WEAKENING, "${{ inputs.allow_weakening }}");
});

test("only one place writes a ruleset and it compares with the live one first", () => {
  // A new task cannot replace a ruleset on its own: every write is inside upsert_ruleset.
  const body = step().run;
  const count = (needle) => body.split(needle).length - 1;
  assert.equal(count("-X PUT"), 1);
  assert.equal(count("-X POST"), 1);
  const functionStart = body.indexOf("upsert_ruleset() {");
  const compare = body.indexOf('compare_ruleset "$name" "$payload"', functionStart);
  const refuse = body.indexOf("exit 1", compare);
  assert.ok(functionStart >= 0 && compare > functionStart && refuse > compare, "upsert_ruleset compares, then may refuse");
  assert.ok(refuse < body.indexOf("-X PUT") && body.indexOf("-X PUT") < body.indexOf("-X POST"));
  assert.ok(body.slice(compare, refuse).includes('"${ALLOW_WEAKENING:-false}" != "true"'));
});

// --- behaviour: the real step body against a stand-in gh ---

// Stand-in for `gh api`: answers from the sample files in $FAKE_GH_DIR and records every call there.
const STUB_GH = `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "api" ] || { echo "stub gh: unsupported: $*" >&2; exit 2; }
shift
method=GET; path=""; jq_expr=""
while [ $# -gt 0 ]; do
  case "$1" in
    -H) shift ;;
    -X) method="$2"; shift ;;
    --jq) jq_expr="$2"; shift ;;
    --input) shift ;;
    --paginate) ;;
    -*) echo "stub gh: unsupported flag $1" >&2; exit 2 ;;
    *) path="$1" ;;
  esac
  shift
done
echo "$method $path" >> "$FAKE_GH_DIR/calls.log"
if [ "$method" != GET ]; then cat > "$FAKE_GH_DIR/body-$method.json"; echo '{}'; exit 0; fi
case "$path" in
  */rulesets) file="$FAKE_GH_DIR/list.json" ;;
  */rulesets/*) file="$FAKE_GH_DIR/ruleset-\${path##*/}.json" ;;
  */branches) file="$FAKE_GH_DIR/branches.json" ;;
  *) echo "stub gh: no answer for $path" >&2; exit 1 ;;
esac
[ -f "$file" ] || { echo "stub gh: not found: $path" >&2; exit 1; }
if [ -n "$jq_expr" ]; then jq -r "$jq_expr" "$file"; else cat "$file"; fi
`;

// On Windows the variable is called `Path`; setting `PATH` as well would give the child two of them.
const PATH_KEY = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";

const MAIN_ID = 111;
const TAGS_ID = 222;

/** The live "Protect main" ruleset as the API returns it, with optional changes made to it. */
function liveMain({ checks, extraRules = [], extraBypass = [], pullRequest = {} } = {}) {
  const ruleset = structuredClone(EXPECTED_MAIN);
  ruleset.id = MAIN_ID;
  ruleset.bypass_actors.push(...extraBypass);
  ruleset.rules.push(...extraRules);
  for (const rule of ruleset.rules) {
    if (rule.type === "required_status_checks" && checks) {
      rule.parameters.required_status_checks = checks.map((context) => ({ context }));
    }
    if (rule.type === "pull_request") Object.assign(rule.parameters, pullRequest);
  }
  return ruleset;
}

function liveTags({ extraRules = [], include = ["refs/tags/v*"], bypassMode = "always" } = {}) {
  const ruleset = structuredClone(EXPECTED_TAGS);
  ruleset.id = TAGS_ID;
  ruleset.conditions.ref_name.include = [...include];
  ruleset.bypass_actors[0].bypass_mode = bypassMode;
  ruleset.rules.push(...extraRules);
  return ruleset;
}

/** Run the real step body of repository-admin.yml with a stand-in gh. `live` is the list of live rulesets. */
function runStep(task, { apply = false, allowWeakening = false, live = [], requiredChecks: checks, mutate } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  try {
    const work = join(dir, "work");
    const stubs = join(dir, "bin");
    mkdirSync(work);
    mkdirSync(stubs);
    const gh = join(stubs, "gh");
    writeFileSync(gh, STUB_GH, { encoding: "utf8" });
    chmodSync(gh, 0o755);
    writeFileSync(
      join(work, "list.json"),
      JSON.stringify(live.map(({ id, name, target, enforcement }) => ({ id, name, target, enforcement }))),
    );
    for (const ruleset of live) writeFileSync(join(work, `ruleset-${ruleset.id}.json`), JSON.stringify(ruleset));
    writeFileSync(join(work, "branches.json"), JSON.stringify([{ name: "main" }]));
    writeFileSync(join(work, "summary.md"), "");
    let body = step().run;
    if (mutate) {
      const [old, replacement] = mutate;
      assert.equal(body.split(old).length - 1, 1, `the mutation target '${old}' is not in the step exactly once`);
      body = body.replace(old, () => replacement);
    }
    const script = join(dir, "step.sh");
    writeFileSync(script, body, { encoding: "utf8" });
    const posix = (p) => p.replaceAll("\\", "/");
    const result = spawnSync("bash", [posix(script)], {
      env: {
        ...process.env,
        [PATH_KEY]: `${posix(stubs)}${delimiter}${process.env[PATH_KEY]}`,
        FAKE_GH_DIR: posix(work),
        GITHUB_STEP_SUMMARY: posix(join(work, "summary.md")),
        GH_TOKEN: "stub",
        REPO: "owner/repo",
        DEFAULT_BRANCH: "main",
        TASK: task,
        APPLY: apply ? "true" : "false",
        ALLOW_WEAKENING: allowWeakening ? "true" : "false",
        REQUIRED_CHECKS: checks ?? step().env.REQUIRED_CHECKS,
        KEEP_REGEX: step().env.KEEP_REGEX,
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    const calls = existsSync(join(work, "calls.log"))
      ? readFileSync(join(work, "calls.log"), "utf8").split("\n").filter(Boolean)
      : [];
    // read now: the temporary directory is removed when this function returns
    const bodies = Object.fromEntries(
      ["PUT", "POST"]
        .filter((method) => existsSync(join(work, `body-${method}.json`)))
        .map((method) => [method, JSON.parse(readFileSync(join(work, `body-${method}.json`), "utf8"))]),
    );
    const sent = (method) => {
      assert.ok(bodies[method], `no ${method} body was sent`);
      return bodies[method];
    };
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      summary: readFileSync(join(work, "summary.md"), "utf8"),
      calls,
      writes: calls.filter((call) => !call.startsWith("GET ")),
      sent,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sentChecks = (run, method) => run.sent(method).rules.at(-1).parameters.required_status_checks.map((c) => c.context);
const NOTHING_REMOVED = "The update removes and weakens nothing that is live.";

describe("protect-main does not drop live checks", needsTools, () => {
  test("a dry run against a matching live ruleset removes nothing", () => {
    const run = runStep("protect-main", { live: [liveMain(), liveTags()] });
    assert.equal(run.status, 0, run.output);
    assert.ok(run.summary.includes(NOTHING_REMOVED));
    assert.ok(run.summary.includes("The update adds and changes nothing."));
    assert.deepEqual(run.writes, []);
  });

  test("a list that lacks live checks is reported, and apply refuses it", () => {
    const stale = JSON.stringify(STALE_REQUIRED_CHECKS);
    const dry = runStep("protect-main", { live: [liveMain()], requiredChecks: stale });
    assert.equal(dry.status, 0, dry.output);
    assert.ok(dry.summary.includes("would REMOVE or WEAKEN these"));
    for (const name of MISSING_FROM_STALE) assert.ok(dry.summary.includes(`- check: ${name}`), name);
    assert.ok(dry.summary.includes("Apply would be REFUSED"));
    assert.deepEqual(dry.writes, []);

    const applied = runStep("protect-main", { apply: true, live: [liveMain()], requiredChecks: stale });
    assert.notEqual(applied.status, 0);
    assert.ok(applied.summary.includes("REFUSED"));
    assert.ok(applied.summary.includes("Nothing was changed."));
    assert.deepEqual(applied.writes, []);
  });

  test("apply with allow_weakening goes ahead and says so", () => {
    const stale = JSON.stringify(STALE_REQUIRED_CHECKS);
    const run = runStep("protect-main", { apply: true, allowWeakening: true, live: [liveMain()], requiredChecks: stale });
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.writes, [`PUT repos/owner/repo/rulesets/${MAIN_ID}`]);
    assert.ok(run.summary.includes("allow_weakening is ticked"));
    assert.deepEqual(sentChecks(run, "PUT"), STALE_REQUIRED_CHECKS);
  });

  test("adding checks needs no allow_weakening", () => {
    // The ordinary change: the file has two checks the live ruleset lacks; apply adds and removes nothing.
    const run = runStep("protect-main", { apply: true, live: [liveMain({ checks: STALE_REQUIRED_CHECKS })] });
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.writes, [`PUT repos/owner/repo/rulesets/${MAIN_ID}`]);
    for (const name of MISSING_FROM_STALE) assert.ok(run.summary.includes(`- check: ${name}`), name);
    assert.ok(run.summary.includes(NOTHING_REMOVED));
    assert.deepEqual(sentChecks(run, "PUT"), EXPECTED_REQUIRED_CHECKS);
  });

  test("a check that only the live ruleset has blocks apply", () => {
    const run = runStep("protect-main", {
      apply: true,
      live: [liveMain({ checks: [...EXPECTED_REQUIRED_CHECKS, "Added In The UI"] })],
    });
    assert.notEqual(run.status, 0);
    assert.ok(run.summary.includes("- check: Added In The UI"));
    assert.deepEqual(run.writes, []);
  });

  test("a rule or a bypass actor that only the live ruleset has blocks apply", () => {
    const rule = runStep("protect-main", { apply: true, live: [liveMain({ extraRules: [{ type: "required_signatures" }] })] });
    assert.notEqual(rule.status, 0);
    assert.ok(rule.summary.includes("- rule: required_signatures"));
    assert.deepEqual(rule.writes, []);

    const extraBypass = [{ actor_id: 1, actor_type: "OrganizationAdmin", bypass_mode: "always" }];
    const bypass = runStep("protect-main", { apply: true, live: [liveMain({ extraBypass })] });
    assert.notEqual(bypass.status, 0);
    assert.ok(bypass.summary.includes("- bypass: OrganizationAdmin 1 (always)"));
    assert.deepEqual(bypass.writes, []);
  });

  test("with no live ruleset apply creates it", () => {
    const run = runStep("protect-main", { apply: true, live: [] });
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.writes, ["POST repos/owner/repo/rulesets"]);
    assert.deepEqual(sentChecks(run, "POST"), EXPECTED_REQUIRED_CHECKS);
  });

  for (const [liveLabel, live] of [
    ["no live ruleset", () => []],
    ["a live ruleset", () => [liveMain()]],
  ]) {
    for (const bad of ["[]", "{}", '["a","a"]', '["a",""]', "[1]", "not json"]) {
      // With no live ruleset there is nothing to compare, so only the list check stands in the way of a POST.
      test(`a malformed REQUIRED_CHECKS value ${bad} stops before any write (${liveLabel})`, () => {
        const run = runStep("protect-main", { apply: true, allowWeakening: true, live: live(), requiredChecks: bad });
        assert.notEqual(run.status, 0);
        assert.deepEqual(run.writes, []);
      });
    }
  }
});

describe("protect-release-tags does not drop live settings", needsTools, () => {
  test("a matching live ruleset is updated without removing anything", () => {
    const run = runStep("protect-release-tags", { apply: true, live: [liveTags()] });
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.writes, [`PUT repos/owner/repo/rulesets/${TAGS_ID}`]);
    assert.ok(run.summary.includes(NOTHING_REMOVED));
  });

  test("a pattern that only the live ruleset has blocks apply", () => {
    // A second tag pattern added to the live ruleset by hand: apply must not undo it.
    const live = [liveTags({ include: ["refs/tags/v*", "refs/tags/extra-v*"] })];
    const dry = runStep("protect-release-tags", { live });
    assert.equal(dry.status, 0, dry.output);
    assert.ok(dry.summary.includes("- include: refs/tags/extra-v*"));
    assert.ok(dry.summary.includes("Apply would be REFUSED"));
    const applied = runStep("protect-release-tags", { apply: true, live });
    assert.notEqual(applied.status, 0);
    assert.deepEqual(applied.writes, []);
    const allowed = runStep("protect-release-tags", { apply: true, allowWeakening: true, live });
    assert.equal(allowed.status, 0, allowed.output);
    assert.deepEqual(allowed.writes, [`PUT repos/owner/repo/rulesets/${TAGS_ID}`]);
  });

  test("a rule that only the live ruleset has blocks apply", () => {
    const run = runStep("protect-release-tags", {
      apply: true,
      live: [liveTags({ extraRules: [{ type: "required_signatures" }] })],
    });
    assert.notEqual(run.status, 0);
    assert.ok(run.summary.includes("- rule: required_signatures"));
    assert.deepEqual(run.writes, []);
  });
});

test("show-plan prints what each task would remove and writes nothing", needsTools, () => {
  const live = [liveMain({ checks: [...EXPECTED_REQUIRED_CHECKS, "Added In The UI"] }), liveTags()];
  const run = runStep("show-plan", { apply: true, live });
  assert.equal(run.status, 0, run.output);
  assert.ok(run.summary.includes("What protect-main would change in the live ruleset:"));
  assert.ok(run.summary.includes("- check: Added In The UI"));
  assert.ok(run.summary.includes("What protect-release-tags would change in the live ruleset:"));
  assert.deepEqual(run.writes, []);
});

// --- the payloads are the live policy, and every weakening of it is refused ---

/** The ruleset the task would create: run it against an empty repository and read the POST body. */
function payloadSent(task) {
  const run = runStep(task, { apply: true, live: [] });
  assert.equal(run.status, 0, run.output);
  return run.sent("POST");
}

test("the protect-main payload is the live policy", needsTools, () => {
  assert.deepEqual(payloadSent("protect-main"), EXPECTED_MAIN);
});

test("the protect-release-tags payload is the live policy", needsTools, () => {
  assert.deepEqual(payloadSent("protect-release-tags"), EXPECTED_TAGS);
});

for (const [task, live] of [
  ["protect-main", liveMain],
  ["protect-release-tags", liveTags],
]) {
  test(`applying ${task} to the live ruleset as it is changes nothing`, needsTools, () => {
    const run = runStep(task, { apply: true, live: [live()] });
    assert.equal(run.status, 0, run.output);
    assert.ok(run.summary.includes(NOTHING_REMOVED));
    assert.ok(run.summary.includes("The update adds and changes nothing."));
  });
}

// Each mutation edits ONE setting of the payload builder so that it is weaker than the live ruleset. Apply must refuse
// it and send nothing; with allow_weakening it goes ahead. `old` is asserted to occur exactly once.
// [label, text in the step, replacement, line the summary must show]
const MAIN_MUTATIONS = [
  [
    "approvals lowered",
    "required_approving_review_count: 1,",
    "required_approving_review_count: 0,",
    "param: pull_request.required_approving_review_count: live 1, payload 0",
  ],
  [
    "stale reviews no longer dismissed",
    "dismiss_stale_reviews_on_push: true,",
    "dismiss_stale_reviews_on_push: false,",
    "param: pull_request.dismiss_stale_reviews_on_push: live true, payload false",
  ],
  [
    "code owner review off",
    "require_code_owner_review: true,",
    "require_code_owner_review: false,",
    "param: pull_request.require_code_owner_review: live true, payload false",
  ],
  [
    "last push approval off",
    "require_last_push_approval: true,",
    "require_last_push_approval: false,",
    "param: pull_request.require_last_push_approval: live true, payload false",
  ],
  [
    "thread resolution off",
    "required_review_thread_resolution: true,",
    "required_review_thread_resolution: false,",
    "param: pull_request.required_review_thread_resolution: live true, payload false",
  ],
  [
    "extra approval for unattributed changes off",
    "require_extra_approval_for_unattributed_changes: true,",
    "require_extra_approval_for_unattributed_changes: false,",
    "param: pull_request.require_extra_approval_for_unattributed_changes: live true, payload false",
  ],
  [
    "a merge method dropped",
    'allowed_merge_methods: ["merge", "squash", "rebase"]',
    'allowed_merge_methods: ["merge", "squash"]',
    "param: pull_request.allowed_merge_methods",
  ],
  [
    "checks no longer enforced on create",
    "do_not_enforce_on_create: false,",
    "do_not_enforce_on_create: true,",
    "param: required_status_checks.do_not_enforce_on_create",
  ],
  ["the deletion rule dropped", '      { type: "deletion" },\n', "", "- rule: deletion"],
  [
    "the bypass actor dropped",
    'bypass_actors: [ { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" } ],',
    "bypass_actors: [],",
    "- bypass: RepositoryRole 5 (pull_request)",
  ],
  [
    "a different branch protected",
    'include: ["~DEFAULT_BRANCH"]',
    'include: ["refs/heads/other"]',
    "- include: ~DEFAULT_BRANCH",
  ],
];
const TAGS_MUTATIONS = [
  [
    "the creation rule dropped",
    '{ type: "update" }, { type: "creation" } ]',
    '{ type: "update" } ]',
    "- rule: creation",
  ],
  [
    "the update rule dropped",
    '{ type: "update" }, { type: "creation" } ]',
    '{ type: "creation" } ]',
    "- rule: update",
  ],
  [
    "the bypass actor dropped",
    'bypass_actors: [ { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" } ],',
    "bypass_actors: [],",
    "- bypass: RepositoryRole 5 (always)",
  ],
  [
    "the bypass narrowed",
    'bypass_mode: "always" } ],',
    'bypass_mode: "pull_request" } ],',
    "- bypass: RepositoryRole 5 (always)",
  ],
  [
    "the tag pattern narrowed",
    'include: ["refs/tags/v*"]',
    'include: ["refs/tags/v1*"]',
    "- include: refs/tags/v*",
  ],
];

for (const [task, live, table] of [
  ["protect-main", liveMain, MAIN_MUTATIONS],
  ["protect-release-tags", liveTags, TAGS_MUTATIONS],
]) {
  for (const [label, old, replacement, expectedLine] of table) {
    test(`${task}: a payload weaker than the live ruleset (${label}) is refused unless allowed`, needsTools, () => {
      const mutate = [old, replacement];
      const refused = runStep(task, { apply: true, live: [live()], mutate });
      assert.notEqual(refused.status, 0, refused.output);
      assert.ok(refused.summary.includes("REFUSED"));
      assert.ok(refused.summary.includes(expectedLine), `the summary lacks '${expectedLine}'`);
      assert.deepEqual(refused.writes, []);

      const dry = runStep(task, { live: [live()], mutate });
      assert.equal(dry.status, 0, dry.output);
      assert.ok(dry.summary.includes("Apply would be REFUSED"));
      assert.deepEqual(dry.writes, []);

      const allowed = runStep(task, { apply: true, allowWeakening: true, live: [live()], mutate });
      assert.equal(allowed.status, 0, allowed.output);
      assert.ok(allowed.summary.includes("allow_weakening is ticked"));
      assert.equal(allowed.writes.length, 1);
      assert.ok(allowed.writes[0].startsWith("PUT "));
    });
  }
}

test("a payload that only strengthens the live ruleset needs no allowance", needsTools, () => {
  // Live has 0 approvals and no code-owner review; the payload (1, on) raises both. Nothing is weakened.
  const live = liveMain({ pullRequest: { required_approving_review_count: 0, require_code_owner_review: false } });
  const run = runStep("protect-main", { apply: true, live: [live] });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.writes, [`PUT repos/owner/repo/rulesets/${MAIN_ID}`]);
  assert.ok(run.summary.includes("param: pull_request.required_approving_review_count: live 0 -> payload 1"));
  assert.ok(run.summary.includes("param: pull_request.require_code_owner_review: live false -> payload true"));
  assert.ok(run.summary.includes(NOTHING_REMOVED));
});

test("a live ruleset stricter than the payload blocks apply", needsTools, () => {
  // Someone raised the live approvals to 2 by hand: the payload's 1 would lower it.
  const run = runStep("protect-main", { apply: true, live: [liveMain({ pullRequest: { required_approving_review_count: 2 } })] });
  assert.notEqual(run.status, 0);
  assert.ok(run.summary.includes("param: pull_request.required_approving_review_count: live 2, payload 1"));
  assert.deepEqual(run.writes, []);
});
