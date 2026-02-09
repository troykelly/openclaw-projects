#!/usr/bin/env bash
# =============================================================================
# openclaw-projects setup wizard
# =============================================================================
#
# Interactive setup script that generates a .env file with sensible defaults.
# Automatically generates secrets and guides users through configuration.
#
# Usage:
#   ./scripts/setup.sh                  # Interactive wizard
#   ./scripts/setup.sh --non-interactive  # Use defaults + env var overrides
#   ./scripts/setup.sh --help           # Show help
#
# Environment variable overrides (for --non-interactive mode):
#   PUBLIC_BASE_URL, POSTGRES_PASSWORD, COOKIE_SECRET, S3_SECRET_KEY,
#   OPENCLAW_PROJECTS_AUTH_SECRET, EMBEDDING_PROVIDER, OPENAI_API_KEY,
#   VOYAGERAI_API_KEY, GEMINI_API_KEY, and all other .env variables.
#
# The script is idempotent: re-running preserves existing .env values
# unless explicitly overridden via environment variables or interactive input.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"
ENV_EXAMPLE="${PROJECT_ROOT}/.env.example"

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
NON_INTERACTIVE=false
FORCE_OVERWRITE=false

# Associative array to hold existing .env values (loaded on startup)
declare -A EXISTING_ENV

# Ordered list of keys to write (preserves output order)
declare -a ENV_KEYS=()

# Associative array of values to write
declare -A ENV_VALUES

# Associative array of comments per section
declare -A ENV_COMMENTS

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

usage() {
  cat <<'USAGE'
Usage: setup.sh [OPTIONS]

Options:
  --non-interactive   Skip all prompts; use defaults and environment overrides
  --force             Overwrite existing .env without prompting
  --help              Show this help message

Environment variables override defaults in --non-interactive mode.
USAGE
  exit 0
}

# Colours (disabled if not a terminal)
if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  RED='\033[0;31m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' CYAN='' RED='' RESET=''
fi

info()    { printf "${GREEN}==>${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}WARNING:${RESET} %s\n" "$*"; }
error()   { printf "${RED}ERROR:${RESET} %s\n" "$*" >&2; }
section() { printf "\n${BOLD}${CYAN}--- %s ---${RESET}\n\n" "$*"; }

# Generate a random hex secret of given byte length (default 32 = 64 hex chars)
generate_secret() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes" 2>/dev/null || head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Load existing .env into EXISTING_ENV associative array
load_existing_env() {
  if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line; do
      # Skip comments and blank lines
      case "$line" in
        '#'*|'') continue ;;
      esac
      # Only process lines with = that don't start with whitespace
      if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        local key="${line%%=*}"
        local val="${line#*=}"
        EXISTING_ENV["$key"]="$val"
      fi
    done < "$ENV_FILE"
  fi
}

# Resolve a value with precedence: env var > existing .env > default
# Usage: resolve KEY DEFAULT
resolve() {
  local key="$1"
  local default="${2:-}"
  local env_val="${!key:-}"

  if [ -n "$env_val" ]; then
    printf '%s' "$env_val"
  elif [ -n "${EXISTING_ENV[$key]:-}" ]; then
    printf '%s' "${EXISTING_ENV[$key]}"
  else
    printf '%s' "$default"
  fi
}

# Prompt user for a value (skipped in non-interactive mode)
# Usage: prompt_value KEY "Prompt text" DEFAULT [--secret]
prompt_value() {
  local key="$1"
  local prompt_text="$2"
  local default="$3"
  local is_secret="${4:-}"

  # Resolve from env var or existing .env first
  local resolved
  resolved="$(resolve "$key" "$default")"

  if [ "$NON_INTERACTIVE" = true ]; then
    printf '%s' "$resolved"
    return
  fi

  local display_default="$resolved"
  if [ "$is_secret" = "--secret" ] && [ -n "$resolved" ]; then
    display_default="(keep existing)"
  fi

  if [ -n "$display_default" ]; then
    printf "  %s [%s]: " "$prompt_text" "$display_default"
  else
    printf "  %s: " "$prompt_text"
  fi

  local input
  read -r input

  if [ -z "$input" ]; then
    printf '%s' "$resolved"
  else
    printf '%s' "$input"
  fi
}

