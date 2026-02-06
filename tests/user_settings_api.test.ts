import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';

describe('User Settings API', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test user settings
    await pool.query("DELETE FROM user_setting WHERE email LIKE 'test-%'");
  });

  describe('user_setting table', () => {
    it('creates user setting with defaults', async () => {
      const result = await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) RETURNING *`,
        ['test-user@example.com']
      );

      expect(result.rows[0]).toMatchObject({
        email: 'test-user@example.com',
        theme: 'system',
        default_view: 'activity',
        sidebar_collapsed: false,
        show_completed_items: true,
        items_per_page: 50,
        email_notifications: true,
        email_digest_frequency: 'daily',
        timezone: 'UTC',
      });
    });

    it('enforces unique email constraint', async () => {
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1)`,
        ['test-unique@example.com']
      );

      await expect(
        pool.query(
          `INSERT INTO user_setting (email) VALUES ($1)`,
          ['test-unique@example.com']
        )
      ).rejects.toThrow(/duplicate key/);
    });

    it('validates theme values', async () => {
      await expect(
        pool.query(
          `INSERT INTO user_setting (email, theme) VALUES ($1, $2)`,
          ['test-theme@example.com', 'invalid']
        )
      ).rejects.toThrow(/violates check constraint/);
    });

    it('validates default_view values', async () => {
      await expect(
        pool.query(
          `INSERT INTO user_setting (email, default_view) VALUES ($1, $2)`,
          ['test-view@example.com', 'invalid']
        )
      ).rejects.toThrow(/violates check constraint/);
    });

    it('validates items_per_page range', async () => {
      await expect(
        pool.query(
          `INSERT INTO user_setting (email, items_per_page) VALUES ($1, $2)`,
          ['test-items@example.com', 5]
        )
      ).rejects.toThrow(/violates check constraint/);

      await expect(
        pool.query(
          `INSERT INTO user_setting (email, items_per_page) VALUES ($1, $2)`,
          ['test-items2@example.com', 150]
        )
      ).rejects.toThrow(/violates check constraint/);
    });

    it('updates updated_at on change', async () => {
      const insert = await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) RETURNING *`,
        ['test-update@example.com']
      );

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50));

      const update = await pool.query(
        `UPDATE user_setting SET theme = 'dark' WHERE email = $1 RETURNING *`,
        ['test-update@example.com']
      );

      expect(new Date(update.rows[0].updated_at).getTime()).toBeGreaterThan(
        new Date(insert.rows[0].created_at).getTime()
      );
    });

    it('allows upsert pattern', async () => {
      // First insert
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        ['test-upsert@example.com']
      );

      // Update via upsert
      const result = await pool.query(
        `INSERT INTO user_setting (email, theme) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET theme = EXCLUDED.theme
         RETURNING *`,
        ['test-upsert@example.com', 'dark']
      );

      expect(result.rows[0].theme).toBe('dark');
    });
  });
});
