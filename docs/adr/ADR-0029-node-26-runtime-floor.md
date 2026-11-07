# ADR-0029: Node 26 is the runtime floor for both repositories

**Status:** Accepted · **Date:** 2026-10-04 · **Amends ADR-0002 (runtime version only)**

## Context

ADR-0002 chose TypeScript on Node 22 with zero runtime dependencies. Dependabot proposed `node:26-bookworm-slim` for both
container images; merging only the image bump would have left the runtime split across the image (26), the CI runners (22),
`engines` (>=22), the devcontainer (22), the type definitions (@types/node 22) and the single-executable bundle target
(node22). The working plan's version-floor item asks for one deliberate decision instead of silent drift, and the owner
chose to move to Node 26.

## Decision

Node 26 is the single runtime floor in `saulpatinojr/HCW-AzMigrateOrchestrator_App` and `saulpatinojr/HCW-AzMigrateOrchestrator_Addon`:

| Surface | Value |
|---|---|
| `package.json` `engines.node` (both repos, and the published `@hybridcloudworks/migration-core` / `migration-ui`) | `>=26` |
| `@types/node` | `^26.6.4` |
| GitHub Actions `setup-node` in every workflow (ci, copilot-setup-steps, release-cli, rules-refresh, publish-npm, core-update) | `26` |
| Container base image, build and runtime stages (`Dockerfile.appliance`, `Dockerfile.lab`) | `node:26-bookworm-slim` |
| Devcontainer | `mcr.microsoft.com/devcontainers/typescript-node:26-bookworm` |
| CLI single-executable bundle (`scripts/build-sea.sh`) | `--target=node26`; the release binaries embed the Node 26 runtime |

The TypeScript `target`/`module` settings (ES2022 / Node16 resolution) are unchanged; ESM-only output stands. The zero
runtime dependency rule of ADR-0002 stands. The Coder workspace image is unaffected (it does not run the engine).

## Consequences

- Consumers of the npm packages must run Node 26 or newer; `engines` makes npm warn on older runtimes.
- Local development on Node 22 is no longer a supported configuration; `nvm use 26` or the devcontainer.
- Future runtime bumps follow the same rule: one coordinated change across the surfaces in the table, verified by `npm test`,
  the clean-consumer gate, local image builds with a vulnerability scan, and a release tag that exercises the publish
  workflows — never a lone Dockerfile bump.

## Note (2026-11-07): the Debian release under Node 26 moves to 13 "trixie"

The Node floor is unchanged (26); only the Debian release the images and the devcontainer sit on moves. `Dockerfile.lab`
(downstream, AddOn 0.3.3, 2026-11-05) and `Dockerfile.appliance` (here, 2026-11-07) now build on `node:26-trixie-slim`,
pinned by digest, and the devcontainer uses `mcr.microsoft.com/devcontainers/typescript-node:26-trixie`. Reason: Debian 12's
apt 2.6.1 carries CVE-2026-109518, which the website's Docker Scout check refused on the lab image; Debian 13 is the current
stable release. The table above records the decision as it was taken on 2026-10-04.
