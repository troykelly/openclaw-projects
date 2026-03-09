-- no-transaction
-- Issue #2289: Add 'list' kind to work_item_kind enum
-- Issue #2305: Migrate work_item.sort_order from INTEGER to BIGINT

-- STEP 1: Add 'list' to the work_item_kind enum (must be outside transaction)
ALTER TYPE work_item_kind ADD VALUE IF NOT EXISTS 'list'
