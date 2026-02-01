-- Add sort_order column for reordering work items within same parent
-- Issue #104

-- Add sort_order column with default based on creation time
ALTER TABLE work_item
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Initialize sort_order based on created_at for existing items
-- Items with same parent get sequential sort_order
UPDATE work_item wi
SET sort_order = subq.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY parent_work_item_id
    ORDER BY created_at ASC
  ) as row_num
  FROM work_item
) subq
WHERE wi.id = subq.id;

-- Make sort_order NOT NULL after initialization
ALTER TABLE work_item
  ALTER COLUMN sort_order SET NOT NULL;

-- Default for new items: use timestamp to avoid conflicts
ALTER TABLE work_item
  ALTER COLUMN sort_order SET DEFAULT EXTRACT(EPOCH FROM now())::integer;

-- Index for efficient sibling ordering
CREATE INDEX IF NOT EXISTS idx_work_item_parent_sort_order
  ON work_item(parent_work_item_id, sort_order);
