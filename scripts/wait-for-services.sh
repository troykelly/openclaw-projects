#!/bin/bash
# Wait for E2E test services to become healthy
# Part of Epic #310, Issue #326, #958

set -e

BACKEND_URL="${E2E_API_URL:-http://localhost:3001}"
TIMEOUT="${E2E_TIMEOUT:-180}"
INTERVAL=2

echo "Waiting for backend at $BACKEND_URL..."

start_time=$(date +%s)
while true; do
  current_time=$(date +%s)
  elapsed=$((current_time - start_time))

  if [ $elapsed -ge $TIMEOUT ]; then
    echo "Timeout waiting for services after ${TIMEOUT}s"
    exit 1
  fi

  # Check backend liveness (always returns 200 when server is running)
  if curl -sf "${BACKEND_URL}/api/health/live" > /dev/null 2>&1; then
    echo "Backend is healthy!"
    break
  fi

  echo "Services not ready yet, waiting... (${elapsed}s elapsed)"
  sleep $INTERVAL
done

echo "All services are ready!"
exit 0
