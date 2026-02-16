-- Issue #1280: Pantry/fridge/freezer inventory and leftovers tracking

CREATE TABLE IF NOT EXISTS pantry_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      text REFERENCES user_setting(email) ON DELETE CASCADE,
  name            text NOT NULL,
  location        text NOT NULL,
  quantity        text,
  category        text,
  is_leftover     boolean NOT NULL DEFAULT false,
  leftover_dish   text,
  leftover_portions integer,
  meal_log_id     uuid,
  added_date      date NOT NULL DEFAULT CURRENT_DATE,
  use_by_date     date,
  use_soon        boolean NOT NULL DEFAULT false,
  notes           text,
  is_depleted     boolean NOT NULL DEFAULT false,
  depleted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pantry_location ON pantry_item (location) WHERE NOT is_depleted;
CREATE INDEX IF NOT EXISTS idx_pantry_use_by ON pantry_item (use_by_date) WHERE NOT is_depleted AND use_by_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pantry_leftover ON pantry_item (is_leftover) WHERE NOT is_depleted AND is_leftover;
