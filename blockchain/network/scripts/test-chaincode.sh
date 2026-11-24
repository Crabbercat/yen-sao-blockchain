#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_environment
"$SCRIPT_DIR/health-check.sh"

CHANNEL_ID="supplychannel"
CHAINCODE_NAME="yen-sao-contract"
ORDERER="orderer0.example.com:7050"
ORDERER_CA="/workspace/blockchain/organizations/crypto-config/ordererOrganizations/example.com/orderers/orderer0.example.com/tls/ca.crt"

HARVEST_MSP="/workspace/blockchain/organizations/ca-clients/harvest/OrgHarvest/users/harvest.operator/msp"
PROCESSING_MSP="/workspace/blockchain/organizations/ca-clients/processing/OrgProcessing/users/processing.operator/msp"
DISTRIBUTION_MSP="/workspace/blockchain/organizations/ca-clients/distribution/OrgDistribution/users/distributor.operator/msp"
HARVEST_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-harvest.example.com/peers/peer0.org-harvest.example.com/tls/ca.crt"
PROCESSING_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-processing.example.com/peers/peer0.org-processing.example.com/tls/ca.crt"
DISTRIBUTION_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-distribution.example.com/peers/peer0.org-distribution.example.com/tls/ca.crt"
PEER_HARVEST="peer0.org-harvest.example.com:7051"
PEER_PROCESSING="peer0.org-processing.example.com:8051"
PEER_DISTRIBUTION="peer0.org-distribution.example.com:9051"

encode_input() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

query() {
  local msp_id="$1"
  local msp_home="$2"
  local peer_address="$3"
  local peer_tls="$4"
  local function="$5"
  local argument="$6"
  local escaped_argument
  local payload
  escaped_argument="$(encode_input "$argument")"
  payload="$(printf '{"Args":["%s","%s"]}' "$function" "$escaped_argument")"
  fabric_peer_tool "$msp_id" "$msp_home" "$peer_address" "$peer_tls" \
    chaincode query -C "$CHANNEL_ID" -n "$CHAINCODE_NAME" -c "$payload"
}

invoke() {
  local msp_id="$1"
  local msp_home="$2"
  local peer_address="$3"
  local peer_tls="$4"
  local function="$5"
  local argument="$6"
  shift 6
  local escaped_argument
  local payload
  escaped_argument="$(encode_input "$argument")"
  payload="$(printf '{"Args":["%s","%s"]}' "$function" "$escaped_argument")"
  fabric_peer_tool "$msp_id" "$msp_home" "$peer_address" "$peer_tls" \
    chaincode invoke \
    -C "$CHANNEL_ID" \
    -n "$CHAINCODE_NAME" \
    -c "$payload" \
    -o "$ORDERER" \
    --tls \
    --cafile "$ORDERER_CA" \
    "$@" \
    --waitForEvent \
    --waitForEventTimeout 60s
}

require_output() {
  local output="$1"
  local pattern="$2"
  if [[ "$output" != *"$pattern"* ]]; then
    printf 'Expected output to contain %s.\nActual output:\n%s\n' "$pattern" "$output" >&2
    exit 1
  fi
}

public_trace="$(query OrgDistributionMSP "$DISTRIBUTION_MSP" "$PEER_DISTRIBUTION" "$DISTRIBUTION_TLS" GetPublicTrace 'YEN-2026-0001-A')"
require_output "$public_trace" '"status":"DISTRIBUTED"'
if [[ "$public_trace" == *"DEMO-CONTRACT-PRIVATE-01"* || "$public_trace" == *"Fictional private demo note"* ]]; then
  printf 'Private commercial data appeared in public trace output.\n' >&2
  exit 1
fi

private_terms="$(query OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" GetPrivateCommercialTerms 'YEN-2026-0001-A')"
require_output "$private_terms" 'DEMO-CONTRACT-PRIVATE-01'

