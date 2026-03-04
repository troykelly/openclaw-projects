-- ============================================================
-- Migration 133 (down): Revert terminal CHECK constraints
-- Issue #2119
-- ============================================================

ALTER TABLE terminal_credential
  DROP CONSTRAINT IF EXISTS chk_terminal_credential_command_timeout_s;

ALTER TABLE terminal_tunnel
  DROP CONSTRAINT IF EXISTS chk_terminal_tunnel_target_port;

ALTER TABLE terminal_tunnel
  DROP CONSTRAINT IF EXISTS chk_terminal_tunnel_bind_port;

ALTER TABLE terminal_known_host
  DROP CONSTRAINT IF EXISTS chk_terminal_known_host_port;

ALTER TABLE terminal_connection
  DROP CONSTRAINT IF EXISTS chk_terminal_connection_idle_timeout_s;

ALTER TABLE terminal_connection
  DROP CONSTRAINT IF EXISTS chk_terminal_connection_keepalive_interval;

ALTER TABLE terminal_connection
  DROP CONSTRAINT IF EXISTS chk_terminal_connection_connect_timeout_s;

ALTER TABLE terminal_connection
  DROP CONSTRAINT IF EXISTS chk_terminal_connection_port;
