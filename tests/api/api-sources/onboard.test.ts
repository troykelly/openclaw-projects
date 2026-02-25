/**
 * Integration tests for the onboard endpoint.
 * Tests the full flow: spec parsing, memory creation, deduplication.
 * Part of API Onboarding feature (#1781).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../../helpers/db.ts';
import { buildServer } from '../../../src/api/server.ts';
import type { InjectOptions } from 'fastify';

const TEST_KEY_HEX = 'd'.repeat(64);
const NS_HEADERS = { 'x-namespace': 'default' };

function injectOpts(opts: InjectOptions): InjectOptions {
  return {
    ...opts,
    headers: { ...NS_HEADERS, ...opts.headers },
  };
}

const minimalSpec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Minimal API', version: '1.0.0' },
  paths: {
    '/health': {
      get: {
        operationId: 'healthCheck',
        summary: 'Health check endpoint',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});

const richSpec = JSON.stringify({
  openapi: '3.0.3',
  info: {
    title: 'Pet Store API',
    description: 'A sample API for managing pets.',
    version: '2.1.0',
  },
  servers: [{ url: 'https://api.petstore.example.com/v2' }],
  tags: [
    { name: 'pets', description: 'Pet operations' },
    { name: 'store', description: 'Store operations' },
  ],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        tags: ['pets'],
        summary: 'List all pets',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        summary: 'Create a pet',
        responses: { '201': { description: 'Created' } },
      },
    },
    '/store/orders': {
      get: {
        operationId: 'listOrders',
        tags: ['store'],
        summary: 'List orders',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});

describe('Onboard Endpoint', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    await truncateAllTables(pool);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /api/api-sources with spec_content', () => {
    it('onboards a minimal spec and creates memories', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_content: minimalSpec,
          name: 'Test Minimal API',
        },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        data: {
          api_source: { id: string; name: string; spec_hash: string };
          memories_created: number;
        };
      };

      expect(body.data.api_source.name).toBe('Test Minimal API');
      expect(body.data.api_source.spec_hash).toBeTruthy();
      // 1 operation + 1 tag group (_untagged) + 1 overview = 3 memories
      expect(body.data.memories_created).toBe(3);
    });

    it('creates correct number of memories for rich spec', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_content: richSpec,
          tags: ['test'],
        },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        data: {
          api_source: { id: string; name: string };
          memories_created: number;
        };
      };

      expect(body.data.api_source.name).toBe('Pet Store API');
      // 3 operations + 2 tag groups (pets, store) + 1 overview = 6 memories
      expect(body.data.memories_created).toBe(6);
    });

    it('creates api_memory rows with correct operation keys', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { spec_content: richSpec },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { api_source: { id: string } } };
      const sourceId = body.data.api_source.id;

      // Verify memories in database
      const memResult = await pool.query(
        `SELECT operation_key, memory_kind FROM api_memory
         WHERE api_source_id = $1
         ORDER BY operation_key`,
        [sourceId],
      );

      const keys = memResult.rows.map((r: { operation_key: string }) => r.operation_key);
      expect(keys).toContain('listPets');
      expect(keys).toContain('createPet');
      expect(keys).toContain('listOrders');
      expect(keys).toContain('overview');
      expect(keys).toContain('tag:pets');
      expect(keys).toContain('tag:store');
    });

    it('sets embedding_status to pending', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { spec_content: minimalSpec },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { api_source: { id: string } } };
      const sourceId = body.data.api_source.id;

      const memResult = await pool.query(
        'SELECT embedding_status FROM api_memory WHERE api_source_id = $1',
        [sourceId],
      );

      for (const row of memResult.rows) {
        expect((row as { embedding_status: string }).embedding_status).toBe('pending');
      }
    });

    it('stores credentials encrypted', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_content: minimalSpec,
          credentials: [
            {
              header_name: 'Authorization',
              header_prefix: 'Bearer',
              resolve_strategy: 'literal',
              resolve_reference: 'sk-secret-12345',
            },
          ],
        },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { api_source: { id: string } } };
      const sourceId = body.data.api_source.id;

      // Check that resolve_reference in DB is not the plaintext
      const credResult = await pool.query(
        'SELECT resolve_reference FROM api_credential WHERE api_source_id = $1',
        [sourceId],
      );

      expect(credResult.rows).toHaveLength(1);
      expect((credResult.rows[0] as { resolve_reference: string }).resolve_reference).not.toBe('sk-secret-12345');
    });

    it('uses spec name when no name provided', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { spec_content: minimalSpec },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { api_source: { name: string } } };
      expect(body.data.api_source.name).toBe('Minimal API');
    });
  });

  describe('deduplication', () => {
    it('returns existing source when same spec_url is onboarded twice', async () => {
      // First onboard with spec_content + spec_url
      const firstRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_url: 'https://example.com/openapi.json',
          spec_content: minimalSpec,
        },
      }));
      expect(firstRes.statusCode).toBe(201);
      const firstBody = firstRes.json() as { data: { memories_created: number } };
      expect(firstBody.data.memories_created).toBe(3);

      // Second onboard with same spec_url + spec_content
      // Since the source already exists with that URL, should return existing
      const secondRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_url: 'https://example.com/openapi.json',
          spec_content: minimalSpec,
        },
      }));

      expect(secondRes.statusCode).toBe(201);
      const body = secondRes.json() as { data: { memories_created: number } };
      // Should not create new memories since it found existing source
      expect(body.data.memories_created).toBe(0);
    });
  });

  describe('SSRF protection', () => {
    it('rejects private IP addresses in spec_url', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_url: 'http://192.168.1.1/openapi.json',
          spec_content: minimalSpec,
        },
      }));

      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: string };
      expect(body.error).toContain('SSRF');
    });

    it('rejects localhost in spec_url', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_url: 'http://localhost/openapi.json',
          spec_content: minimalSpec,
        },
      }));

      expect(res.statusCode).toBe(422);
      const body = res.json() as { error: string };
      expect(body.error).toContain('SSRF');
    });
  });

  describe('error handling', () => {
    it('rejects invalid spec_content', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_content: 'not valid json',
        },
      }));

      expect(res.statusCode).toBe(400);
    });

    it('rejects non-OpenAPI document', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          spec_content: JSON.stringify({ foo: 'bar' }),
        },
      }));

      expect(res.statusCode).toBe(400);
    });

    it('requires spec_url or spec_content or name for creation', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {},
      }));

      expect(res.statusCode).toBe(400);
    });
  });
});
