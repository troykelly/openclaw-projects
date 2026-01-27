-- Issue #9: Contacts + endpoints + trust model (cross-channel)

CREATE TABLE IF NOT EXISTS contact (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  notes text,

  -- Trust / automation policy flags (coarse, safe-by-default)
  allow_schedule boolean NOT NULL DEFAULT false,
  allow_auto_reply_safe_only boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE contact_endpoint_type AS ENUM (
    'phone',
    'email',
    'telegram',
    'slack',
    'github',
    'webhook'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Normalization helpers keep the DB as the source-of-truth.
CREATE OR REPLACE FUNCTION normalize_contact_endpoint_value(p_type contact_endpoint_type, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'email' THEN lower(trim(p_value))
    WHEN 'telegram' THEN lower(regexp_replace(trim(p_value), '^@', ''))
    WHEN 'phone' THEN regexp_replace(trim(p_value), '[^0-9+]', '', 'g')
    ELSE lower(trim(p_value))
  END;
$$;

CREATE TABLE IF NOT EXISTS contact_endpoint (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  endpoint_type contact_endpoint_type NOT NULL,
  endpoint_value text NOT NULL CHECK (length(trim(endpoint_value)) > 0),
  normalized_value text NOT NULL,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Policy: privileged actions are never allowed via SMS/phone endpoints.
  allow_privileged_actions boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_endpoint_normalized_unique UNIQUE (endpoint_type, normalized_value),
  CONSTRAINT contact_endpoint_no_privileged_via_phone CHECK (
    NOT (endpoint_type = 'phone' AND allow_privileged_actions)
  )
);

CREATE INDEX IF NOT EXISTS contact_display_name_idx ON contact(display_name);
CREATE INDEX IF NOT EXISTS contact_endpoint_contact_idx ON contact_endpoint(contact_id);

CREATE OR REPLACE FUNCTION contact_endpoint_set_normalized_value()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_value := normalize_contact_endpoint_value(NEW.endpoint_type, NEW.endpoint_value);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_endpoint_normalize ON contact_endpoint;
CREATE TRIGGER trg_contact_endpoint_normalize
BEFORE INSERT OR UPDATE OF endpoint_type, endpoint_value
ON contact_endpoint
FOR EACH ROW
EXECUTE FUNCTION contact_endpoint_set_normalized_value();
