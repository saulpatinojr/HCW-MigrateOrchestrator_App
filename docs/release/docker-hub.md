# Publishing the appliance image to Docker Hub (owner runbook)

`publish-images.yml` builds `infrastructure/docker/Dockerfile.appliance` once on every `v*` tag, pushes that build to
`docker.io/hybridcloudworks/img-mo-appliance-app` by digest (no tag) with provenance and SBOM, scans that digest (Trivy,
HIGH/CRITICAL, fixed only), and only then tags it, so the scanned, tagged and attested image is one digest. It then prints the
immutable digest in the run summary. Deployments (`infrastructure/terraform/appliance-azure`, `image_ref`) reference that
digest, never a tag, and Terraform now enforces that: `image_ref` has no default and must end in `@sha256:` followed by 64 hexadecimal characters. Moved from GHCR on 2026-10-10 so both repositories publish to the one registry the website's lab host
already pulls from (`REFACTOR_APP.md` section 7, optional item).

Login is the **Docker OIDC connection**: `docker/login-action` v4.5.0 and later, with no password, registry `docker.io` and
`DOCKERHUB_OIDC_CONNECTIONID` set, asks GitHub for an ID token with Docker's audience, exchanges it at
`identity.docker.com` for a short-lived Docker access token (900 seconds here) and logs in with it. No `DOCKERHUB_TOKEN`,
no `DOCKERHUB_USERNAME`, nothing stored in the repository. Until the two repository variables below exist the job is
skipped, not failed.

Only a `v*` tag push can reach Docker Hub. The workflow has two paths, in two jobs:

| Started by | Job | Docker Hub login | Push, tag, attest | `id-token` / `attestations` |
|---|---|---|---|---|
| Pushing a `v*` tag | `build-scan-publish` (gated: `DOCKERHUB_ENABLED` is `true` and the ref is `refs/tags/v*`) | Yes, twice | Yes | Granted to this job only |
| Run workflow, on `main` | `rehearse` | No | No: the image is built into the runner's local Docker and scanned | Not granted |

The Docker Home rule for the connection trusts tag refs only, so a login from `main` is refused (`400 access_denied`, run
[40254017571](https://github.com/saulpatinojr/HCW-MigrateOrchestrator_App/actions/runs/40254017571)). Before the change that
introduced `rehearse`, the manual run reached the login step and failed there; now it never asks.

## Owner steps (once)

1. In Docker Home, under the `hybridcloudworks` organization, create an OIDC connection for this repository that trusts
   `saulpatinojr/HCW-MigrateOrchestrator_App` on tag refs (`refs/tags/v*`) and workflow `publish-images.yml`, and copy
   its connection ID (a UUID). [VERIFY the exact page: Docker Home, organization settings, OIDC connections.]
2. Set the repository variables. PowerShell, with the connection ID on the clipboard:

   ```powershell
   gh variable set DOCKERHUB_CONNECTION --repo saulpatinojr/HCW-MigrateOrchestrator_App --body (Get-Clipboard); gh variable set DOCKERHUB_ENABLED --repo saulpatinojr/HCW-MigrateOrchestrator_App --body true
   ```

   Success: `gh variable list --repo saulpatinojr/HCW-MigrateOrchestrator_App` prints both names.
3. Push the next `v*` tag (section 3 of `docs/release/README.md`). A manual **Run workflow** on `main` is only a rehearsal
   (build and scan, nothing pushed) and never produces an image; run it first if you want to see the build and the scan pass
   (`gh workflow run publish-images.yml --repo saulpatinojr/HCW-MigrateOrchestrator_App --ref main`, bash or PowerShell).
   Success of the tag run: the run summary ends with one line of the form `docker.io/hybridcloudworks/img-mo-appliance-app@sha256:…`,
   and `docker pull` of that reference succeeds anonymously. Then check the attestation of that exact digest, bash or PowerShell:

   ```bash
   gh attestation verify oci://docker.io/hybridcloudworks/img-mo-appliance-app@sha256:<digest-from-the-run-summary> --repo saulpatinojr/HCW-MigrateOrchestrator_App
   ```

   Which tags have an image, and how to tell a skipped run from a published one: the README section "Which tags have an
   appliance image".

## Failure modes

- `DOCKERHUB_ENABLED is true, but the repository variable DOCKERHUB_CONNECTION is not an OIDC connection ID`: the first
  step guards this; set the variable to the UUID from step 1.
- `400 access_denied` from the token exchange: the connection's rule does not match this repository, ref or workflow.
  Compare the connection's rule with the run's `repository`, `ref` and `workflow` claims; Docker reports only the
  refusal, not the failing condition. A manual run on `main` no longer produces this error, because it does not log in; if
  a manual run ever shows a login step again, the push gate has been weakened (`tests/release/release-workflows.test.mjs`
  should have failed).
- A Trivy finding: the image gets no tag and no attestation. The build is pushed by digest first and that exact digest is
  scanned (so the scanned bytes are the published bytes), which means a failed scan leaves an **untagged** image in the
  repository. Delete it on Docker Hub (the repository's Tags page, the untagged image) so nobody can pull it by digest.
  Rebuild on an updated base image or wait for the fix; never skip the scan.

## Rollback

Revert the workflow to the GHCR variant from git history; images already pushed to either registry stay where they are.
