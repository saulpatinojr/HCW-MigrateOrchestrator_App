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
| Environment | `npm-publish` (the GitHub Environment created in step 4) |

Then, in the same settings, require two-factor authentication or trusted publishing for new versions (disallow tokens).

## 4. Create the GitHub Environment `npm-publish` with required reviewers (a person approves every publish)

The publish job runs in a GitHub Environment named `npm-publish`. An environment with **required reviewers** stops the job
until a named person approves it on the run page, so a tag alone can never put a package on npm. If you skip this step GitHub
creates the environment empty the first time the job runs and the job then does **not** wait for anyone, so do it before step 5.

1. Open [Settings, Environments](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/settings/environments) and choose **New environment**.
2. Name: `npm-publish`. Choose **Configure environment**.
3. Tick **Required reviewers** and add yourself (and one other person if there is one). Leave **Prevent self-review** unticked if you are the only maintainer, or the job could never be approved.
4. Under **Deployment branches and tags** choose **Selected branches and tags**, then add a **tag** rule `v*`. Save protection rules.
5. Do not add any secret to this environment: publishing needs none.

Docs: [Managing environments for deployment](https://docs.github.com/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment).

## 5. Arm the workflow

In GitHub → repository Settings → Secrets and variables → Actions → Variables: add `NPM_TRUSTED_PUBLISHING` = `ready`.
From the next `v*` tag the workflow first checks that the tag, the package version and `main` agree and that the npm that ships with Node 26 is at least 11.5.1 (it never installs `npm@latest`), rehearses the build and the clean-consumer gate, then **waits for the GitHub Release of that tag to be public**, downloads it and verifies every file's digest and signed attestation (the same strict check as `post-release`). Only then does the `publish` job wait for your approval (step 4) and publish **the released tarballs themselves** with
provenance, after comparing their sha256 once more: what reaches npm is byte for byte what the release carries and what was attested. If the release run fails, nothing is published to npm. Verify at https://www.npmjs.com/package/@hybridcloudworks/migration-core (the Provenance panel must show this
repository and workflow).

## 6. Switch the downstream consumers to the registry

- `_Addon`: replace the two `file:` links in `package.json` with the exact version (`"@hybridcloudworks/migration-core": "0.2.1"`),
  remove the sibling checkout steps from `.github/workflows`, and delete `scripts/bootstrap-app.sh`. Dependabot (`npm`
  ecosystem, already enabled) then proposes every later bump; `core-update.yml` can be retired.
- Website: `npm install --save-exact @hybridcloudworks/migration-ui@0.2.1 --workspace=frontend` and add
  `@source "../node_modules/@hybridcloudworks/migration-ui/dist";` to the Tailwind entry (see the integration guide in `_Addon`).

Never publish from a developer machine after step 2; never create or store an npm automation token.

A version that was published in error cannot be published again. Mark it with `npm deprecate` and ship the next version (commands:
[`README.md`](README.md) section 5). `publish-npm.yml` starts from the same tag as the release run and waits (up to 45 minutes) for that release to be public and verified before it asks for your approval; if the release run fails, it publishes nothing.
