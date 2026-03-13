#!/bin/bash
# reset-test-db.sh — truncate all application tables before a test run.
#
# Purpose:
#   Running `pnpm test` consecutively in the devcontainer causes ~216
#   spurious failures due to DB state contamination (Issue #2504).
#   This script resets the test database so every run starts clean.
#
# Usage:
#   ./scripts/reset-test-db.sh         # manual invocation
#   pnpm test:clean                     # preferred — runs this then full suite
#
# Safety gate:
#   The script will REFUSE to run unless PGDATABASE matches one of the
#   known-safe test database names OR the ALLOW_RESET_DB_OVERRIDE env var
#   is set to "yes-i-know-what-i-am-doing".
#   This prevents accidentally wiping a production or staging database if
#   your shell happens to point at a non-test target.
#
# Known-safe database names (configurable via RESET_DB_SAFE_NAMES):
#   openclaw, openclaw_test, openclaw_ci, test, postgres
#
# Environment variables (mirrors tests/helpers/db.ts defaults):
#   PGHOST      — default: "postgres" inside devcontainer, "localhost" outside
#   PGPORT      — default: 5432
#   PGUSER      — default: openclaw
#   PGPASSWORD  — default: openclaw
#   PGDATABASE  — default: openclaw

set -euo pipefail

# ---------------------------------------------------------------------------
# Connection defaults
# ---------------------------------------------------------------------------

# Detect whether we are inside a devcontainer (Docker-in-Docker environment).
# Inside the devcontainer, Postgres is reachable via the "postgres" hostname.
# Outside (e.g. a developer's local machine), it is reachable via localhost.
if [ -f /.dockerenv ]; then
  DEFAULT_HOST="postgres"
else
  DEFAULT_HOST="localhost"
fi

PGHOST="${PGHOST:-${DEFAULT_HOST}}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-openclaw}"
PGPASSWORD="${PGPASSWORD:-openclaw}"
PGDATABASE="${PGDATABASE:-openclaw}"

export PGPASSWORD

# ---------------------------------------------------------------------------
# Safety gate — refuse to truncate obviously non-test databases.
# ---------------------------------------------------------------------------

# Comma-separated list of database names this script is allowed to reset.
# Override via RESET_DB_SAFE_NAMES if your CI uses a different name.
RESET_DB_SAFE_NAMES="${RESET_DB_SAFE_NAMES:-openclaw,openclaw_test,openclaw_ci,test,postgres}"

db_is_safe() {
  local db="$1"
  IFS=',' read -ra safe_names <<< "${RESET_DB_SAFE_NAMES}"
  for name in "${safe_names[@]}"; do
    if [ "${db}" = "${name}" ]; then
      return 0
    fi
  done
  return 1
}

if [ "${ALLOW_RESET_DB_OVERRIDE:-}" != "yes-i-know-what-i-am-doing" ]; then
  if ! db_is_safe "${PGDATABASE}"; then
    echo "[reset-test-db] ERROR: Refusing to truncate '${PGDATABASE}'." >&2
    echo "[reset-test-db] Database name is not in the safe-list: ${RESET_DB_SAFE_NAMES}" >&2
    echo "[reset-test-db] To override (dangerous!), set:" >&2
    echo "[reset-test-db]   ALLOW_RESET_DB_OVERRIDE=yes-i-know-what-i-am-doing" >&2
    echo "[reset-test-db] Or add your database name to:" >&2
    echo "[reset-test-db]   RESET_DB_SAFE_NAMES=${RESET_DB_SAFE_NAMES},${PGDATABASE}" >&2
    exit 1
  fi
fi

echo "[reset-test-db] Connecting to ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"

# ---------------------------------------------------------------------------
# Verify connectivity before proceeding.
# ---------------------------------------------------------------------------

if ! psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
     -c "SELECT 1" --quiet --tuples-only > /dev/null 2>&1; then
  echo "[reset-test-db] ERROR: Cannot connect to Postgres. Is the devcontainer running?" >&2
  echo "[reset-test-db] Hint: run \`pnpm db:up\` to start the database." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Application tables in FK-safe order (children first, parents last).
# This list mirrors APPLICATION_TABLES in tests/helpers/db.ts.
# Keep both in sync when adding new tables.
# ---------------------------------------------------------------------------