# Prompt for a choice from a list
# Usage: prompt_choice KEY "Prompt text" DEFAULT option1 option2 ...
prompt_choice() {
  local key="$1"
  local prompt_text="$2"
  local default="$3"
  shift 3
  local options=("$@")

  local resolved
  resolved="$(resolve "$key" "$default")"

  if [ "$NON_INTERACTIVE" = true ]; then
    printf '%s' "$resolved"
    return
  fi

  printf "  %s\n" "$prompt_text"
  local i=1
  for opt in "${options[@]}"; do
    local marker=""
    if [ "$opt" = "$resolved" ]; then
      marker=" (default)"
    fi
    printf "    %d) %s%s\n" "$i" "$opt" "$marker"
    i=$((i + 1))
  done
  printf "  Choice [%s]: " "$resolved"

  local input
  read -r input

  if [ -z "$input" ]; then
    printf '%s' "$resolved"
    return
  fi

  # Accept number or text
  if [[ "$input" =~ ^[0-9]+$ ]] && [ "$input" -ge 1 ] && [ "$input" -le "${#options[@]}" ]; then
    printf '%s' "${options[$((input - 1))]}"
  else
    printf '%s' "$input"
  fi
}

# Prompt yes/no
# Usage: prompt_yn "Question" [default: y/n]
prompt_yn() {
  local prompt_text="$1"
  local default="${2:-n}"

  if [ "$NON_INTERACTIVE" = true ]; then
    printf '%s' "$default"
    return
  fi

  local hint="y/N"
  if [ "$default" = "y" ]; then
    hint="Y/n"
  fi

  printf "  %s [%s]: " "$prompt_text" "$hint"
  local input
  read -r input

  if [ -z "$input" ]; then
    printf '%s' "$default"
  else
    case "$input" in
      [Yy]*) printf 'y' ;;
      [Nn]*) printf 'n' ;;
      *) printf '%s' "$default" ;;
    esac
  fi
}

# Register a key-value pair for the output .env
set_env() {
  local key="$1"
  local value="$2"
  ENV_KEYS+=("$key")
  ENV_VALUES["$key"]="$value"
}

# Register a comment line (section header) in the output
set_comment() {
  local key="$1"
  local comment="$2"
  ENV_COMMENTS["$key"]="$comment"
}

