#!/usr/bin/env bash
# Unified devcontainer post-create script
# Idempotent, atomic, architecture-aware
# Each step is independent — failures are logged but never abort the script.
set -uo pipefail

###############################################################################
# CRLF self-heal — Windows git checkout can inject \r into shell scripts
###############################################################################
if head -1 "$0" | grep -q $'\r'; then
    sed -i 's/\r$//' "$0"
    exec bash "$0" "$@"
fi

###############################################################################
# Platform detection
###############################################################################
RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
    x86_64|amd64)   ARCH="x86_64";  IS_ARM64=false ;;
    aarch64|arm64)   ARCH="aarch64"; IS_ARM64=true  ;;
    *)
        echo "FATAL: Unsupported architecture: $RAW_ARCH"
        exit 1
        ;;
esac

OS="$(uname -s)"   # Linux expected inside devcontainer

# Resolve workspace root — prefer $CONTAINER_WORKSPACE_FOLDER, fall back to /workspaces/*
if [ -n "${CONTAINER_WORKSPACE_FOLDER:-}" ]; then
    WORKSPACE_DIR="$CONTAINER_WORKSPACE_FOLDER"
elif [ -d /workspaces ]; then
    WORKSPACE_DIR="$(find /workspaces -mindepth 1 -maxdepth 1 -type d | head -1)"
else
    WORKSPACE_DIR="$(pwd)"
fi

# Determine the non-root user running inside the container
DEV_USER="${_REMOTE_USER:-${USER:-vscode}}"
DEV_HOME="$(eval echo "~${DEV_USER}")"

echo "=== Unified post-create ==="
echo "  Arch:      $ARCH (arm64=$IS_ARM64)"
echo "  OS:        $OS"
echo "  Workspace: $WORKSPACE_DIR"
echo "  User:      $DEV_USER ($DEV_HOME)"
echo ""

###############################################################################
# Step runner — tracks pass/fail per step, never aborts
###############################################################################
declare -a STEP_RESULTS=()

run_step() {
    local name="$1"
    shift
    echo "--- [$name] ---"
    if "$@"; then
        STEP_RESULTS+=("✅ $name")
    else
        STEP_RESULTS+=("❌ $name")
        echo "⚠️  $name failed (non-fatal, continuing)"
    fi
    echo ""
}

###############################################################################
# 1. Node.js / NVM
###############################################################################
setup_node() {
    export NVM_DIR="${DEV_HOME}/.nvm"

    # Source nvm from common locations
    for candidate in \
        "${NVM_DIR}/nvm.sh" \
        /usr/local/share/nvm/nvm.sh \
        /usr/share/nvm/nvm.sh; do
        if [ -s "$candidate" ]; then
            # shellcheck source=/dev/null
            . "$candidate"
            break
        fi
    done

    if ! command -v nvm &>/dev/null; then
        echo "nvm not found — skipping Node.js setup"
        return 1
    fi

    if [ -f "${WORKSPACE_DIR}/.nvmrc" ]; then
        nvm install
    else
        echo "No .nvmrc found — installing current node"
        nvm install node
    fi

    echo "Node $(node --version) / npm $(npm --version)"
}

###############################################################################
# 2. pnpm
###############################################################################
setup_pnpm() {
    export PNPM_HOME="${DEV_HOME}/.local/share/pnpm"
    export PATH="${PNPM_HOME}:${PATH}"

    # Ensure directories exist with correct ownership
    for dir in "${DEV_HOME}/.local" "${DEV_HOME}/.local/share" "$PNPM_HOME"; do
        if [ ! -d "$dir" ]; then
            sudo mkdir -p "$dir"
        fi
        sudo chown "$DEV_USER" "$dir"
    done

    if ! command -v pnpm &>/dev/null; then
        echo "Installing pnpm..."
        curl -fsSL https://get.pnpm.io/install.sh | sh -
    fi

    echo "pnpm $(pnpm --version)"
}

