# Publishing the npm packages (owner runbook)

> **Optional since 2026-10-11.** Every `v*` tag's GitHub Release carries the two package tarballs
> (`release-cli.yml`, job `packages`; [`README.md`](README.md)), and the downstream edition `HCW-MigrateOrchestrator_AddOn` pins them by URL with
> an integrity hash and adopts new releases through its `core-update` workflow. Publishing to npm makes the packages
> available to third parties; it is not on the path between a release and the website.

`publish-npm.yml` publishes `@hybridcloudworks/migration-core` and `@hybridcloudworks/migration-ui` on every `v*` tag (never from a manual run: Run workflow on `main` is a dry run that stops after the clean-consumer gate; see [`README.md`](README.md)) using
**npm trusted publishing** (OIDC from GitHub Actions, provenance attached, no token stored anywhere). The registry needs a
one-time bootstrap that only the package owner can do. Until it is done the workflow is skipped (not failed) because it is
gated on the repository variable `NPM_TRUSTED_PUBLISHING`.

Both names were unpublished on 2026-10-04 (`HTTP 404` from the registry). Ownership of the `@hybridcloudworks` scope was not
verifiable anonymously; step 1 settles it.

## 1. Own the scope

Sign in at https://www.npmjs.com and create the organization `hybridcloudworks` (free plan is enough for public packages). If the
name is taken by someone else, pick another scope and change `CORE_NAME`/`UI_NAME` in `scripts/assemble-packages.mjs`, the
references in `_Addon`, and this document.

## 2. First publish from a trusted machine

Trusted publishing can only be configured on a package that already exists, so the first version is published by a person,
with a short-lived login session, never with a stored token:

```bash
git clone https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App.git && cd HCW-MigrateOrchestrator_App
git checkout v0.2.1
npm ci && npm run build && npm run packages:verify
npm login
cd dist-packages/migration-core && npm publish --access public && cd ../migration-ui && npm publish --access public
npm logout
```

PowerShell: same commands; use `;` between them.

## 3. Configure the trusted publisher on both packages

On npmjs.com → package → Settings → Trusted Publisher → GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `saulpatinojr` |
| Repository | `HCW-MigrateOrchestrator_App` |
| Workflow filename | `publish-npm.yml` |
| Environment | leave empty |

Then, in the same settings, require two-factor authentication or trusted publishing for new versions (disallow tokens).

## 4. Arm the workflow

In GitHub → repository Settings → Secrets and variables → Actions → Variables: add `NPM_TRUSTED_PUBLISHING` = `ready`.
From the next `v*` tag the workflow first checks that the tag, the package version and `main` agree and that the npm that ships with Node 26 is at least 11.5.1 (it never installs `npm@latest`), builds at the package version, runs the clean-consumer gate, and publishes exactly those packages with
provenance. Verify at https://www.npmjs.com/package/@hybridcloudworks/migration-core (the Provenance panel must show this
repository and workflow).

## 5. Switch the downstream consumers to the registry

- `_Addon`: replace the two `file:` links in `package.json` with the exact version (`"@hybridcloudworks/migration-core": "0.2.1"`),
  remove the sibling checkout steps from `.github/workflows`, and delete `scripts/bootstrap-app.sh`. Dependabot (`npm`
  ecosystem, already enabled) then proposes every later bump; `core-update.yml` can be retired.
- Website: `npm install --save-exact @hybridcloudworks/migration-ui@0.2.1 --workspace=frontend` and add
  `@source "../node_modules/@hybridcloudworks/migration-ui/dist";` to the Tailwind entry (see the integration guide in `_Addon`).

Never publish from a developer machine after step 2; never create or store an npm automation token.
