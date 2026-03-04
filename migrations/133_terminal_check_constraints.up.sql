-- ============================================================
-- Migration 133: Terminal CHECK constraints for port/timeout fields
-- Issue #2119 — Database schema lacks CHECK constraints
-- Epic #2130 — Terminal System Hardening
--
-- Uses NOT VALID + VALIDATE CONSTRAINT to avoid blocking on
-- existing data that may violate constraints, then validates
-- separately. If existing invalid rows exist, VALIDATE will
-- fail and the migration must be fixed manually first.
-- ============================================================

-- ── terminal_connection ─────────────────────────────────────
-- port: valid TCP port range
ALTER TABLE terminal_connection
  ADD CONSTRAINT chk_terminal_connection_port
    CHECK (port IS NULL OR port BETWEEN 1 AND 65535) NOT VALID;
ALTER TABLE terminal_connection
  VALIDATE CONSTRAINT chk_terminal_connection_port;

-- connect_timeout_s: positive, max 24h
ALTER TABLE terminal_connection
  ADD CONSTRAINT chk_terminal_connection_connect_timeout_s
    CHECK (connect_timeout_s IS NULL OR connect_timeout_s BETWEEN 1 AND 86400) NOT VALID;
ALTER TABLE terminal_connection
  VALIDATE CONSTRAINT chk_terminal_connection_connect_timeout_s;

-- keepalive_interval: positive, max 24h
ALTER TABLE terminal_connection
  ADD CONSTRAINT chk_terminal_connection_keepalive_interval
    CHECK (keepalive_interval IS NULL OR keepalive_interval BETWEEN 1 AND 86400) NOT VALID;
ALTER TABLE terminal_connection
  VALIDATE CONSTRAINT chk_terminal_connection_keepalive_interval;

-- idle_timeout_s: positive, max 24h
ALTER TABLE terminal_connection
  ADD CONSTRAINT chk_terminal_connection_idle_timeout_s
    CHECK (idle_timeout_s IS NULL OR idle_timeout_s BETWEEN 1 AND 86400) NOT VALID;
ALTER TABLE terminal_connection
  VALIDATE CONSTRAINT chk_terminal_connection_idle_timeout_s;

-- ── terminal_known_host ─────────────────────────────────────
-- port: valid TCP port range
ALTER TABLE terminal_known_host
  ADD CONSTRAINT chk_terminal_known_host_port
    CHECK (port IS NULL OR port BETWEEN 1 AND 65535) NOT VALID;
ALTER TABLE terminal_known_host
  VALIDATE CONSTRAINT chk_terminal_known_host_port;

-- ── terminal_tunnel ─────────────────────────────────────────
-- bind_port: valid TCP port range
ALTER TABLE terminal_tunnel
  ADD CONSTRAINT chk_terminal_tunnel_bind_port
    CHECK (bind_port BETWEEN 1 AND 65535) NOT VALID;
ALTER TABLE terminal_tunnel
  VALIDATE CONSTRAINT chk_terminal_tunnel_bind_port;

-- target_port: valid TCP port range (nullable for dynamic tunnels)
ALTER TABLE terminal_tunnel
  ADD CONSTRAINT chk_terminal_tunnel_target_port
    CHECK (target_port IS NULL OR target_port BETWEEN 1 AND 65535) NOT VALID;
ALTER TABLE terminal_tunnel
  VALIDATE CONSTRAINT chk_terminal_tunnel_target_port;

-- ── terminal_credential ─────────────────────────────────────
-- command_timeout_s: positive, max 24h
ALTER TABLE terminal_credential
  ADD CONSTRAINT chk_terminal_credential_command_timeout_s
    CHECK (command_timeout_s IS NULL OR command_timeout_s BETWEEN 1 AND 86400) NOT VALID;
ALTER TABLE terminal_credential
  VALIDATE CONSTRAINT chk_terminal_credential_command_timeout_s;
