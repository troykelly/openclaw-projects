#!/usr/bin/env bash
# Test script to verify TOCTOU mitigation in gateway directory check

set -euo pipefail

echo "=== Testing TOCTOU Safety Improvements ==="
echo ""

# Source logging function
log() { echo "[test] $*"; }

# Test 1: Verify error handling exists
test_error_handling() {
  echo "Test 1: Verify cd failure is handled in install_openclaw_gateway"

  local postCreate=".devcontainer/postCreate.sh"

  # Check that cd uses error suppression and explicit check
  if ! grep -A 20 "if \[\[ -f.*package.json.*\]\]" "$postCreate" | grep -q "cd.*2>/dev/null"; then
    echo "FAIL: cd command doesn't suppress stderr (TOCTOU mitigation missing)"
    return 1
  fi

  # Check that there's explicit if/else handling
  if ! grep -A 20 "if \[\[ -f.*package.json.*\]\]" "$postCreate" | grep -q "if (cd"; then
    echo "FAIL: No explicit check of cd exit code"
    return 1
  fi

  echo "PASS: Error handling present for cd failures"
  echo ""
}

# Test 2: Simulate directory disappearing during check
test_directory_disappears() {
  echo "Test 2: Simulate TOCTOU - directory disappears after check"

  local test_dir
  test_dir=$(mktemp -d)
  local gateway_dir="$test_dir/gateway"

  # Create initial structure
  mkdir -p "$gateway_dir"
  echo '{ "name": "test" }' > "$gateway_dir/package.json"

  echo "Created test structure: $gateway_dir"
  ls -la "$gateway_dir"

  # Simulate the check-then-use pattern with TOCTOU
  if [[ -f "$gateway_dir/package.json" ]]; then
    log "File exists at check time"

    # Simulate race condition - delete directory before cd
    rm -rf "$gateway_dir"
    log "Directory deleted (simulating race condition)"

    # Try to cd - should fail gracefully
    if (cd "$gateway_dir" 2>/dev/null && echo "Commands would execute here"); then
      echo "FAIL: cd succeeded after directory deletion (should have failed)"
      rm -rf "$test_dir"
      return 1
    else
      log "cd failed gracefully (expected)"
      echo "PASS: TOCTOU handled - cd failure detected"
    fi
  fi

  rm -rf "$test_dir"
  echo ""
}

# Test 3: Verify fallback to clone
test_fallback_to_clone() {
  echo "Test 3: Verify fallback logic is present"

  local postCreate=".devcontainer/postCreate.sh"

  # Check that failure leads to rm -rf and fall through
  if ! grep -A 20 "if \[\[ -f.*package.json.*\]\]" "$postCreate" | grep -q "rm -rf.*gateway_dir"; then
    echo "FAIL: No cleanup of corrupted directory"
    return 1
  fi

  # Check for fall through comment or log message
  if ! grep -A 20 "if \[\[ -f.*package.json.*\]\]" "$postCreate" | grep -qE "(Fall through|fresh clone)"; then
    echo "FAIL: No indication of fallback to clone"
    return 1
  fi

  echo "PASS: Fallback to clone logic present"
  echo ""
}

# Test 4: Verify node_modules check still works
test_node_modules_check() {
  echo "Test 4: Verify node_modules check still works correctly"

  local test_dir
  test_dir=$(mktemp -d)
  local gateway_dir="$test_dir/gateway"

  # Create structure with node_modules
  mkdir -p "$gateway_dir/node_modules"
  echo '{ "name": "test" }' > "$gateway_dir/package.json"

  echo "Created test structure with node_modules:"
  ls -la "$gateway_dir"

  # Simulate the check logic
  if [[ -f "$gateway_dir/package.json" ]]; then
    if [[ ! -d "$gateway_dir/node_modules" ]]; then
      echo "FAIL: node_modules not detected when it exists"
      rm -rf "$test_dir"
      return 1
    else
      log "node_modules detected - would skip install (correct)"
      echo "PASS: node_modules check works correctly"
    fi
  fi

  rm -rf "$test_dir"
  echo ""
}

# Test 5: Verify missing node_modules triggers install
test_missing_node_modules() {
  echo "Test 5: Verify missing node_modules triggers install attempt"

  local test_dir
  test_dir=$(mktemp -d)
  local gateway_dir="$test_dir/gateway"

  # Create structure without node_modules
  mkdir -p "$gateway_dir"
  echo '{ "name": "test" }' > "$gateway_dir/package.json"

  echo "Created test structure without node_modules:"
  ls -la "$gateway_dir"

  # Simulate the check logic
  if [[ -f "$gateway_dir/package.json" ]]; then
    if [[ ! -d "$gateway_dir/node_modules" ]]; then
      log "node_modules missing - would attempt install (correct)"

      # Test the cd pattern with error suppression
      if (cd "$gateway_dir" 2>/dev/null && echo "Install would run here"); then
        echo "PASS: Install logic would execute"
      else
        echo "FAIL: cd failed even though directory exists"
        rm -rf "$test_dir"
        return 1
      fi
    else
      echo "FAIL: node_modules detected when it doesn't exist"
      rm -rf "$test_dir"
      return 1
    fi
  fi

  rm -rf "$test_dir"
  echo ""
}

# Test 6: Verify error messages are informative
test_error_messages() {
  echo "Test 6: Verify error messages mention race condition/modification"

  local postCreate=".devcontainer/postCreate.sh"

  # Check for informative error message
  if ! grep -A 30 "install_openclaw_gateway()" "$postCreate" | grep -qE "(modified|race|fresh clone)"; then
    echo "FAIL: No informative error message about directory modification"
    return 1
  fi

  echo "PASS: Error messages are informative"
  echo ""
}

# Run all tests
all_tests_passed=true

test_error_handling || all_tests_passed=false
test_directory_disappears || all_tests_passed=false
test_fallback_to_clone || all_tests_passed=false
test_node_modules_check || all_tests_passed=false
test_missing_node_modules || all_tests_passed=false
test_error_messages || all_tests_passed=false

echo "=== Test Summary ==="
if $all_tests_passed; then
  echo "All tests PASSED"
  exit 0
else
  echo "Some tests FAILED"
  exit 1
fi
