#!/usr/bin/env bash
set -uo pipefail

# ---------------------------------------------------------------------------
# postCreate.sh — devcontainer setup for openclaw-projects
#
# Each step is independent: one failure does not block others.
# A summary is printed at the end showing what succeeded / failed.
# ---------------------------------------------------------------------------

RESULTS=()

log() { echo "[postCreate] $*"; }

# Run a named step, record pass/fail. Failures do NOT abort the script.
run_step() {
  local name="$1"; shift
  log "--- $name ---"
  if "$@"; then
    RESULTS+=("  OK  $name")
  else
    RESULTS+=("  FAIL $name")
  fi
}

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

install_claude_code() {
  if command -v claude >/dev/null 2>&1; then
    log "Claude Code already installed: $(claude --version 2>/dev/null || true)"
    return 0
  fi

  log "Installing Claude Code via official installer (https://claude.ai/install.sh)"

  # Download to temp file first for security (avoid piping directly to bash)
  local install_script
  install_script=$(mktemp)
  trap 'rm -f "${install_script:-}"' RETURN

  log "Downloading Claude Code installer..."
  if ! curl -fsSL --max-time 60 https://claude.ai/install.sh -o "$install_script"; then
    log "ERROR: Failed to download Claude Code installer"
    return 1
  fi

  # Verify the script starts with a shebang and basic sanity check
  if ! head -n 1 "$install_script" | grep -q '^#!.*bash'; then
    log "ERROR: Downloaded installer does not appear to be a bash script"
    return 1
  fi

  # NOTE: Anthropic does not currently provide checksums for install.sh
  # Consider adding verification if/when available
  log "Executing Claude Code installer..."
  bash "$install_script"

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

  local want_arch
  case "$arch" in
    x86_64|amd64)  want_arch="x86_64"  ;;
    aarch64|arm64)  want_arch="aarch64" ;;
    *)
      log "ERROR: Unsupported architecture for codex binary install: ${arch}"
      return 1
      ;;
  esac

  local release_json
  local attempt=0
  local max_attempts=3
  local http_code

  log "Fetching codex release info from GitHub API..."
  while ((attempt < max_attempts)); do
    ((attempt++))

    # Capture both HTTP status code and response body
    local response
    response=$(curl -fsSL -w "\n%{http_code}" --max-time 30 \
      https://api.github.com/repos/openai/codex/releases/latest 2>/dev/null || echo -e "\n000")

    http_code=$(echo "$response" | tail -n 1)
    release_json=$(echo "$response" | head -n -1)

    if [[ "$http_code" == "200" ]] && [[ -n "$release_json" ]]; then
      log "Successfully fetched codex release info"
      break
    fi

    # Handle specific HTTP error codes
    if [[ "$http_code" == "429" ]]; then
      log "WARN: GitHub API rate limit hit (attempt $attempt/$max_attempts)"
    elif [[ "$http_code" == "000" ]]; then
      log "WARN: Network error connecting to GitHub API (attempt $attempt/$max_attempts)"
    else
      log "WARN: GitHub API request failed with HTTP $http_code (attempt $attempt/$max_attempts)"
    fi

    if ((attempt < max_attempts)); then
      local sleep_time=$((attempt * 2))
      log "Retrying in ${sleep_time}s..."
      sleep "$sleep_time"
    fi
  done

  if [[ -z "${release_json:-}" ]] || [[ "$http_code" != "200" ]]; then
    log "ERROR: Failed to fetch codex release info after $max_attempts attempts (HTTP $http_code)"
    return 1
  fi

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
  trap 'rm -rf "${tmp:-}"' RETURN

  log "Downloading: $asset_url"
  curl -fsSL "$asset_url" -o "$tmp/codex.tar.gz"

  log "Extracting codex"
  tar -xzf "$tmp/codex.tar.gz" -C "$tmp"

  local codex_path
  codex_path=$(find "$tmp" -maxdepth 2 -type f \( -name codex -o -name 'codex-*linux*' -o -name 'codex-*unknown-linux-*' \) | head -n 1)
  if [[ -z "$codex_path" ]]; then
    log "ERROR: Could not find extracted codex binary in tarball. Contents:"
    find "$tmp" -maxdepth 2 -type f -print | sed 's#^#  - #' || true
    return 1
  fi

  chmod +x "$codex_path"

  log "Installing codex to /usr/local/bin (sudo)"
  sudo install -m 0755 "$codex_path" /usr/local/bin/codex

  log "Codex installed: $(/usr/local/bin/codex --version 2>/dev/null || true)"
}

