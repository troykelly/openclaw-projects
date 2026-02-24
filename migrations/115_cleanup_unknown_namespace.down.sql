-- No-op: namespace='unknown' data migration is irreversible (data was buggy).
-- Original namespace was always intended to be the agent's real namespace,
-- not 'unknown'. There is no meaningful rollback.
SELECT 1;
