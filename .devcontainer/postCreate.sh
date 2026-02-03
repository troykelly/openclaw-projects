#!/usr/bin/env bash
set -euo pipefail

log() { echo "[postCreate] $*"; }

# Ensure common user-local paths are available for this session.
mkdir -p "$HOME/.local/bin"
export PATH="$HOME/.claude/bin:$HOME/.local/bin:$PATH"

log "Starting devcontainer postCreate setup..."

log "Verifying prerequisites"
command -v curl >/dev/null
command -v jq >/dev/null
command -v op >/dev/null || {
  log "WARN: op not found on PATH (expected via Dockerfile)."
}

command -v gunzip >/dev/null 2>&1 || {
  log "WARN: gunzip not found; rust-analyzer install fallback may fail."
}

install_claude_code() {
  if command -v claude >/dev/null 2>&1; then
    log "Claude Code already installed: $(claude --version 2>/dev/null || true)"
    return 0
  fi

  log "Installing Claude Code via official installer (https://claude.ai/install.sh)"
  curl -fsSL https://claude.ai/install.sh | bash

  export PATH="$HOME/.claude/bin:$HOME/.local/bin:$PATH"

  if command -v claude >/dev/null 2>&1; then
    log "Claude Code installed: $(claude --version 2>/dev/null || true)"
  else
    log "WARN: Claude Code install completed but 'claude' is not on PATH (expected at $HOME/.claude/bin)."
  fi
}

install_codex_binary() {
  if command -v codex >/dev/null 2>&1; then
    log "Codex already installed: $(codex --version 2>/dev/null || true)"
    return 0
  fi

  log "Installing Codex from GitHub releases (openai/codex)"

  local arch
  arch=$(uname -m)

  # Map uname arch to the naming used by openai/codex releases.
  local want_arch
  case "$arch" in
    x86_64|amd64) want_arch="x86_64" ;;
    aarch64|arm64) want_arch="aarch64" ;;
    *)
      log "ERROR: Unsupported architecture for codex binary install: ${arch}"
      return 1
      ;;
  esac

  local release_json
  release_json=$(curl -fsSL https://api.github.com/repos/openai/codex/releases/latest)

  # Prefer the tar.gz linux build (avoids needing zstd).
  local asset_url
  asset_url=$(echo "$release_json" | jq -r --arg a "$want_arch" '
    .assets[]
    | select((.name|ascii_downcase) | contains(("codex-" + $a + "-unknown-linux-gnu")))
    | select((.name|ascii_downcase) | endswith(".tar.gz"))
    | .browser_download_url
  ' | head -n 1)

  if [[ -z "$asset_url" || "$asset_url" == "null" ]]; then
    log "ERROR: Could not find a codex ${want_arch} linux (gnu) .tar.gz release asset."
    return 1
  fi

  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  log "Downloading: $asset_url"
  curl -fsSL "$asset_url" -o "$tmp/codex.tar.gz"

  log "Extracting codex"
  tar -xzf "$tmp/codex.tar.gz" -C "$tmp"

  local codex_path
  codex_path=$(find "$tmp" -maxdepth 2 -type f \( -name codex -o -name 'codex-*linux*' -o -name 'codex-*unknown-linux-*' \) | head -n 1)
  if [[ -z "$codex_path" ]]; then
    log "ERROR: Could not find extracted codex binary in tarball. Contents:";
    find "$tmp" -maxdepth 2 -type f -print | sed 's#^#  - #' || true
    return 1
  fi

  chmod +x "$codex_path"

  # Install system-wide so it is available regardless of shell init.
  log "Installing codex to /usr/local/bin (sudo)"
  sudo install -m 0755 "$codex_path" /usr/local/bin/codex

  log "Codex installed: $(/usr/local/bin/codex --version 2>/dev/null || true)"
}

install_plugins_user_scope() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Skipping plugin installation: 'claude' not found."
    return 0
  fi

  # Official marketplace is named claude-plugins-official.
  # Use the CLI (non-interactive):
  #   claude plugin install <plugin>@claude-plugins-official --scope user
  local plugins=(
    frontend-design
    code-review
    github
    feature-dev
    code-simplifier
    ralph-loop
    commit-commands
    playwright
    security-guidance
    pr-review-toolkit
    agent-sdk-dev
    superpowers
    plugin-dev
    hookify
    linear
    sentry
    rust-analyzer-lsp
    claude-md-management
    claude-code-setup
    circleback
    pinecone
  )

  # LSP plugins require the corresponding language server binary in PATH.
  # rust-analyzer-lsp requires rust-analyzer.
  log "Ensuring rust-analyzer is installed (required for rust-analyzer-lsp)"
  if ! command -v rust-analyzer >/dev/null 2>&1; then
    if command -v curl >/dev/null 2>&1; then
      # Install rust-analyzer directly (static binary) from the upstream releases.
      # We avoid apt packaging differences between distros/images.
      local ra_url="https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz"
      case "$(uname -m)" in
        x86_64|amd64) ra_url="https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz" ;;
        aarch64|arm64) ra_url="https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-aarch64-unknown-linux-gnu.gz" ;;
      esac
      log "Downloading rust-analyzer from: $ra_url"
      curl -fsSL "$ra_url" | gunzip -c | sudo tee /usr/local/bin/rust-analyzer >/dev/null
      sudo chmod +x /usr/local/bin/rust-analyzer
    fi
  fi
  if command -v rust-analyzer >/dev/null 2>&1; then
    log "rust-analyzer available: $(rust-analyzer --version 2>/dev/null || true)"
  else
    log "WARN: rust-analyzer not installed; rust-analyzer-lsp plugin may show errors until installed."
  fi

  log "Installing Claude Code plugins to user scope (~/.claude/settings.json)"

  for p in "${plugins[@]}"; do
    log "Installing plugin: ${p}@claude-plugins-official"
    if claude plugin install "${p}@claude-plugins-official" --scope user; then
      true
    else
      log "WARN: Failed to install plugin ${p}. If Claude isn't authenticated yet, authenticate then rerun: bash .devcontainer/postCreate.sh"
    fi
  done
}

