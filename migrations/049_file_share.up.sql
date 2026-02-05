-- Migration 049: File Share Schema
-- Part of Epic #574, Issue #584
-- Creates sharing system for file attachments via time-limited tokens

-- ============================================================================
-- FILE_SHARE TABLE
-- ============================================================================
-- Shareable download links for file attachments

CREATE TABLE IF NOT EXISTS file_share (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  file_attachment_id uuid NOT NULL REFERENCES file_attachment(id) ON DELETE CASCADE,

  -- Share token for anonymous access
  share_token text NOT NULL UNIQUE,

  -- Access controls
  expires_at timestamptz NOT NULL,
  download_count integer DEFAULT 0,
  max_downloads integer,  -- Optional download limit

  -- Metadata
  created_by text,        -- User email or 'agent' for API calls

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz
);

COMMENT ON TABLE file_share IS 'Time-limited shareable download links for file attachments';
COMMENT ON COLUMN file_share.share_token IS 'URL-safe token for anonymous download access';
COMMENT ON COLUMN file_share.expires_at IS 'When this share link expires and becomes invalid';
COMMENT ON COLUMN file_share.max_downloads IS 'Optional limit on number of downloads';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Token lookup for download requests
CREATE INDEX IF NOT EXISTS idx_file_share_token ON file_share(share_token);

-- Find shares by file
CREATE INDEX IF NOT EXISTS idx_file_share_file_id ON file_share(file_attachment_id);

-- Cleanup expired shares
CREATE INDEX IF NOT EXISTS idx_file_share_expires_at ON file_share(expires_at);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Validate and consume file share token
CREATE OR REPLACE FUNCTION validate_file_share_token(
  p_token text,
  p_increment_download boolean DEFAULT true
) RETURNS TABLE (
  file_attachment_id uuid,
  is_valid boolean,
  error_message text
) AS $$
DECLARE
  v_share RECORD;
BEGIN
  -- Find the share (FOR UPDATE locks the row to prevent race conditions)
  SELECT fs.file_attachment_id, fs.expires_at, fs.download_count, fs.max_downloads
  INTO v_share
  FROM file_share fs
  WHERE fs.share_token = p_token
  FOR UPDATE;

  IF v_share IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false, 'Invalid or expired share link'::text;
    RETURN;
  END IF;

  -- Check expiration
  IF v_share.expires_at < NOW() THEN
    RETURN QUERY SELECT v_share.file_attachment_id, false, 'Share link has expired'::text;
    RETURN;
  END IF;

  -- Check max downloads
  IF v_share.max_downloads IS NOT NULL AND v_share.download_count >= v_share.max_downloads THEN
    RETURN QUERY SELECT v_share.file_attachment_id, false, 'Maximum downloads reached for this link'::text;
    RETURN;
  END IF;

  -- Increment download count and update last accessed
  IF p_increment_download THEN
    UPDATE file_share
    SET download_count = download_count + 1,
        last_accessed_at = NOW()
    WHERE share_token = p_token;
  END IF;

  RETURN QUERY SELECT v_share.file_attachment_id, true, NULL::text;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_file_share_token IS 'Validate file share token, check limits and expiration, optionally increment download count';

-- Cleanup expired file shares
CREATE OR REPLACE FUNCTION cleanup_expired_file_shares() RETURNS integer AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Delete expired share links (keep for 7 days after expiry for audit)
  DELETE FROM file_share
  WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_file_shares IS 'Remove expired file share links (7+ days old)';
