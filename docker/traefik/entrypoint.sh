#!/bin/sh
set -eu
# Enable pipefail if available (bash/zsh), ignore on POSIX sh
( set -o pipefail 2>/dev/null ) && set -o pipefail || true

# Traefik dynamic config entrypoint script
# Generates dynamic configuration from environment variables using sed
# then executes traefik with the generated config
#
# Note: traefik:3.x is Alpine-based and does not include envsubst (gettext).
# We use sed substitution instead, matching the pattern in seaweedfs/entrypoint.sh.

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
# to prevent accidental exposure of private keys.
#
# The container may run as non-root (Traefik 3.x uses UID 65532) while the
# host bind-mount directory is owned by root. We chown the directory and file
# to the running user so that chmod and Traefik's own writes succeed.
init_acme_storage() {
    # Determine running user/group
    CURRENT_UID=$(id -u)
    CURRENT_GID=$(id -g)

    # Fix ownership of the ACME directory if we have CHOWN capability
    if [ "$(stat -c '%u' "${ACME_DIR}" 2>/dev/null || echo unknown)" != "${CURRENT_UID}" ]; then
        if chown "${CURRENT_UID}:${CURRENT_GID}" "${ACME_DIR}" 2>/dev/null; then
            echo "Fixed ACME directory ownership to ${CURRENT_UID}:${CURRENT_GID}"
        else
            echo "WARNING: Could not chown ${ACME_DIR} — continuing anyway" >&2
        fi
    fi

    # Create the file if it doesn't exist
    if [ ! -f "${ACME_FILE}" ]; then
        touch "${ACME_FILE}"
        echo "Created ACME storage file at ${ACME_FILE}"
    fi

    # Fix ownership of the file if needed
    if [ "$(stat -c '%u' "${ACME_FILE}" 2>/dev/null || echo unknown)" != "${CURRENT_UID}" ]; then
        if chown "${CURRENT_UID}:${CURRENT_GID}" "${ACME_FILE}" 2>/dev/null; then
            echo "Fixed ACME file ownership to ${CURRENT_UID}:${CURRENT_GID}"
        else
            echo "WARNING: Could not chown ${ACME_FILE}" >&2
        fi
    fi

    # Set restrictive permissions (Traefik refuses to start without mode 600)
    if chmod 600 "${ACME_FILE}" 2>/dev/null; then
        echo "ACME storage ready: ${ACME_FILE} (mode 600)"
    else
        # Check if permissions are already correct
        CURRENT_PERMS=$(stat -c '%a' "${ACME_FILE}" 2>/dev/null || echo unknown)
        if [ "${CURRENT_PERMS}" = "600" ]; then
            echo "ACME storage ready: ${ACME_FILE} (already mode 600)"
        else
            echo "ERROR: Cannot set mode 600 on ${ACME_FILE} (current: ${CURRENT_PERMS})" >&2
            echo "  The container needs CHOWN and FOWNER capabilities to manage ACME storage." >&2
            echo "  Ensure cap_add includes CHOWN and FOWNER in docker-compose." >&2
            exit 1
        fi
    fi
}

# Sanitize DNS provider credentials
# Lego (Traefik's ACME library) checks CF_DNS_API_TOKEN first — if the env
# var exists, even as an empty string, lego uses scoped-token auth and
# ignores CF_API_KEY + CF_API_EMAIL entirely.  Unset empty credential vars
# so the fallback auth path works correctly.
# See: https://github.com/troykelly/openclaw-projects/issues/1095
sanitize_dns_credentials() {
    if [ -n "${CF_DNS_API_TOKEN+set}" ] && [ -z "${CF_DNS_API_TOKEN}" ]; then
        unset CF_DNS_API_TOKEN; echo "  Unset empty CF_DNS_API_TOKEN"
    fi
    if [ -n "${CF_API_KEY+set}" ] && [ -z "${CF_API_KEY}" ]; then
        unset CF_API_KEY; echo "  Unset empty CF_API_KEY"
    fi
    if [ -n "${CF_API_EMAIL+set}" ] && [ -z "${CF_API_EMAIL}" ]; then
        unset CF_API_EMAIL; echo "  Unset empty CF_API_EMAIL"
    fi
    if [ -n "${AWS_ACCESS_KEY_ID+set}" ] && [ -z "${AWS_ACCESS_KEY_ID}" ]; then
        unset AWS_ACCESS_KEY_ID; echo "  Unset empty AWS_ACCESS_KEY_ID"
    fi
    if [ -n "${AWS_SECRET_ACCESS_KEY+set}" ] && [ -z "${AWS_SECRET_ACCESS_KEY}" ]; then
        unset AWS_SECRET_ACCESS_KEY; echo "  Unset empty AWS_SECRET_ACCESS_KEY"
    fi
    if [ -n "${AWS_HOSTED_ZONE_ID+set}" ] && [ -z "${AWS_HOSTED_ZONE_ID}" ]; then
        unset AWS_HOSTED_ZONE_ID; echo "  Unset empty AWS_HOSTED_ZONE_ID"
    fi
    if [ -n "${AWS_REGION+set}" ] && [ -z "${AWS_REGION}" ]; then
        unset AWS_REGION; echo "  Unset empty AWS_REGION"
    fi
}

