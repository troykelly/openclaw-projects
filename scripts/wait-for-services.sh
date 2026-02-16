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

wait_for_service() {
  local service_name="$1"
  echo "Waiting for ${service_name} to be healthy..."

  local start_time
  start_time=$(date +%s)
  while true; do
    local current_time
    current_time=$(date +%s)
    local elapsed=$((current_time - start_time))

    if [ $elapsed -ge $TIMEOUT ]; then
      echo "Timeout waiting for ${service_name} after ${TIMEOUT}s"
      echo "Showing container logs:"
      docker compose -f "$COMPOSE_FILE" logs "$service_name" | tail -50
      exit 1
    fi

    # Check if container is healthy via docker compose
    local health_status
    health_status=$(docker compose -f "$COMPOSE_FILE" ps "$service_name" --format json | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")

    if [ "$health_status" = "healthy" ]; then
      echo "${service_name} is healthy!"
      break
    fi

    echo "${service_name} not ready yet (status: ${health_status:-starting}), waiting... (${elapsed}s elapsed)"
    sleep $INTERVAL
  done
}

wait_for_service "backend-test"
wait_for_service "backend-auth-test"

echo "All services are ready!"
exit 0
