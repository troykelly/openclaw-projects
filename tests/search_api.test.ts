import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Search API endpoint (issue #135).
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
      const body = res.json() as { results: unknown[]; total: number };
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns results for empty query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/search',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: unknown[]; total: number };
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('finds work items by title', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Feature Request', 'issue')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=feature',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string; title: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('work_item');
      expect(body.results[0].title).toBe('Test Feature Request');
      expect(body.total).toBe(1);
    });

    it('finds work items by description', async () => {
      await pool.query(
        `INSERT INTO work_item (title, description, work_item_kind)
         VALUES ('Bug Report', 'The login page crashes when clicking submit', 'issue')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=login+page',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string; title: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe('Bug Report');
    });

    it('finds contacts by display name', async () => {
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('John Smith')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=john',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string; title: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('contact');
      expect(body.results[0].title).toBe('John Smith');
    });

    it('finds contacts by email', async () => {
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Jane Doe')
         RETURNING id::text as id`
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'jane.doe@example.com')`,
        [contactId]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=jane.doe@example',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string; title: string; description: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('contact');
      expect(body.results[0].title).toBe('Jane Doe');
      expect(body.results[0].description).toContain('jane.doe@example.com');
    });

    it('filters by type - work_item only', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')`
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&type=work_item',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('work_item');
    });

    it('filters by type - contact only', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')`
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&type=contact',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].type).toBe('contact');
    });

    it('filters by multiple types', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')`
      );
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&type=work_item,contact',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string }>; total: number };
      expect(body.results.length).toBe(2);
    });

    it('includes URL for navigation', async () => {
      const workItem = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const workItemId = (workItem.rows[0] as { id: string }).id;

      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')
         RETURNING id::text as id`
      );
      const contactId = (contact.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ type: string; id: string; url: string }> };

      const workItemResult = body.results.find(r => r.type === 'work_item');
      const contactResult = body.results.find(r => r.type === 'contact');

      expect(workItemResult?.url).toBe(`/app/work-items/${workItemId}`);
      expect(contactResult?.url).toBe(`/app/contacts/${contactId}`);
    });

    it('respects limit parameter', async () => {
      // Create 5 work items
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO work_item (title, work_item_kind)
           VALUES ($1, 'issue')`,
          [`Test Item ${i}`]
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=test&limit=3',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: unknown[]; total: number };
      expect(body.results.length).toBe(3);
      expect(body.total).toBe(5);
    });

    it('is case insensitive', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('UPPERCASE TITLE', 'issue')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=uppercase',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string }>; total: number };
      expect(body.results.length).toBe(1);
      expect(body.results[0].title).toBe('UPPERCASE TITLE');
    });

    it('returns correct result structure', async () => {
      await pool.query(
        `INSERT INTO work_item (title, description, work_item_kind)
         VALUES ('Feature Request', 'Add new button to homepage', 'issue')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/search?q=feature',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        results: Array<{
          type: string;
          id: string;
          title: string;
          description: string;
          url: string;
        }>;
      };

      expect(body.results.length).toBe(1);
      const result = body.results[0];
      expect(result.type).toBe('work_item');
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.title).toBe('Feature Request');
      expect(result.description).toBe('Add new button to homepage');
      expect(result.url).toMatch(/^\/app\/work-items\/[0-9a-f-]{36}$/i);
    });
  });
});
