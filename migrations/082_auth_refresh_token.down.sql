-- Down migration 082: Remove auth refresh token table
-- Issue #1324, Epic #1322

DROP TABLE IF EXISTS auth_refresh_token;
