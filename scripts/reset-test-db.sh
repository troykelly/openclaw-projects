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
# Environment variables (mirrors tests/helpers/db.ts defaults):
#   PGHOST      — default: "postgres" inside devcontainer, "localhost" outside
#   PGPORT      — default: 5432
#   PGUSER      — default: openclaw
#   PGPASSWORD  — default: openclaw
#   PGDATABASE  — default: openclaw

set -euo pipefail

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

echo "[reset-test-db] Connecting to ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"

# Verify connectivity before proceeding.
if ! psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
     -c "SELECT 1" --quiet --tuples-only > /dev/null 2>&1; then
  echo "[reset-test-db] ERROR: Cannot connect to Postgres. Is the devcontainer running?" >&2
  echo "[reset-test-db] Hint: run \`pnpm db:up\` to start the database." >&2
  exit 1
fi

# Application tables in FK-safe order (children first, parents last).
# This list mirrors APPLICATION_TABLES in tests/helpers/db.ts.
# Keep both in sync when adding new tables.
TABLES=(
  list_item
  list
  context_link
  context
  relationship
  work_item_label
  label
  memory_contact
  memory_relationship
  work_item_external_link
  work_item_communication
  work_item_contact
  work_item_attachment
  message_attachment
  memory_attachment
  external_message
  external_thread
  contact_endpoint
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
  note_work_item_reference
  note_version
  note_collaborator
  note_share
  notebook_share
  note
  notebook
  skill_store_activity
  skill_store_schedule
  skill_store_item
  agent_identity_history
  agent_identity
  entity_link
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
  github_issue_sync
  project_host
  project_repository
  dev_session_terminal
  dev_session
  recipe_image
  recipe_step
  recipe_ingredient
  recipe
  meal_log
  pantry_item
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
  api_memory
  api_credential
  api_source_link
  api_source
  notification_dedup
  notification_rate
  chat_read_cursor
  chat_session
  dev_prompt
  gateway_connection
  channel_default
  inbound_destination
  prompt_template
  note_export
  webhook_outbox
  internal_job
  file_share
  file_attachment
  embedding_usage
  memory
  work_item_memory
  work_item
  contact
  auth_refresh_token
  auth_one_time_code
  auth_magic_link
)

# Build a comma-separated quoted table list, filtering to tables that actually
# exist in the current schema (safe against partial migrations / new tables).
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

# Build TRUNCATE statement with quoted identifiers.
TRUNCATE_LIST=$(echo "${EXISTING}" | tr '\n' ',' | sed 's/,$//' | sed 's/,/", "/g')
TRUNCATE_SQL="TRUNCATE TABLE \"${TRUNCATE_LIST}\" RESTART IDENTITY CASCADE;"

echo "[reset-test-db] Truncating $(echo "${EXISTING}" | wc -l | tr -d ' ') tables..."

psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
  --quiet -c "${TRUNCATE_SQL}"

echo "[reset-test-db] Done. Database is clean."
