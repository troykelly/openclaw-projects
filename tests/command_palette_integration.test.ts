import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Command Palette integration (issue #136).
 * These tests verify that the search API works correctly for the command palette.
 */
describe('Command Palette Integration', () => {
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

  describe('Search API for Command Palette', () => {
    it('returns empty results for empty query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: unknown[]; total: number };
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('searches work items by title', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, description)
         VALUES ('Login Feature', 'issue', 'Implement user login'),
                ('Dashboard', 'project', 'Main dashboard project'),
                ('User Login Page', 'issue', 'Add login page')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=login',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string; type: string }>; total: number };
      expect(body.results.length).toBeGreaterThanOrEqual(2);
      const titles = body.results.map((r) => r.title);
      expect(titles).toContain('Login Feature');
      expect(titles).toContain('User Login Page');
    });

    it('searches work items by description', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, description)
         VALUES ('Task 1', 'issue', 'Fix the authentication bug'),
                ('Task 2', 'issue', 'Update the UI theme')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=authentication',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe('Task 1');
    });

    it('searches contacts by display name', async () => {
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Alice Smith'), ('Bob Jones'), ('Charlie Smith')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=smith&type=contact',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string; type: string }>; total: number };
      expect(body.results.length).toBe(2);
      expect(body.results.every((r) => r.type === 'contact')).toBe(true);
      const names = body.results.map((r) => r.title);
      expect(names).toContain('Alice Smith');
      expect(names).toContain('Charlie Smith');
    });

    it('filters by type', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')`
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`
      );

      // Search only work items
      const workItemRes = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&type=work_item',
      });

      expect(workItemRes.statusCode).toBe(200);
      const workItemBody = workItemRes.json() as { results: Array<{ type: string }> };
      expect(workItemBody.results.every((r) => r.type === 'work_item')).toBe(true);

      // Search only contacts
      const contactRes = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&type=contact',
      });

      expect(contactRes.statusCode).toBe(200);
      const contactBody = contactRes.json() as { results: Array<{ type: string }> };
      expect(contactBody.results.every((r) => r.type === 'contact')).toBe(true);
    });

    it('respects limit parameter', async () => {
      // Create many items
      for (let i = 1; i <= 10; i++) {
        await pool.query(
          `INSERT INTO work_item (title, work_item_kind)
           VALUES ($1, 'issue')`,
          [`Search Item ${i}`]
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=search&limit=5',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: unknown[]; total: number };
      expect(body.results.length).toBe(5);
      expect(body.total).toBe(10); // Total is still 10 even though limit is 5
    });

    it('returns URL for navigation', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Navigate Test', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=navigate',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ url: string; id: string }> };
      expect(body.results.length).toBe(1);
      expect(body.results[0].url).toBe(`/app/work-items/${itemId}`);
    });
  });
});
