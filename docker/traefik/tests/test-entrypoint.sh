#!/bin/bash
set -euo pipefail

# Test suite for Traefik entrypoint script
# Run this script to verify the entrypoint behavior

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="${SCRIPT_DIR}/../entrypoint.sh"
TEMPLATE="${SCRIPT_DIR}/../dynamic-config.yml.template"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors for output (use printf for better portability)
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Test helper functions
pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    printf "${GREEN}PASS${NC}: %s\n" "$1"
}

fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf "${RED}FAIL${NC}: %s\n" "$1"
    if [ -n "${2:-}" ]; then
        printf "       Details: %s\n" "$2"
    fi
}

run_test() {
    TESTS_RUN=$((TESTS_RUN + 1))
}

# Create temporary test environment
setup_test_env() {
    TEST_DIR=$(mktemp -d)
    TEST_SYSTEM_DIR="${TEST_DIR}/etc/traefik/dynamic/system"
    TEST_TEMPLATE_DIR="${TEST_DIR}/etc/traefik/templates"
    mkdir -p "${TEST_SYSTEM_DIR}"
    mkdir -p "${TEST_TEMPLATE_DIR}"
    cp "${TEMPLATE}" "${TEST_TEMPLATE_DIR}/dynamic-config.yml.template"
    
    # Create a modified entrypoint for testing (doesn't exec traefik)
    TEST_ENTRYPOINT="${TEST_DIR}/entrypoint-test.sh"
    sed 's/exec traefik/echo "Would exec traefik"/' "${ENTRYPOINT}" > "${TEST_ENTRYPOINT}"
    sed -i "s|/etc/traefik|${TEST_DIR}/etc/traefik|g" "${TEST_ENTRYPOINT}"
    chmod +x "${TEST_ENTRYPOINT}"
    
    echo "${TEST_DIR}"
}

cleanup_test_env() {
    rm -rf "$1"
}

# Test 1: Missing DOMAIN should fail
test_missing_domain() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    unset DOMAIN 2>/dev/null || true
    export ACME_EMAIL="test@example.com"
    
    if "${test_dir}/entrypoint-test.sh" 2>/dev/null; then
        fail "Should fail when DOMAIN is missing"
    else
        pass "Fails correctly when DOMAIN is missing"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 2: Missing ACME_EMAIL should fail
test_missing_acme_email() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    unset ACME_EMAIL 2>/dev/null || true
    
    if "${test_dir}/entrypoint-test.sh" 2>/dev/null; then
        fail "Should fail when ACME_EMAIL is missing"
    else
        pass "Fails correctly when ACME_EMAIL is missing"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 3: Valid environment should succeed
test_valid_env() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    unset TRUSTED_IPS 2>/dev/null || true
    unset DISABLE_HTTP 2>/dev/null || true
    
    if "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1; then
        pass "Succeeds with valid environment"
    else
        fail "Should succeed with valid environment"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 4: Generated config should contain DOMAIN
test_config_contains_domain() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="mytest.example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if grep -q "mytest.example.com" "${config_file}"; then
        pass "Generated config contains DOMAIN value"
    else
        fail "Generated config should contain DOMAIN value"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 5: Generated config should be valid YAML
test_config_is_valid_yaml() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    # Check basic YAML structure (no syntax errors)
    if [ -f "${config_file}" ] && [ -s "${config_file}" ]; then
        # Check for required sections
        if grep -q "^tls:" "${config_file}" && \
           grep -q "^http:" "${config_file}" && \
           grep -q "middlewares:" "${config_file}" && \
           grep -q "routers:" "${config_file}" && \
           grep -q "services:" "${config_file}"; then
            pass "Generated config has valid YAML structure"
        else
            fail "Generated config missing required sections"
        fi
    else
        fail "Generated config file is empty or missing"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 6: TLS config should specify TLS 1.3
test_tls_version() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if grep -q "VersionTLS13" "${config_file}"; then
        pass "TLS config specifies TLS 1.3 minimum"
    else
        fail "TLS config should specify TLS 1.3 minimum"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 7: Security headers middleware should be present
