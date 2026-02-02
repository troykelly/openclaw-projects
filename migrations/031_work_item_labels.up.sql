-- Issue #221: Work item labels/tags for GTD-style contexts

-- Drop and recreate to handle schema changes
DROP TABLE IF EXISTS work_item_label;
DROP TABLE IF EXISTS label CASCADE;

-- Create labels table (normalized, unique labels)
CREATE TABLE label (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  color text, -- Optional hex color for UI display
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Function to normalize label names (lowercase, trim, replace spaces with -)
CREATE OR REPLACE FUNCTION normalize_label_name(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(trim(name), '\s+', '-', 'g'));
$$;

-- Trigger to auto-set normalized_name
CREATE OR REPLACE FUNCTION set_label_normalized_name()
RETURNS TRIGGER AS $$
BEGIN
  NEW.normalized_name := normalize_label_name(NEW.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER label_normalize_name
  BEFORE INSERT OR UPDATE OF name ON label
  FOR EACH ROW
  EXECUTE FUNCTION set_label_normalized_name();

-- Junction table for work_item <-> label relationship
CREATE TABLE work_item_label (
  work_item_id uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, label_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_work_item_label_label_id ON work_item_label(label_id);
CREATE INDEX IF NOT EXISTS idx_label_normalized_name ON label(normalized_name);

-- GIN index for fast label-based work item queries
-- (Using a view-based approach with the array of labels)

-- Function to get or create a label by name
CREATE OR REPLACE FUNCTION get_or_create_label(p_name text)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_normalized text;
BEGIN
  v_normalized := normalize_label_name(p_name);

  -- Try to find existing
  SELECT id INTO v_id FROM label WHERE normalized_name = v_normalized;

  IF v_id IS NULL THEN
    -- Create new
    INSERT INTO label (name, normalized_name)
    VALUES (trim(p_name), v_normalized)
    ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- Function to set labels on a work item (replaces existing)
CREATE OR REPLACE FUNCTION set_work_item_labels(p_work_item_id uuid, p_labels text[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_label_id uuid;
  v_label text;
BEGIN
  -- Remove existing labels
  DELETE FROM work_item_label WHERE work_item_id = p_work_item_id;

  -- Add new labels
  IF p_labels IS NOT NULL THEN
    FOREACH v_label IN ARRAY p_labels
    LOOP
      IF v_label IS NOT NULL AND length(trim(v_label)) > 0 THEN
        v_label_id := get_or_create_label(v_label);
        INSERT INTO work_item_label (work_item_id, label_id)
        VALUES (p_work_item_id, v_label_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Function to add a single label to a work item
CREATE OR REPLACE FUNCTION add_work_item_label(p_work_item_id uuid, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_label_id uuid;
BEGIN
  IF p_label IS NOT NULL AND length(trim(p_label)) > 0 THEN
    v_label_id := get_or_create_label(p_label);
    INSERT INTO work_item_label (work_item_id, label_id)
    VALUES (p_work_item_id, v_label_id)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- Function to remove a label from a work item
CREATE OR REPLACE FUNCTION remove_work_item_label(p_work_item_id uuid, p_label text)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM work_item_label wl
  USING label l
  WHERE wl.work_item_id = p_work_item_id
    AND wl.label_id = l.id
    AND l.normalized_name = normalize_label_name(p_label);
$$;

-- Comments
COMMENT ON TABLE label IS 'Normalized labels for work item tagging (GTD contexts, categories)';
COMMENT ON TABLE work_item_label IS 'Junction table linking work items to labels';
COMMENT ON FUNCTION get_or_create_label(text) IS 'Gets existing label or creates new one, returns label ID';
COMMENT ON FUNCTION set_work_item_labels(uuid, text[]) IS 'Replaces all labels on a work item';