###############################################################################
# 3. Install project dependencies
###############################################################################
install_deps() {
    if [ ! -f "${WORKSPACE_DIR}/package.json" ]; then
        echo "No package.json — skipping"
        return 0
    fi

    cd "$WORKSPACE_DIR" || return 1

    # Fix node_modules ownership if Docker created it as root
    if [ -d node_modules ] && [ "$(stat -c '%U' node_modules 2>/dev/null || stat -f '%Su' node_modules 2>/dev/null)" = "root" ]; then
        echo "Fixing node_modules ownership (root → $DEV_USER)..."
        sudo chown -R "$DEV_USER" node_modules
    fi

    pnpm install --frozen-lockfile || pnpm install
}

###############################################################################
# 4. System Chromium + no-sandbox wrapper
###############################################################################
install_chromium() {
    if [ "$OS" != "Linux" ]; then
        echo "Not Linux — skipping system Chromium"
        return 0
    fi

    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium >/dev/null 2>&1 \
        || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium-browser >/dev/null 2>&1

    # Verify we got a binary
    local chromium_bin=""
    for candidate in /usr/bin/chromium /usr/bin/chromium-browser; do
        if [ -x "$candidate" ]; then
            chromium_bin="$candidate"
            break
        fi
    done

    if [ -z "$chromium_bin" ]; then
        echo "Chromium binary not found after install"
        return 1
    fi

    # Create wrapper at /opt/google/chrome/chrome so tools that probe for
    # "google-chrome" or "chrome" find it automatically. --no-sandbox is
    # required inside container PID namespaces.
    sudo mkdir -p /opt/google/chrome
    sudo tee /opt/google/chrome/chrome >/dev/null <<WRAPPER
#!/bin/sh
exec ${chromium_bin} --no-sandbox "\$@"
WRAPPER
    sudo chmod +x /opt/google/chrome/chrome

    echo "Chromium wrapper installed → /opt/google/chrome/chrome"
}

###############################################################################
# 5. Playwright browsers
###############################################################################
install_playwright() {
    if ! command -v pnpm &>/dev/null; then
        echo "pnpm not available — skipping Playwright"
        return 1
    fi

    cd "$WORKSPACE_DIR" || return 1

    # Only install if playwright is a project dependency
    if ! pnpm list --depth=0 2>/dev/null | grep -q playwright; then
        echo "Playwright not in project dependencies — skipping"
        return 0
    fi

    pnpm exec playwright install --with-deps chromium
    echo "Playwright chromium installed"
}

###############################################################################
# 6. Puppeteer browsers + arm64 fallback
###############################################################################
install_puppeteer() {
    if ! command -v pnpm &>/dev/null; then
        echo "pnpm not available — skipping Puppeteer"
        return 1
    fi

    cd "$WORKSPACE_DIR" || return 1

    # Only install if puppeteer is a project dependency
    if ! pnpm list --depth=0 2>/dev/null | grep -q puppeteer; then
        echo "Puppeteer not in project dependencies — skipping"
        return 0
    fi

    # Install Puppeteer browsers
    pnpm exec puppeteer browsers install chrome || true
    pnpm exec puppeteer browsers install chrome-headless-shell || true

    # arm64 Linux: Chrome for Testing has no native build.
    # Fall back to Playwright's Chromium via PUPPETEER_EXECUTABLE_PATH.
    if $IS_ARM64; then
        local pw_chrome=""
        pw_chrome="$(find "${DEV_HOME}/.cache/ms-playwright" \
            -name 'chrome' -path '*/chromium-*/chrome-linux*/chrome' \
            -type f 2>/dev/null | head -1)"

        if [ -n "$pw_chrome" ]; then
            echo "arm64: Chrome for Testing unavailable — using Playwright Chromium"
            echo "  → $pw_chrome"
            export PUPPETEER_EXECUTABLE_PATH="$pw_chrome"
            # Persisted to shell rc in setup_shell step
        else
            echo "⚠️  arm64: No Playwright Chromium found for Puppeteer fallback"
        fi
    fi
}

