-- Issue #1178 rollback: restore original claim/complete/fail without hardening

-- Restore original internal_job_claim (no attempt cap)
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

-- Drop overloaded versions first (must match exact signatures)
DROP FUNCTION IF EXISTS internal_job_complete(uuid, text);
DROP FUNCTION IF EXISTS internal_job_fail(uuid, text, integer, text);

-- Restore original internal_job_complete (no ownership check)
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

-- Restore original internal_job_fail (no ownership check)
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
