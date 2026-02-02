-- Issue #221: Rollback work item labels

-- Drop functions
DROP FUNCTION IF EXISTS remove_work_item_label(uuid, text);
DROP FUNCTION IF EXISTS add_work_item_label(uuid, text);
DROP FUNCTION IF EXISTS set_work_item_labels(uuid, text[]);
DROP FUNCTION IF EXISTS get_or_create_label(text);

-- Drop trigger and function
DROP TRIGGER IF EXISTS label_normalize_name ON label;
DROP FUNCTION IF EXISTS set_label_normalized_name();
DROP FUNCTION IF EXISTS normalize_label_name(text);

-- Drop tables
DROP TABLE IF EXISTS work_item_label;
DROP TABLE IF EXISTS label;
