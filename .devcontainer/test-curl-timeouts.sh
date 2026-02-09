#!/usr/bin/env bash
# Test script to verify curl timeout configuration

set -euo pipefail

echo "=== Testing Curl Timeout Configuration ==="
echo ""

# Test 1: Verify timeout flags are present
test_timeout_flags() {
  echo "Test 1: Verify all curl commands have timeout flags"

  local postCreate=".devcontainer/postCreate.sh"

  # Find all curl commands (exclude comments and curl availability check)
  local curl_lines
  curl_lines=$(grep -n "curl " "$postCreate" | grep -v "^[[:space:]]*#" | grep -v "command -v curl")

  echo "Found curl commands:"
  echo "$curl_lines"
  echo ""

  # Check each curl command has timeouts
  local missing_timeout=false
  while IFS= read -r line; do
    if ! echo "$line" | grep -q -- "--max-time"; then
      echo "FAIL: Missing --max-time on line: $line"
      missing_timeout=true
    fi
    if ! echo "$line" | grep -q -- "--connect-timeout"; then
      echo "FAIL: Missing --connect-timeout on line: $line"
      missing_timeout=true
    fi
  done <<< "$curl_lines"

  if $missing_timeout; then
    echo "FAIL: Some curl commands are missing timeout flags"
    return 1
  fi

  echo "PASS: All curl commands have timeout flags"
  echo ""
}

# Test 2: Verify timeout with slow endpoint (10 second delay)
test_connect_timeout() {
  echo "Test 2: Verify connect timeout works (slow connection)"

  # Use httpbin.org delay endpoint
  local start
  start=$(date +%s)

  echo "Testing connect timeout with 5s timeout against 10s delay endpoint..."

  # This should timeout in ~5 seconds
  if curl -fsSL --max-time 5 --connect-timeout 2 https://httpbin.org/delay/10 >/dev/null 2>&1; then
    echo "WARN: Request succeeded unexpectedly (should have timed out)"
  else
    local end
    end=$(date +%s)
    local duration=$((end - start))

    echo "Request failed after ${duration}s (expected: ~5s or less)"

    # Verify it failed within reasonable time (should be around 5s, allow up to 10s for variance)
    if [ "$duration" -le 10 ]; then
      echo "PASS: Timeout triggered within expected timeframe"
    else
      echo "FAIL: Timeout took too long (${duration}s > 10s)"
      return 1
    fi
  fi

  echo ""
}

# Test 3: Verify valid endpoints still work
test_normal_operation() {
  echo "Test 3: Verify curl still works with normal endpoints"

  # Test a quick API call with timeouts
  echo "Testing GitHub API call with timeouts..."

  if curl -fsSL --max-time 30 --connect-timeout 10 https://api.github.com/zen >/dev/null 2>&1; then
    echo "PASS: Normal operation works with timeout flags"
  else
    echo "FAIL: Valid endpoint failed with timeout flags"
    return 1
  fi

  echo ""
}

# Test 4: Verify timeout values are reasonable
test_timeout_values() {
  echo "Test 4: Verify timeout values are reasonable"

  local postCreate=".devcontainer/postCreate.sh"

  # Check max-time values
  echo "Checking --max-time values..."
  local max_times
  max_times=$(grep -oP -- '--max-time \K\d+' "$postCreate" || true)

  echo "Found --max-time values: $(echo "$max_times" | tr '\n' ' ')"

  # All should be between 10 and 300 seconds (5 minutes)
  while IFS= read -r timeout; do
    if [ -n "$timeout" ]; then
      if [ "$timeout" -lt 10 ] || [ "$timeout" -gt 300 ]; then
        echo "FAIL: --max-time value $timeout is outside reasonable range (10-300s)"
        return 1
      fi
    fi
  done <<< "$max_times"

  echo "PASS: All --max-time values are reasonable"
  echo ""

  # Check connect-timeout values
  echo "Checking --connect-timeout values..."
  local connect_times
  connect_times=$(grep -oP -- '--connect-timeout \K\d+' "$postCreate" || true)

  echo "Found --connect-timeout values: $(echo "$connect_times" | tr '\n' ' ')"

  # All should be between 5 and 30 seconds
  while IFS= read -r timeout; do
    if [ -n "$timeout" ]; then
      if [ "$timeout" -lt 5 ] || [ "$timeout" -gt 30 ]; then
        echo "FAIL: --connect-timeout value $timeout is outside reasonable range (5-30s)"
        return 1
      fi
    fi
  done <<< "$connect_times"

  echo "PASS: All --connect-timeout values are reasonable"
  echo ""
}

# Run all tests
all_tests_passed=true

test_timeout_flags || all_tests_passed=false
test_connect_timeout || all_tests_passed=false
test_normal_operation || all_tests_passed=false
test_timeout_values || all_tests_passed=false

echo "=== Test Summary ==="
if $all_tests_passed; then
  echo "All tests PASSED"
  exit 0
else
  echo "Some tests FAILED"
  exit 1
fi
