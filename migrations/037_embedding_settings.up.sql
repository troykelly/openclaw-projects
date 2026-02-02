-- Embedding settings and usage tracking
-- Part of Issue #231

-- Settings table for embedding configuration
CREATE TABLE IF NOT EXISTS embedding_settings (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Singleton pattern
    daily_limit_usd numeric(10, 2) DEFAULT 10.00,
    monthly_limit_usd numeric(10, 2) DEFAULT 100.00,
    pause_on_limit boolean DEFAULT true,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Insert default settings
INSERT INTO embedding_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Usage tracking table (per-day aggregation)
CREATE TABLE IF NOT EXISTS embedding_usage (
    date date NOT NULL,
    provider text NOT NULL,
    request_count integer NOT NULL DEFAULT 0,
    token_count bigint NOT NULL DEFAULT 0,
    estimated_cost_usd numeric(10, 4) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (date, provider)
);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_embedding_usage_date ON embedding_usage(date DESC);

-- Function to update timestamp on settings change
CREATE OR REPLACE FUNCTION update_embedding_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for settings updates
DROP TRIGGER IF EXISTS trigger_embedding_settings_updated ON embedding_settings;
CREATE TRIGGER trigger_embedding_settings_updated
    BEFORE UPDATE ON embedding_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_embedding_settings_timestamp();

-- Function to increment usage (upsert pattern)
CREATE OR REPLACE FUNCTION increment_embedding_usage(
    p_provider text,
    p_tokens integer,
    p_cost_usd numeric
)
RETURNS void AS $$
BEGIN
    INSERT INTO embedding_usage (date, provider, request_count, token_count, estimated_cost_usd)
    VALUES (CURRENT_DATE, p_provider, 1, p_tokens, p_cost_usd)
    ON CONFLICT (date, provider) DO UPDATE SET
        request_count = embedding_usage.request_count + 1,
        token_count = embedding_usage.token_count + EXCLUDED.token_count,
        estimated_cost_usd = embedding_usage.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
        updated_at = now();
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE embedding_settings IS 'Singleton table for embedding configuration and budget limits';
COMMENT ON TABLE embedding_usage IS 'Daily aggregated embedding usage per provider';
COMMENT ON FUNCTION increment_embedding_usage IS 'Atomically increments usage stats for a provider';