lineage="$(query OrgHarvestMSP "$HARVEST_MSP" "$PEER_HARVEST" "$HARVEST_TLS" GetBatchLineage 'YEN-2026-0001-A')"
require_output "$lineage" 'YEN-2026-0001->YEN-2026-0001-A'

history="$(query OrgHarvestMSP "$HARVEST_MSP" "$PEER_HARVEST" "$HARVEST_TLS" GetBatchHistory 'YEN-2026-0001-A')"
require_output "$history" 'DerivedBatchCreated'
require_output "$history" 'BatchPackaged'

if output="$(query OrgDistributionMSP "$DISTRIBUTION_MSP" "$PEER_DISTRIBUTION" "$DISTRIBUTION_TLS" GetPrivateCommercialTerms 'YEN-2026-0001-A' 2>&1)"; then
  printf 'A non-member unexpectedly read private commercial data:\n%s\n' "$output" >&2
  exit 1
fi
require_output "$output" 'FORBIDDEN'

if output="$(invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" CreateHarvestBatch \
  '{"batchId":"YEN-2026-UNAUTHORIZED","eventId":"test-unauthorized-1","species":"Swiftlet","harvestLocation":"Fictional test location","harvestedAt":"2026-11-01T02:00:00.000Z","quantity":1,"unit":"kg"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS" 2>&1)"; then
  printf 'An unauthorized organization unexpectedly created a harvest batch:\n%s\n' "$output" >&2
  exit 1
fi
require_output "$output" 'FORBIDDEN'

if output="$(invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" CreateDerivedBatch \
  '{"batchId":"YEN-2026-0001-B","eventId":"test-overdraw-1","quantity":1,"unit":"kg","inputBatches":[{"batchId":"YEN-2026-0001","quantityUsed":6,"unit":"kg"}]}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS" 2>&1)"; then
  printf 'An overdrawn processing input unexpectedly succeeded:\n%s\n' "$output" >&2
  exit 1
fi
require_output "$output" 'INVALID_QUANTITY'

if output="$(invoke OrgDistributionMSP "$DISTRIBUTION_MSP" "$PEER_DISTRIBUTION" "$DISTRIBUTION_TLS" CreateHandover \
  '{"batchId":"YEN-2026-0001-A","recipientMsp":"OrgProcessingMSP","eventId":"test-invalid-transition-1"}' \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS" \
  --peerAddresses "$PEER_DISTRIBUTION" --tlsRootCertFiles "$DISTRIBUTION_TLS" 2>&1)"; then
  printf 'An invalid post-distribution handover unexpectedly succeeded:\n%s\n' "$output" >&2
  exit 1
fi
require_output "$output" 'INVALID_STATE'

if output="$(invoke OrgHarvestMSP "$HARVEST_MSP" "$PEER_HARVEST" "$HARVEST_TLS" CreateHarvestBatch \
  '{"batchId":"YEN-2026-UNDERENDORSED","eventId":"test-endorsement-1","species":"Swiftlet","harvestLocation":"Fictional test location","harvestedAt":"2026-11-01T02:00:00.000Z","quantity":1,"unit":"kg"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" 2>&1)"; then
  printf 'The peer accepted a single-endorser proposal; verifying commit validation on all peers.\n'
elif [[ "$output" != *"ENDORSEMENT_POLICY_FAILURE"* && "$output" != *"endorsement"* ]]; then
  printf 'The under-endorsed transaction failed for an unexpected reason:\n%s\n' "$output" >&2
  exit 1
fi
if output="$(query OrgHarvestMSP "$HARVEST_MSP" "$PEER_HARVEST" "$HARVEST_TLS" GetBatch 'YEN-2026-UNDERENDORSED' 2>&1)"; then
  printf 'A transaction with only one endorser unexpectedly changed ledger state:\n%s\n' "$output" >&2
  exit 1
fi
require_output "$output" 'NOT_FOUND'

printf 'Real-network chaincode tests passed: lifecycle, authorization, quantity, lineage, PDC privacy and endorsement.\n'
