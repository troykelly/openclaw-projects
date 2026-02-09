#!/usr/bin/env bash
# Test script to verify security documentation is present and comprehensive

set -euo pipefail

echo "=== Testing Security Documentation ==="
echo ""

# Test 1: Verify Claude permissions has security notes
test_claude_security_docs() {
  echo "Test 1: Verify configure_claude_permissions has security documentation"

  local postCreate=".devcontainer/postCreate.sh"

  # Check for SECURITY NOTE comment
  if ! grep -A 20 "configure_claude_permissions()" "$postCreate" | grep -q "SECURITY NOTE"; then
    echo "FAIL: No SECURITY NOTE in configure_claude_permissions"
    return 1
  fi

  # Check for key security context
  local claude_section
  claude_section=$(grep -A 20 "configure_claude_permissions()" "$postCreate")

  local missing=()

  echo "$claude_section" | grep -q "DevContainer" || missing+=("DevContainer mention")
  echo "$claude_section" | grep -q "isolated" || missing+=("isolation mention")
  echo "$claude_section" | grep -q "DO NOT" || missing+=("DO NOT warning")
  echo "$claude_section" | grep -q "production" || missing+=("production warning")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "FAIL: Missing security documentation elements: ${missing[*]}"
    return 1
  fi

  echo "PASS: Claude permissions has comprehensive security documentation"
  echo ""
}

# Test 2: Verify Codex CLI has security notes
test_codex_security_docs() {
  echo "Test 2: Verify configure_codex_cli has security documentation"

  local postCreate=".devcontainer/postCreate.sh"

  # Check for SECURITY NOTE comment
  if ! grep -A 30 "configure_codex_cli()" "$postCreate" | grep -q "SECURITY NOTE"; then
    echo "FAIL: No SECURITY NOTE in configure_codex_cli"
    return 1
  fi

  # Check for key security context
  local codex_section
  codex_section=$(grep -A 35 "configure_codex_cli()" "$postCreate")

  local missing=()

  echo "$codex_section" | grep -q "DevContainer" || missing+=("DevContainer mention")
  echo "$codex_section" | grep -q "isolated" || missing+=("isolation mention")
  echo "$codex_section" | grep -q "DO NOT" || missing+=("DO NOT warning")
  echo "$codex_section" | grep -q "production" || missing+=("production warning")
  echo "$codex_section" | grep -q "Threat model" || missing+=("threat model")
  echo "$codex_section" | grep -q "Security guarantees" || missing+=("security guarantees")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "FAIL: Missing security documentation elements: ${missing[*]}"
    return 1
  fi

  echo "PASS: Codex CLI has comprehensive security documentation"
  echo ""
}

# Test 3: Verify devcontainer isolation is documented
test_isolation_docs() {
  echo "Test 3: Verify devcontainer isolation guarantees are documented"

  local postCreate=".devcontainer/postCreate.sh"

  # Check for specific isolation guarantees
  local codex_section
  codex_section=$(grep -A 40 "configure_codex_cli()" "$postCreate")

  local missing=()

  echo "$codex_section" | grep -q "network" || missing+=("network isolation")
  echo "$codex_section" | grep -q "filesystem" || missing+=("filesystem isolation")
  echo "$codex_section" | grep -q "credentials" || missing+=("credentials protection")
  echo "$codex_section" | grep -q "host" || missing+=("host protection")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "FAIL: Missing isolation documentation: ${missing[*]}"
    return 1
  fi

  echo "PASS: Devcontainer isolation is well documented"
  echo ""
}

# Test 4: Verify production warnings exist
test_production_warnings() {
  echo "Test 4: Verify warnings about production use"

  local postCreate=".devcontainer/postCreate.sh"

  # Check Claude permissions
  if ! grep -A 15 "configure_claude_permissions()" "$postCreate" | grep -qE "(DO NOT.*production|production.*DO NOT)"; then
    echo "FAIL: No production warning in Claude permissions"
    return 1
  fi

  # Check Codex CLI
  if ! grep -A 35 "configure_codex_cli()" "$postCreate" | grep -qE "(DO NOT.*production|production.*DO NOT)"; then
    echo "FAIL: No production warning in Codex CLI"
    return 1
  fi

  # Check config file warning
  if ! grep -A 45 "configure_codex_cli()" "$postCreate" | grep -q "WARNING.*production"; then
    echo "FAIL: No WARNING in generated config file"
    return 1
  fi

  echo "PASS: Production warnings present in all locations"
  echo ""
}

# Test 5: Verify threat model is documented
test_threat_model() {
  echo "Test 5: Verify threat model is documented"

  local postCreate=".devcontainer/postCreate.sh"

  # Check for threat model section
  if ! grep -A 40 "configure_codex_cli()" "$postCreate" | grep -q "Threat model"; then
    echo "FAIL: No threat model documentation"
    return 1
  fi

  # Check for what it protects/doesn't protect
  local threat_section
  threat_section=$(grep -A 45 "configure_codex_cli()" "$postCreate")

  if ! echo "$threat_section" | grep -q "DOES"; then
    echo "FAIL: No positive security guarantees (DOES protect)"
    return 1
  fi

  if ! echo "$threat_section" | grep -qE "(DOES NOT|Does NOT)"; then
    echo "FAIL: No negative security boundaries (DOES NOT protect)"
    return 1
  fi

  echo "PASS: Threat model is documented"
  echo ""
}

# Test 6: Verify MCP terminal context is explained
test_mcp_context() {
  echo "Test 6: Verify MCP subprocess terminal context is explained"

  local postCreate=".devcontainer/postCreate.sh"

  # Check for MCP terminal explanation
  if ! grep -A 35 "configure_codex_cli()" "$postCreate" | grep -qE "MCP.*terminal"; then
    echo "FAIL: No explanation of MCP terminal context"
    return 1
  fi

  # Check in config file comments too
  if ! grep -A 45 "configure_codex_cli()" "$postCreate" | grep -qE "MCP.*terminal.*approval"; then
    echo "FAIL: No MCP explanation in config file"
    return 1
  fi

  echo "PASS: MCP terminal context is explained"
  echo ""
}

# Run all tests
all_tests_passed=true

test_claude_security_docs || all_tests_passed=false
test_codex_security_docs || all_tests_passed=false
test_isolation_docs || all_tests_passed=false
test_production_warnings || all_tests_passed=false
test_threat_model || all_tests_passed=false
test_mcp_context || all_tests_passed=false

echo "=== Test Summary ==="
if $all_tests_passed; then
  echo "All tests PASSED"
  exit 0
else
  echo "Some tests FAILED"
  exit 1
fi
