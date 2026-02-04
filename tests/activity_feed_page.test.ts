import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Activity Feed Page integration (issue #131).
 * These tests verify that the /app/activity route works and
 * the API returns data in the correct format.
 */
describe('Activity Feed Page', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /app/activity', () => {
    it('renders the activity page (returns HTML)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/activity',
        headers: {
          accept: 'text/html',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('returns bootstrap data with activity route', async () => {
      // Create a session cookie for authentication
      const pool2 = createTestPool();
      const session = await pool2.query(
        `INSERT INTO auth_session (email, expires_at)
         VALUES ('test@example.com', now() + interval '1 hour')
         RETURNING id::text as id`
      );
      const sessionId = (session.rows[0] as { id: string }).id;
      await pool2.end();

      const res = await app.inject({
        method: 'GET',
        url: '/app/activity',
        cookies: {
          projects_session: sessionId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.payload).toContain('app-bootstrap');
      expect(res.payload).toContain('"activity"');
    });
  });

  describe('Activity API for Page', () => {
    it('returns activity items for the page to display', async () => {
      // Create a work item and some activity
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Insert some activity
      await pool.query(
        `INSERT INTO work_item_activity (work_item_id, activity_type, description)
         VALUES ($1, 'created', 'Created work item: Test Item')`,
        [itemId]
      );

      await pool.query(
        `INSERT INTO work_item_activity (work_item_id, activity_type, description)
         VALUES ($1, 'status_change', 'Status changed to in_progress')`,
        [itemId]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity?limit=50',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items.length).toBe(2);
    });
  });
});
