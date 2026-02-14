-- Migration 061: Backfill user_email for existing rows
-- Issue #1192 (part of #1172): Assign a default scope to all pre-existing data
-- that was created before user_email scoping was introduced in migration 060.
--
-- We use the sentinel value 'default@openclaw.local' so that:
--   1. Existing single-agent deployments continue to work — all data belongs
--      to one logical owner.
--   2. The value is clearly distinguishable from real email addresses, making
--      it easy for operators to reassign data to actual users later.
--   3. The down migration can reliably reverse just the rows it touched.

-- work_item
UPDATE work_item SET user_email = 'default@openclaw.local' WHERE user_email IS NULL;

-- contact
UPDATE contact SET user_email = 'default@openclaw.local' WHERE user_email IS NULL;

-- contact_endpoint
UPDATE contact_endpoint SET user_email = 'default@openclaw.local' WHERE user_email IS NULL;

-- relationship
UPDATE relationship SET user_email = 'default@openclaw.local' WHERE user_email IS NULL;

-- external_thread
UPDATE external_thread SET user_email = 'default@openclaw.local' WHERE user_email IS NULL;

-- external_message
UPDATE external_message SET user_email = 'default@openclaw.local' WHERE user_email IS NULL;

-- NOTE: Adding NOT NULL constraint is deferred intentionally.
-- Once all API routes enforce user_email on insert/update (Phases 2-12),
-- a future migration should add:
--   ALTER TABLE <table> ALTER COLUMN user_email SET NOT NULL;
-- for each table above.
