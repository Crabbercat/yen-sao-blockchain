#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

require_environment
"$SCRIPT_DIR/health-check.sh"

CHANNEL_ID="supplychannel"
CHAINCODE_NAME="yen-sao-contract"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_LABEL="${CHAINCODE_NAME}_${CHAINCODE_VERSION}"
CHAINCODE_ROOT="$PROJECT_ROOT/blockchain/chaincode/yen-traceability"
PACKAGE_DIR="$PROJECT_ROOT/blockchain/network/chaincode-packages"
PACKAGE_STAGE="$PACKAGE_DIR/source"
PACKAGE_FILE="$PACKAGE_DIR/$CHAINCODE_NAME.tgz"
PACKAGE_PATH="/workspace/blockchain/network/chaincode-packages/$CHAINCODE_NAME.tgz"
COLLECTIONS_PATH="/workspace/blockchain/chaincode/yen-traceability/collections_config.json"
ORDERER_CA="/workspace/blockchain/organizations/crypto-config/ordererOrganizations/example.com/orderers/orderer0.example.com/tls/ca.crt"
ENDORSEMENT_POLICY="OutOf(2, 'OrgHarvestMSP.peer', 'OrgProcessingMSP.peer', 'OrgDistributionMSP.peer')"

HARVEST_MSP="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-harvest.example.com/users/Admin@org-harvest.example.com/msp"
PROCESSING_MSP="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-processing.example.com/users/Admin@org-processing.example.com/msp"
DISTRIBUTION_MSP="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-distribution.example.com/users/Admin@org-distribution.example.com/msp"
HARVEST_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-harvest.example.com/peers/peer0.org-harvest.example.com/tls/ca.crt"
PROCESSING_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-processing.example.com/peers/peer0.org-processing.example.com/tls/ca.crt"
DISTRIBUTION_TLS="/workspace/blockchain/organizations/crypto-config/peerOrganizations/org-distribution.example.com/peers/peer0.org-distribution.example.com/tls/ca.crt"

query_committed() {
  fabric_peer_tool OrgHarvestMSP "$HARVEST_MSP" peer0.org-harvest.example.com:7051 "$HARVEST_TLS" \
    lifecycle chaincode querycommitted --channelID "$CHANNEL_ID" --name "$CHAINCODE_NAME" --output json
}

if ! [[ "$CHAINCODE_SEQUENCE" =~ ^[1-9][0-9]*$ ]]; then
  printf 'CHAINCODE_SEQUENCE must be a positive integer.\n' >&2
  exit 1
fi

if committed="$(query_committed 2>&1)"; then
  committed_json="$(sed -n '/^[[:space:]]*{/,$p' <<< "$committed")"
  committed_sequence="$(sed -n 's/.*"sequence"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' <<< "$committed_json" | head -n 1)"
  committed_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<< "$committed_json" | head -n 1)"
  if [[ -z "$committed_sequence" || -z "$committed_version" ]]; then
    printf 'Unable to parse the committed chaincode definition:\n%s\n' "$committed" >&2
    exit 1
  fi
  if [[ "$committed_sequence" == "$CHAINCODE_SEQUENCE" && "$committed_version" == "$CHAINCODE_VERSION" ]]; then
    printf 'Chaincode %s version %s sequence %s is already committed on %s.\n' \
      "$CHAINCODE_NAME" "$CHAINCODE_VERSION" "$CHAINCODE_SEQUENCE" "$CHANNEL_ID"
    exit 0
  fi
  if (( CHAINCODE_SEQUENCE != committed_sequence + 1 )); then
    printf 'Requested sequence %s must be the next sequence after committed sequence %s.\n' \
      "$CHAINCODE_SEQUENCE" "$committed_sequence" >&2
    exit 1
  fi
elif [[ "$committed" != *"not found"* \
  && "$committed" != *"does not exist"* \
  && "$committed" != *"namespace $CHAINCODE_NAME is not defined"* ]]; then
  printf 'Unable to query committed chaincode definition:\n%s\n' "$committed" >&2
  exit 1
fi

mkdir -p "$PACKAGE_DIR"
rm -rf "$PACKAGE_STAGE"
mkdir -p "$PACKAGE_STAGE"
cp "$CHAINCODE_ROOT/index.js" "$CHAINCODE_ROOT/package.json" "$CHAINCODE_ROOT/package-lock.json" "$PACKAGE_STAGE/"
cp -R "$CHAINCODE_ROOT/lib" "$CHAINCODE_ROOT/node_modules" "$PACKAGE_STAGE/"

fabric_tool peer lifecycle chaincode package "$PACKAGE_PATH" \
  --path /workspace/blockchain/network/chaincode-packages/source \
  --lang node \
  --label "$CHAINCODE_LABEL"

