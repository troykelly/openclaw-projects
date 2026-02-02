-- Migration: Add soft delete support
-- Part of Issue #225

-- Add deleted_at column to work_item
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Add deleted_at column to contact
ALTER TABLE contact ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Create indexes for efficient filtering of deleted items
CREATE INDEX IF NOT EXISTS idx_work_item_deleted_at
ON work_item(deleted_at)
WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_deleted_at
ON contact(deleted_at)
WHERE deleted_at IS NOT NULL;

-- Create view for active (non-deleted) work items
CREATE OR REPLACE VIEW work_item_active AS
SELECT *
FROM work_item
WHERE deleted_at IS NULL;

-- Create view for active (non-deleted) contacts
CREATE OR REPLACE VIEW contact_active AS
SELECT *
FROM contact
WHERE deleted_at IS NULL;

-- Create view for deleted (trash) work items
CREATE OR REPLACE VIEW work_item_trash AS
SELECT *
FROM work_item
WHERE deleted_at IS NOT NULL;

-- Create view for deleted (trash) contacts
CREATE OR REPLACE VIEW contact_trash AS
SELECT *
FROM contact
WHERE deleted_at IS NOT NULL;

-- Function to purge old soft-deleted items
CREATE OR REPLACE FUNCTION purge_soft_deleted(
  retention_days integer DEFAULT 30
) RETURNS TABLE (
  work_items_purged bigint,
  contacts_purged bigint
) AS $$
DECLARE
  cutoff_date timestamptz;
  wi_count bigint;
  c_count bigint;
BEGIN
  cutoff_date := now() - (retention_days || ' days')::interval;

  -- Purge old deleted work items
  DELETE FROM work_item
  WHERE deleted_at IS NOT NULL
    AND deleted_at < cutoff_date;
  GET DIAGNOSTICS wi_count = ROW_COUNT;

  -- Purge old deleted contacts
  DELETE FROM contact
  WHERE deleted_at IS NOT NULL
    AND deleted_at < cutoff_date;
  GET DIAGNOSTICS c_count = ROW_COUNT;

  RETURN QUERY SELECT wi_count, c_count;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION purge_soft_deleted(integer) TO current_user;

COMMENT ON COLUMN work_item.deleted_at IS 'Soft delete timestamp. NULL means active, non-NULL means deleted.';
COMMENT ON COLUMN contact.deleted_at IS 'Soft delete timestamp. NULL means active, non-NULL means deleted.';
COMMENT ON VIEW work_item_active IS 'View of non-deleted work items';
COMMENT ON VIEW contact_active IS 'View of non-deleted contacts';
COMMENT ON VIEW work_item_trash IS 'View of soft-deleted work items pending permanent deletion';
COMMENT ON VIEW contact_trash IS 'View of soft-deleted contacts pending permanent deletion';
COMMENT ON FUNCTION purge_soft_deleted(integer) IS 'Permanently deletes soft-deleted items older than retention_days';
