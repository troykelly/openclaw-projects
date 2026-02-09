#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# test-postCreate.sh — Integration test for postCreate.sh
#
# Runs postCreate.sh in a clean container and verifies installation results.
# Part of Epic #967, Issue #977
#
# USAGE:
#   ./.devcontainer/test-postCreate.sh
#
# ENVIRONMENT:
#   TEST_IMAGE - Docker image to use for testing (default: mcr.microsoft.com/devcontainers/base:ubuntu)
#
# WHAT IT TESTS:
#   - postCreate.sh executes without errors
#   - Summary output is produced with OK/FAIL indicators
#   - Script handles failures gracefully (continues after errors)
#   - Basic prerequisites (curl, jq) are available
#   - Optional: Claude Code and Codex installation (if dependencies available)
#
# LIMITATIONS:
#   - Does not test GitHub token-dependent features (OpenClaw gateway clone)
#   - Does not test cloud credential restoration (requires secrets)
#   - Does not test plugin installation (requires external services)
#
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_IMAGE="${TEST_IMAGE:-mcr.microsoft.com/devcontainers/base:ubuntu}"
TEST_CONTAINER_NAME="postCreate-test-$$"

log() { echo "[test-postCreate] $*"; }
error() { echo "[test-postCreate] ERROR: $*" >&2; }
cleanup() {
  if docker ps -a --format '{{.Names}}' | grep -q "^${TEST_CONTAINER_NAME}\$"; then
    log "Cleaning up container ${TEST_CONTAINER_NAME}"
    docker rm -f "$TEST_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# Test functions
# ---------------------------------------------------------------------------

test_basic_prerequisites() {
  log "Testing: Basic prerequisites (curl, jq)"

  docker run --rm --name "${TEST_CONTAINER_NAME}" \
    -v "$REPO_ROOT:/workspace" -w /workspace \
    "$TEST_IMAGE" \
    bash -c 'command -v curl && command -v jq'
}

test_postCreate_execution() {
  log "Testing: postCreate.sh execution"

  # Run postCreate.sh without GitHub token (some steps will fail gracefully)
  docker run --rm --name "${TEST_CONTAINER_NAME}" \
    -v "$REPO_ROOT:/workspace" -w /workspace \
    -e HOME=/tmp/test-home \
    "$TEST_IMAGE" \
    bash .devcontainer/postCreate.sh
}

test_claude_installation() {
  log "Testing: Claude Code installation"

  # Check if Claude Code binary exists and is executable
  docker run --rm --name "${TEST_CONTAINER_NAME}" \
    -v "$REPO_ROOT:/workspace" -w /workspace \
    -e HOME=/tmp/test-home \
    "$TEST_IMAGE" \
    bash -c '
      export PATH="/tmp/test-home/.claude/bin:/tmp/test-home/.local/bin:$PATH"
      command -v claude >/dev/null 2>&1 || exit 1
      claude --version || exit 1
    '
}

test_codex_installation() {
  log "Testing: Codex binary installation"

  # Codex should be installed to /usr/local/bin
  docker run --rm --name "${TEST_CONTAINER_NAME}" \
    -v "$REPO_ROOT:/workspace" -w /workspace \
    "$TEST_IMAGE" \
    bash -c '
      command -v codex >/dev/null 2>&1 || exit 1
      codex --version || exit 1
    '
}

test_summary_output() {
  log "Testing: postCreate.sh summary output format"

  # Verify the script produces a summary
  local output
  output=$(docker run --rm --name "${TEST_CONTAINER_NAME}" \
    -v "$REPO_ROOT:/workspace" -w /workspace \
    -e HOME=/tmp/test-home \
    "$TEST_IMAGE" \
    bash .devcontainer/postCreate.sh 2>&1)

  if ! echo "$output" | grep -q "Setup Summary"; then
    error "postCreate.sh did not produce expected summary output"
    return 1
  fi

  if ! echo "$output" | grep -qE "(OK|FAIL)"; then
    error "postCreate.sh summary missing OK/FAIL status indicators"
    return 1
  fi

  log "Summary output format is correct"
}

test_failure_handling() {
  log "Testing: Graceful failure handling"

  # Run without GITHUB_TOKEN - OpenClaw gateway step should fail but script continues
  local output
  output=$(docker run --rm --name "${TEST_CONTAINER_NAME}" \
    -v "$REPO_ROOT:/workspace" -w /workspace \
    -e HOME=/tmp/test-home \
    "$TEST_IMAGE" \
    bash .devcontainer/postCreate.sh 2>&1)

  # Script should complete even with failures
  if ! echo "$output" | grep -q "postCreate setup complete"; then
    error "postCreate.sh did not complete with failures"
    return 1
  fi

  # Should have at least one FAIL entry (OpenClaw gateway without token)
  if ! echo "$output" | grep -q "FAIL"; then
    error "Expected at least one FAIL entry for missing GITHUB_TOKEN"
    return 1
  fi

  log "Graceful failure handling verified"
}

# ---------------------------------------------------------------------------
# Main test execution
# ---------------------------------------------------------------------------

main() {
  log "Starting postCreate.sh integration tests"
  log "Test image: $TEST_IMAGE"
  log "Repository: $REPO_ROOT"
  log ""

  local failed=0
  local tests=(
    test_basic_prerequisites
    test_postCreate_execution
    test_summary_output
    test_failure_handling
  )

  # Optional tests (require full installation)
  local optional_tests=(
    test_claude_installation
    test_codex_installation
  )

  # Run core tests
  for test in "${tests[@]}"; do
    if "$test"; then
      log "✓ $test passed"
    else
      error "✗ $test failed"
      ((failed++))
    fi
    log ""
  done

  # Run optional tests (don't fail on these, just report)
  log "Running optional verification tests..."
  for test in "${optional_tests[@]}"; do
    if "$test"; then
      log "✓ $test passed"
    else
      log "⚠ $test skipped or failed (may require external dependencies)"
    fi
    log ""
  done

  # Summary
  log "=========================================="
  log "Test Results: ${#tests[@]} core tests"
  if ((failed == 0)); then
    log "✓ All core tests passed"
    return 0
  else
    error "✗ $failed core test(s) failed"
    return 1
  fi
}

main "$@"
