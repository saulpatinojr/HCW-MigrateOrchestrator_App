#!/usr/bin/env bash
# Run the Terraform checks locally, with the same tools CI uses and nothing installed on your machine (ticket #53).
#
# What it needs: Docker and bash. On Windows that is Docker Desktop (Linux containers, context `desktop-linux`) and Git Bash;
# start it from PowerShell with `bash scripts/ci/local-iac-checks.sh all`.
#
# Usage:   bash scripts/ci/local-iac-checks.sh <check>...
#   terraform     fmt -check, init -backend=false, validate and `terraform test` (mock providers, plan only) in
#                 infrastructure/terraform/appliance-azure, with Terraform 1.9.8, the version `iac-validate` uses
#   trivy-config  Trivy configuration scan of infrastructure/terraform at HIGH,CRITICAL, the same gate as `iac-validate`
#   all           terraform and trivy-config
#
# Settings (environment variables):
#   TRIVY_SEVERITY   severities Trivy reports (default HIGH,CRITICAL, the CI gate; lower it only to look, never to pass)
#   TRIVY_EXIT_CODE  exit code Trivy returns when it finds something (default 1)
#   AMO_CHECKS_ANY_CONTEXT=1   allow a Docker context other than desktop-linux or default (see below)
#
# What it never does: no `terraform apply`, no remote backend, no Azure or Entra credentials. Every run is
# `init -backend=false`, `validate` and `test` against mocked providers. The only network use is downloading the
# providers from the Terraform registry (terraform) and the Trivy checks bundle (trivy-config).
#
# How it stays safe: each tool runs in a disposable container (--rm) with all capabilities dropped, no privilege
# escalation, a read-only root file system and no Docker socket. The repository is mounted read-only and copied into a
# scratch directory, so nothing is written into your working tree. The named volumes `amo-iac-terraform-plugins` and
# `amo-iac-trivy-cache` hold downloaded providers and the Trivy database; remove them with `docker volume rm`.
#
# The script stops when `docker context show` names an engine other than your own machine (desktop-linux, or default on
# Linux), or when DOCKER_HOST is set, because running against a shared or remote engine is a different decision.
#
# Where the versions come from: Terraform 1.9.8 is the version in .github/workflows/iac-validate.yml. Trivy 0.76.1
# (released 2026-10-21, https://github.com/aquasecurity/trivy/releases) is pulled by the digest below; never use a tag
# alone and never `latest`: on 2026-03-19 and 2026-03-22 malicious Trivy images were published under moving tags
# (GHSA-69fq-xp46-6x23), and a digest cannot be moved. The Terraform image digest was read from Docker Hub on 2026-10-25.
# To move a pin: pull the new tag, copy the digest Docker prints, and change it here.

set -euo pipefail

TERRAFORM_IMAGE="hashicorp/terraform:1.9.8@sha256:18f9986038bbaf02cf49db9c09261c778161c51dcc7fb7e355ae8938459428cd"
TRIVY_IMAGE="ghcr.io/aquasecurity/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c"
TF_DIR="infrastructure/terraform/appliance-azure"
TF_PLUGIN_VOLUME="amo-iac-terraform-plugins"
TRIVY_CACHE_VOLUME="amo-iac-trivy-cache"

TRIVY_SEVERITY="${TRIVY_SEVERITY:-HIGH,CRITICAL}"
TRIVY_EXIT_CODE="${TRIVY_EXIT_CODE:-1}"

# Git Bash rewrites paths that look like Unix paths before handing them to docker.exe; switch that off, and use the
# Windows form of the repository path (pwd -W exists only in Git Bash) so Docker Desktop can mount it.
export MSYS_NO_PATHCONV=1
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
if REPO="$(pwd -W 2>/dev/null)"; then :; else REPO="$(pwd)"; fi

say() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 2; }

command -v docker >/dev/null 2>&1 || fail "docker was not found on PATH. Start Docker Desktop and try again."
context="$(docker context show 2>/dev/null || true)"
say "Docker context: ${context:-unknown}"
if [ "${AMO_CHECKS_ANY_CONTEXT:-0}" != "1" ]; then
  case "$context" in
    desktop-linux | default) ;;
    *) fail "Docker context '$context' is not desktop-linux or default. Switch with 'docker context use desktop-linux', or set AMO_CHECKS_ANY_CONTEXT=1 if you really mean this engine." ;;
  esac
  [ -z "${DOCKER_HOST:-}" ] || fail "DOCKER_HOST is set ($DOCKER_HOST); unset it, or set AMO_CHECKS_ANY_CONTEXT=1 if you really mean that engine."
fi
docker info >/dev/null 2>&1 || fail "the Docker engine does not answer. Start Docker Desktop and try again."

# Flags every tool container gets.
HARDEN=(--rm --read-only --cap-drop ALL --security-opt no-new-privileges)

results=()
overall=0
record() { # name exit-code
  if [ "$2" -eq 0 ]; then results+=("PASS  $1"); else results+=("FAIL  $1 (exit $2)"); overall=1; fi
}

run_terraform() {
  say "== terraform fmt, init -backend=false, validate, test in $TF_DIR (Terraform 1.9.8, mock providers, no credentials)"
  local code=0
  docker run "${HARDEN[@]}" --tmpfs /scratch --tmpfs /tmp -e HOME=/scratch -e TF_IN_AUTOMATION=1 \
    -e TF_PLUGIN_CACHE_DIR=/plugins -v "$TF_PLUGIN_VOLUME:/plugins" -v "$REPO:/work:ro" \
    --entrypoint sh "$TERRAFORM_IMAGE" -c "
      set -e
      # Copy everything except a .terraform directory (a local init can leave hundreds of megabytes of providers there; they
      # would fill the tmpfs and are not wanted). The lock file is copied on purpose: init runs with -lockfile=readonly.
      mkdir -p /scratch/tf && cd /work/$TF_DIR
      for f in * .[!.]*; do
        [ -e \"\$f\" ] || continue
        [ \"\$f\" = .terraform ] && continue
        cp -R \"\$f\" /scratch/tf/
      done
      cd /scratch/tf
      terraform fmt -check -recursive -diff
      terraform init -backend=false -input=false -lockfile=readonly
      terraform validate -no-color
      terraform test -no-color
    " || code=$?
  record "terraform fmt, init -backend=false, validate, test" "$code"
}

run_trivy_config() {
  say "== trivy config (severity $TRIVY_SEVERITY)"
  local code=0
  docker run "${HARDEN[@]}" --tmpfs /tmp -v "$TRIVY_CACHE_VOLUME:/root/.cache" -v "$REPO:/work:ro" -w /work "$TRIVY_IMAGE" \
    config --severity "$TRIVY_SEVERITY" --exit-code "$TRIVY_EXIT_CODE" --skip-dirs .git,node_modules,.terraform infrastructure/terraform || code=$?
  record "trivy config ($TRIVY_SEVERITY)" "$code"
}

[ "$#" -gt 0 ] || fail "name a check: terraform, trivy-config, or all"
while [ "$#" -gt 0 ]; do
  case "$1" in
    terraform) run_terraform ;;
    trivy-config) run_trivy_config ;;
    all) run_terraform; run_trivy_config ;;
    *) fail "unknown check '$1'" ;;
  esac
  shift
done

say ""
say "Summary"
printf '  %s\n' "${results[@]}"
exit "$overall"
