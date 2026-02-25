/**
 * Unit tests for API memory search service.
 * Part of API Onboarding feature (#1782).
 *
 * These tests use the text-search fallback path since the embedding service
 * is not available in unit tests. Integration tests should cover full hybrid search.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../../helpers/db.ts';
import { runMigrate } from '../../helpers/migrate.ts';
import { createApiSource } from '../../../src/api/api-sources/service.ts';
import { createApiCredential } from '../../../src/api/api-sources/credential-service.ts';
import { searchApiMemories, listApiMemories } from '../../../src/api/api-sources/search.ts';

describe('API Memory Search Service', () => {
  let pool: Pool;
  const namespace = 'test-search';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  /** Helper: insert a source and seed memories directly into the DB */
  async function seedSourceWithMemories(
    name: string,
    memories: Array<{
      memory_kind: string;
      operation_key: string;
      title: string;
      content: string;
      tags?: string[];
    }>,
    opts?: { addCredential?: boolean },
  ): Promise<string> {
    const source = await createApiSource(pool, { namespace, name });

    for (const mem of memories) {
      await pool.query(
        `INSERT INTO api_memory (
          api_source_id, namespace, memory_kind, operation_key,
          title, content, tags, embedding_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [
          source.id,
          namespace,
          mem.memory_kind,
          mem.operation_key,
          mem.title,
          mem.content,
          mem.tags ?? [],
        ],
      );
    }

    if (opts?.addCredential) {
      await createApiCredential(pool, {
        api_source_id: source.id,
        header_name: 'Authorization',
        header_prefix: 'Bearer',
        resolve_strategy: 'literal',
        resolve_reference: 'test-api-key-12345',
      });
    }

    return source.id;
  }

  describe('searchApiMemories', () => {
    it('should find memories by text search', async () => {
      await seedSourceWithMemories('Weather API', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/v1/weather',
          title: 'GET /v1/weather — Current weather data',
          content: 'Get current weather data for a location by latitude and longitude',
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/v1/forecast',
          title: 'GET /v1/forecast — Weather forecast',
          content: 'Get weather forecast for the next 7 days by city name',
        },
      ]);

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'weather forecast',
      });

      expect(results.length).toBeGreaterThan(0);
      // Text search should find forecast-related entries
      expect(results.some((r) => r.operation_key === 'GET:/v1/forecast')).toBe(true);
    });

    it('should filter by memory_kind', async () => {
      await seedSourceWithMemories('Transport API', [
        {
          memory_kind: 'overview',
          operation_key: 'overview:transport-api',
          title: 'Transport API Overview',
          content: 'Provides public transport departures and arrivals',
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/departures',
          title: 'GET /departures — Departure board',
          content: 'Get upcoming departures from a station',
        },
      ]);

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'departures transport',
        memory_kind: 'operation',
      });

      for (const r of results) {
        expect(r.memory_kind).toBe('operation');
      }
    });

    it('should filter by api_source_id', async () => {
      const sourceA = await seedSourceWithMemories('API A', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/a/items',
          title: 'GET /a/items — list items from A',
          content: 'List items from API A database',
        },
      ]);

      await seedSourceWithMemories('API B', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/b/items',
          title: 'GET /b/items — list items from B',
          content: 'List items from API B database',
        },
      ]);

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'list items database',
        api_source_id: sourceA,
      });

      for (const r of results) {
        expect(r.api_source_id).toBe(sourceA);
      }
    });

    it('should filter by tags', async () => {
      await seedSourceWithMemories('Tagged API', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/users',
          title: 'GET /users — list users',
          content: 'List all registered users',
          tags: ['users', 'admin'],
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/products',
          title: 'GET /products — list products',
          content: 'List all available products',
          tags: ['products', 'catalog'],
        },
      ]);

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'list',
        tags: ['admin'],
      });

      // Only the users memory has the 'admin' tag
      for (const r of results) {
        expect(r.tags).toContain('admin');
      }
    });

    it('should exclude soft-deleted API sources', async () => {
      const sourceId = await seedSourceWithMemories('Deleted API', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/deleted/items',
          title: 'GET /deleted/items — list deleted items',
          content: 'List items from a deleted API source',
        },
      ]);

      // Soft delete the source
      await pool.query(
        `UPDATE api_source SET deleted_at = now() WHERE id = $1`,
        [sourceId],
      );

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'deleted items',
      });

      expect(results.length).toBe(0);
    });

    it('should exclude disabled API sources', async () => {
      const sourceId = await seedSourceWithMemories('Disabled API', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/disabled/items',
          title: 'GET /disabled/items — list disabled items',
          content: 'List items from a disabled API source',
        },
      ]);

      // Disable the source
      await pool.query(
        `UPDATE api_source SET status = 'disabled' WHERE id = $1`,
        [sourceId],
      );

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'disabled items',
      });

      expect(results.length).toBe(0);
    });

    it('should scope to namespace', async () => {
      // Seed in a different namespace
      const source = await createApiSource(pool, { namespace: 'other-ns', name: 'Other NS API' });
      await pool.query(
        `INSERT INTO api_memory (
          api_source_id, namespace, memory_kind, operation_key,
          title, content, embedding_status
        ) VALUES ($1, 'other-ns', 'operation', 'GET:/other', 'GET /other', 'Other namespace content', 'pending')`,
        [source.id],
      );

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'other namespace content',
      });

      expect(results.length).toBe(0);
    });

    it('should attach decrypted credentials to results', async () => {
      await seedSourceWithMemories('Auth API', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/auth/data',
          title: 'GET /auth/data — authenticated data retrieval',
          content: 'Retrieve data that requires authentication headers',
        },
      ], { addCredential: true });

      const results = await searchApiMemories(pool, {
        namespace,
        query: 'authenticated data retrieval',
      });

      expect(results.length).toBeGreaterThan(0);
      const withCreds = results.find((r) => r.credentials && r.credentials.length > 0);
      expect(withCreds).toBeDefined();
      expect(withCreds!.credentials![0].header_name).toBe('Authorization');
      // Search results return masked credentials (security: decrypt requires write scope)
      expect(withCreds!.credentials![0].resolve_reference).not.toBe('test-api-key-12345');
      expect(withCreds!.credentials![0].resolve_reference).toContain('***');
    });

    it('should return empty for no matches', async () => {
      const results = await searchApiMemories(pool, {
        namespace,
        query: 'xyzzy-no-match-12345',
      });

      expect(results).toEqual([]);
    });
  });

  describe('listApiMemories', () => {
    it('should list memories for a source', async () => {
      const sourceId = await seedSourceWithMemories('List API', [
        {
          memory_kind: 'overview',
          operation_key: 'overview:list-api',
          title: 'List API Overview',
          content: 'Overview of the list API',
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/list/items',
          title: 'GET /list/items',
          content: 'List items endpoint',
        },
      ]);

      const memories = await listApiMemories(pool, sourceId, namespace);

      expect(memories.length).toBe(2);
    });

    it('should filter by memory_kind', async () => {
      const sourceId = await seedSourceWithMemories('Kind Filter API', [
        {
          memory_kind: 'overview',
          operation_key: 'overview:kind-api',
          title: 'Kind API Overview',
          content: 'Overview',
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/kind/items',
          title: 'GET /kind/items',
          content: 'Items endpoint',
        },
      ]);

      const memories = await listApiMemories(pool, sourceId, namespace, {
        memory_kind: 'operation',
      });

      expect(memories.length).toBe(1);
      expect(memories[0].memory_kind).toBe('operation');
    });

    it('should respect limit and offset', async () => {
      const sourceId = await seedSourceWithMemories('Paginated API', [
        {
          memory_kind: 'operation',
          operation_key: 'GET:/page/1',
          title: 'GET /page/1',
          content: 'Page one',
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/page/2',
          title: 'GET /page/2',
          content: 'Page two',
        },
        {
          memory_kind: 'operation',
          operation_key: 'GET:/page/3',
          title: 'GET /page/3',
          content: 'Page three',
        },
      ]);

      const page = await listApiMemories(pool, sourceId, namespace, {
        limit: 2,
        offset: 0,
      });

      expect(page.length).toBe(2);

      const page2 = await listApiMemories(pool, sourceId, namespace, {
        limit: 2,
        offset: 2,
      });

      expect(page2.length).toBe(1);
    });
  });
});
