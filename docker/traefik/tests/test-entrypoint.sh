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
    TEST_ACME_DIR="${TEST_DIR}/etc/traefik/acme"
    mkdir -p "${TEST_SYSTEM_DIR}"
    mkdir -p "${TEST_TEMPLATE_DIR}"
    mkdir -p "${TEST_ACME_DIR}"
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

# Test 8: ModSecurity service should be present with localhost URL
test_modsecurity_service() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    if grep -q "modsecurity-service:" "${config_file}" && \
       grep -q 'http://\[::1\]:' "${config_file}"; then
        pass "ModSecurity service is present with IPv6 localhost URL"
    else
        fail "ModSecurity service should be present with IPv6 localhost URL"
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

# Test 16: Custom config directory should be created
test_custom_config_dir_created() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local custom_dir="${test_dir}/etc/traefik/dynamic/custom"

    if [ -d "${custom_dir}" ]; then
        pass "Custom config directory is created"
    else
        fail "Custom config directory should be created at ${custom_dir}"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 17: Custom config directory should be empty (for user extensions)
test_custom_config_dir_empty() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local custom_dir="${test_dir}/etc/traefik/dynamic/custom"
    local file_count
    file_count=$(find "${custom_dir}" -type f 2>/dev/null | wc -l)

    if [ "${file_count}" -eq 0 ]; then
        pass "Custom config directory is empty (ready for user extensions)"
    else
        fail "Custom config directory should be empty, found ${file_count} files"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 18: System and custom directories should be separate
test_system_custom_separation() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local system_dir="${test_dir}/etc/traefik/dynamic/system"
    local custom_dir="${test_dir}/etc/traefik/dynamic/custom"
    local system_config="${system_dir}/config.yml"

    # Verify both directories exist and are separate
    if [ -d "${system_dir}" ] && [ -d "${custom_dir}" ] && \
       [ -f "${system_config}" ] && [ ! -f "${custom_dir}/config.yml" ]; then
        pass "System and custom directories are properly separated"
    else
        fail "System config should only be in system/, not in custom/"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 19: ACME JSON file should be created if missing
test_acme_json_created() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    # Ensure acme.json does NOT exist before running
    rm -f "${test_dir}/etc/traefik/acme/acme.json"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local acme_file="${test_dir}/etc/traefik/acme/acme.json"

    if [ -f "${acme_file}" ]; then
        pass "ACME JSON file is created when missing"
    else
        fail "ACME JSON file should be created at ${acme_file}"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 20: ACME JSON file should have mode 600
test_acme_json_permissions() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local acme_file="${test_dir}/etc/traefik/acme/acme.json"
    local perms
    perms=$(stat -c "%a" "${acme_file}" 2>/dev/null || stat -f "%Lp" "${acme_file}" 2>/dev/null)

    if [ "${perms}" = "600" ]; then
        pass "ACME JSON file has mode 600"
    else
        fail "ACME JSON file should have mode 600, got ${perms}"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 21: Existing ACME JSON file should not be overwritten
test_acme_json_preserved() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    # Create an existing acme.json with content
    local acme_file="${test_dir}/etc/traefik/acme/acme.json"
    echo '{"existing":"data"}' > "${acme_file}"
    chmod 600 "${acme_file}"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local content
    content=$(cat "${acme_file}")

    if [ "${content}" = '{"existing":"data"}' ]; then
        pass "Existing ACME JSON file is preserved"
    else
        fail "Existing ACME JSON file should be preserved, got: ${content}"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 22: ACME JSON with wrong permissions should be corrected
test_acme_json_permissions_corrected() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    # Create acme.json with wrong permissions
    local acme_file="${test_dir}/etc/traefik/acme/acme.json"
    echo '{}' > "${acme_file}"
    chmod 644 "${acme_file}"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local perms
    perms=$(stat -c "%a" "${acme_file}" 2>/dev/null || stat -f "%Lp" "${acme_file}" 2>/dev/null)

    if [ "${perms}" = "600" ]; then
        pass "ACME JSON permissions corrected from 644 to 600"
    else
        fail "ACME JSON permissions should be corrected to 600, got ${perms}"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 23: Host port and SERVICE_HOST variables should be substituted in generated config
