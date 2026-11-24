#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CHANNEL_ID="supplychannel"
BLOCK_FILE="$PROJECT_ROOT/blockchain/network/channel-artifacts/$CHANNEL_ID.block"

if [[ ! -f "$BLOCK_FILE" ]]; then
  fabric_tool configtxgen \
    -configPath /workspace/blockchain/network/config \
    -profile ThreeOrgsRaft \
    -channelID "$CHANNEL_ID" \
    -outputBlock "/workspace/blockchain/network/channel-artifacts/$CHANNEL_ID.block"
fi

join_orderer() {
  local orderer="$1"
  local tls_dir="/workspace/blockchain/organizations/crypto-config/ordererOrganizations/example.com/orderers/$orderer/tls"

  fabric_network_tool osnadmin channel join \
    --channelID "$CHANNEL_ID" \
    --config-block "/workspace/blockchain/network/channel-artifacts/$CHANNEL_ID.block" \
    -o "$orderer:7053" \
    --ca-file "$tls_dir/ca.crt" \
    --client-cert "$tls_dir/server.crt" \
    --client-key "$tls_dir/server.key"
}

join_orderer orderer0.example.com
join_orderer orderer1.example.com
join_orderer orderer2.example.com

printf 'Orderer nodes joined %s.\n' "$CHANNEL_ID"
