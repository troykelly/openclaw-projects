-- Issue #29: pg_cron-backed internal nudge scheduler + durable dispatch/outbox tables

-- A generic internal job queue for DB-scheduled callbacks.
CREATE TABLE IF NOT EXISTS internal_job (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  kind text NOT NULL CHECK (length(trim(kind)) > 0),
  run_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS internal_job_run_at_idx ON internal_job (run_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS internal_job_locked_at_idx ON internal_job (locked_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS internal_job_kind_idx ON internal_job (kind) WHERE completed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS internal_job_kind_idempotency_uniq
  ON internal_job (kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- A dedicated outbound dispatch table (outbox) for webhooks/notifications.
-- Provider-specific delivery is handled in the backend; DB only records intent and timing.
CREATE TABLE IF NOT EXISTS webhook_outbox (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  kind text NOT NULL CHECK (length(trim(kind)) > 0),
  destination text NOT NULL CHECK (length(trim(destination)) > 0),
  run_at timestamptz NOT NULL DEFAULT now(),
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  dispatched_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_outbox_run_at_idx ON webhook_outbox (run_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS webhook_outbox_locked_at_idx ON webhook_outbox (locked_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS webhook_outbox_kind_idx ON webhook_outbox (kind) WHERE dispatched_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS webhook_outbox_kind_idempotency_uniq
  ON webhook_outbox (kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Helper: enqueue with optional idempotency key.
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
    ON CONFLICT (kind, idempotency_key) WHERE p_idempotency_key IS NOT NULL DO NOTHING
    RETURNING id
  )
  SELECT id FROM ins;
$$;

-- Claim due jobs with a lock (FOR UPDATE SKIP LOCKED) to prevent double-processing.
-- Also considers stale locks (older than 5 minutes) as reclaimable.
CREATE OR REPLACE FUNCTION internal_job_claim(
  p_worker text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  kind text,
  run_at timestamptz,
  payload jsonb,
  attempts integer,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  idempotency_key text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
AS $$
  WITH due AS (
    SELECT j.id
      FROM internal_job j
     WHERE j.completed_at IS NULL
       AND j.run_at <= now()
       AND (
         j.locked_at IS NULL
         OR j.locked_at < (now() - interval '5 minutes')
       )
     ORDER BY j.run_at ASC, j.created_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(p_limit, 0)
  )
  UPDATE internal_job j
     SET locked_at = now(),
         locked_by = p_worker,
         updated_at = now()
    FROM due
   WHERE j.id = due.id
  RETURNING j.id, j.kind, j.run_at, j.payload, j.attempts, j.last_error,
            j.locked_at, j.locked_by, j.completed_at, j.idempotency_key, j.created_at, j.updated_at;
$$;

CREATE OR REPLACE FUNCTION internal_job_complete(p_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE internal_job
     SET completed_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now()
   WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION internal_job_fail(
  p_id uuid,
  p_error text,
  p_retry_seconds integer DEFAULT 60
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE internal_job
     SET attempts = attempts + 1,
         last_error = p_error,
         run_at = now() + make_interval(secs => GREATEST(p_retry_seconds, 0)),
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now()
   WHERE id = p_id;
$$;

-- Nudge enqueuer: work items whose not_after is within 24 hours.
-- This is deliberately conservative (no provider-specific side effects here).
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
    ON CONFLICT (kind, idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$$;

-- Register a pg_cron job to periodically enqueue nudges.
-- Idempotent: only creates the cron entry if it does not exist.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'internal_nudge_enqueue') THEN
    PERFORM cron.schedule(
      'internal_nudge_enqueue',
      '*/1 * * * *',
      $cmd$SELECT enqueue_due_nudges();$cmd$
    );
  END IF;
END $do$;
