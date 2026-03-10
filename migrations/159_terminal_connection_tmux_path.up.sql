-- Issue #2324: Add optional tmux_path column to terminal_connection.
-- Allows specifying a custom path to the tmux binary on the remote host,
-- useful for macOS where tmux may be in /opt/homebrew/bin or /usr/local/bin.
ALTER TABLE terminal_connection ADD COLUMN IF NOT EXISTS tmux_path text;
