FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Base tooling required for this repo + for installing claude/codex/op inside the container.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    gnupg \
    unzip \
    postgresql-client \
    nodejs \
    npm \
    rust-analyzer \
  && rm -rf /var/lib/apt/lists/*

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
