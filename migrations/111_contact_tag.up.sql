-- ============================================================
-- Migration 111: contact_tag table
-- Issue #1576 — Epic #1569: Identity Model & Contacts v2
-- Design: docs/plans/2026-02-22-contacts-v2-full-featured.md §3.5
-- ============================================================

-- Note: No namespace column on child tables. Namespace is inherited
-- from the parent contact via JOIN (see design doc §3.5 note).

CREATE TABLE IF NOT EXISTS contact_tag (
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(trim(tag)) > 0 AND length(tag) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_contact_tag_tag ON contact_tag(tag);

COMMENT ON TABLE contact_tag IS 'Tags/labels for contacts (analogous to Google Contact Groups or Outlook Categories)';
