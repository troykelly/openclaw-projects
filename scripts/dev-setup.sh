#!/bin/bash
# Development setup script
# Usage: ./scripts/dev-setup.sh [--reset] [--seed] [--link EMAIL]
#
# Options:
#   --reset    Reset database and run migrations
#   --seed     Seed sample data
#   --link     Generate magic link for EMAIL

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Database connection
export PGHOST="${PGHOST:-postgres}"
export PGUSER="${PGUSER:-openclaw}"
export PGPASSWORD="${PGPASSWORD:-openclaw}"
export PGDATABASE="${PGDATABASE:-openclaw}"

RESET=false
SEED=false
LINK_EMAIL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --reset)
      RESET=true
      shift
      ;;
    --seed)
      SEED=true
      shift
      ;;
    --link)
      LINK_EMAIL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "==> Checking database connection..."
if ! psql -c "SELECT 1" > /dev/null 2>&1; then
  echo "ERROR: Cannot connect to database. Is PostgreSQL running?"
  exit 1
fi
echo "    Database connection OK"

if [ "$RESET" = true ]; then
  echo "==> Resetting database..."
  psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $PGUSER;"
  echo "    Schema reset complete"
fi

echo "==> Running migrations..."
# Ensure schema_migrations table exists for test compatibility
psql -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version bigint PRIMARY KEY,
    dirty boolean NOT NULL DEFAULT false,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false;
  ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at timestamptz NOT NULL DEFAULT now();
" > /dev/null 2>&1
for f in "$PROJECT_ROOT"/migrations/*.up.sql; do
  migration_name=$(basename "$f")
  # Extract numeric version prefix (e.g. "003" from "003_work_items_core.up.sql")
  version=$(echo "$migration_name" | grep -oE '^[0-9]+')
  # Use ON_ERROR_STOP so psql returns non-zero on SQL errors
  if psql -v ON_ERROR_STOP=1 -f "$f" > /dev/null 2>&1; then
    # Track the applied version in schema_migrations
    psql -c "INSERT INTO schema_migrations(version, dirty) VALUES ($version, false) ON CONFLICT (version) DO NOTHING;" > /dev/null 2>&1
    echo "    Applied: $migration_name"
  else
    echo "    Already applied or error: $migration_name"
  fi
done
echo "    Migrations complete"

if [ "$SEED" = true ]; then
  echo "==> Seeding sample data..."
  psql << 'EOF'
-- Create a test project
INSERT INTO work_item (id, title, description, status, work_item_kind, priority)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Platform Completeness Demo', 'Showcase all the new features implemented in Epic #179', 'in_progress', 'project', 'P2')
ON CONFLICT DO NOTHING;

-- Create an epic under the project
INSERT INTO work_item (id, title, description, status, work_item_kind, priority, parent_work_item_id)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'User Experience Improvements', 'Collection of UX enhancements', 'open', 'epic', 'P2', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

-- Create some issues
INSERT INTO work_item (id, title, description, status, work_item_kind, priority, parent_work_item_id, not_after)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'Add dark mode toggle', 'Implement theme switching in user settings', 'open', 'issue', 'P2', '22222222-2222-2222-2222-222222222222', now() + interval '3 days'),
  ('44444444-4444-4444-4444-444444444444', 'Keyboard navigation polish', 'Review and improve keyboard shortcuts', 'in_progress', 'issue', 'P3', '22222222-2222-2222-2222-222222222222', now() + interval '1 day'),
  ('55555555-5555-5555-5555-555555555555', 'Performance optimization', 'Improve load times for dashboard', 'closed', 'issue', 'P2', '22222222-2222-2222-2222-222222222222', null)
ON CONFLICT DO NOTHING;

-- Create a contact
INSERT INTO contact (id, display_name, notes)
VALUES ('66666666-6666-6666-6666-666666666666', 'Demo Contact', 'Demo contact for testing')
ON CONFLICT DO NOTHING;

INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
VALUES ('66666666-6666-6666-6666-666666666666', 'email', 'demo@example.com', 'demo@example.com')
ON CONFLICT DO NOTHING;

-- Add some comments
INSERT INTO work_item_comment (work_item_id, user_email, content, mentions)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'demo@openclaw.dev', 'This is looking great! We should prioritize this for the next sprint.', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'demo@openclaw.dev', 'Working on the cmd+k shortcut improvements now.', '{}')
ON CONFLICT DO NOTHING;
EOF
  echo "    Sample data seeded"
fi

if [ -n "$LINK_EMAIL" ]; then
  echo "==> Generating magic link for $LINK_EMAIL..."

  # Generate token and create magic link
  TOKEN=$(openssl rand -hex 32)
  HASH=$(echo -n "$TOKEN" | sha256sum | cut -d' ' -f1)

  psql -c "
    INSERT INTO auth_magic_link (email, token_sha256, expires_at)
    VALUES ('$LINK_EMAIL', '$HASH', now() + interval '1 hour');
  " > /dev/null

  # Create user settings if not exists
  psql -c "
    INSERT INTO user_setting (email, theme)
    VALUES ('$LINK_EMAIL', 'system')
    ON CONFLICT (email) DO NOTHING;
  " > /dev/null

  echo ""
  echo "=============================================="
  echo "  Magic Link (valid for 1 hour):"
  echo "  http://localhost:3000/api/auth/consume?token=$TOKEN"
  echo "=============================================="
  echo ""
fi

echo "==> Done!"
