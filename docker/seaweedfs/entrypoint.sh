#!/bin/sh
set -eu

# SeaweedFS entrypoint script for S3 authentication
# Generates S3 config from environment variables using shell substitution
# then starts SeaweedFS with the generated config

# Configuration paths
TEMPLATE_FILE="/etc/seaweedfs/s3.json.template"
OUTPUT_FILE="/tmp/s3.json"

# Validate required environment variables
validate_env() {
    errors=""

    if [ -z "${S3_ACCESS_KEY:-}" ]; then
        errors="${errors}S3_ACCESS_KEY "
    fi

    if [ -z "${S3_SECRET_KEY:-}" ]; then
        errors="${errors}S3_SECRET_KEY "
    fi

    if [ -n "${errors}" ]; then
        echo "ERROR: Missing required environment variables: ${errors}" >&2
        echo "" >&2
        echo "Please set the following environment variables:" >&2
        echo "  S3_ACCESS_KEY  - Access key for S3 authentication" >&2
        echo "  S3_SECRET_KEY  - Secret key for S3 authentication" >&2
        exit 1
    fi
}

# Generate the S3 configuration from template using shell substitution
# Note: SeaweedFS image is Alpine-based and doesn't have envsubst
generate_config() {
    # Check if template exists
    if [ ! -f "${TEMPLATE_FILE}" ]; then
        echo "ERROR: Template file not found: ${TEMPLATE_FILE}" >&2
        exit 1
    fi

    # Generate config using sed substitution
    # We escape special characters in secrets for sed safety
    access_key_escaped=$(printf '%s\n' "${S3_ACCESS_KEY}" | sed 's/[&/\]/\\&/g')
    secret_key_escaped=$(printf '%s\n' "${S3_SECRET_KEY}" | sed 's/[&/\]/\\&/g')

    sed -e "s/\${S3_ACCESS_KEY}/${access_key_escaped}/g" \
        -e "s/\${S3_SECRET_KEY}/${secret_key_escaped}/g" \
        < "${TEMPLATE_FILE}" \
        > "${OUTPUT_FILE}"

    echo "Generated S3 config at ${OUTPUT_FILE}"
}

# Main execution
main() {
    echo "SeaweedFS entrypoint: Validating environment..."
    validate_env

    echo "SeaweedFS entrypoint: Generating S3 configuration..."
    generate_config

    echo "SeaweedFS entrypoint: Starting SeaweedFS..."
    exec weed server -s3 -s3.port=8333 -s3.config="${OUTPUT_FILE}" \
        -ip.bind=0.0.0.0 \
        -master.volumeSizeLimitMB="${SEAWEEDFS_VOLUME_SIZE_LIMIT_MB:-1000}" \
        -volume.max="${SEAWEEDFS_VOLUME_MAX:-10}" \
        -dir=/data
}

main "$@"
