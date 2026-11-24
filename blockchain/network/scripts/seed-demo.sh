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
QUALITY_MSP="/workspace/blockchain/organizations/ca-clients/processing/OrgProcessing/users/quality.inspector/msp"
DISTRIBUTION_MSP="/workspace/blockchain/organizations/ca-clients/distribution/OrgDistribution/users/distributor.operator/msp"
HARVEST_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-harvest.example.com/peers/peer0.org-harvest.example.com/tls/ca.crt"
PROCESSING_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-processing.example.com/peers/peer0.org-processing.example.com/tls/ca.crt"
DISTRIBUTION_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-distribution.example.com/peers/peer0.org-distribution.example.com/tls/ca.crt"

invoke() {
  local msp_id="$1"
  local msp_home="$2"
  local peer_address="$3"
  local peer_tls="$4"
  local function="$5"
  local json_input="$6"
  shift 6
  local escaped_input
  local payload
  escaped_input="$(printf '%s' "$json_input" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  payload="$(printf '{"Args":["%s","%s"]}' "$function" "$escaped_input")"
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

PEER_HARVEST="peer0.org-harvest.example.com:7051"
PEER_PROCESSING="peer0.org-processing.example.com:8051"
PEER_DISTRIBUTION="peer0.org-distribution.example.com:9051"

invoke OrgHarvestMSP "$HARVEST_MSP" "$PEER_HARVEST" "$HARVEST_TLS" CreateHarvestBatch \
  '{"batchId":"YEN-2026-0001","eventId":"demo-harvest-1","species":"Swiftlet","harvestLocation":"Cu Lao Cham, Quang Nam, Vietnam","harvestedAt":"2026-11-01T02:00:00.000Z","quantity":5.5,"unit":"kg"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgHarvestMSP "$HARVEST_MSP" "$PEER_HARVEST" "$HARVEST_TLS" CreateHandover \
  '{"batchId":"YEN-2026-0001","recipientMsp":"OrgProcessingMSP","eventId":"demo-handover-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" AcceptHandover \
  '{"batchId":"YEN-2026-0001","eventId":"demo-handover-2"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" RecordProcessing \
  '{"recordId":"PROC-0001","outputBatchId":"YEN-2026-0001-A","inputBatches":[{"batchId":"YEN-2026-0001","quantityUsed":5,"unit":"kg"}],"processType":"CLEANING_AND_SORTING","facilityId":"PROCESSING-FACILITY-01","notes":"Fictional demo record","eventId":"demo-processing-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" CreateDerivedBatch \
  '{"batchId":"YEN-2026-0001-A","batchType":"PRODUCT","species":"Swiftlet","quantity":0.5,"unit":"kg","inputBatches":[{"batchId":"YEN-2026-0001","quantityUsed":5,"unit":"kg"}],"eventId":"demo-derived-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgProcessingMSP "$QUALITY_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" RecordQualityCheck \
  '{"qualityId":"QC-0001","batchId":"YEN-2026-0001-A","result":"PASS","standardCode":"DEMO-STANDARD-01","certificateHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","documentRef":"certificates/QC-0001.pdf","eventId":"demo-quality-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" PackageBatch \
  '{"batchId":"YEN-2026-0001-A","certificateHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","eventId":"demo-package-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

PRIVATE_TERMS='{"commercialPrice":125,"contractReference":"DEMO-CONTRACT-PRIVATE-01","supplierNotes":"Fictional private demo note"}'
PRIVATE_TERMS_B64="$(printf '%s' "$PRIVATE_TERMS" | base64 | tr -d '\n')"
invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" StorePrivateCommercialTerms \
  '{"batchId":"YEN-2026-0001-A","eventId":"demo-private-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS" \
  --transient "{\"privateTerms\":\"$PRIVATE_TERMS_B64\"}"

invoke OrgProcessingMSP "$PROCESSING_MSP" "$PEER_PROCESSING" "$PROCESSING_TLS" CreateShipment \
  '{"shipmentId":"SHIP-0001","batchIds":["YEN-2026-0001-A"],"toMsp":"OrgDistributionMSP","eventId":"demo-shipment-1"}' \
  --peerAddresses "$PEER_HARVEST" --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS"

invoke OrgDistributionMSP "$DISTRIBUTION_MSP" "$PEER_DISTRIBUTION" "$DISTRIBUTION_TLS" AcceptShipment \
  '{"shipmentId":"SHIP-0001","eventId":"demo-shipment-2"}' \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS" \
  --peerAddresses "$PEER_DISTRIBUTION" --tlsRootCertFiles "$DISTRIBUTION_TLS"

invoke OrgDistributionMSP "$DISTRIBUTION_MSP" "$PEER_DISTRIBUTION" "$DISTRIBUTION_TLS" RecordDistribution \
  '{"batchId":"YEN-2026-0001-A","shipmentId":"SHIP-0001","distributionId":"DIST-0001","location":"Da Nang, Vietnam","eventId":"demo-distribution-1"}' \
  --peerAddresses "$PEER_PROCESSING" --tlsRootCertFiles "$PROCESSING_TLS" \
  --peerAddresses "$PEER_DISTRIBUTION" --tlsRootCertFiles "$DISTRIBUTION_TLS"

printf 'Fictional demo supply-chain flow submitted to Fabric channel %s.\n' "$CHANNEL_ID"
