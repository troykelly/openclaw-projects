-- Issue #1337: Drop legacy auth_session table
-- Session cookie auth has been replaced by JWT bearer tokens.

DROP TABLE IF EXISTS auth_session;
