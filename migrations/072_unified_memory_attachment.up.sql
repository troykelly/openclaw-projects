-- Issue #1271: File attachments on unified memory table
-- Links file_attachment rows to memory rows (the unified memory system from migration 028)

CREATE TABLE IF NOT EXISTS unified_memory_attachment (
    memory_id uuid NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    file_attachment_id uuid NOT NULL REFERENCES file_attachment(id) ON DELETE CASCADE,
    attached_at timestamptz DEFAULT now() NOT NULL,
    attached_by text,
    PRIMARY KEY (memory_id, file_attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_unified_memory_attachment_memory
    ON unified_memory_attachment(memory_id);

CREATE INDEX IF NOT EXISTS idx_unified_memory_attachment_file
    ON unified_memory_attachment(file_attachment_id);

COMMENT ON TABLE unified_memory_attachment IS 'Links files to unified memories (Issue #1271)';
