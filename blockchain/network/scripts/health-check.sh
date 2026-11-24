#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

services=(
  ca-harvest ca-processing ca-distribution
  orderer0 orderer1 orderer2
  peer-harvest peer-processing peer-distribution
)

for service in "${services[@]}"; do
  container_id="$(compose ps -q "$service")"
  if [[ -z "$container_id" ]]; then
    printf '%s is not running. Run up.sh first.\n' "$service" >&2
    exit 1
  fi
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container_id")"
  if [[ "$health" != "healthy" ]]; then
    printf '%s health is %s.\n' "$service" "$health" >&2
    exit 1
  fi
done

for service in peer-harvest peer-processing peer-distribution; do
  joined="$(compose exec -T "$service" peer channel list 2>&1)"
  if [[ "$joined" != *"supplychannel"* ]]; then
    printf '%s has not joined supplychannel.\n%s\n' "$service" "$joined" >&2
    exit 1
  fi
done

for orderer in orderer0.example.com orderer1.example.com orderer2.example.com; do
  tls_dir="/workspace/blockchain/organizations/crypto-config/ordererOrganizations/example.com/orderers/$orderer/tls"
  channels="$(fabric_network_tool osnadmin channel list \
    -o "$orderer:7053" \
    --ca-file "$tls_dir/ca.crt" \
    --client-cert "$tls_dir/server.crt" \
    --client-key "$tls_dir/server.key")"
  if [[ "$channels" != *"supplychannel"* ]]; then
    printf '%s is not participating in supplychannel.\n' "$service" >&2
    exit 1
  fi
done

printf 'All CAs, peers and orderers are healthy; all peers and orderers participate in supplychannel.\n'
