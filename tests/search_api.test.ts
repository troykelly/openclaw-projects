import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { embeddingService } from '../src/api/embeddings/service.ts';

/**
 * Tests for Search API endpoint (issue #135, enhanced in #216).
 * Uses PostgreSQL full-text search with tsvector/tsquery.
 */
describe('Search API', () => {
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

  describe('GET /api/search', () => {
    it('returns empty results when no data exists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns results for empty query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('finds work items by title', async () => {
      // Note: kind must be 'project' to not require parent
      await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Test Feature Request', 'project')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=feature+request',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('work_item');
      expect(body.results[0].title).toBe('Test Feature Request');
    });

    it('finds work items by description', async () => {
      await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Bug Report', 'The login page crashes when clicking submit', 'project')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=login+page+crashes',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe('Bug Report');
    });

    it('finds contacts by display name', async () => {
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('John Smith')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=john+smith',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('contact');
      expect(body.results[0].title).toBe('John Smith');
    });

    it('finds contacts by notes', async () => {
      await pool.query(
        `INSERT INTO contact (display_name, notes)
         VALUES ('Jane Doe', 'Project manager for the tiny house build')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=tiny+house+manager',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('contact');
      expect(body.results[0].title).toBe('Jane Doe');
    });

    it('filters by type - work_item only', async () => {
      await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Test Item', 'project')`,
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&types=work_item',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('work_item');
    });

    it('filters by type - contact only', async () => {
      await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Test Item', 'project')`,
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&types=contact',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('contact');
    });

    it('filters by multiple types', async () => {
      await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Test Item', 'project')`,
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&types=work_item,contact',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(2);
    });

    it('includes URL for navigation', async () => {
      const workItem = await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('Test Item', 'project')
         RETURNING id::text as id`,
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')
         RETURNING id::text as id`,
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      const workItemResult = body.results.find((r: { type: string }) => r.type === 'work_item');
      const contactResult = body.results.find((r: { type: string }) => r.type === 'contact');

      expect(workItemResult?.url).toBe(`/app/work-items/${workItemId}`);
      expect(contactResult?.url).toBe(`/app/contacts/${contactId}`);
    });

    it('respects limit parameter', async () => {
      // Create 5 work items
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO work_item (title, kind)
           VALUES ($1, 'project')`,
          [`Test Item ${i}`],
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&limit=3',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeLessThanOrEqual(3);
    });

    it('is case insensitive', async () => {
      await pool.query(
        `INSERT INTO work_item (title, kind)
         VALUES ('UPPERCASE TITLE', 'project')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=uppercase+title',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe('UPPERCASE TITLE');
    });

    it('returns correct result structure', async () => {
      await pool.query(
        `INSERT INTO work_item (title, description, kind)
         VALUES ('Feature Request', 'Add new button to homepage', 'project')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=feature+request',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.results.length).toBe(1);
      const result = body.results[0];
      expect(result.type).toBe('work_item');
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.title).toBe('Feature Request');
      expect(result.snippet).toContain('new button');
      expect(result.url).toMatch(/^\/app\/work-items\/[0-9a-f-]{36}$/i);
    });

    it('returns facets with result counts', async () => {
      await pool.query(`INSERT INTO work_item (title, kind) VALUES ('Search Test', 'project')`);
      await pool.query(`INSERT INTO contact (display_name) VALUES ('Search Contact')`);

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=search',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.facets).toBeDefined();
      expect(typeof body.facets.work_item).toBe('number');
      expect(typeof body.facets.contact).toBe('number');
      expect(typeof body.facets.memory).toBe('number');
      expect(typeof body.facets.message).toBe('number');
    });

    it('returns search type indicator', async () => {
      await pool.query(`INSERT INTO work_item (title, kind) VALUES ('Test', 'project')`);

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(['text', 'semantic', 'hybrid']).toContain(body.search_type);
    });
  });
});
