-- Issue #1277: Shared lists entity (shopping lists, checklists)

CREATE TABLE IF NOT EXISTS list (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  list_type       text NOT NULL DEFAULT 'shopping',
  is_shared       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_list_type ON list(list_type);
CREATE INDEX IF NOT EXISTS idx_list_created_at ON list(created_at);

CREATE OR REPLACE FUNCTION update_list_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER list_updated_at_trigger
  BEFORE UPDATE ON list
  FOR EACH ROW EXECUTE FUNCTION update_list_updated_at();

CREATE TABLE IF NOT EXISTS list_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         uuid NOT NULL REFERENCES list(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  quantity        text,
  category        text,
  is_checked      boolean NOT NULL DEFAULT false,
  is_recurring    boolean NOT NULL DEFAULT false,
  checked_at      timestamptz,
  checked_by      text,
  source_type     text,
  source_id       uuid,
  sort_order      integer NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_list_item_list ON list_item(list_id);
CREATE INDEX IF NOT EXISTS idx_list_item_category ON list_item(list_id, category);

CREATE OR REPLACE FUNCTION update_list_item_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER list_item_updated_at_trigger
  BEFORE UPDATE ON list_item
  FOR EACH ROW EXECUTE FUNCTION update_list_item_updated_at();
