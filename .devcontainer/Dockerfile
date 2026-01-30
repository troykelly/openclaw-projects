FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Base tooling required for this repo + for installing claude/codex/op inside the container.
# Note: rust-analyzer isn't available from the default apt sources in this base image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    gnupg \
    unzip \
    gzip \
    postgresql-client \
    nodejs \
    npm \
    lsb-release \
  && rm -rf /var/lib/apt/lists/*

# Docker CLI (outside-of-docker / docker-sock) support.
# Install ONLY the client bits (no daemon) from Docker's official apt repo:
# - docker-ce-cli provides `docker`
# - docker-compose-plugin provides `docker compose`
# - docker-buildx-plugin is commonly expected by modern compose builds
RUN set -eux; \
  install -m 0755 -d /etc/apt/keyrings; \
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc; \
  chmod a+r /etc/apt/keyrings/docker.asc; \
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
    > /etc/apt/sources.list.d/docker.list; \
  apt-get update; \
  apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin; \
  rm -rf /var/lib/apt/lists/*

# Ensure pnpm exists even when host mounts are not present.
RUN npm install -g pnpm

# Install 1Password CLI (op) in the devcontainer.
# Ref: https://developer.1password.com/docs/cli/get-started/
RUN set -eux; \
    mkdir -p /usr/share/keyrings; \
    curl -sS https://downloads.1password.com/linux/keys/1password.asc \
      | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" \
      > /etc/apt/sources.list.d/1password.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends 1password-cli; \
    rm -rf /var/lib/apt/lists/*
