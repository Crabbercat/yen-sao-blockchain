#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CHANNEL_ID="supplychannel"
BLOCK_PATH="/var/hyperledger/configtx/$CHANNEL_ID.block"

join_peer() {
  local service="$1"
  compose exec -T \
    -e CORE_PEER_MSPCONFIGPATH=/etc/hyperledger/fabric/admin/msp \
    "$service" peer channel join -b "$BLOCK_PATH"
}

join_peer peer-harvest
join_peer peer-processing
join_peer peer-distribution

printf 'All three organization peers joined %s.\n' "$CHANNEL_ID"
