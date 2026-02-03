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
    lsb-release \
  && rm -rf /var/lib/apt/lists/*

# Node.js 25.x (current major) with native TypeScript support via --experimental-transform-types
RUN set -eux; \
  curl -fsSL https://deb.nodesource.com/setup_25.x | bash -; \
  apt-get update; \
  apt-get install -y --no-install-recommends nodejs; \
  rm -rf /var/lib/apt/lists/*

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

# Ensure user-local bins are on PATH for the default devcontainer user (vscode).
# (Claude installer uses ~/.local/bin)
RUN echo 'export PATH="$HOME/.local/bin:$HOME/.claude/bin:$PATH"' > /etc/profile.d/99-clawdbot-path.sh

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

# Install GitHub CLI (gh).
# Ref: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
RUN set -eux; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*

# Install Google Cloud SDK (gcloud).
# Ref: https://cloud.google.com/sdk/docs/install#deb
RUN set -eux; \
    curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
      | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends google-cloud-cli; \
    rm -rf /var/lib/apt/lists/*

# Install Azure CLI (az).
# Ref: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux
RUN set -eux; \
    curl -sLS https://packages.microsoft.com/keys/microsoft.asc \
      | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg; \
    chmod go+r /etc/apt/keyrings/microsoft.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/azure-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends azure-cli; \
    rm -rf /var/lib/apt/lists/*
