-- UUID helpers
-- Postgres 18 provides built-in uuidv7() (RFC 9562).
-- We wrap it so app code can depend on a stable function name.

CREATE OR REPLACE FUNCTION new_uuid()
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$
  SELECT uuidv7();
$$;
