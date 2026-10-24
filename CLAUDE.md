# CLAUDE.md — working agreement for Claude Code in this repository

This is `saulpatinojr/HCW-MigrateOrchestrator_App`, the **upstream product** (ADR-0028): the migration intelligence core
(`packages/*`), the rule corpus (`rules/`), the `amo` CLI, the explorer UI components and the Azure appliance. It publishes
`@hybridcloudworks/migration-core` and `@hybridcloudworks/migration-ui` (assembled by `scripts/assemble-packages.mjs` into
`dist-packages/`). The slim web-front edition `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` consumes those packages as the tarballs attached to each `v*` GitHub Release (pinned by URL and integrity hash) at exact
versions and must stay technically unable to reach Azure: `azure-auth`, `azure-arm` and `azure-execution` are never published
(`tests/security/appliance-boundary.test.mjs`, `tests/packaging/`).

- Read `docs/requirements-ledger.md`, `WORKING-PLAN.md` and `VALIDATION.md` before changing behaviour; keep them current.
- Run `npm test` and `npm run rules:validate` before claiming anything works; run `npm run packages:verify` when a package's
  public surface, exports or the rules location change. Never claim a check passed that you did not run.
- A change to any `packages/*` public surface is a change to the published packages and to the downstream edition: say so in
  the PR; releases are semver tags (`v*`), and the addon's `core-update` workflow tests each release before adopting it.
- **Keep the AddOn informed.** When a change reaches `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` (a `packages/*` public
  surface, the rule corpus, a release or its assets, the shared tests), add an entry to the AddOn's
  `docs/whats-new-upstream.md` in the same change set, or say in the PR why none is needed.
- Rules are data: change `scripts/author-rules.mjs` → `node scripts/author-rules.mjs` → build → `amo rules report` → `amo rules snapshot`. Cite Microsoft Learn with a retrieval date.
- Golden files (`samples/expected-reports`) change only deliberately via `npm run goldens:update`; explain the diff in the PR.
- Never weaken: the unauthenticated confidence cap, the web-front edition's inability to construct an Azure provider, the Safety
  Agent checks, the authorization gate and execution levels, Entra token validation on every appliance route, the refusal of
  client secrets, the "not production" labels.
- No secrets, tokens, customer inventories or real tenant/subscription IDs anywhere, including fixtures and tests. npm
  publishing is trusted publishing only (`docs/release/npm-publishing.md`); never add a registry token.
- Owner-pasteable commands: no placeholders; bash and PowerShell both acceptable.
- This repository holds the canonical ADR log for both repositories. Record material design choices as ADRs in `docs/adr/`
  (next number: 0031). Record limitations in `VALIDATION.md`.
- Docs for agents are generated: edit `packages/agents/src/definitions.ts`, then `node scripts/generate-agent-docs.mjs`.

## How to communicate with the owner

The owner is not a specialist in every tool used here. Write for a junior administrator with limited experience and no
memory of earlier sessions.

- **Be conversational and human.** Plain, friendly sentences. Say what happened and why it matters before the detail.
- **Assume little context.** Do not rely on repository history, ticket numbers or earlier chat. Restate what a thing is
  the first time it appears.
- **Avoid jargon.** When a technical term is unavoidable, explain it in a few words the first time, for example
  "a lockfile (the file that records the exact versions installed)".
- **When the owner must act, give numbered steps.** One action per step, short, saying where to click or what to run and
  which shell (bash or PowerShell). Say what they should see when it worked.
- **When you ask the owner a question, make it answerable.** Say what is being decided and why it matters, list the
  options in plain words with what each one means, give a recommendation, and say exactly how to answer (a word to reply
  with, or the steps and the link for where to click). Never ask a bare "A, B or C?" or "OK to proceed?".
- **When the owner has to fill in a form or a setting, give every non-secret value.** For each field, say the exact text
  to type or paste (name, description, URL), which boxes to tick or leave empty, and where to find it. Always supply a
  description wherever a form has a description field. Never put a password, token, client secret, certificate or private
  key in chat, pull requests, issues or documentation; tell the owner to enter each secret only in the approved secure
  settings field, or through a script that reads it from a file.
- **Include links.** Point to the exact settings page, the issue or pull request, and the official documentation
  (Microsoft Learn, GitHub Docs and similar) whenever one exists.
- **Be honest about status.** Separate what was checked, what is assumed, and what is blocked. Never present a guess as a result.

This applies to chat replies, pull request and issue text, and documentation. It does not apply to code comments or
machine-readable files, which keep following the surrounding style.
