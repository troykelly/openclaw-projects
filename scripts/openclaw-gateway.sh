#!/usr/bin/env bash
# Start the OpenClaw gateway in development mode (no channels, WebSocket only).
# Usage: ./scripts/openclaw-gateway.sh [--reset]
#
# The gateway will bind to ws://127.0.0.1:18789 by default.
# Set OPENCLAW_GATEWAY_PORT to change the port.
#
# Prerequisites:
#   - OpenClaw source at .local/openclaw-gateway (installed by postCreate.sh)
#   - Dependencies installed (pnpm install)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="${REPO_ROOT}/.local/openclaw-gateway"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

if [[ ! -f "$GATEWAY_DIR/package.json" ]]; then
  echo "ERROR: OpenClaw gateway not found at $GATEWAY_DIR"
  echo "Run: bash .devcontainer/postCreate.sh"
  exit 1
fi

if [[ ! -d "$GATEWAY_DIR/node_modules" ]]; then
  echo "Installing OpenClaw gateway dependencies..."
  (cd "$GATEWAY_DIR" && pnpm install)
fi

echo "Starting OpenClaw gateway on port $GATEWAY_PORT (channels disabled)..."

reset_flag=""
if [[ "${1:-}" == "--reset" ]]; then
  reset_flag="--reset"
fi

cd "$GATEWAY_DIR"
exec env \
  OPENCLAW_SKIP_CHANNELS=1 \
  CLAWDBOT_SKIP_CHANNELS=1 \
  node scripts/run-node.mjs --dev gateway \
    --port "$GATEWAY_PORT" \
    $reset_flag
