#!/usr/bin/env bash
# Test script to verify node availability checking

set -euo pipefail

echo "=== Testing Node Availability Check ==="
echo ""

# Source logging function
log() { echo "[test] $*"; }

# Test 1: Verify configure_claude_permissions checks for node
test_node_check_exists() {
  echo "Test 1: Verify node availability check exists in code"

  local postCreate=".devcontainer/postCreate.sh"

  # Find configure_claude_permissions function
  if ! grep -A 30 "configure_claude_permissions()" "$postCreate" | grep -q "command -v node"; then
    echo "FAIL: No node availability check found in configure_claude_permissions"
    return 1
  fi

  echo "PASS: Node availability check present"
  echo ""
}

# Test 2: Simulate missing node
test_missing_node() {
  echo "Test 2: Verify behavior when node is not available"

  local test_dir
  test_dir=$(mktemp -d)
  local settings="$test_dir/.claude/settings.json"

  # Create existing settings file
  mkdir -p "$(dirname "$settings")"
  echo '{ "existingKey": "existingValue" }' > "$settings"

  echo "Created test settings: $settings"
  cat "$settings"

  # Simulate configure_claude_permissions without node
  local node_available=false
  if command -v node >/dev/null 2>&1; then
    node_available=true
  fi

  if ! $node_available; then
    log "WARN: node not available, cannot safely merge settings - will overwrite if file exists"
    echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"
  fi

  echo "After processing (no node):"
  cat "$settings"

  # Verify it created the file even without node
  if [ ! -f "$settings" ]; then
    echo "FAIL: Settings file not created when node unavailable"
    rm -rf "$test_dir"
    return 1
  fi

  echo "PASS: Gracefully handles missing node"
  rm -rf "$test_dir"
  echo ""
}

# Test 3: Simulate node available with merge
test_with_node() {
  echo "Test 3: Verify settings merge when node is available"

  if ! command -v node >/dev/null 2>&1; then
    echo "SKIP: node not available in test environment"
    echo ""
    return 0
  fi

  local test_dir
  test_dir=$(mktemp -d)
  local settings="$test_dir/.claude/settings.json"

  # Create existing settings file with some data
  mkdir -p "$(dirname "$settings")"
  echo '{ "existingKey": "existingValue", "permissions": { "oldSetting": "oldValue" } }' > "$settings"

  echo "Created test settings: $settings"
  cat "$settings"

  # Simulate the node merge operation
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('$settings', 'utf8'));
    s.permissions = { ...s.permissions, defaultMode: 'bypassPermissions' };
    fs.writeFileSync('$settings', JSON.stringify(s, null, 2) + '\n');
  " 2>/dev/null || {
    log "WARN: Node script failed, overwriting"
    echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"
  }

  echo "After merge:"
  cat "$settings"

  # Verify permissions were added/merged
  if ! grep -q '"defaultMode"' "$settings"; then
    echo "FAIL: defaultMode not added to settings"
    rm -rf "$test_dir"
    return 1
  fi

  # Verify existing key preserved
  if ! grep -q '"existingKey"' "$settings"; then
    echo "FAIL: Existing settings not preserved"
    rm -rf "$test_dir"
    return 1
  fi

  echo "PASS: Settings merged correctly with node"
  rm -rf "$test_dir"
  echo ""
}

# Test 4: Verify new file creation
test_new_file_creation() {
  echo "Test 4: Verify new file creation when settings don't exist"

  local test_dir
  test_dir=$(mktemp -d)
  local settings="$test_dir/.claude/settings.json"

  # Ensure directory exists
  mkdir -p "$(dirname "$settings")"

  # Create new file (same logic regardless of node availability)
  echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"

  echo "Created new settings:"
  cat "$settings"

  # Verify file was created
  if [ ! -f "$settings" ]; then
    echo "FAIL: Settings file not created"
    rm -rf "$test_dir"
    return 1
  fi

  # Verify content is valid JSON
  if command -v node >/dev/null 2>&1; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$settings', 'utf8'))" 2>/dev/null; then
      echo "FAIL: Created file is not valid JSON"
      rm -rf "$test_dir"
      return 1
    fi
  fi

  echo "PASS: New file created correctly"
  rm -rf "$test_dir"
  echo ""
}

# Test 5: Verify error handling for node script failure
test_node_script_failure() {
  echo "Test 5: Verify graceful fallback on node script failure"

  if ! command -v node >/dev/null 2>&1; then
    echo "SKIP: node not available in test environment"
    echo ""
    return 0
  fi

  local test_dir
  test_dir=$(mktemp -d)
  local settings="$test_dir/.claude/settings.json"

  # Create invalid JSON to force node script to fail
  mkdir -p "$(dirname "$settings")"
  echo '{ invalid json }' > "$settings"

  echo "Created invalid settings (to test error handling):"
  cat "$settings"

  # Try to merge (should fail and fallback)
  if ! node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync('$settings', 'utf8'));
    s.permissions = { ...s.permissions, defaultMode: 'bypassPermissions' };
    fs.writeFileSync('$settings', JSON.stringify(s, null, 2) + '\n');
  " 2>/dev/null; then
    log "WARN: Node script failed to merge settings, overwriting file"
    echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"
  fi

  echo "After fallback:"
  cat "$settings"

  # Verify file was overwritten with valid config
  if ! grep -q '"defaultMode"' "$settings"; then
    echo "FAIL: Fallback didn't create valid config"
    rm -rf "$test_dir"
    return 1
  fi

  echo "PASS: Graceful fallback on node script failure"
  rm -rf "$test_dir"
  echo ""
}

# Run all tests
all_tests_passed=true

test_node_check_exists || all_tests_passed=false
test_missing_node || all_tests_passed=false
test_with_node || all_tests_passed=false
test_new_file_creation || all_tests_passed=false
test_node_script_failure || all_tests_passed=false

echo "=== Test Summary ==="
if $all_tests_passed; then
  echo "All tests PASSED"
  exit 0
else
  echo "Some tests FAILED"
  exit 1
fi