###############################################################################
# 7. Claude Code CLI
###############################################################################
install_claude() {
    if command -v claude &>/dev/null; then
        echo "Claude Code already installed: $(claude --version 2>/dev/null || echo 'unknown')"
        return 0
    fi

    echo "Installing Claude Code CLI..."
    curl -fsSL https://claude.ai/install.sh | bash

    # Ensure it's on PATH for the rest of this script
    export PATH="${DEV_HOME}/.claude/bin:${DEV_HOME}/.local/bin:${PATH}"

    if command -v claude &>/dev/null; then
        echo "Claude Code installed: $(claude --version 2>/dev/null || echo 'ok')"
    else
        echo "Claude Code install did not place binary on PATH"
        return 1
    fi
}

###############################################################################
# 8. Claude Code plugins
###############################################################################
install_plugins() {
    if ! command -v claude &>/dev/null; then
        echo "claude not found — skipping plugins"
        return 1
    fi

    # Add official marketplace
    claude plugins add-marketplace "https://raw.githubusercontent.com/anthropics/claude-code-plugins/refs/heads/main/marketplace.json" 2>/dev/null || true

    local plugins=(
        circleback
        claude-code-setup
        code-review
        code-simplifier
        commit-commands
        feature-dev
        frontend-design
        github
        hookify
        linear
        playwright
        playground
        pr-review-toolkit
        pyright-lsp
        ralph-loop
        ralph-wiggum
        security-guidance
        sentry
        stripe
        thinking-tool
        typescript-lsp
    )

    for plugin in "${plugins[@]}"; do
        claude plugin add "$plugin" 2>/dev/null || true
    done

    echo "Installed ${#plugins[@]} plugins"
}

###############################################################################
# 9. Codex CLI (architecture-aware binary)
###############################################################################
install_codex() {
    if command -v codex &>/dev/null; then
        echo "Codex already installed: $(codex --version 2>/dev/null || echo 'unknown')"
        return 0
    fi

    if [ "$OS" != "Linux" ]; then
        echo "Codex binary install only supported on Linux — skipping"
        return 0
    fi

    local codex_arch=""
    case "$ARCH" in
        x86_64)   codex_arch="x86_64-unknown-linux-musl" ;;
        aarch64)  codex_arch="aarch64-unknown-linux-musl" ;;
        *)        echo "Unsupported arch for Codex: $ARCH"; return 1 ;;
    esac

    echo "Fetching latest Codex release for $codex_arch..."

    local latest_tag=""
    latest_tag="$(curl -fsSL --retry 3 --retry-delay 2 \
        "https://api.github.com/repos/openai/codex/releases" \
        | jq -r '[.[] | select(.prerelease==false)][0].tag_name' 2>/dev/null)"

    if [ -z "$latest_tag" ] || [ "$latest_tag" = "null" ]; then
        echo "Could not determine latest Codex version"
        return 1
    fi

    # Asset names are codex-{arch}.tar.gz (no version in filename)
    local download_url="https://github.com/openai/codex/releases/download/${latest_tag}/codex-${codex_arch}.tar.gz"

    local _tmpdir=""
    _tmpdir="$(mktemp -d)"

    echo "Downloading $download_url"
    if ! curl -fsSL --retry 3 --retry-delay 2 "$download_url" -o "${_tmpdir}/codex.tar.gz"; then
        rm -rf "$_tmpdir"
        echo "Download failed"
        return 1
    fi

    tar -xzf "${_tmpdir}/codex.tar.gz" -C "$_tmpdir"

    # The archive contains a single binary named codex-{arch}, not "codex"
    local codex_bin=""
    codex_bin="$(find "$_tmpdir" -maxdepth 1 -name 'codex*' -type f 2>/dev/null | head -1)"

    if [ -z "$codex_bin" ]; then
        rm -rf "$_tmpdir"
        echo "Codex binary not found in archive"
        return 1
    fi

    sudo install -m 755 "$codex_bin" /usr/local/bin/codex
    rm -rf "$_tmpdir"
    echo "Codex $(codex --version 2>/dev/null || echo "$latest_tag") installed"
}

