#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

"$SCRIPT_DIR/check-prerequisites.sh"
"$SCRIPT_DIR/create-identities.sh"

compose up -d --wait --wait-timeout 180 ca-harvest ca-processing ca-distribution
"$SCRIPT_DIR/enroll-ca-identities.sh"
compose up -d --wait --wait-timeout 180 \
  orderer0 orderer1 orderer2 \
  peer-harvest peer-processing peer-distribution

printf 'Fabric CAs, peers and Raft orderers are healthy.\n'
