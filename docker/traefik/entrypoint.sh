#!/bin/sh
set -eu
# Enable pipefail if available (bash/zsh), ignore on POSIX sh
( set -o pipefail 2>/dev/null ) && set -o pipefail || true

# Traefik dynamic config entrypoint script
# Generates dynamic configuration from environment variables using envsubst
# then executes traefik with the generated config

# Directory paths
SYSTEM_CONFIG_DIR="/etc/traefik/dynamic/system"
CUSTOM_CONFIG_DIR="/etc/traefik/dynamic/custom"
ACME_DIR="/etc/traefik/acme"
ACME_FILE="${ACME_DIR}/acme.json"
TEMPLATE_FILE="/etc/traefik/templates/dynamic-config.yml.template"
OUTPUT_FILE="${SYSTEM_CONFIG_DIR}/config.yml"

# Required environment variables
: "${DOMAIN:=}"
: "${ACME_EMAIL:=}"

# Validate required environment variables
validate_env() {
    errors=""
    
    if [ -z "${DOMAIN}" ]; then
        errors="${errors}DOMAIN "
    fi
    
    if [ -z "${ACME_EMAIL}" ]; then
        errors="${errors}ACME_EMAIL "
    fi
    
    if [ -n "${errors}" ]; then
        echo "ERROR: Missing required environment variables: ${errors}" >&2
        echo "" >&2
        echo "Please set the following environment variables:" >&2
        echo "  DOMAIN      - The base domain (e.g., example.com)" >&2
        echo "  ACME_EMAIL  - Email for Let's Encrypt certificates" >&2
        exit 1
    fi
}

# Generate trusted IPs YAML list
generate_trusted_ips_yaml() {
    if [ -z "${TRUSTED_IPS:-}" ]; then
        echo ""
        return
    fi
    
    # Split by comma and format as YAML list
    echo "${TRUSTED_IPS}" | tr ',' '\n' | while read -r ip; do
        # Trim whitespace
        ip=$(echo "${ip}" | xargs)
        if [ -n "${ip}" ]; then
            echo "          - \"${ip}\""
        fi
    done
}

# Create required directories for dynamic configuration
create_directories() {
    # System config directory - managed by this script
    mkdir -p "${SYSTEM_CONFIG_DIR}"

    # Custom config directory - for user extensions
    # Users can bind-mount their own configs here via docker-compose.override.yml
    # Traefik watches this directory with file provider (watch: true)
    # Malformed YAML in custom/ won't break system routes in system/
    mkdir -p "${CUSTOM_CONFIG_DIR}"

    echo "Created config directories:"
    echo "  System: ${SYSTEM_CONFIG_DIR}"
    echo "  Custom: ${CUSTOM_CONFIG_DIR} (for user extensions)"
}

# Ensure ACME certificate storage is ready
# Traefik requires acme.json to exist with mode 600 (owner read/write only)
# to prevent accidental exposure of private keys
init_acme_storage() {
    if [ ! -f "${ACME_FILE}" ]; then
        touch "${ACME_FILE}"
        echo "Created ACME storage file at ${ACME_FILE}"
    fi

    chmod 600 "${ACME_FILE}"
    echo "ACME storage ready: ${ACME_FILE} (mode 600)"
}

# Generate the dynamic configuration from template
generate_config() {
    # Ensure output directories exist
    create_directories
    
    # Set defaults for optional variables
    export TRUSTED_IPS="${TRUSTED_IPS:-}"
    export DISABLE_HTTP="${DISABLE_HTTP:-false}"
    
    # Generate TRUSTED_IPS_YAML for template
    export TRUSTED_IPS_YAML
    TRUSTED_IPS_YAML=$(generate_trusted_ips_yaml)
    
    # Check if template exists
    if [ ! -f "${TEMPLATE_FILE}" ]; then
        echo "ERROR: Template file not found: ${TEMPLATE_FILE}" >&2
        exit 1
    fi
    
    # Generate config using envsubst
    # Only substitute explicitly defined variables for safety
    envsubst '${DOMAIN} ${ACME_EMAIL} ${TRUSTED_IPS} ${TRUSTED_IPS_YAML} ${DISABLE_HTTP}' \
        < "${TEMPLATE_FILE}" \
        > "${OUTPUT_FILE}"
    
    echo "Generated dynamic config at ${OUTPUT_FILE}"
}

# Main execution
main() {
    echo "Traefik entrypoint: Validating environment..."
    validate_env
    
    echo "Traefik entrypoint: Initializing ACME certificate storage..."
    init_acme_storage

    echo "Traefik entrypoint: Generating dynamic configuration..."
    generate_config

    echo "Traefik entrypoint: Starting Traefik..."
    exec traefik "$@"
}

main "$@"