# Generate the dynamic configuration from template
generate_config() {
    # Ensure output directories exist
    create_directories
    
    # Set defaults for optional variables
    export TRUSTED_IPS="${TRUSTED_IPS:-}"
    export DISABLE_HTTP="${DISABLE_HTTP:-false}"

    # Host networking defaults for service routing
    # Traefik runs with network_mode: host and reaches services via localhost
    # SERVICE_HOST: address Traefik uses to reach backend services (default: 127.0.0.1)
    # Set to [::1] for IPv6-only or a specific interface address if needed
    export SERVICE_HOST="${SERVICE_HOST:-127.0.0.1}"
    export MODSEC_HOST_PORT="${MODSEC_HOST_PORT:-8080}"
    export API_HOST_PORT="${API_HOST_PORT:-3001}"
    export APP_HOST_PORT="${APP_HOST_PORT:-8081}"
    export GATEWAY_HOST_PORT="${GATEWAY_HOST_PORT:-18789}"
    
    # Generate TRUSTED_IPS_YAML for template
    export TRUSTED_IPS_YAML
    TRUSTED_IPS_YAML=$(generate_trusted_ips_yaml)
    
    # Check if template exists
    if [ ! -f "${TEMPLATE_FILE}" ]; then
        echo "ERROR: Template file not found: ${TEMPLATE_FILE}" >&2
        exit 1
    fi
    
    # Generate config using sed substitution
    # traefik:3.x is Alpine-based and does not include envsubst (gettext)
    # Escape sed-special characters in values to prevent injection
    escape_sed() { printf '%s\n' "$1" | sed 's/[&/\|]/\\&/g'; }

    sed \
        -e "s|\${DOMAIN}|$(escape_sed "${DOMAIN}")|g" \
        -e "s|\${ACME_EMAIL}|$(escape_sed "${ACME_EMAIL}")|g" \
        -e "s|\${TRUSTED_IPS}|$(escape_sed "${TRUSTED_IPS}")|g" \
        -e "s|\${DISABLE_HTTP}|$(escape_sed "${DISABLE_HTTP}")|g" \
        -e "s|\${SERVICE_HOST}|$(escape_sed "${SERVICE_HOST}")|g" \
        -e "s|\${MODSEC_HOST_PORT}|$(escape_sed "${MODSEC_HOST_PORT}")|g" \
        -e "s|\${API_HOST_PORT}|$(escape_sed "${API_HOST_PORT}")|g" \
        -e "s|\${APP_HOST_PORT}|$(escape_sed "${APP_HOST_PORT}")|g" \
        -e "s|\${GATEWAY_HOST_PORT}|$(escape_sed "${GATEWAY_HOST_PORT}")|g" \
        < "${TEMPLATE_FILE}" \
        > "${OUTPUT_FILE}"

    # TRUSTED_IPS_YAML may be multiline; sed can't handle that inline.
    # If set, replace the placeholder line using awk.
    if [ -n "${TRUSTED_IPS_YAML}" ]; then
        awk -v yaml="${TRUSTED_IPS_YAML}" '{gsub(/\$\{TRUSTED_IPS_YAML\}/, yaml); print}' \
            "${OUTPUT_FILE}" > "${OUTPUT_FILE}.tmp" && mv "${OUTPUT_FILE}.tmp" "${OUTPUT_FILE}"
    else
        # shellcheck disable=SC2016
        sed 's|\${TRUSTED_IPS_YAML}||g' "${OUTPUT_FILE}" > "${OUTPUT_FILE}.tmp" && mv "${OUTPUT_FILE}.tmp" "${OUTPUT_FILE}"
    fi
    
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

    echo "Traefik entrypoint: Sanitizing DNS credentials..."
    sanitize_dns_credentials

    echo "Traefik entrypoint: Starting Traefik..."
    exec traefik "$@"
}

main "$@"
