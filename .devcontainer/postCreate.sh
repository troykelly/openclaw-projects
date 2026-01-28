#!/usr/bin/env bash
set -euo pipefail

log() { echo "[postCreate] $*"; }

# Ensure common user-local paths are available for this session.
export PATH="$HOME/.claude/bin:$HOME/.local/bin:$PATH"

log "Starting devcontainer postCreate setup..."

log "Verifying prerequisites"
command -v curl >/dev/null
command -v jq >/dev/null
command -v op >/dev/null || {
  log "WARN: op not found on PATH (expected via Dockerfile)."
}

install_claude_code() {
  if command -v claude >/dev/null 2>&1; then
    log "Claude Code already installed: $(claude --version 2>/dev/null || true)"
    return 0
  fi

  log "Installing Claude Code via official installer (https://claude.ai/install.sh)"
  curl -fsSL https://claude.ai/install.sh | bash

  export PATH="$HOME/.claude/bin:$PATH"

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

  # Map uname arch to expected asset suffixes.
  # We'll pick the asset that contains linux + arch.
  local want_arch
  case "$arch" in
    x86_64|amd64) want_arch="amd64" ;;
    aarch64|arm64) want_arch="arm64" ;;
    *)
      log "ERROR: Unsupported architecture for codex binary install: ${arch}"
      return 1
      ;;
  esac

  local release_json
  release_json=$(curl -fsSL https://api.github.com/repos/openai/codex/releases/latest)

  local asset_url
  asset_url=$(echo "$release_json" | jq -r --arg a "$want_arch" '
    .assets[]
    | select((.name|ascii_downcase) | contains("linux"))
    | select((.name|ascii_downcase) | contains($a))
    | .browser_download_url
  ' | head -n 1)

  if [[ -z "$asset_url" || "$asset_url" == "null" ]]; then
    log "ERROR: Could not find a linux/${want_arch} codex release asset."
    return 1
  fi

  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  log "Downloading: $asset_url"
  curl -fsSL "$asset_url" -o "$tmp/codex"
  chmod +x "$tmp/codex"

  # Install system-wide so it is available regardless of shell init.
  log "Installing codex to /usr/local/bin (sudo)"
  sudo install -m 0755 "$tmp/codex" /usr/local/bin/codex

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

install_claude_code
install_codex_binary
install_plugins_user_scope

log "postCreate setup complete."
