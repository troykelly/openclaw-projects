-- Issue #29 follow-up: fix idempotency constraints so ON CONFLICT works reliably.

-- Replace partial unique indexes with plain UNIQUE constraints (NULL idempotency_key values do not conflict).

DROP FUNCTION IF EXISTS enqueue_due_nudges();
DROP FUNCTION IF EXISTS internal_job_enqueue(text, timestamptz, jsonb, text);

DROP INDEX IF EXISTS internal_job_kind_idempotency_uniq;
DROP INDEX IF EXISTS webhook_outbox_kind_idempotency_uniq;

ALTER TABLE internal_job
  ADD CONSTRAINT internal_job_kind_idempotency_uniq UNIQUE (kind, idempotency_key);

ALTER TABLE webhook_outbox
  ADD CONSTRAINT webhook_outbox_kind_idempotency_uniq UNIQUE (kind, idempotency_key);

CREATE OR REPLACE FUNCTION internal_job_enqueue(
  p_kind text,
  p_run_at timestamptz,
  p_payload jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
AS $$
  WITH ins AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    VALUES (p_kind, p_run_at, COALESCE(p_payload, '{}'::jsonb), p_idempotency_key)
    ON CONFLICT ON CONSTRAINT internal_job_kind_idempotency_uniq DO NOTHING
    RETURNING id
  )
  SELECT id FROM ins;
$$;

CREATE OR REPLACE FUNCTION enqueue_due_nudges()
RETURNS integer
LANGUAGE sql
AS $$
  WITH candidates AS (
    SELECT wi.id,
           wi.not_after
      FROM work_item wi
     WHERE wi.not_after IS NOT NULL
       AND wi.not_after > now()
       AND wi.not_after <= (now() + interval '24 hours')
       AND wi.status <> 'done'
  ),
  inserted AS (
    INSERT INTO internal_job (kind, run_at, payload, idempotency_key)
    SELECT 'nudge.work_item.not_after',
           now(),
           jsonb_build_object(
             'work_item_id', c.id::text,
             'not_after', c.not_after
           ),
           'work_item_not_after:' || c.id::text || ':' || to_char(c.not_after, 'YYYY-MM-DD')
      FROM candidates c
    ON CONFLICT ON CONSTRAINT internal_job_kind_idempotency_uniq DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;