###############################################################################
# 10. MCP server configuration
###############################################################################
configure_mcp() {
    if ! command -v claude &>/dev/null; then
        echo "claude not found — skipping MCP config"
        return 1
    fi

    # Codex MCP wrapper
    if command -v codex &>/dev/null; then
        sudo tee /usr/local/bin/codex-mcp-wrapper >/dev/null <<'CODEX_WRAPPER'
#!/bin/sh
exec codex --dangerously-bypass-approvals-and-sandbox --full-auto mcp
CODEX_WRAPPER
        sudo chmod +x /usr/local/bin/codex-mcp-wrapper
        claude mcp add codex -s user -- /usr/local/bin/codex-mcp-wrapper 2>/dev/null || true
        echo "Codex MCP server registered"
    fi

    # Playwright MCP — configure to use system chromium
    local pw_config_dir="${DEV_HOME}/.claude/plugin-settings"
    if [ -d "$pw_config_dir" ] || command -v pnpm &>/dev/null; then
        # Find the playwright plugin config and patch it
        local pw_config=""
        pw_config="$(find "${DEV_HOME}/.claude" -path '*/playwright/config.json' -type f 2>/dev/null | head -1)"
        if [ -n "$pw_config" ]; then
            local tmp_pw=""
            tmp_pw="$(mktemp)"
            jq '.mcpServers.playwright.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/chromium"
                | .mcpServers.playwright.env.PLAYWRIGHT_LAUNCH_OPTIONS = "{\"args\":[\"--no-sandbox\"]}"' \
                "$pw_config" > "$tmp_pw" 2>/dev/null && mv "$tmp_pw" "$pw_config"
            echo "Playwright MCP configured for system chromium"
        fi
    fi
}

###############################################################################
# 11. Claude Code settings (merged via jq)
###############################################################################
configure_claude() {
    local settings_file="${DEV_HOME}/.claude/settings.json"
    mkdir -p "${DEV_HOME}/.claude"

    # Build the desired settings object
    local desired='{
        "permissions": {
            "defaultMode": "bypassPermissions"
        },
        "apiKeyHelper": "/bin/sh -c '\''echo $ANTHROPIC_API_KEY'\''"
    }'

    if [ -f "$settings_file" ]; then
        local tmp=""
        tmp="$(mktemp)"
        jq -s '.[0] * .[1]' "$settings_file" <(echo "$desired") > "$tmp" 2>/dev/null \
            && mv "$tmp" "$settings_file"
    else
        printf '%s\n' "$desired" | jq '.' > "$settings_file"
    fi

    echo "Claude settings updated: apiKeyHelper + bypassPermissions"

    # User preferences (onboarding, theme)
    local prefs_file="${DEV_HOME}/.claude.json"
    local prefs='{
        "hasCompletedOnboarding": true,
        "hasAcknowledgedCostThreshold": true,
        "theme": "dark"
    }'

    if [ -f "$prefs_file" ]; then
        local tmp=""
        tmp="$(mktemp)"
        jq -s '.[0] * .[1]' "$prefs_file" <(echo "$prefs") > "$tmp" 2>/dev/null \
            && mv "$tmp" "$prefs_file"
    else
        printf '%s\n' "$prefs" | jq '.' > "$prefs_file"
    fi

    echo "Claude preferences updated: onboarding + dark theme"
}

###############################################################################
# 12. Codex CLI configuration
###############################################################################
configure_codex() {
    if ! command -v codex &>/dev/null; then
        echo "codex not found — skipping config"
        return 0
    fi

    local codex_dir="${DEV_HOME}/.codex"
    mkdir -p "$codex_dir"

    cat > "${codex_dir}/config.toml" <<'TOML'
# Devcontainer: no interactive terminal for approval prompts
approval_policy = "never"

[sandbox]
type = "danger-full-access"
TOML

    echo "Codex config written"
}

