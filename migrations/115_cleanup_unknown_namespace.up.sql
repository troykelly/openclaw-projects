-- Issue #1644: Migrate entities created with namespace='unknown'
-- (caused by plugin bug where agent ID defaulted to 'unknown')
-- Moves all 'unknown' namespace rows to 'default'.

DO $$
DECLARE
  tbl text;
  cnt int;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'work_item', 'contact', 'contact_endpoint', 'memory',
      'relationship', 'external_thread', 'external_message',
      'notebook', 'note', 'notification', 'list', 'recipe',
      'meal_log', 'pantry_item', 'entity_link', 'context',
      'file_attachment', 'file_share', 'skill_store_item', 'dev_session'
    ])
  LOOP
    EXECUTE format(
      'UPDATE %I SET namespace = $1, updated_at = now() WHERE namespace = $2',
      tbl
    ) USING 'default', 'unknown';
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN
      RAISE NOTICE 'Migrated % rows in % from unknown to default', cnt, tbl;
    END IF;
  END LOOP;
END $$;