install_plugins() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Skipping plugin installation: 'claude' not found."
    return 0
  fi

  claude plugin marketplace add anthropics/claude-plugins-official || true

  local plugins=(
    circleback
    claude-code-setup
    claude-md-management
    code-review
    code-simplifier
    commit-commands
    feature-dev
    frontend-design
    github
    hookify
    linear
    playground
    playwright
    pr-review-toolkit
    pyright-lsp
    ralph-loop
    security-guidance
    sentry
    stripe
    superpowers
    typescript-lsp
  )

  local failed=0
  for plugin in "${plugins[@]}"; do
    if ! claude plugin install "${plugin}@claude-plugins-official"; then
      log "WARN: Failed to install plugin: ${plugin}"
      ((failed++)) || true
    fi
  done

  if ((failed > 0)); then
    log "WARN: ${failed}/${#plugins[@]} plugin(s) failed to install."
  else
    log "All ${#plugins[@]} plugins installed."
  fi
}

restore_cloud_credentials() {
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

  if [[ -n "${AZURE_CLIENT_ID:-}" && -n "${AZURE_CLIENT_SECRET:-}" && -n "${AZURE_TENANT_ID:-}" ]]; then
    log "Logging in to Azure with service principal"
    # Use stdin to pass password to avoid credential exposure in process list
    if echo "${AZURE_CLIENT_SECRET}" | az login --service-principal \
        -u "${AZURE_CLIENT_ID}" \
        --password /dev/stdin \
        --tenant "${AZURE_TENANT_ID}" \
        --allow-no-subscriptions >/dev/null 2>&1; then
      log "Azure CLI authenticated as service principal"
    else
      log "WARN: Azure service principal login failed"
    fi
  fi
}

install_openclaw_gateway() {
  # Clone into .local/ inside the repo (gitignored) to avoid Docker volume permission issues.
  local repo_root
  repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  local gateway_dir="${repo_root}/.local/openclaw-gateway"

  # Use GITHUB_TOKEN for authentication (the repo is private).
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    log "WARN: GITHUB_TOKEN is not set — cannot clone OpenClaw gateway (private repo)."
    log "WARN: Set GITHUB_TOKEN in .env and rebuild the devcontainer."
    return 1
  fi

  local auth_url="https://x-access-token:${GITHUB_TOKEN}@github.com/openclaw/openclaw.git"

  # Check if gateway already cloned - handle TOCTOU defensively
  if [[ -f "$gateway_dir/package.json" ]]; then
    log "OpenClaw gateway source already present at $gateway_dir"
    if [[ ! -d "$gateway_dir/node_modules" ]]; then
      log "Installing OpenClaw gateway dependencies..."
      # TOCTOU mitigation: cd might fail if directory disappears, so check exit code
      if (cd "$gateway_dir" 2>/dev/null && pnpm install --frozen-lockfile 2>/dev/null || pnpm install); then
        return 0
      else
        log "WARN: Failed to install OpenClaw gateway dependencies (directory may have been modified)"
        log "WARN: Will attempt fresh clone"
        rm -rf "$gateway_dir"
        # Fall through to clone below
      fi
    else
      return 0
    fi
  fi

  mkdir -p "$(dirname "$gateway_dir")"

  log "Cloning OpenClaw gateway from source..."
  if ! git clone --depth 1 "$auth_url" "$gateway_dir" 2>&1; then
    log "WARN: Failed to clone OpenClaw gateway. Integration testing will be unavailable."
    log "WARN: Verify GITHUB_TOKEN has access to github.com/openclaw/openclaw"
    return 1
  fi

  log "Installing OpenClaw gateway dependencies..."
  (cd "$gateway_dir" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install) || {
    log "WARN: Failed to install OpenClaw gateway dependencies"
    return 1
  }

  log "Building OpenClaw gateway..."
  (cd "$gateway_dir" && pnpm build) || {
    log "WARN: OpenClaw gateway build failed. Source is still available for inspection."
    log "WARN: Try rebuilding manually: cd $gateway_dir && pnpm build"
    return 1
  }

  log "OpenClaw gateway installed at $gateway_dir"
}

