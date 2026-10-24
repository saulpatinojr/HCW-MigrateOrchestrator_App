# AGENTS.md — guidance for coding agents (Copilot coding agent, Codex, Claude)

This is `saulpatinojr/HCW-MigrateOrchestrator_App`: the upstream product — engine, rules, CLI, UI components and the Azure
appliance (ADR-0028). It publishes `@hybridcloudworks/migration-core` and `@hybridcloudworks/migration-ui`; the slim web-front
edition `saulpatinojr/HCW-AzMigrateOrchestrator_Addon` consumes them.

Build/test: `npm ci && npm test` (TypeScript project references, Node 26 test runner; the build also assembles `dist-packages/`).
Rules: `npm run rules:validate`. Packages: `npm run packages:verify`. Web UI: `npm run web:build`.
Conventions and invariants: `CLAUDE.md`. Review expectations: `.github/copilot-instructions.md` and
`.github/skills/code-review/references/azure-migration-orchestrator-profile.md`.

Product agents (the 19 migration agents) are documented in `docs/agents/README.md` and defined in
`packages/agents/src/definitions.ts`; do not confuse them with coding agents. AI-created changes go through the
review → fix → current-head verification cycle described in `.github/setup/HANDSHAKE.md`.
