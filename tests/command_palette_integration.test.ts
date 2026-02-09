import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { embeddingService } from '../src/api/embeddings/service.ts';

/**
 * Tests for Command Palette integration (issue #136, enhanced in #216).
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
    embeddingService.clearCache();
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
      const body = res.json();
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('searches work items by title', async () => {
      // Create an initiative first (needs no parent), then issues under an epic
      await pool.query(
        `INSERT INTO work_item (title, kind, description)
         VALUES ('Login Feature Project', 'project', 'Implement user login'),
                ('Dashboard Project', 'project', 'Main dashboard project'),
                ('User Login Page', 'project', 'Add login page')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=login',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeGreaterThanOrEqual(2);
      const titles = body.results.map((r: { title: string }) => r.title);
      expect(titles).toContain('Login Feature Project');
      expect(titles).toContain('User Login Page');
    });

    it('searches work items by description', async () => {
      await pool.query(
        `INSERT INTO work_item (title, kind, description)
         VALUES ('Task 1', 'project', 'Fix the authentication bug'),
                ('Task 2', 'project', 'Update the UI theme')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=authentication+bug',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe('Task 1');
    });

    it('searches contacts by display name', async () => {
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Alice Smith'), ('Bob Jones'), ('Charlie Smith')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=smith&types=contact',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(2);
      expect(body.results.every((r: { type: string }) => r.type === 'contact')).toBe(true);
      const names = body.results.map((r: { title: string }) => r.title);
      expect(names).toContain('Alice Smith');
      expect(names).toContain('Charlie Smith');
    });

    it('filters by type', async () => {
      await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Test Item', 'project')`,
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`,
      );

      // Search only work items
      const workItemRes = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&types=work_item',
      });

      expect(workItemRes.statusCode).toBe(200);
      const workItemBody = workItemRes.json();
      expect(workItemBody.results.every((r: { type: string }) => r.type === 'work_item')).toBe(true);

      // Search only contacts
      const contactRes = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&types=contact',
      });

      expect(contactRes.statusCode).toBe(200);
      const contactBody = contactRes.json();
      expect(contactBody.results.every((r: { type: string }) => r.type === 'contact')).toBe(true);
    });

    it('respects limit parameter', async () => {
      // Create many items
      for (let i = 1; i <= 10; i++) {
        await pool.query(
          `INSERT INTO work_item (title, kind)
           VALUES ($1, 'project')`,
          [`Search Item ${i}`],
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=search&limit=5',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeLessThanOrEqual(5);
    });

    it('returns URL for navigation', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Navigate Test', 'project')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=navigate+test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].url).toBe(`/app/work-items/${itemId}`);
    });
  });
});
