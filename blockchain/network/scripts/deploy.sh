#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/up.sh"
"$SCRIPT_DIR/create-channel.sh"
"$SCRIPT_DIR/join-channel.sh"
"$SCRIPT_DIR/health-check.sh"
