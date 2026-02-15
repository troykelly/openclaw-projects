-- Issue #1277: Shared lists entity (shopping lists, checklists)
-- Generic list entity with grouped, checkable, recurring items.

CREATE TABLE IF NOT EXISTS list (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      text NOT NULL,
  name            text NOT NULL,
  list_type       text NOT NULL DEFAULT 'shopping',
  is_shared       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_list_user ON list (user_email);

CREATE TABLE IF NOT EXISTS list_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         uuid NOT NULL REFERENCES list(id) ON DELETE CASCADE,
  name            text NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_list_item_list ON list_item (list_id);
CREATE INDEX IF NOT EXISTS idx_list_item_category ON list_item (list_id, category);