package_id="$(fabric_peer_tool OrgHarvestMSP "$HARVEST_MSP" peer0.org-harvest.example.com:7051 "$HARVEST_TLS" \
  lifecycle chaincode calculatepackageid "$PACKAGE_PATH")"
printf 'Package ID: %s\n' "$package_id"

install_on_peer() {
  local msp_id="$1"
  local msp_home="$2"
  local peer_address="$3"
  local tls_ca="$4"
  local installed

  installed="$(fabric_peer_tool "$msp_id" "$msp_home" "$peer_address" "$tls_ca" lifecycle chaincode queryinstalled --output json)"
  if [[ "$installed" != *"$package_id"* ]]; then
    fabric_peer_tool "$msp_id" "$msp_home" "$peer_address" "$tls_ca" \
      lifecycle chaincode install "$PACKAGE_PATH"
  fi
}

install_on_peer OrgHarvestMSP "$HARVEST_MSP" peer0.org-harvest.example.com:7051 "$HARVEST_TLS"
install_on_peer OrgProcessingMSP "$PROCESSING_MSP" peer0.org-processing.example.com:8051 "$PROCESSING_TLS"
install_on_peer OrgDistributionMSP "$DISTRIBUTION_MSP" peer0.org-distribution.example.com:9051 "$DISTRIBUTION_TLS"

approve_for_org() {
  local msp_id="$1"
  local msp_home="$2"
  local peer_address="$3"
  local tls_ca="$4"

  fabric_peer_tool "$msp_id" "$msp_home" "$peer_address" "$tls_ca" \
    lifecycle chaincode approveformyorg \
    --channelID "$CHANNEL_ID" \
    --name "$CHAINCODE_NAME" \
    --version "$CHAINCODE_VERSION" \
    --package-id "$package_id" \
    --sequence "$CHAINCODE_SEQUENCE" \
    --collections-config "$COLLECTIONS_PATH" \
    --signature-policy "$ENDORSEMENT_POLICY" \
    --tls \
    --cafile "$ORDERER_CA" \
    -o orderer0.example.com:7050
}

approve_for_org OrgHarvestMSP "$HARVEST_MSP" peer0.org-harvest.example.com:7051 "$HARVEST_TLS"
approve_for_org OrgProcessingMSP "$PROCESSING_MSP" peer0.org-processing.example.com:8051 "$PROCESSING_TLS"
approve_for_org OrgDistributionMSP "$DISTRIBUTION_MSP" peer0.org-distribution.example.com:9051 "$DISTRIBUTION_TLS"

readiness="$(fabric_peer_tool OrgHarvestMSP "$HARVEST_MSP" peer0.org-harvest.example.com:7051 "$HARVEST_TLS" \
  lifecycle chaincode checkcommitreadiness \
  --channelID "$CHANNEL_ID" \
  --name "$CHAINCODE_NAME" \
  --version "$CHAINCODE_VERSION" \
  --sequence "$CHAINCODE_SEQUENCE" \
  --collections-config "$COLLECTIONS_PATH" \
  --signature-policy "$ENDORSEMENT_POLICY" \
  --output json)"
printf 'Commit readiness:\n%s\n' "$readiness"
for msp_id in OrgHarvestMSP OrgProcessingMSP OrgDistributionMSP; do
  if ! grep -Eq "\"$msp_id\"[[:space:]]*:[[:space:]]*true" <<< "$readiness"; then
    printf 'Chaincode approval missing for %s.\n' "$msp_id" >&2
    exit 1
  fi
done

fabric_peer_tool OrgHarvestMSP "$HARVEST_MSP" peer0.org-harvest.example.com:7051 "$HARVEST_TLS" \
  lifecycle chaincode commit \
  --channelID "$CHANNEL_ID" \
  --name "$CHAINCODE_NAME" \
  --version "$CHAINCODE_VERSION" \
  --sequence "$CHAINCODE_SEQUENCE" \
  --collections-config "$COLLECTIONS_PATH" \
  --signature-policy "$ENDORSEMENT_POLICY" \
  --peerAddresses peer0.org-harvest.example.com:7051 \
  --tlsRootCertFiles "$HARVEST_TLS" \
  --peerAddresses peer0.org-processing.example.com:8051 \
  --tlsRootCertFiles "$PROCESSING_TLS" \
  --peerAddresses peer0.org-distribution.example.com:9051 \
  --tlsRootCertFiles "$DISTRIBUTION_TLS" \
  --tls \
  --cafile "$ORDERER_CA" \
  -o orderer0.example.com:7050

query_committed
