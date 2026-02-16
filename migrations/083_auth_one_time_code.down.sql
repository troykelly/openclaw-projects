-- Rollback migration 083: Remove one-time authorization codes table
DROP TABLE IF EXISTS auth_one_time_code;
