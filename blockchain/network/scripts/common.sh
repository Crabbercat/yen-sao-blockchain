#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
FABRIC_COMPOSE="$PROJECT_ROOT/blockchain/network/compose/docker-compose.yml"
FABRIC_PROJECT="yen-sao-fabric"
FABRIC_NETWORK_NAME="yen-sao-fabric-network"
FABRIC_TOOLS_IMAGE="hyperledger/fabric-tools:2.5.16"
ENV_FILE="$PROJECT_ROOT/.env"

compose() {
  docker compose \
    --project-name "$FABRIC_PROJECT" \
    --project-directory "$PROJECT_ROOT" \
    --env-file "$ENV_FILE" \
    --file "$FABRIC_COMPOSE" \
    "$@"
}

fabric_tool() {
  local tool="$1"
  shift
  docker run --rm \
    --volume "$PROJECT_ROOT/blockchain:/workspace/blockchain" \
    --workdir /workspace/blockchain/network \
    --entrypoint "$tool" \
    "$FABRIC_TOOLS_IMAGE" \
    "$@"
}

fabric_network_tool() {
  local tool="$1"
  shift
  docker run --rm \
    --network "$FABRIC_NETWORK_NAME" \
    --volume "$PROJECT_ROOT/blockchain:/workspace/blockchain" \
    --workdir /workspace/blockchain/network \
    --entrypoint "$tool" \
    "$FABRIC_TOOLS_IMAGE" \
    "$@"
}

fabric_peer_tool() {
  local msp_id="$1"
  local msp_home="$2"
  local peer_address="$3"
  local tls_ca="$4"
  shift 4
  docker run --rm \
    --network "$FABRIC_NETWORK_NAME" \
    --volume "$PROJECT_ROOT/blockchain:/workspace/blockchain" \
    --workdir /workspace/blockchain/network \
    --env FABRIC_CFG_PATH=/etc/hyperledger/fabric \
    --env CORE_PEER_LOCALMSPID="$msp_id" \
    --env CORE_PEER_MSPCONFIGPATH="$msp_home" \
    --env CORE_PEER_ADDRESS="$peer_address" \
    --env CORE_PEER_TLS_ENABLED=true \
    --env CORE_PEER_TLS_ROOTCERT_FILE="$tls_ca" \
    --entrypoint peer \
    "$FABRIC_TOOLS_IMAGE" \
    "$@"
}

env_value() {
  local name="$1"
  local value
  value="$(sed -n "s/^${name}=//p" "$ENV_FILE" | tail -n 1)"
  value="${value%$'\r'}"
  if [[ -z "$value" ]]; then
    printf 'Missing or empty %s in %s\n' "$name" "$ENV_FILE" >&2
    return 1
  fi
  printf '%s' "$value"
}

require_environment() {
  if [[ ! -f "$ENV_FILE" ]]; then
    printf 'Missing %s. Copy .env.example to .env and set local random secrets.\n' "$ENV_FILE" >&2
    return 1
  fi
}
