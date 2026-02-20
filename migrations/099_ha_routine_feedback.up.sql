-- ============================================================
-- Migration 099: Home Assistant routine feedback table
-- Epic #1440 — HA observation pipeline
-- Issue #1466 — Feedback loop with confidence adjustments
-- ============================================================

CREATE TABLE ha_routine_feedback (
  id UUID PRIMARY KEY DEFAULT new_uuid(),
  namespace TEXT NOT NULL DEFAULT 'default'
    CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  routine_id UUID NOT NULL REFERENCES ha_routines(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('confirmed', 'rejected', 'modified', 'automation_accepted', 'automation_rejected')),
  source TEXT NOT NULL DEFAULT 'agent',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ha_feedback_routine ON ha_routine_feedback (routine_id);
CREATE INDEX idx_ha_feedback_namespace ON ha_routine_feedback (namespace, created_at DESC);
