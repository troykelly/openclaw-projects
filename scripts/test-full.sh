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

cleanup() {
  if [ $TEARDOWN_DONE -eq 0 ]; then
    echo ""
    echo "=== Tearing down test services ==="
    pnpm run test:e2e:teardown 2>/dev/null || true
    TEARDOWN_DONE=1
  fi
}

# Trap SIGINT, SIGTERM, and EXIT
trap cleanup SIGINT SIGTERM EXIT

echo "=== Building plugin ==="
pnpm --filter @troykelly/openclaw-projects run build

echo ""
echo "=== Level 1 + 3: Unit + Gateway Tests ==="
pnpm test

echo ""
echo "=== Level 2: E2E Tests ==="
pnpm run test:e2e:setup
pnpm run test:e2e

echo ""
echo "=== All tests passed! ==="
