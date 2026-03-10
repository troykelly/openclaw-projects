-- Issue #2324: Remove tmux_path column from terminal_connection.
ALTER TABLE terminal_connection DROP COLUMN IF EXISTS tmux_path;
