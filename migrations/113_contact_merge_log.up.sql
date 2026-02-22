-- ============================================================
-- Migration 113: contact_merge_log table
-- Issue #1578 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §4.7
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_merge_log (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  survivor_id uuid NOT NULL REFERENCES contact(id),
  loser_id uuid NOT NULL,  -- No FK: loser is soft-deleted after merge
  merged_by text,           -- Email of human or agent ID that initiated
  survivor_snapshot jsonb NOT NULL,  -- Pre-merge state of survivor
  loser_snapshot jsonb NOT NULL,     -- Pre-merge state of loser
  merged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_merge_log_survivor
  ON contact_merge_log(survivor_id);
CREATE INDEX IF NOT EXISTS idx_contact_merge_log_loser
  ON contact_merge_log(loser_id);
CREATE INDEX IF NOT EXISTS idx_contact_merge_log_merged_at
  ON contact_merge_log(merged_at);

COMMENT ON TABLE contact_merge_log IS 'Audit trail for contact merge operations, preserving pre-merge snapshots';
COMMENT ON COLUMN contact_merge_log.loser_id IS 'ID of the merged-away contact (no FK since it is soft-deleted)';
COMMENT ON COLUMN contact_merge_log.merged_by IS 'Email of human or agent ID that initiated the merge';