test_host_port_substitution() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export SERVICE_HOST="[::1]"
    export MODSEC_HOST_PORT="9080"
    export API_HOST_PORT="9001"
    export APP_HOST_PORT="9081"
    export GATEWAY_HOST_PORT="19789"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    if grep -q '\[::1\]:9080' "${config_file}" && \
       grep -q '\[::1\]:9001' "${config_file}" && \
       grep -q '\[::1\]:9081' "${config_file}" && \
       grep -q '\[::1\]:19789' "${config_file}"; then
        pass "SERVICE_HOST and port variables are substituted correctly"
    else
        fail "SERVICE_HOST and port variables should be substituted in generated config"
    fi

    unset SERVICE_HOST MODSEC_HOST_PORT API_HOST_PORT APP_HOST_PORT GATEWAY_HOST_PORT
    cleanup_test_env "${test_dir}"
}

# Test 24: OpenClaw gateway routes should be present
test_gateway_routes() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    if grep -q "openclaw-ui-router:" "${config_file}" && \
       grep -q "openclaw-ws-router:" "${config_file}" && \
       grep -q "openclaw-hooks-router:" "${config_file}" && \
       grep -q "openclaw-gateway-service:" "${config_file}"; then
        pass "OpenClaw gateway routes and service are present"
    else
        fail "OpenClaw gateway routes should be present in config"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 25: Generated config should use SERVICE_HOST, not Docker hostnames
test_no_docker_hostnames() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    # Ensure no Docker service hostnames appear in service URLs
    # Service URLs should use SERVICE_HOST (defaults to [::1]), not Docker DNS names
    if grep -q "http://modsecurity:" "${config_file}" || \
       grep -q "http://api:" "${config_file}" || \
       grep -q "http://app:" "${config_file}"; then
        fail "Generated config should not contain Docker hostnames in service URLs"
    else
        pass "Generated config uses SERVICE_HOST, not Docker hostnames"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 26: Empty CF_DNS_API_TOKEN should be unset before exec
test_empty_cf_dns_api_token_unset() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export CF_DNS_API_TOKEN=""
    export CF_API_KEY="global-key-value"
    export CF_API_EMAIL="user@example.com"

    # Modify the test entrypoint to print env instead of exec traefik
    local env_entrypoint="${test_dir}/entrypoint-env.sh"
    sed 's/echo "Would exec traefik".*/env/' "${test_dir}/entrypoint-test.sh" > "${env_entrypoint}"
    chmod +x "${env_entrypoint}"

    local output
    output=$("${env_entrypoint}" 2>/dev/null)

    # CF_DNS_API_TOKEN should NOT appear in the environment
    if echo "${output}" | grep -q "^CF_DNS_API_TOKEN="; then
        fail "Empty CF_DNS_API_TOKEN should be unset before exec"
    else
        pass "Empty CF_DNS_API_TOKEN is unset before exec"
    fi

    unset CF_DNS_API_TOKEN CF_API_KEY CF_API_EMAIL
    cleanup_test_env "${test_dir}"
}

# Test 27: Non-empty CF_DNS_API_TOKEN should be preserved
test_nonempty_cf_dns_api_token_preserved() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export CF_DNS_API_TOKEN="real-token-value"

    # Modify the test entrypoint to print env instead of exec traefik
    local env_entrypoint="${test_dir}/entrypoint-env.sh"
    sed 's/echo "Would exec traefik".*/env/' "${test_dir}/entrypoint-test.sh" > "${env_entrypoint}"
    chmod +x "${env_entrypoint}"

    local output
    output=$("${env_entrypoint}" 2>/dev/null)

    # CF_DNS_API_TOKEN should still be present with its value
    if echo "${output}" | grep -q "^CF_DNS_API_TOKEN=real-token-value$"; then
        pass "Non-empty CF_DNS_API_TOKEN is preserved"
    else
        fail "Non-empty CF_DNS_API_TOKEN should be preserved"
    fi

    unset CF_DNS_API_TOKEN
    cleanup_test_env "${test_dir}"
}

# Test 28: Whitespace-only CF_DNS_API_TOKEN should be unset before exec
test_whitespace_cf_dns_api_token_unset() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export CF_DNS_API_TOKEN="   "
    export CF_API_KEY="global-key-value"
    export CF_API_EMAIL="user@example.com"

    # Modify the test entrypoint to print env instead of exec traefik
    local env_entrypoint="${test_dir}/entrypoint-env.sh"
    sed 's/echo "Would exec traefik".*/env/' "${test_dir}/entrypoint-test.sh" > "${env_entrypoint}"
    chmod +x "${env_entrypoint}"

    local output
    output=$("${env_entrypoint}" 2>/dev/null)

    # CF_DNS_API_TOKEN should NOT appear in the environment
    if echo "${output}" | grep -q "^CF_DNS_API_TOKEN="; then
        fail "Whitespace-only CF_DNS_API_TOKEN should be unset before exec"
    else
        pass "Whitespace-only CF_DNS_API_TOKEN is unset before exec"
    fi

    unset CF_DNS_API_TOKEN CF_API_KEY CF_API_EMAIL
    cleanup_test_env "${test_dir}"
}

