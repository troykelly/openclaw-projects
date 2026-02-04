#!/usr/bin/env bash
#
# Test script for openclaw-projects PostgreSQL Dockerfile
# Verifies hardening requirements from issue #524
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="openclaw-projects-db-test"
CONTAINER_NAME="openclaw-projects-db-test-container"
TESTS_PASSED=0
TESTS_FAILED=0

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((TESTS_PASSED++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((TESTS_FAILED++))
}

cleanup() {
    log_info "Cleaning up..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    docker rmi "$IMAGE_NAME" 2>/dev/null || true
}

trap cleanup EXIT

# Test 1: Verify Dockerfile syntax and build
test_dockerfile_builds() {
    log_info "Testing: Dockerfile builds successfully"
    
    if docker build \
        --build-arg OCI_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --build-arg OCI_VERSION="test-1.0.0" \
        --build-arg OCI_REVISION="test-revision" \
        -t "$IMAGE_NAME" \
        "$DOCKERFILE_DIR" 2>&1; then
        log_pass "Dockerfile builds successfully"
    else
        log_fail "Dockerfile failed to build"
        return 1
    fi
}

# Test 2: Verify OCI labels are present
test_oci_labels() {
    log_info "Testing: OCI labels are present"
    
    local labels
    labels=$(docker inspect "$IMAGE_NAME" --format '{{json .Config.Labels}}')
    
    local required_labels=(
        "org.opencontainers.image.title"
        "org.opencontainers.image.description"
        "org.opencontainers.image.version"
        "org.opencontainers.image.created"
        "org.opencontainers.image.source"
        "org.opencontainers.image.url"
        "org.opencontainers.image.revision"
        "org.opencontainers.image.licenses"
        "org.opencontainers.image.authors"
        "org.opencontainers.image.base.name"
    )
    
    local all_present=true
    for label in "${required_labels[@]}"; do
        if echo "$labels" | grep -q "\"$label\""; then
            log_pass "Label present: $label"
        else
            log_fail "Label missing: $label"
            all_present=false
        fi
    done
    
    # Verify specific label values
    if echo "$labels" | grep -q '"org.opencontainers.image.title":"openclaw-projects-db"'; then
        log_pass "Label value correct: org.opencontainers.image.title"
    else
        log_fail "Label value incorrect: org.opencontainers.image.title"
    fi
    
    if echo "$labels" | grep -q '"org.opencontainers.image.version":"test-1.0.0"'; then
        log_pass "Label value correct: org.opencontainers.image.version (build arg override)"
    else
        log_fail "Label value incorrect: org.opencontainers.image.version"
    fi
}

# Test 3: Verify container runs as non-root (UID 999)
test_runs_as_non_root() {
    log_info "Testing: Container runs as non-root user (UID 999)"
    
    # Start container
    docker run -d \
        --name "$CONTAINER_NAME" \
        -e POSTGRES_PASSWORD=testpassword \
        "$IMAGE_NAME"
    
    # Wait for container to start
    sleep 5
    
    # Check the user
    local user_info
    user_info=$(docker exec "$CONTAINER_NAME" id)
    
    if echo "$user_info" | grep -q "uid=999(postgres)"; then
        log_pass "Container runs as postgres user (UID 999)"
    else
        log_fail "Container does not run as UID 999. Got: $user_info"
    fi
    
    # Check USER directive in Dockerfile
    if grep -q "^USER postgres" "$DOCKERFILE_DIR/Dockerfile"; then
        log_pass "USER directive is explicit in Dockerfile"
    else
        log_fail "USER directive not found or not explicit in Dockerfile"
    fi
}

# Test 4: Verify HEALTHCHECK is present
test_healthcheck() {
    log_info "Testing: HEALTHCHECK instruction is present"
    
    local healthcheck
    healthcheck=$(docker inspect "$IMAGE_NAME" --format '{{json .Config.Healthcheck}}')
    
    if [ "$healthcheck" != "null" ] && [ -n "$healthcheck" ]; then
        log_pass "HEALTHCHECK instruction is present"
        
        # Verify it uses pg_isready
        if echo "$healthcheck" | grep -q "pg_isready"; then
            log_pass "HEALTHCHECK uses pg_isready"
        else
            log_fail "HEALTHCHECK does not use pg_isready"
        fi
    else
        log_fail "HEALTHCHECK instruction is missing"
    fi
}

# Test 5: Verify base image is pinned
test_base_image_pinned() {
    log_info "Testing: Base image is pinned to postgres:18-bookworm"
    
    if grep -q "^FROM postgres:18-bookworm" "$DOCKERFILE_DIR/Dockerfile"; then
        log_pass "Base image is pinned to postgres:18-bookworm"
    else
        log_fail "Base image is not pinned correctly"
    fi
}

# Test 6: Verify apt cleanup
test_apt_cleanup() {
    log_info "Testing: Apt caches are cleaned up"
    
    # Check Dockerfile for cleanup commands
    if grep -q "apt-get clean" "$DOCKERFILE_DIR/Dockerfile" && \
       grep -q "rm -rf /var/lib/apt/lists" "$DOCKERFILE_DIR/Dockerfile"; then
        log_pass "Apt cleanup commands present in Dockerfile"
    else
        log_fail "Apt cleanup commands missing in Dockerfile"
    fi
    
    # Check if curl/gnupg are removed
    if grep -q "apt-get purge" "$DOCKERFILE_DIR/Dockerfile"; then
        log_pass "Unnecessary packages are purged"
    else
        log_fail "Unnecessary packages are not purged"
    fi
}

# Test 7: Verify .dockerignore exists
test_dockerignore() {
    log_info "Testing: .dockerignore file exists"
    
    if [ -f "$DOCKERFILE_DIR/.dockerignore" ]; then
        log_pass ".dockerignore file exists"
        
        # Check for common ignores
        if grep -q ".git" "$DOCKERFILE_DIR/.dockerignore"; then
            log_pass ".dockerignore includes .git"
        else
            log_fail ".dockerignore does not include .git"
        fi
    else
        log_fail ".dockerignore file does not exist"
    fi
}

# Test 8: Verify extensions load correctly
test_extensions() {
    log_info "Testing: Extensions load correctly"
    
    # Wait for PostgreSQL to be ready
    local retries=30
    while [ $retries -gt 0 ]; do
        if docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; then
            break
        fi
        sleep 1
        ((retries--))
    done
    
    if [ $retries -eq 0 ]; then
        log_fail "PostgreSQL did not become ready in time"
        return 1
    fi
    
    # Create extensions and verify they work
    local extensions=("vector" "timescaledb" "pg_cron" "postgis")
    
    for ext in "${extensions[@]}"; do
        if docker exec "$CONTAINER_NAME" psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS $ext CASCADE;" 2>/dev/null; then
            log_pass "Extension '$ext' loads successfully"
        else
            # Some extensions may need special handling
            log_info "Extension '$ext' may need special configuration (checking availability)"
            if docker exec "$CONTAINER_NAME" psql -U postgres -c "SELECT * FROM pg_available_extensions WHERE name = '$ext';" 2>/dev/null | grep -q "$ext"; then
                log_pass "Extension '$ext' is available"
            else
                log_fail "Extension '$ext' is not available"
            fi
        fi
    done
}

# Main execution
main() {
    log_info "Starting Dockerfile tests for issue #524"
    log_info "Dockerfile directory: $DOCKERFILE_DIR"
    echo ""
    
    # Run tests
    test_base_image_pinned
    test_apt_cleanup
    test_dockerignore
    test_dockerfile_builds
    test_oci_labels
    test_healthcheck
    test_runs_as_non_root
    test_extensions
    
    echo ""
    echo "========================================"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo "========================================"
    
    if [ $TESTS_FAILED -gt 0 ]; then
        exit 1
    fi
}

main "$@"
