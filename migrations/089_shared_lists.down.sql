-- Rollback Issue #1277: shared lists
DROP TABLE IF EXISTS list_item CASCADE;
DROP TRIGGER IF EXISTS list_updated_at_trigger ON list;
DROP FUNCTION IF EXISTS update_list_updated_at();
DROP TABLE IF EXISTS list CASCADE;
DROP TRIGGER IF EXISTS list_item_updated_at_trigger ON list_item;
DROP FUNCTION IF EXISTS update_list_item_updated_at();