###############################################################################
# 13. Ed25519 signing key (for audit logs)
###############################################################################
generate_keys() {
    local key_dir="${WORKSPACE_DIR}"
    local key_file="${key_dir}/signing_key.pem"

    if [ -f "$key_file" ]; then
        echo "Signing key already exists — skipping"
        return 0
    fi

    if ! command -v openssl &>/dev/null; then
        echo "openssl not found — skipping key generation"
        return 1
    fi

    openssl genpkey -algorithm Ed25519 -out "$key_file" 2>/dev/null
    openssl pkey -in "$key_file" -pubout -out "${key_dir}/signing_key.pub" 2>/dev/null
    chmod 600 "$key_file"

    echo "Ed25519 signing key generated"
}

###############################################################################
# 14. .env from .env.example
###############################################################################
setup_env() {
    local env_file="${WORKSPACE_DIR}/.env"
    local env_example="${WORKSPACE_DIR}/.env.example"

    if [ -f "$env_file" ]; then
        echo ".env already exists — skipping"
        return 0
    fi

    if [ ! -f "$env_example" ]; then
        echo "No .env.example found — skipping"
        return 0
    fi

    cp "$env_example" "$env_file"

    # Generate secrets for common placeholder patterns
    if command -v openssl &>/dev/null; then
        local jwt_secret=""
        jwt_secret="$(openssl rand -base64 48)"
        local encryption_key=""
        encryption_key="$(openssl rand -base64 32)"

        # Replace placeholder values (YOUR_SECRET_HERE, CHANGE_ME, <generate>, etc.)
        sed -i "s|JWT_SECRET=.*|JWT_SECRET=${jwt_secret}|" "$env_file" 2>/dev/null || true
        sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${encryption_key}|" "$env_file" 2>/dev/null || true
    fi

    # Rewrite common hostname placeholders for devcontainer networking
    sed -i 's/localhost:5432/db:5432/g' "$env_file" 2>/dev/null || true
    sed -i 's/localhost:6379/redis:6379/g' "$env_file" 2>/dev/null || true
    sed -i 's/localhost:1025/mailpit:1025/g' "$env_file" 2>/dev/null || true

    echo ".env created from .env.example"
}

###############################################################################
# 15. Git safe directory
###############################################################################
setup_git() {
    if command -v git &>/dev/null; then
        git config --global --add safe.directory "$WORKSPACE_DIR" 2>/dev/null || true
        echo "Git safe directory: $WORKSPACE_DIR"
    fi
}

###############################################################################
# 16. Shell customizations (zsh + bash)
###############################################################################
setup_shell() {
    local marker="# >>> unified-devcontainer-config >>>"
    local end_marker="# <<< unified-devcontainer-config <<<"

    # Build the shell block
    local shell_block=""
    shell_block="$(cat <<'SHELL_BLOCK'

# >>> unified-devcontainer-config >>>

# nvm
export NVM_DIR="${HOME}/.nvm"
for _nvm_candidate in \
    "${NVM_DIR}/nvm.sh" \
    /usr/local/share/nvm/nvm.sh \
    /usr/share/nvm/nvm.sh; do
    if [ -s "$_nvm_candidate" ]; then
        . "$_nvm_candidate"
        break
    fi
done
unset _nvm_candidate

# pnpm
export PNPM_HOME="${HOME}/.local/share/pnpm"
case ":${PATH}:" in
    *":${PNPM_HOME}:"*) ;;
    *) export PATH="${PNPM_HOME}:${PATH}" ;;
esac

# Claude Code
case ":${PATH}:" in
    *":${HOME}/.claude/bin:"*) ;;
    *) export PATH="${HOME}/.claude/bin:${PATH}" ;;
esac
case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) export PATH="${HOME}/.local/bin:${PATH}" ;;
esac

# GitHub token for MCP servers
if command -v gh &> /dev/null && gh auth status &> /dev/null 2>&1; then
    export GITHUB_TOKEN=$(gh auth token 2>/dev/null)
fi

# Container sandbox — bypass interactive prompts
alias claude="claude --dangerously-skip-permissions"
alias codex="codex --dangerously-bypass-approvals-and-sandbox"

SHELL_BLOCK
)"

    # Add workspace alias — needs the actual path baked in
    shell_block+="
