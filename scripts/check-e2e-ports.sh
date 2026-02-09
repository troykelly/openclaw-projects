#!/bin/bash
# Check E2E test ports are available before starting containers
# Part of Epic #956, Issue #965
#
# Usage: ./scripts/check-e2e-ports.sh
# Returns: 0 if ports available, 1 if conflict detected

set -e

# Allow port configuration via env vars (optional enhancement)
E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-5433}"
E2E_BACKEND_PORT="${E2E_BACKEND_PORT:-3001}"

check_port() {
  local port=$1
  local service=$2

  # Use ss to check if port is in LISTEN state
  # -t = TCP, -l = listening, -n = numeric ports
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    echo "ERROR: Port ${port} (${service}) is already in use."
    echo "Stop the conflicting service first, or set E2E_${service^^}_PORT to a different port."
    return 1
  fi
  return 0
}

echo "Checking E2E test port availability..."

# Track if any port is in use
conflict=0

# Check postgres port
if ! check_port "$E2E_POSTGRES_PORT" "postgres"; then
  conflict=1
fi

# Check backend port
if ! check_port "$E2E_BACKEND_PORT" "backend"; then
  conflict=1
fi

if [ $conflict -eq 1 ]; then
  echo ""
  echo "Port conflict detected. Cannot start E2E test containers."
  exit 1
fi

echo "All E2E test ports are available."
exit 0
