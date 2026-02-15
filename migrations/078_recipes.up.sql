-- Issue #1278: Structured recipe storage with ingredients, steps, and images.

CREATE TABLE IF NOT EXISTS recipe (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      text NOT NULL,
  title           text NOT NULL,
  description     text,
  source_url      text,
  source_name     text,
  prep_time_min   integer,
  cook_time_min   integer,
  total_time_min  integer,
  servings        integer,
  difficulty      text,
  cuisine         text,
  meal_type       text[] NOT NULL DEFAULT '{}',
  tags            text[] NOT NULL DEFAULT '{}',
  rating          integer CHECK (rating BETWEEN 1 AND 5),
  notes           text,
  is_favourite    boolean NOT NULL DEFAULT false,
  image_s3_key    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_user ON recipe (user_email);
CREATE INDEX IF NOT EXISTS idx_recipe_cuisine ON recipe (cuisine);
CREATE INDEX IF NOT EXISTS idx_recipe_tags ON recipe USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_recipe_meal_type ON recipe USING gin (meal_type);

CREATE TABLE IF NOT EXISTS recipe_ingredient (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  name            text NOT NULL,
  quantity        text,
  unit            text,
  category        text,
  is_optional     boolean NOT NULL DEFAULT false,
  notes           text,
  sort_order      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredient_recipe ON recipe_ingredient (recipe_id);

CREATE TABLE IF NOT EXISTS recipe_step (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  step_number     integer NOT NULL,
  instruction     text NOT NULL,
  duration_min    integer,
  image_s3_key    text
);

CREATE INDEX IF NOT EXISTS idx_recipe_step_recipe ON recipe_step (recipe_id, step_number);

CREATE TABLE IF NOT EXISTS recipe_image (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       uuid NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
  s3_key          text NOT NULL,
  caption         text,
  sort_order      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipe_image_recipe ON recipe_image (recipe_id);
