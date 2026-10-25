# Publishing the appliance image to Docker Hub (owner runbook)

`publish-images.yml` builds `infrastructure/docker/Dockerfile.appliance` on every `v*` tag, scans it (Trivy, HIGH/CRITICAL,
fixed only) and pushes `docker.io/hybridcloudworks/img-mo-appliance-app` with provenance and SBOM, then prints the
immutable digest in the run summary. Deployments (`infrastructure/terraform/appliance-azure`, `image_ref`) reference that
digest, never a tag, and Terraform now enforces that: `image_ref` has no default and must end in `@sha256:` followed by 64 hexadecimal characters. Moved from GHCR on 2026-10-10 so both repositories publish to the one registry the website's lab host
already pulls from (`REFACTOR_APP.md` section 7, optional item).

Login is the **Docker OIDC connection**: `docker/login-action` v4.5.0 and later, with no password, registry `docker.io` and
`DOCKERHUB_OIDC_CONNECTIONID` set, asks GitHub for an ID token with Docker's audience, exchanges it at
`identity.docker.com` for a short-lived Docker access token (900 seconds here) and logs in with it. No `DOCKERHUB_TOKEN`,
no `DOCKERHUB_USERNAME`, nothing stored in the repository. Until the two repository variables below exist the job is
skipped, not failed.

## Owner steps (once)

1. In Docker Home, under the `hybridcloudworks` organization, create an OIDC connection for this repository that trusts
   `saulpatinojr/HCW-MigrateOrchestrator_App` on tag refs (`refs/tags/v*`) and workflow `publish-images.yml`, and copy
   its connection ID (a UUID). [VERIFY the exact page: Docker Home, organization settings, OIDC connections.]
2. Set the repository variables. PowerShell, with the connection ID on the clipboard:

   ```powershell
   gh variable set DOCKERHUB_CONNECTION --repo saulpatinojr/HCW-MigrateOrchestrator_App --body (Get-Clipboard); gh variable set DOCKERHUB_ENABLED --repo saulpatinojr/HCW-MigrateOrchestrator_App --body true
   ```

   Success: `gh variable list --repo saulpatinojr/HCW-MigrateOrchestrator_App` prints both names.
3. Run the workflow for the current tag from the Actions tab (`publish-images`, **Run workflow**), or push the next `v*` tag.
   Success: the run summary ends with one line of the form `docker.io/hybridcloudworks/img-mo-appliance-app@sha256:…`,
   and `docker pull` of that reference succeeds anonymously.

## Failure modes

- `DOCKERHUB_ENABLED is true, but the repository variable DOCKERHUB_CONNECTION is not an OIDC connection ID`: the first
  step guards this; set the variable to the UUID from step 1.
- `400 access_denied` from the token exchange: the connection's rule does not match this repository, ref or workflow.
  Compare the connection's rule with the run's `repository`, `ref` and `workflow` claims; Docker reports only the
  refusal, not the failing condition.
- A Trivy finding before the push: nothing is published. Rebuild on an updated base image or wait for the fix; never
  skip the scan.

## Rollback

Revert the workflow to the GHCR variant from git history; images already pushed to either registry stay where they are.
