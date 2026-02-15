-- Issue #1279: Meal log — track what was eaten, source, and preferences.

CREATE TABLE IF NOT EXISTS meal_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      text NOT NULL,
  meal_date       date NOT NULL,
  meal_type       text NOT NULL,
  title           text NOT NULL,
  source          text NOT NULL,
  recipe_id       uuid REFERENCES recipe(id) ON DELETE SET NULL,
  order_ref       text,
  restaurant      text,
  cuisine         text,
  who_ate         text[] NOT NULL DEFAULT '{}',
  who_cooked      text,
  rating          integer CHECK (rating BETWEEN 1 AND 5),
  notes           text,
  leftovers_stored boolean NOT NULL DEFAULT false,
  image_s3_key    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meal_log_user ON meal_log (user_email);
CREATE INDEX IF NOT EXISTS idx_meal_log_date ON meal_log (meal_date DESC);
CREATE INDEX IF NOT EXISTS idx_meal_log_cuisine ON meal_log (cuisine);
CREATE INDEX IF NOT EXISTS idx_meal_log_source ON meal_log (source);