# Validate URL format (basic check)
validate_url() {
  local url="$1"
  if [[ "$url" =~ ^https?:// ]]; then
    return 0
  fi
  return 1
}

# Validate port number
validate_port() {
  local port="$1"
  if [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --force)           FORCE_OVERWRITE=true; shift ;;
    --help|-h)         usage ;;
    *)
      error "Unknown option: $1"
      usage
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

printf "\n${BOLD}openclaw-projects setup wizard${RESET}\n"
printf "This script will generate a .env configuration file.\n\n"

# Check for openssl
if ! command -v openssl >/dev/null 2>&1; then
  error "openssl is required but not found. Please install it."
  exit 1
fi

# Load existing .env values
load_existing_env

# Handle existing .env file
if [ -f "$ENV_FILE" ] && [ "$FORCE_OVERWRITE" != true ] && [ "$NON_INTERACTIVE" != true ]; then
  printf "${YELLOW}An existing .env file was found.${RESET}\n"
  printf "  Existing values will be preserved as defaults.\n"
  printf "  Press Enter to continue or Ctrl+C to abort.\n"
  read -r
fi

# ============================================================================
# Section 1: Core Application Settings
# ============================================================================
section "Core Application Settings"

PUBLIC_BASE_URL="$(prompt_value PUBLIC_BASE_URL "Public base URL" "http://localhost:3000")"
if [ -n "$PUBLIC_BASE_URL" ] && ! validate_url "$PUBLIC_BASE_URL"; then
  warn "URL does not start with http:// or https:// — proceeding anyway"
fi
set_env PUBLIC_BASE_URL "$PUBLIC_BASE_URL"

# Auto-generate secrets if not already set
COOKIE_SECRET="$(resolve COOKIE_SECRET "")"
if [ -z "$COOKIE_SECRET" ]; then
  COOKIE_SECRET="$(generate_secret 32)"
  info "Generated COOKIE_SECRET"
fi
set_env COOKIE_SECRET "$COOKIE_SECRET"

AUTH_SECRET="$(resolve OPENCLAW_PROJECTS_AUTH_SECRET "")"
if [ -z "$AUTH_SECRET" ]; then
  AUTH_SECRET="$(generate_secret 32)"
  info "Generated OPENCLAW_PROJECTS_AUTH_SECRET"
fi
set_env OPENCLAW_PROJECTS_AUTH_SECRET "$AUTH_SECRET"

NODE_ENV="$(prompt_value NODE_ENV "Node environment" "production")"
set_env NODE_ENV "$NODE_ENV"

# ============================================================================
# Section 2: Service Ports
# ============================================================================
section "Service Ports"

API_PORT="$(prompt_value API_PORT "API port" "3000")"
if ! validate_port "$API_PORT"; then
  warn "Invalid port number: $API_PORT — using default 3000"
  API_PORT=3000
fi
set_env API_PORT "$API_PORT"

FRONTEND_PORT="$(prompt_value FRONTEND_PORT "Frontend port" "8080")"
if ! validate_port "$FRONTEND_PORT"; then
  warn "Invalid port number: $FRONTEND_PORT — using default 8080"
  FRONTEND_PORT=8080
fi
set_env FRONTEND_PORT "$FRONTEND_PORT"

# ============================================================================
# Section 3: Database
# ============================================================================
section "PostgreSQL Database"

POSTGRES_USER="$(prompt_value POSTGRES_USER "Database user" "openclaw")"
set_env POSTGRES_USER "$POSTGRES_USER"

POSTGRES_PASSWORD="$(resolve POSTGRES_PASSWORD "")"
if [ -z "$POSTGRES_PASSWORD" ]; then
  POSTGRES_PASSWORD="$(generate_secret 24)"
  info "Generated POSTGRES_PASSWORD"
fi
set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"

POSTGRES_DB="$(prompt_value POSTGRES_DB "Database name" "openclaw")"
set_env POSTGRES_DB "$POSTGRES_DB"

# ============================================================================
# Section 4: S3-Compatible Storage
# ============================================================================
section "S3-Compatible Storage (SeaweedFS)"

S3_BUCKET="$(prompt_value S3_BUCKET "S3 bucket name" "openclaw")"
set_env S3_BUCKET "$S3_BUCKET"

S3_REGION="$(prompt_value S3_REGION "S3 region" "us-east-1")"
set_env S3_REGION "$S3_REGION"

S3_ACCESS_KEY="$(prompt_value S3_ACCESS_KEY "S3 access key" "openclaw")"
set_env S3_ACCESS_KEY "$S3_ACCESS_KEY"

S3_SECRET_KEY="$(resolve S3_SECRET_KEY "")"
if [ -z "$S3_SECRET_KEY" ]; then
  S3_SECRET_KEY="$(generate_secret 32)"
  info "Generated S3_SECRET_KEY"
fi
set_env S3_SECRET_KEY "$S3_SECRET_KEY"

SEAWEEDFS_VOLUME_SIZE_LIMIT_MB="$(prompt_value SEAWEEDFS_VOLUME_SIZE_LIMIT_MB "SeaweedFS volume size limit (MB)" "1000")"
set_env SEAWEEDFS_VOLUME_SIZE_LIMIT_MB "$SEAWEEDFS_VOLUME_SIZE_LIMIT_MB"

# ============================================================================
# Section 5: Embedding Provider
# ============================================================================
section "Embedding Provider (for semantic search)"

if [ "$NON_INTERACTIVE" = true ]; then
  EMBEDDING_PROVIDER="$(resolve EMBEDDING_PROVIDER "")"
else
  printf "  Embedding providers enable semantic search via pgvector.\n"
  printf "  You can skip this and configure later.\n\n"
  EMBEDDING_PROVIDER="$(prompt_choice EMBEDDING_PROVIDER "Select embedding provider:" "" "openai" "voyagerai" "gemini" "none")"
  if [ "$EMBEDDING_PROVIDER" = "none" ]; then
    EMBEDDING_PROVIDER=""
  fi
fi

if [ -n "$EMBEDDING_PROVIDER" ]; then
  set_env EMBEDDING_PROVIDER "$EMBEDDING_PROVIDER"

  case "$EMBEDDING_PROVIDER" in
    openai)
      OPENAI_API_KEY="$(prompt_value OPENAI_API_KEY "OpenAI API key" "" --secret)"
      if [ -n "$OPENAI_API_KEY" ]; then
        set_env OPENAI_API_KEY "$OPENAI_API_KEY"
      fi
      ;;
    voyagerai)
      VOYAGERAI_API_KEY="$(prompt_value VOYAGERAI_API_KEY "VoyagerAI API key" "" --secret)"
      if [ -n "$VOYAGERAI_API_KEY" ]; then
        set_env VOYAGERAI_API_KEY "$VOYAGERAI_API_KEY"
      fi
      ;;
    gemini)
      GEMINI_API_KEY="$(prompt_value GEMINI_API_KEY "Gemini API key" "" --secret)"
      if [ -n "$GEMINI_API_KEY" ]; then
        set_env GEMINI_API_KEY "$GEMINI_API_KEY"
      fi
      ;;
  esac
