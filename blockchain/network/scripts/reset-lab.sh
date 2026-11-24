#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

if [[ "${1:-}" != "--confirm-delete-lab-state" ]]; then
  printf 'This deletes Fabric ledgers, CA databases, MSP identities and channel artifacts.\n' >&2
  printf 'Run reset-lab.sh --confirm-delete-lab-state only for a disposable lab.\n' >&2
  exit 2
fi

require_environment
printf 'Deleting disposable Fabric state and generated identities as explicitly requested.\n'
compose down --volumes --remove-orphans
rm -rf \
  "$PROJECT_ROOT/blockchain/organizations/crypto-config" \
  "$PROJECT_ROOT/blockchain/organizations/ca-clients"
find "$PROJECT_ROOT/blockchain/network/channel-artifacts" -maxdepth 1 -type f \
  \( -name '*.block' -o -name '*.tx' -o -name '*.json' \) -delete