TABLES=(
  # FK children first — mirrors APPLICATION_TABLES in tests/helpers/db.ts
  # Keep in sync when adding new tables.
  list_item
  list
  context_link
  context
  relationship
  relationship_type
  work_item_label
  label
  memory_contact
  memory_relationship
  unified_memory_attachment
  work_item_external_link
  work_item_communication
  work_item_contact
  work_item_attachment
  work_item_todo
  work_item_activity
  message_attachment
  memory_attachment
  external_message
  external_thread
  contact_endpoint
  contact_address
  contact_date
  contact_tag
  contact_external_identity
  contact_merge_log
  work_item_dependency
  work_item_participant
  notification
  notification_preference
  work_item_comment_reaction
  work_item_comment
  user_presence
  calendar_event
  oauth_state
  oauth_connection
  # Note/notebook tables (Epic #337)
  note_work_item_reference
  note_version
  note_collaborator
  note_share
  notebook_share
  note
  notebook
  # Skill Store (Epic #794)
  skill_store_activity
  skill_store_schedule
  skill_store_item
  # Agent identity (Issue #1287)
  agent_identity_history
  agent_identity
  # Entity links (polymorphic)
  entity_link
  # Symphony orchestration (Epic #2186) — FK children first
  symphony_run_terminal
  symphony_provisioning_step
  symphony_run_event
  symphony_cleanup_item
  symphony_secret_deployment
  symphony_container
  symphony_run
  symphony_workspace
  symphony_claim
  symphony_circuit_breaker
  symphony_github_rate_limit
  symphony_orchestrator_heartbeat
  symphony_notification_rule
  symphony_orchestrator_config
  symphony_tool_config
  symphony_dead_letter
  github_issue_sync
  project_host
  project_repository
  project_event
  project_webhook
  # Dev session terminal links (Issue #1988)
  dev_session_terminal
  # Dev sessions (Issue #1285)
  dev_session
  # Recipes (Issue #1278)
  recipe_image
  recipe_step
  recipe_ingredient
  recipe
  # Meal log (Issue #1279)
  meal_log
  # Pantry inventory (Issue #1280)
  pantry_item
  # Terminal management (Epic #1667) — FK children first
  terminal_activity
  terminal_session_entry
  terminal_session_pane
  terminal_session_window
  terminal_tunnel
  terminal_session
  terminal_known_host
  terminal_enrollment_token
  terminal_connection
  terminal_credential
  terminal_setting
  # API sources — FK children first
  api_memory
  api_credential
  api_source_link
  api_source
  # Chat (Epic #1940) — FK children first
  notification_dedup
  notification_rate
  chat_read_cursor
  chat_activity
  chat_session
  # Dev Prompts (Epic #2011)
  dev_prompt
  # Gateway (Epic #2153)
  gateway_connection
  gateway_agent_cache
  # Inbound routing (Epic #1497)
  channel_default
  inbound_destination
  prompt_template
  # Note export (Epic #2475)
  note_export
  # Async/queue tables
  webhook_outbox
  internal_job
  # File storage
  file_share
  file_attachment
  # Embedding tracking
  embedding_usage
  embedding_config
  embedding_settings
  # Geolocation (optional)
  geo_location
  geo_provider_user
  geo_provider
  # HA connector
  ha_anomalies
  ha_entity_tier_config
  ha_observations
  ha_routine_feedback
  ha_routines
  ha_state_snapshots
  # Voice assistant
  voice_message
  voice_conversation
  voice_agent_config
  # Audit
  audit_log
  # Auth sessions
  auth_session
  # Parents
  memory
  work_item_memory
  work_item
  contact
  # Namespace / user settings (not FK-linked from above, must be explicit)
  namespace_grant
  user_setting
  auth_refresh_token
  auth_one_time_code
  auth_magic_link
)

# ---------------------------------------------------------------------------
# Discover which of the listed tables actually exist in schema 'public'.
# Filtering here means the script is safe to run against a partially-migrated
# database (e.g. right after a fresh migration, before all tables exist).
# ---------------------------------------------------------------------------

TABLE_CSV=$(printf "'%s'," "${TABLES[@]}")
TABLE_CSV="${TABLE_CSV%,}"  # strip trailing comma

EXISTING=$(psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
  --tuples-only --no-align \
  -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (${TABLE_CSV}) ORDER BY 1;")

if [ -z "${EXISTING}" ]; then
  echo "[reset-test-db] No application tables found — nothing to truncate."
  echo "[reset-test-db] Run migrations first: pnpm migrate:up"
  exit 0
fi

# ---------------------------------------------------------------------------
# Build and execute the TRUNCATE statement.
#
# Tables are schema-qualified as public."tablename" to be immune to
# search_path configuration on the connected role.
# The table list comes from pg_tables discovery (not user input), so there
# is no SQL injection risk, but we still quote identifiers for safety.
# ---------------------------------------------------------------------------

TABLE_COUNT=$(echo "${EXISTING}" | wc -l | tr -d ' ')

TRUNCATE_LIST=$(echo "${EXISTING}" | while IFS= read -r tbl; do
  printf 'public."%s",' "${tbl}"
done)
TRUNCATE_LIST="${TRUNCATE_LIST%,}"  # strip trailing comma

TRUNCATE_SQL="TRUNCATE TABLE ${TRUNCATE_LIST} RESTART IDENTITY CASCADE;"

echo "[reset-test-db] Truncating ${TABLE_COUNT} tables in public schema..."

psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
  --quiet -c "${TRUNCATE_SQL}"

echo "[reset-test-db] Done. Database '${PGDATABASE}' is clean."
