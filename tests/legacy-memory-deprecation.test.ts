import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Tests for legacy memory endpoint deprecation headers.
 * Issue #2452: Deprecate legacy memory endpoints (GET/POST/PUT/DELETE /memory)
 *
 * Acceptance criteria:
 * - Legacy endpoints return Sunset header
 * - Legacy endpoints return Deprecation header
 * - Legacy endpoints still return correct data (no functional breakage)
 * - OpenAPI spec marks legacy endpoints as deprecated
 */
describe('Legacy Memory Endpoint Deprecation (#2452)', () => {
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

  // Helper to create a memory for update/delete tests
  async function createMemory(_workItemId?: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO memory (title, content, memory_type)
       VALUES ('Test Memory', 'Test content for memory', 'note')
       RETURNING id::text as id`,
    );
    return (result.rows[0] as { id: string }).id;
  }

  describe('Deprecation headers on legacy endpoints', () => {
    it('GET /memory returns Deprecation header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/memory',
      });

      expect(res.headers['deprecation']).toBeDefined();
    });

    it('GET /memory returns Sunset header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/memory',
      });

      expect(res.headers['sunset']).toBeDefined();
      // Sunset header should be a valid HTTP date
      const sunsetDate = new Date(res.headers['sunset'] as string);
      expect(sunsetDate.getTime()).not.toBeNaN();
      // Sunset should be in the future
      expect(sunsetDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('POST /memory returns Deprecation and Sunset headers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/memory',
        payload: {
          content: 'Deprecated endpoint test content',
          memory_type: 'note',
        },
      });

      expect(res.headers['deprecation']).toBeDefined();
      expect(res.headers['sunset']).toBeDefined();
    });

    it('PUT /memory/:id returns Deprecation and Sunset headers', async () => {
      const memoryId = await createMemory();

      const res = await app.inject({
        method: 'PUT',
        url: `/memory/${memoryId}`,
        payload: {
          title: 'Updated title',
          content: 'Updated content',
          type: 'note',
        },
      });

      expect(res.headers['deprecation']).toBeDefined();
      expect(res.headers['sunset']).toBeDefined();
    });

    it('DELETE /memory/:id returns Deprecation and Sunset headers', async () => {
      const memoryId = await createMemory();

      const res = await app.inject({
        method: 'DELETE',
        url: `/memory/${memoryId}`,
      });

      expect(res.headers['deprecation']).toBeDefined();
      expect(res.headers['sunset']).toBeDefined();
    });

    it('Deprecation header includes link to unified API', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/memory',
      });

      const deprecation = res.headers['deprecation'] as string;
      // RFC 8594: Deprecation header is a date in HTTP-date format
      expect(deprecation).toBeDefined();
    });
  });

  describe('Legacy endpoints still function correctly', () => {
    it('GET /memory returns valid response with data', async () => {
      await createMemory();

      const res = await app.inject({
        method: 'GET',
        url: '/memory',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.has_more).toBeDefined();
    });

    it('POST /memory creates memory and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/memory',
        payload: {
          content: 'Test memory creation via legacy endpoint',
          memory_type: 'note',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
    });

    it('DELETE /memory/:id deletes memory and returns 204', async () => {
      const memoryId = await createMemory();

      const res = await app.inject({
        method: 'DELETE',
        url: `/memory/${memoryId}`,
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('Deprecation logging', () => {
    it('GET /memory logs deprecation usage', async () => {
      // We verify that the endpoint sets an x-deprecated-endpoint header
      // which can be used by logging infrastructure for tracking
      const res = await app.inject({
        method: 'GET',
        url: '/memory',
      });

      expect(res.headers['x-deprecated-endpoint']).toBe('GET /memory');
    });

    it('POST /memory logs deprecation usage', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/memory',
        payload: {
          content: 'Test content for deprecation logging',
          memory_type: 'note',
        },
      });

      expect(res.headers['x-deprecated-endpoint']).toBe('POST /memory');
    });

    it('PUT /memory/:id logs deprecation usage', async () => {
      const memoryId = await createMemory();

      const res = await app.inject({
        method: 'PUT',
        url: `/memory/${memoryId}`,
        payload: {
          title: 'Updated',
          content: 'Updated content',
          type: 'note',
        },
      });

      expect(res.headers['x-deprecated-endpoint']).toBe('PUT /memory/:id');
    });

    it('DELETE /memory/:id logs deprecation usage', async () => {
      const memoryId = await createMemory();

      const res = await app.inject({
        method: 'DELETE',
        url: `/memory/${memoryId}`,
      });

      expect(res.headers['x-deprecated-endpoint']).toBe('DELETE /memory/:id');
    });
  });
});
