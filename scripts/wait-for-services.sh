#!/bin/bash
# Wait for E2E test services to become healthy
# Part of Epic #310, Issue #326, #958
#
# When running from inside devcontainer via DooD, we can't reliably access
# sibling containers via localhost port forwarding. Instead, we check the
# Docker healthcheck status directly via docker compose.

set -e

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
TIMEOUT="${E2E_TIMEOUT:-180}"
INTERVAL=2

echo "Waiting for backend-test service to be healthy..."

start_time=$(date +%s)
while true; do
  current_time=$(date +%s)
  elapsed=$((current_time - start_time))

  if [ $elapsed -ge $TIMEOUT ]; then
    echo "Timeout waiting for services after ${TIMEOUT}s"
    echo "Showing container logs:"
    docker compose -f "$COMPOSE_FILE" logs backend-test | tail -50
    exit 1
  fi

  # Check if backend-test container is healthy via docker compose
  health_status=$(docker compose -f "$COMPOSE_FILE" ps backend-test --format json | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")

  if [ "$health_status" = "healthy" ]; then
    echo "Backend is healthy!"
    break
  fi

  echo "Services not ready yet (status: ${health_status:-starting}), waiting... (${elapsed}s elapsed)"
  sleep $INTERVAL
done

echo "All services are ready!"
exit 0