configure_codex_mcp() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Skipping Codex MCP: 'claude' not found."
    return 0
  fi
  if ! command -v codex >/dev/null 2>&1; then
    log "Skipping Codex MCP: 'codex' not found."
    return 0
  fi

  log "Adding Codex MCP server"
  claude mcp add --transport stdio --scope user codex -- codex mcp-server || {
    log "Codex MCP server already configured (or add failed)"
    return 0
  }
}

configure_claude_permissions() {
  if ! command -v claude >/dev/null 2>&1; then
    log "Skipping Claude permissions: 'claude' not found."
    return 0
  fi

  log "Configuring Claude Code permissions (bypass for sandboxed container)"
  local settings="$HOME/.claude/settings.json"

  # Check if node is available before attempting to use it
  if ! command -v node >/dev/null 2>&1; then
    log "WARN: node not available, cannot safely merge settings - will overwrite if file exists"
    mkdir -p "$(dirname "$settings")"
    echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"
    return 0
  fi

  if [ -f "$settings" ]; then
    # Use node to merge settings (preserves existing configuration)
    if ! node -e "
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync('$settings', 'utf8'));
      s.permissions = { ...s.permissions, defaultMode: 'bypassPermissions' };
      fs.writeFileSync('$settings', JSON.stringify(s, null, 2) + '\n');
    " 2>/dev/null; then
      log "WARN: Node script failed to merge settings, overwriting file"
      mkdir -p "$(dirname "$settings")"
      echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"
    fi
  else
    mkdir -p "$(dirname "$settings")"
    echo '{ "permissions": { "defaultMode": "bypassPermissions" } }' > "$settings"
  fi
}

configure_codex_cli() {
  log "Configuring Codex CLI (no sandbox/approvals for MCP mode)"
  mkdir -p "$HOME/.codex"
  cat > "$HOME/.codex/config.toml" <<'CODEXEOF'
# Equivalent to --dangerously-bypass-approvals-and-sandbox
# Required: MCP subprocess has no interactive terminal for approval prompts.
approval_policy = "never"
sandbox_policy = "danger-full-access"
sandbox_permissions = ["disk-full-read-access"]
CODEXEOF
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  mkdir -p "$HOME/.local/bin"
  export PATH="$HOME/.claude/bin:$HOME/.local/bin:$PATH"

  log "Starting devcontainer postCreate setup..."

  # Verify basic prerequisites.
  command -v curl >/dev/null || { log "ERROR: curl not found"; return 1; }
  command -v jq   >/dev/null || { log "ERROR: jq not found";   return 1; }

  run_step "Claude Code"          install_claude_code
  run_step "Codex binary"         install_codex_binary
  run_step "Claude plugins"       install_plugins
  run_step "Cloud credentials"    restore_cloud_credentials
  run_step "OpenClaw gateway"     install_openclaw_gateway
  run_step "Codex MCP server"     configure_codex_mcp
  run_step "Claude permissions"   configure_claude_permissions
  run_step "Codex CLI config"     configure_codex_cli

  # Summary
  log ""
  log "========== Setup Summary =========="
  for r in "${RESULTS[@]}"; do
    log "$r"
  done
  log "==================================="
  log "postCreate setup complete."
}

main "$@"
