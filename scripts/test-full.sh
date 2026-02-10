#!/bin/bash
# Unified test runner — runs all 3 test levels
# Part of Epic #956, Issue #961
#
# Runs:
# - Level 1 (Unit) + Level 3 (Gateway) via `pnpm test`
# - Level 2 (E2E) via `pnpm run test:e2e`
#
# Fails fast on first failure. Clean teardown on interrupt.

set -e

TEARDOWN_DONE=0
E2E_NETWORK_JOINED=0

# Detect Docker-outside-of-Docker: if /.dockerenv exists and docker is available,
# we're inside a devcontainer that shares the host Docker socket. E2E sibling
# containers won't be reachable via localhost — we need to join their network
# and use the container hostname.
is_dood() {
  [ -f /.dockerenv ] && command -v docker >/dev/null 2>&1
}

cleanup() {
  if [ $TEARDOWN_DONE -eq 0 ]; then
    echo ""
    echo "=== Tearing down test services ==="
    if [ $E2E_NETWORK_JOINED -eq 1 ]; then
      docker network disconnect openclaw-test-network "$(hostname)" 2>/dev/null || true
    fi
    pnpm run test:e2e:teardown 2>/dev/null || true
    TEARDOWN_DONE=1
  fi
}

# Trap SIGINT, SIGTERM, and EXIT
trap cleanup SIGINT SIGTERM EXIT

echo "=== Building plugin ==="
pnpm --filter @troykelly/openclaw-projects run build

echo ""
echo "=== Building frontend assets ==="
pnpm run app:build

echo ""
echo "=== Level 1 + 3: Unit + Gateway Tests ==="
pnpm test

echo ""
echo "=== Level 2: E2E Tests ==="
pnpm run test:e2e:setup

# In DooD, connect this container to the test network so we can reach the
# backend-test container by name instead of localhost.
if is_dood; then
  echo "DooD detected — joining openclaw-test-network..."
  docker network connect openclaw-test-network "$(hostname)" 2>/dev/null || true
  E2E_NETWORK_JOINED=1
  export E2E_API_URL="http://openclaw-backend-test:3001"
fi

pnpm run test:e2e

echo ""
echo "=== All tests passed! ==="
