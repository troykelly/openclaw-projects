-- ============================================================
-- Migration 104: Cleanup corrupted auto-capture memory rows
-- Issue #1565 — Omnibus #1561: auto-capture serialised structured
-- message content as [object Object] before the hook fix in #1563.
-- ============================================================

-- Delete memory rows where the content is the stringified object placeholder.
-- Only target rows created by the auto-capture hook to avoid false positives.
DELETE FROM memory
WHERE content LIKE '%[object Object]%'
  AND created_by_agent = 'auto-capture';
