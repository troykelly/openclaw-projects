#!/usr/bin/env bash
# Test script to verify credential sanitization works correctly

set -euo pipefail

echo "=== Testing Credential Sanitization ==="
echo ""

# Test 1: Verify sanitization with simulated git error containing credentials
test_sanitization() {
  echo "Test 1: Sanitize simulated git error with embedded credentials"

  # Simulate git error output that might contain credentials
  local test_output="fatal: unable to access 'https://x-access-token:ghp_abc123xyz@github.com/test/repo.git/': Could not resolve host"

  # Apply the sanitization regex from our fix
  local sanitized
  sanitized=$(echo "$test_output" | sed -E 's|https://[^:/@]+:[^:/@]+@|https://***:***@|g')

  echo "Original:  $test_output"
  echo "Sanitized: $sanitized"

  # Verify credential is removed
  if echo "$sanitized" | grep -q "ghp_abc123xyz"; then
    echo "FAIL: Credential still visible in sanitized output"
    return 1
  fi

  if echo "$sanitized" | grep -q "https://\*\*\*:\*\*\*@"; then
    echo "PASS: Credential successfully sanitized"
  else
    echo "FAIL: Sanitization didn't work as expected"
    return 1
  fi

  echo ""
}

# Test 2: Verify sanitization preserves error messages
test_preservation() {
  echo "Test 2: Verify error messages are preserved after sanitization"

  local test_output="fatal: unable to access 'https://user:token@github.com/repo.git/': Connection timeout"

  local sanitized
  sanitized=$(echo "$test_output" | sed -E 's|https://[^:/@]+:[^:/@]+@|https://***:***@|g')

  echo "Original:  $test_output"
  echo "Sanitized: $sanitized"

  # Verify error message is still present
  if echo "$sanitized" | grep -q "Connection timeout"; then
    echo "PASS: Error message preserved"
  else
    echo "FAIL: Error message was lost"
    return 1
  fi

  echo ""
}

# Test 3: Verify sanitization handles multiple URLs
test_multiple_urls() {
  echo "Test 3: Sanitize multiple URLs in same output"

  local test_output="Redirected from https://user1:pass1@host1.com/repo to https://user2:pass2@host2.com/repo"

  local sanitized
  sanitized=$(echo "$test_output" | sed -E 's|https://[^:/@]+:[^:/@]+@|https://***:***@|g')

  echo "Original:  $test_output"
  echo "Sanitized: $sanitized"

  # Verify both credentials are removed
  if echo "$sanitized" | grep -qE "(user1|pass1|user2|pass2)"; then
    echo "FAIL: Some credentials still visible"
    return 1
  fi

  echo "PASS: All credentials sanitized"
  echo ""
}

# Test 4: Real git clone with intentional failure
test_real_clone() {
  echo "Test 4: Real git clone with credential sanitization"

  # Use a fake token and non-existent repo
  local fake_token="fake-test-token-12345-should-not-appear"
  local auth_url="https://x-access-token:${fake_token}@github.com/nonexistent-org-12345/nonexistent-repo-67890.git"
  local temp_dir
  temp_dir=$(mktemp -d)

  echo "Attempting clone with fake credentials..."

  # Simulate the exact pattern from postCreate.sh
  local clone_output
  if ! clone_output=$(git clone --depth 1 "$auth_url" "$temp_dir/test-repo" 2>&1); then
    # Apply sanitization
    local sanitized_output
    sanitized_output=$(echo "$clone_output" | sed -E 's|https://[^:/@]+:[^:/@]+@|https://***:***@|g')

    echo "Git output (sanitized):"
    echo "$sanitized_output"

    # Verify token is not in sanitized output
    if echo "$sanitized_output" | grep -q "$fake_token"; then
      echo "FAIL: Token still visible in output"
      rm -rf "$temp_dir"
      return 1
    fi

    echo "PASS: Real git error sanitized successfully"
  else
    echo "WARN: Clone unexpectedly succeeded"
  fi

  rm -rf "$temp_dir"
  echo ""
}

# Run all tests
all_tests_passed=true

test_sanitization || all_tests_passed=false
test_preservation || all_tests_passed=false
test_multiple_urls || all_tests_passed=false
test_real_clone || all_tests_passed=false

echo "=== Test Summary ==="
if $all_tests_passed; then
  echo "All tests PASSED"
  exit 0
else
  echo "Some tests FAILED"
  exit 1
fi