fi

# ============================================================================
# Section 6: Messaging (Optional)
# ============================================================================
section "Messaging Integration (optional)"

CONFIGURE_MESSAGING="n"
if [ "$NON_INTERACTIVE" != true ]; then
  CONFIGURE_MESSAGING="$(prompt_yn "Configure email/SMS integration?" "n")"
fi

if [ "$CONFIGURE_MESSAGING" = "y" ]; then
  # Postmark
  printf "\n  ${BOLD}Postmark (transactional email):${RESET}\n"
  POSTMARK_TOKEN="$(prompt_value POSTMARK_TRANSACTIONAL_TOKEN "Postmark server token" "" --secret)"
  if [ -n "$POSTMARK_TOKEN" ]; then
    set_env POSTMARK_TRANSACTIONAL_TOKEN "$POSTMARK_TOKEN"
    POSTMARK_FROM="$(prompt_value POSTMARK_FROM "From address" "Projects <projects@example.com>")"
    set_env POSTMARK_FROM "$POSTMARK_FROM"
    POSTMARK_REPLY_TO="$(prompt_value POSTMARK_REPLY_TO "Reply-to address" "")"
    if [ -n "$POSTMARK_REPLY_TO" ]; then
      set_env POSTMARK_REPLY_TO "$POSTMARK_REPLY_TO"
    fi
  fi

  # Twilio
  printf "\n  ${BOLD}Twilio (SMS):${RESET}\n"
  TWILIO_SID="$(prompt_value TWILIO_ACCOUNT_SID "Twilio Account SID" "" --secret)"
  if [ -n "$TWILIO_SID" ]; then
    set_env TWILIO_ACCOUNT_SID "$TWILIO_SID"
    TWILIO_TOKEN="$(prompt_value TWILIO_AUTH_TOKEN "Twilio Auth Token" "" --secret)"
    set_env TWILIO_AUTH_TOKEN "$TWILIO_TOKEN"
    TWILIO_NUMBER="$(prompt_value TWILIO_FROM_NUMBER "Twilio phone number (E.164)" "")"
    set_env TWILIO_FROM_NUMBER "$TWILIO_NUMBER"
  fi
else
  # Preserve existing messaging config if present
  for key in POSTMARK_TRANSACTIONAL_TOKEN POSTMARK_FROM POSTMARK_REPLY_TO \
             TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER; do
    if [ -n "${EXISTING_ENV[$key]:-}" ]; then
      set_env "$key" "${EXISTING_ENV[$key]}"
    fi
  done
fi

# ============================================================================
# Section 7: OpenClaw Gateway (Optional)
# ============================================================================
section "OpenClaw Gateway Integration (optional)"

CONFIGURE_GATEWAY="n"
if [ "$NON_INTERACTIVE" != true ]; then
  CONFIGURE_GATEWAY="$(prompt_yn "Configure OpenClaw gateway integration?" "n")"
fi

if [ "$CONFIGURE_GATEWAY" = "y" ]; then
  OPENCLAW_GATEWAY_URL="$(prompt_value OPENCLAW_GATEWAY_URL "Gateway URL" "https://gateway.openclaw.ai")"
  set_env OPENCLAW_GATEWAY_URL "$OPENCLAW_GATEWAY_URL"
  OPENCLAW_HOOK_TOKEN="$(prompt_value OPENCLAW_HOOK_TOKEN "Hook authentication token" "" --secret)"
  if [ -n "$OPENCLAW_HOOK_TOKEN" ]; then
    set_env OPENCLAW_HOOK_TOKEN "$OPENCLAW_HOOK_TOKEN"
  fi