# Workspace
alias ws=\"cd ${WORKSPACE_DIR}\"
"

    # arm64 Puppeteer fallback
    if $IS_ARM64 && [ -n "${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
        shell_block+="
# arm64: Chrome for Testing has no native build — use Playwright Chromium
export PUPPETEER_EXECUTABLE_PATH=\"${PUPPETEER_EXECUTABLE_PATH}\"
"
    fi

    # Auto-switch node version on directory change (.nvmrc)
    shell_block+='
# Auto-switch node version from .nvmrc
if [ -n "$ZSH_VERSION" ]; then
    autoload -U add-zsh-hook
    load-nvmrc() {
        local nvmrc_path="$(nvm_find_nvmrc 2>/dev/null)"
        if [ -n "$nvmrc_path" ]; then
            local nvmrc_node_version=$(nvm version "$(cat "${nvmrc_path}")")
            if [ "$nvmrc_node_version" = "N/A" ]; then
                nvm install
            elif [ "$nvmrc_node_version" != "$(nvm version)" ]; then
                nvm use
            fi
        fi
    }
    add-zsh-hook chpwd load-nvmrc
    load-nvmrc
fi
'

    shell_block+="
$end_marker
"

    # Apply to both zshrc and bashrc, idempotently
    for rc_file in "${DEV_HOME}/.zshrc" "${DEV_HOME}/.bashrc"; do
        if [ ! -f "$rc_file" ]; then
            touch "$rc_file"
        fi

        if grep -qF "$marker" "$rc_file" 2>/dev/null; then
            # Remove old block and replace
            local tmp=""
            tmp="$(mktemp)"
            sed "/$marker/,/$end_marker/d" "$rc_file" > "$tmp"
            printf '%s\n' "$shell_block" >> "$tmp"
            mv "$tmp" "$rc_file"
            echo "Updated shell block in $(basename "$rc_file")"
        else
            printf '%s\n' "$shell_block" >> "$rc_file"
            echo "Added shell block to $(basename "$rc_file")"
        fi
    done
}

###############################################################################
# Run all steps
###############################################################################
cd "$WORKSPACE_DIR" || true

run_step "Node.js / NVM"         setup_node
run_step "pnpm"                  setup_pnpm
run_step "Project dependencies"  install_deps
run_step "System Chromium"       install_chromium
run_step "Playwright browsers"   install_playwright
run_step "Puppeteer browsers"    install_puppeteer
run_step "Claude Code CLI"       install_claude
run_step "Claude plugins"        install_plugins
run_step "Codex CLI"             install_codex
run_step "MCP servers"           configure_mcp
run_step "Claude settings"       configure_claude
run_step "Codex config"          configure_codex
run_step "Signing keys"          generate_keys
run_step ".env setup"            setup_env
run_step "Git config"            setup_git
run_step "Shell customizations"  setup_shell

###############################################################################
# Invoke post-start if it exists (for first-run convenience)
###############################################################################
POST_START_SCRIPT="${WORKSPACE_DIR}/.devcontainer/post-start.sh"
if [ -f "$POST_START_SCRIPT" ]; then
    echo ""
    echo "=== Running post-start.sh ==="
    bash "$POST_START_SCRIPT" || echo "⚠️  post-start.sh returned non-zero"
fi

###############################################################################
# Summary
###############################################################################
echo ""
echo "========================================="
echo "  Post-create complete"
echo "========================================="
for result in "${STEP_RESULTS[@]}"; do
    echo "  $result"
done
echo ""
echo "  Workspace: $WORKSPACE_DIR"
echo "  Arch:      $ARCH"
if command -v node &>/dev/null; then
    echo "  Node:      $(node --version 2>/dev/null)"
fi
if command -v pnpm &>/dev/null; then
    echo "  pnpm:      $(pnpm --version 2>/dev/null)"
fi
if command -v claude &>/dev/null; then
    echo "  Claude:    $(claude --version 2>/dev/null || echo 'installed')"
fi
if command -v codex &>/dev/null; then
    echo "  Codex:     $(codex --version 2>/dev/null || echo 'installed')"
fi
echo "========================================="
