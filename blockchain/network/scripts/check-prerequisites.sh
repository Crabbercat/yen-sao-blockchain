#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_environment
command -v docker >/dev/null || {
  printf 'Docker CLI is required; install Docker Desktop with WSL2 integration.\n' >&2
  exit 1
}
docker compose version >/dev/null
docker info >/dev/null

for name in \
  CA_HARVEST_BOOTSTRAP_PASSWORD \
  CA_PROCESSING_BOOTSTRAP_PASSWORD \
  CA_DISTRIBUTION_BOOTSTRAP_PASSWORD \
  HARVEST_OPERATOR_ENROLLMENT_SECRET \
  PROCESSING_OPERATOR_ENROLLMENT_SECRET \
  QUALITY_INSPECTOR_ENROLLMENT_SECRET \
  DISTRIBUTOR_ENROLLMENT_SECRET; do
  env_value "$name" >/dev/null
done

printf 'Docker, Compose and local Fabric secret settings are available.\n'
