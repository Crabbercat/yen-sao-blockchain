#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_environment
mkdir -p \
  "$PROJECT_ROOT/blockchain/network/channel-artifacts" \
  "$PROJECT_ROOT/blockchain/organizations/ca-clients/harvest" \
  "$PROJECT_ROOT/blockchain/organizations/ca-clients/processing" \
  "$PROJECT_ROOT/blockchain/organizations/ca-clients/distribution"

CRYPTO_DIR="$PROJECT_ROOT/blockchain/organizations/crypto-config"
if [[ -d "$CRYPTO_DIR" ]]; then
  for required in \
    ordererOrganizations/example.com/orderers/orderer0.example.com/msp \
    ordererOrganizations/example.com/orderers/orderer1.example.com/tls \
    ordererOrganizations/example.com/orderers/orderer2.example.com/tls \
    peerOrganizations/org-harvest.example.com/peers/peer0.org-harvest.example.com/msp \
    peerOrganizations/org-processing.example.com/peers/peer0.org-processing.example.com/msp \
    peerOrganizations/org-distribution.example.com/peers/peer0.org-distribution.example.com/msp; do
    if [[ ! -d "$CRYPTO_DIR/$required" ]]; then
      printf 'Incomplete crypto material at %s; use reset-lab.sh only if this disposable lab may be erased.\n' "$CRYPTO_DIR" >&2
      exit 1
    fi
  done
  printf 'Reusing existing Fabric node identities.\n'
else
  fabric_tool cryptogen generate \
    --config=/workspace/blockchain/network/config/crypto-config.yaml \
    --output=/workspace/blockchain/organizations/crypto-config
fi
