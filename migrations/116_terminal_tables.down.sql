-- Rollback Migration 116: Terminal management tables
-- Drop in reverse dependency order.

DROP TABLE IF EXISTS terminal_activity CASCADE;
DROP TABLE IF EXISTS terminal_enrollment_token CASCADE;
DROP TABLE IF EXISTS terminal_tunnel CASCADE;
DROP TABLE IF EXISTS terminal_session_entry CASCADE;
DROP TABLE IF EXISTS terminal_session_pane CASCADE;
DROP TABLE IF EXISTS terminal_session_window CASCADE;
DROP TABLE IF EXISTS terminal_session CASCADE;
DROP TABLE IF EXISTS terminal_known_host CASCADE;
DROP TABLE IF EXISTS terminal_connection CASCADE;
DROP TABLE IF EXISTS terminal_credential CASCADE;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_terminal_credential_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_terminal_connection_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_terminal_session_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_terminal_session_window_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_terminal_session_pane_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_terminal_tunnel_updated_at() CASCADE;