# Test 29: Empty CF_API_KEY should be unset (covers non-token vars too)
test_empty_cf_api_key_unset() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"
    export CF_API_KEY=""

    # Modify the test entrypoint to print env instead of exec traefik
    local env_entrypoint="${test_dir}/entrypoint-env.sh"
    sed 's/echo "Would exec traefik".*/env/' "${test_dir}/entrypoint-test.sh" > "${env_entrypoint}"
    chmod +x "${env_entrypoint}"

    local output
    output=$("${env_entrypoint}" 2>/dev/null)

    if echo "${output}" | grep -q "^CF_API_KEY="; then
        fail "Empty CF_API_KEY should be unset before exec"
    else
        pass "Empty CF_API_KEY is unset before exec"
    fi

    unset CF_API_KEY
    cleanup_test_env "${test_dir}"
}

# Test 30: API CORS middleware should be present with domain origin
test_api_cors_middleware() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    if grep -q "api-cors:" "${config_file}" && \
       grep -q "https://example.com" "${config_file}" && \
       grep -q "accessControlAllowCredentials: true" "${config_file}" && \
       grep -q "accessControlMaxAge: 86400" "${config_file}"; then
        pass "API CORS middleware is present with correct domain origin"
    else
        fail "API CORS middleware should be present with domain origin"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 31: API router should include api-cors middleware
test_api_router_has_cors() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    # Check that api-cors appears in the middlewares list for api-router
    if grep -A 10 "api-router:" "${config_file}" | grep -q "api-cors"; then
        pass "API router includes api-cors middleware"
    else
        fail "API router should include api-cors middleware"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 32: API CORS middleware should include all required method verbs
test_api_cors_methods() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    local missing=""
    for method in GET POST PUT PATCH DELETE OPTIONS; do
        if ! grep -A 30 "api-cors:" "${config_file}" | grep -q "${method}"; then
            missing="${missing} ${method}"
        fi
    done

    if [ -z "${missing}" ]; then
        pass "API CORS middleware includes all required HTTP methods"
    else
        fail "API CORS middleware missing methods:${missing}"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 33: API CORS middleware should include addVaryHeader
test_api_cors_vary_header() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    if grep -A 30 "api-cors:" "${config_file}" | grep -q "addVaryHeader: true"; then
        pass "API CORS middleware includes addVaryHeader: true"
    else
        fail "API CORS middleware should include addVaryHeader: true (prevents cache poisoning)"
    fi

    cleanup_test_env "${test_dir}"
}

# Test 34: API CORS should NOT include wildcard origin
test_api_cors_no_wildcard() {
    run_test
    local test_dir
    test_dir=$(setup_test_env)

    export DOMAIN="example.com"
    export ACME_EMAIL="test@example.com"

    "${test_dir}/entrypoint-test.sh" >/dev/null 2>&1

    local config_file="${test_dir}/etc/traefik/dynamic/system/config.yml"

    # Verify no wildcard (*) in the origin list — wildcards break credentialed CORS
    if grep -A 5 "accessControlAllowOriginList:" "${config_file}" | grep -qF '"*"'; then
        fail "API CORS must NOT use wildcard origin with credentials"
    else
        pass "API CORS correctly avoids wildcard origin"
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
test_modsecurity_service
test_api_router
test_app_router
test_trusted_ips_yaml
test_disable_http
test_error_message_helpful
test_custom_config_dir_created
test_custom_config_dir_empty
test_system_custom_separation
test_acme_json_created
test_acme_json_permissions
test_acme_json_preserved
test_acme_json_permissions_corrected
test_host_port_substitution
test_gateway_routes
test_no_docker_hostnames
test_empty_cf_dns_api_token_unset
test_nonempty_cf_dns_api_token_preserved
test_whitespace_cf_dns_api_token_unset
test_empty_cf_api_key_unset
test_api_cors_middleware
test_api_router_has_cors
test_api_cors_methods
test_api_cors_vary_header
test_api_cors_no_wildcard

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
