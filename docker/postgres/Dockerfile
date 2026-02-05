# syntax=docker/dockerfile:1
#
# openclaw-projects PostgreSQL Database Image
# Includes: pgvector, TimescaleDB, pg_cron, PostGIS
#

# Pin base image to specific version for reproducibility
FROM postgres:18-bookworm

# OCI Image Labels (templated via build args)
ARG OCI_TITLE="openclaw-projects-db"
ARG OCI_DESCRIPTION="PostgreSQL database with pgvector, TimescaleDB, pg_cron, and PostGIS extensions for openclaw-projects"
ARG OCI_VERSION="1.0.0"
ARG OCI_CREATED=""
ARG OCI_SOURCE="https://github.com/troykelly/openclaw-projects"
ARG OCI_URL="https://github.com/troykelly/openclaw-projects"
ARG OCI_REVISION=""
ARG OCI_LICENSES="MIT"
ARG OCI_AUTHORS="Troy Kelly <troy@aperim.com>"
ARG OCI_BASE_NAME="postgres:18-bookworm"

LABEL org.opencontainers.image.title="${OCI_TITLE}" \
      org.opencontainers.image.description="${OCI_DESCRIPTION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.created="${OCI_CREATED}" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.url="${OCI_URL}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.licenses="${OCI_LICENSES}" \
      org.opencontainers.image.authors="${OCI_AUTHORS}" \
      org.opencontainers.image.base.name="${OCI_BASE_NAME}"

# Install required extensions:
# - timescaledb (preload)
# - postgis
# - pg_cron (preload)
# - pgvector
RUN set -eux; \
    apt-get update; \
    # Install only necessary packages for adding repos
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        lsb-release; \
    \
    # Add PostgreSQL official repo
    echo "deb http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg; \
    \
    # Add TimescaleDB repo
    curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | gpg --dearmor -o /etc/apt/trusted.gpg.d/timescale.gpg; \
    echo "deb https://packagecloud.io/timescale/timescaledb/debian/ $(. /etc/os-release && echo $VERSION_CODENAME) main" > /etc/apt/sources.list.d/timescaledb.list; \
    \
    # Update and install extensions
    apt-get update; \
    apt-get install -y --no-install-recommends \
        postgresql-18-postgis-3 \
        postgresql-18-postgis-3-scripts \
        postgresql-18-cron \
        postgresql-18-pgvector \
        timescaledb-2-postgresql-18; \
    \
    # Clean up apt caches and unnecessary packages
    apt-get purge -y --auto-remove \
        curl \
        gnupg \
        lsb-release; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* \
           /tmp/* \
           /var/tmp/* \
           /var/cache/apt/archives/*

# Health check using pg_isready
# Check every 10 seconds, timeout after 5 seconds, start checking after 30 seconds
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" || exit 1

# Note: Do NOT add USER postgres here.
# The official postgres entrypoint needs to run as root initially to:
# 1. Set up data directory permissions on first run
# 2. Run initdb
# 3. Then switch to postgres user using gosu
# Adding USER postgres breaks first-run initialization.