restore_cloud_credentials() {
  # Environment variables are loaded via docker-compose env_file directive.

  # Restore Google Cloud ADC if all required values exist
  if [[ -n "${GOOGLE_CLOUD_REFRESH_TOKEN:-}" && -n "${GOOGLE_CLOUD_CLIENT_ID:-}" && -n "${GOOGLE_CLOUD_CLIENT_SECRET:-}" ]]; then
    log "Restoring Google Cloud Application Default Credentials"
    mkdir -p "$HOME/.config/gcloud"
    cat > "$HOME/.config/gcloud/application_default_credentials.json" <<EOF
{
  "account": "",
  "client_id": "${GOOGLE_CLOUD_CLIENT_ID}",
  "client_secret": "${GOOGLE_CLOUD_CLIENT_SECRET}",
  "quota_project_id": "${GOOGLE_CLOUD_QUOTA_PROJECT:-}",
  "refresh_token": "${GOOGLE_CLOUD_REFRESH_TOKEN}",
  "type": "authorized_user",
  "universe_domain": "googleapis.com"
}
EOF
    chmod 600 "$HOME/.config/gcloud/application_default_credentials.json"
    log "Google Cloud ADC restored"
  fi

  # Restore Azure CLI credentials via service principal
  if [[ -n "${AZURE_CLIENT_ID:-}" && -n "${AZURE_CLIENT_SECRET:-}" && -n "${AZURE_TENANT_ID:-}" ]]; then
    log "Logging in to Azure with service principal"
    if az login --service-principal \
        -u "${AZURE_CLIENT_ID}" \
        -p "${AZURE_CLIENT_SECRET}" \
        --tenant "${AZURE_TENANT_ID}" \
        --allow-no-subscriptions >/dev/null 2>&1; then
      log "Azure CLI authenticated as service principal"
    else
      log "WARN: Azure service principal login failed"
    fi
  fi
}

install_claude_code
install_codex_binary
install_plugins_user_scope
restore_cloud_credentials

log "postCreate setup complete."