else
  for key in OPENCLAW_GATEWAY_URL OPENCLAW_HOOK_TOKEN; do
    if [ -n "${EXISTING_ENV[$key]:-}" ]; then
      set_env "$key" "${EXISTING_ENV[$key]}"
    fi
  done
fi

# ============================================================================
# Write .env file
# ============================================================================
section "Writing configuration"

{
  cat <<'HEADER'
# openclaw-projects environment configuration
# Generated by scripts/setup.sh
# Re-run the script to update; existing values are preserved.

HEADER

  printf "# =============================================================================\n"
  printf "# Core Application Settings\n"
  printf "# =============================================================================\n\n"

  for key in PUBLIC_BASE_URL NODE_ENV COOKIE_SECRET OPENCLAW_PROJECTS_AUTH_SECRET; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

  printf "\n# =============================================================================\n"
  printf "# Service Ports\n"
  printf "# =============================================================================\n\n"

  for key in API_PORT FRONTEND_PORT; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

  printf "\n# =============================================================================\n"
  printf "# PostgreSQL Database\n"
  printf "# =============================================================================\n\n"

  for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

  printf "\n# =============================================================================\n"
  printf "# S3-Compatible Storage (SeaweedFS)\n"
  printf "# =============================================================================\n\n"

  for key in S3_BUCKET S3_REGION S3_ACCESS_KEY S3_SECRET_KEY SEAWEEDFS_VOLUME_SIZE_LIMIT_MB; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

  printf "\n# =============================================================================\n"
  printf "# Embedding Provider\n"
  printf "# =============================================================================\n\n"

  for key in EMBEDDING_PROVIDER OPENAI_API_KEY VOYAGERAI_API_KEY GEMINI_API_KEY; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

  printf "\n# =============================================================================\n"
  printf "# Messaging Integration\n"
  printf "# =============================================================================\n\n"

  for key in POSTMARK_TRANSACTIONAL_TOKEN POSTMARK_FROM POSTMARK_REPLY_TO \
             TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

  printf "\n# =============================================================================\n"
  printf "# OpenClaw Gateway\n"
  printf "# =============================================================================\n\n"

  for key in OPENCLAW_GATEWAY_URL OPENCLAW_HOOK_TOKEN; do
    if [ -n "${ENV_VALUES[$key]:-}" ]; then
      printf '%s=%s\n' "$key" "${ENV_VALUES[$key]}"
    fi
  done

} > "$ENV_FILE"

info "Configuration written to .env"

# ============================================================================
# Summary
# ============================================================================
section "Setup Complete"

printf "  ${BOLD}Generated secrets:${RESET}\n"
# Check which secrets were auto-generated (not from existing env)
for key in COOKIE_SECRET OPENCLAW_PROJECTS_AUTH_SECRET POSTGRES_PASSWORD S3_SECRET_KEY; do
  if [ -n "${ENV_VALUES[$key]:-}" ]; then
    printf "    - %s\n" "$key"
  fi
done

printf "\n  ${BOLD}Configuration summary:${RESET}\n"
printf "    Base URL:          %s\n" "${ENV_VALUES[PUBLIC_BASE_URL]:-http://localhost:3000}"
printf "    API port:          %s\n" "${ENV_VALUES[API_PORT]:-3000}"
printf "    Frontend port:     %s\n" "${ENV_VALUES[FRONTEND_PORT]:-8080}"
printf "    Database:          %s@%s\n" "${ENV_VALUES[POSTGRES_USER]:-openclaw}" "${ENV_VALUES[POSTGRES_DB]:-openclaw}"
printf "    Embedding:         %s\n" "${ENV_VALUES[EMBEDDING_PROVIDER]:-not configured}"

printf "\n  ${BOLD}Next steps:${RESET}\n"
printf "    1. Review the generated .env file\n"
printf "    2. Start services with the quickstart compose (recommended):\n"
printf "       docker compose -f docker-compose.quickstart.yml up -d\n"
printf "    3. Verify the API is running:\n"
printf "       curl http://localhost:3000/health\n"
printf "\n  For production, use docker-compose.yml or docker-compose.traefik.yml instead.\n"
printf "\n"