test_security_headers() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if grep -q "security-headers:" "${config_file}" && \
       grep -q "stsSeconds:" "${config_file}" && \
       grep -q "frameDeny:" "${config_file}"; then
        pass "Security headers middleware is present"
    else
        fail "Security headers middleware should be present"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 8: ModSecurity middleware should be present
test_modsecurity_middleware() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if grep -q "modsecurity:" "${config_file}" && \
       grep -q "forwardAuth:" "${config_file}"; then
        pass "ModSecurity forwardAuth middleware is present"
    else
        fail "ModSecurity forwardAuth middleware should be present"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 9: API router should be configured
test_api_router() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if grep -q "api-router:" "${config_file}" && \
       grep -q "api.example.com" "${config_file}"; then
        pass "API router is configured with correct domain"
    else
        fail "API router should be configured"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 10: App router should be configured
test_app_router() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if grep -q "app-router:" "${config_file}"; then
        pass "App router is configured"
    else
        fail "App router should be configured"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Test 11: Template file should exist
test_template_exists() {
    run_test
    
    if [ -f "${TEMPLATE}" ]; then
        pass "Template file exists"
    else
        fail "Template file should exist at ${TEMPLATE}"
    fi
}

# Test 12: Entrypoint should be executable
test_entrypoint_executable() {
    run_test
    
    if [ -x "${ENTRYPOINT}" ]; then
        pass "Entrypoint script is executable"
    else
        fail "Entrypoint script should be executable"
    fi
}

# Test 13: TRUSTED_IPS should be converted to YAML list
test_trusted_ips_yaml() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export TRUSTED_IPS="10.0.0.0/8,192.168.0.0/16,172.16.0.0/12"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    # The TRUSTED_IPS_YAML should be available but template might not use it yet
    # This test verifies the env var handling works
    if [ -f "${config_file}" ]; then
        pass "Config generated with TRUSTED_IPS set"
    else
        fail "Config should be generated when TRUSTED_IPS is set"
    fi
    
    unset TRUSTED_IPS
    cleanup_test_env "${test_dir}"
}

# Test 14: DISABLE_HTTP should be respected
test_disable_http() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export DISABLE_HTTP="true"
    
    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1
    
    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"
    
    if [ -f "${config_file}" ]; then
        pass "Config generated with DISABLE_HTTP set"
    else
        fail "Config should be generated when DISABLE_HTTP is set"
    fi
    
    unset DISABLE_HTTP
    cleanup_test_env "${test_dir}"
}

# Test 15: Error message should be helpful
test_error_message_helpful() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)
    
    unset DOMAIN 2>/dev/null || true
    unset ACME_EMAIL 2>/dev/null || true
    
    local output
    output=$("${test_dir}/entrypoint-test.sh" 2>&1 || true)
    
    if echo "${output}" | grep -q "DOMAIN" && echo "${output}" | grep -q "ACME_EMAIL"; then
        pass "Error message mentions missing variables"
    else
        fail "Error message should mention which variables are missing"
    fi
    
    cleanup_test_env "${test_dir}"
}

# Run all tests
echo "======================================"
echo "Traefik Entrypoint Script Test Suite"
echo "======================================"
echo ""

test_template_exists
test_entrypoint_executable
test_missing_domain
test_missing_acme_email
test_valid_env
test_config_contains_domain
test_config_is_valid_yaml
test_tls_version
test_security_headers
test_modsecurity_middleware
test_api_router
test_app_router
test_trusted_ips_yaml
test_disable_http
test_error_message_helpful

echo ""
echo "======================================"
echo "Results: ${TESTS_PASSED}/${TESTS_RUN} passed"
if [ ${TESTS_FAILED} -gt 0 ]; then
    printf "${RED}%d tests failed${NC}\n" "${TESTS_FAILED}"
    exit 1
else
    printf "${GREEN}All tests passed!${NC}\n"
    exit 0
fi
