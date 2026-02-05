/**
 * Tests for file share token validation race condition.
 * Part of Epic #574, Issue #611.
 *
 * This test demonstrates and verifies the fix for a TOCTOU race condition
 * in the validate_file_share_token function where concurrent downloads
 * could exceed max_downloads without proper row locking.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

describe('File Share Race Condition Prevention', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  /**
   * Helper to create a file attachment and share token for testing.
   */
  async function createTestFileShare(
    pool: Pool,
    options: {
      maxDownloads: number;
      expiresInHours?: number;
    }
  ): Promise<{ fileId: string; shareToken: string }> {
    // Create a file attachment first
    const fileResult = await pool.query<{ id: string }>(
      `INSERT INTO file_attachment (storage_key, original_filename, content_type, size_bytes)
       VALUES ('test/file.txt', 'test.txt', 'text/plain', 100)
       RETURNING id`
    );
    const fileId = fileResult.rows[0].id;

    // Create a file share with max_downloads limit
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (options.expiresInHours ?? 1));

    const shareResult = await pool.query<{ share_token: string }>(
      `INSERT INTO file_share (file_attachment_id, share_token, expires_at, max_downloads, download_count)
       VALUES ($1, $2, $3, $4, 0)
       RETURNING share_token`,
      [fileId, `test-token-${Date.now()}`, expiresAt, options.maxDownloads]
    );

    return {
      fileId,
      shareToken: shareResult.rows[0].share_token,
    };
  }

  it('should allow downloads up to max_downloads limit', async () => {
    const { shareToken } = await createTestFileShare(pool, { maxDownloads: 3 });

    // First download should succeed
    const result1 = await pool.query<{ is_valid: boolean; error_message: string | null }>(
      'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
      [shareToken]
    );
    expect(result1.rows[0].is_valid).toBe(true);

    // Second download should succeed
    const result2 = await pool.query<{ is_valid: boolean; error_message: string | null }>(
      'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
      [shareToken]
    );
    expect(result2.rows[0].is_valid).toBe(true);

    // Third download should succeed (hits limit)
    const result3 = await pool.query<{ is_valid: boolean; error_message: string | null }>(
      'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
      [shareToken]
    );
    expect(result3.rows[0].is_valid).toBe(true);

    // Fourth download should fail (exceeds limit)
    const result4 = await pool.query<{ is_valid: boolean; error_message: string | null }>(
      'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
      [shareToken]
    );
    expect(result4.rows[0].is_valid).toBe(false);
    expect(result4.rows[0].error_message).toContain('Maximum downloads reached');
  });

  it('should prevent race condition when concurrent downloads exceed max_downloads', async () => {
    const { shareToken } = await createTestFileShare(pool, { maxDownloads: 1 });

    // Simulate concurrent access using multiple connections
    // This test verifies that FOR UPDATE prevents the race condition
    const pool1 = createTestPool();
    const pool2 = createTestPool();
    const pool3 = createTestPool();

    try {
      // Start all validations concurrently
      // Without FOR UPDATE, all three could read download_count=0 and all succeed
      // With FOR UPDATE, only the first should succeed
      const [result1, result2, result3] = await Promise.all([
        pool1.query<{ is_valid: boolean; error_message: string | null }>(
          'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
          [shareToken]
        ),
        pool2.query<{ is_valid: boolean; error_message: string | null }>(
          'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
          [shareToken]
        ),
        pool3.query<{ is_valid: boolean; error_message: string | null }>(
          'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
          [shareToken]
        ),
      ]);

      // Count successful downloads
      const successCount = [result1, result2, result3].filter(
        (r) => r.rows[0].is_valid
      ).length;

      // With proper locking, only 1 download should succeed (max_downloads = 1)
      expect(successCount).toBe(1);

      // Verify the final download_count in the database
      const countResult = await pool.query<{ download_count: number }>(
        'SELECT download_count FROM file_share WHERE share_token = $1',
        [shareToken]
      );
      expect(countResult.rows[0].download_count).toBe(1);
    } finally {
      await pool1.end();
      await pool2.end();
      await pool3.end();
    }
  });

  it('should handle race condition with max_downloads of 2', async () => {
    const { shareToken } = await createTestFileShare(pool, { maxDownloads: 2 });

    // Create 5 concurrent connections all trying to download
    const pools = await Promise.all(
      Array.from({ length: 5 }, () => createTestPool())
    );

    try {
      const results = await Promise.all(
        pools.map((p) =>
          p.query<{ is_valid: boolean; error_message: string | null }>(
            'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
            [shareToken]
          )
        )
      );

      const successCount = results.filter((r) => r.rows[0].is_valid).length;

      // With proper locking, exactly 2 downloads should succeed
      expect(successCount).toBe(2);

      // Verify the final download_count
      const countResult = await pool.query<{ download_count: number }>(
        'SELECT download_count FROM file_share WHERE share_token = $1',
        [shareToken]
      );
      expect(countResult.rows[0].download_count).toBe(2);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  it('should return correct error message when download limit is exceeded', async () => {
    const { shareToken } = await createTestFileShare(pool, { maxDownloads: 1 });

    // First download succeeds
    await pool.query('SELECT * FROM validate_file_share_token($1, true)', [shareToken]);

    // Second download should fail with specific message
    const result = await pool.query<{ is_valid: boolean; error_message: string }>(
      'SELECT is_valid, error_message FROM validate_file_share_token($1, true)',
      [shareToken]
    );

    expect(result.rows[0].is_valid).toBe(false);
    expect(result.rows[0].error_message).toBe('Maximum downloads reached for this link');
  });

  it('should not increment count when p_increment_download is false', async () => {
    const { shareToken } = await createTestFileShare(pool, { maxDownloads: 1 });

    // Validate without incrementing (preview mode)
    const result1 = await pool.query<{ is_valid: boolean }>(
      'SELECT is_valid FROM validate_file_share_token($1, false)',
      [shareToken]
    );
    expect(result1.rows[0].is_valid).toBe(true);

    // Verify count is still 0
    const countResult = await pool.query<{ download_count: number }>(
      'SELECT download_count FROM file_share WHERE share_token = $1',
      [shareToken]
    );
    expect(countResult.rows[0].download_count).toBe(0);

    // Actual download should still work
    const result2 = await pool.query<{ is_valid: boolean }>(
      'SELECT is_valid FROM validate_file_share_token($1, true)',
      [shareToken]
    );
    expect(result2.rows[0].is_valid).toBe(true);
  });
});
