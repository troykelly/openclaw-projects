/**
 * HTTP integration tests for api-sources routes.
 * Tests the full request/response cycle through Fastify.
 * Part of API Onboarding feature (#1775).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../../helpers/db.ts';
import { buildServer } from '../../../src/api/server.ts';
import type { InjectOptions } from 'fastify';

const TEST_KEY_HEX = 'd'.repeat(64);
const NS_HEADERS = { 'x-namespace': 'default' };

/** Helper to inject with default namespace header */
function injectOpts(opts: InjectOptions): InjectOptions {
  return {
    ...opts,
    headers: { ...NS_HEADERS, ...opts.headers },
  };
}

describe('API Sources Routes', () => {
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

  // ── API Source CRUD ─────────────────────────────────────────────

  describe('POST /api/api-sources', () => {
    it('creates a new API source', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: {
          name: 'Petstore API',
          description: 'A sample pet API',
          spec_url: 'https://petstore.example.com/openapi.json',
          tags: ['pets', 'sample'],
        },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { id: string; name: string; namespace: string; status: string } };
      expect(body.data.name).toBe('Petstore API');
      expect(body.data.namespace).toBe('default');
      expect(body.data.status).toBe('active');
    });

    it('rejects missing name', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { description: 'No name' },
      }));

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/api-sources', () => {
    it('lists API sources', async () => {
      await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'API 1' },
      }));
      await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'API 2' },
      }));

      const res = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources',
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ name: string }> };
      expect(body.data).toHaveLength(2);
    });

    it('excludes soft-deleted sources', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'To Delete' },
      }));
      const { id } = (createRes.json() as { data: { id: string } }).data;

      await app.inject(injectOpts({
        method: 'DELETE',
        url: `/api/api-sources/${id}`,
      }));

      const res = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources',
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  describe('GET /api/api-sources/:id', () => {
    it('returns a single API source', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'Test Get' },
      }));
      const { id } = (createRes.json() as { data: { id: string } }).data;

      const res = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${id}`,
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { id: string; name: string } };
      expect(body.data.id).toBe(id);
      expect(body.data.name).toBe('Test Get');
    });

    it('returns 404 for non-existent source', async () => {
      const res = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources/00000000-0000-0000-0000-000000000000',
      }));

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources/not-a-uuid',
      }));

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/api-sources/:id', () => {
    it('updates an API source', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'Original' },
      }));
      const { id } = (createRes.json() as { data: { id: string } }).data;

      const res = await app.inject(injectOpts({
        method: 'PATCH',
        url: `/api/api-sources/${id}`,
        payload: { name: 'Updated', tags: ['new-tag'] },
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { name: string; tags: string[] } };
      expect(body.data.name).toBe('Updated');
      expect(body.data.tags).toEqual(['new-tag']);
    });

    it('returns 404 for non-existent source', async () => {
      const res = await app.inject(injectOpts({
        method: 'PATCH',
        url: '/api/api-sources/00000000-0000-0000-0000-000000000000',
        payload: { name: 'Nope' },
      }));

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/api-sources/:id', () => {
    it('soft deletes an API source', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'To Delete' },
      }));
      const { id } = (createRes.json() as { data: { id: string } }).data;

      const res = await app.inject(injectOpts({
        method: 'DELETE',
        url: `/api/api-sources/${id}`,
      }));

      expect(res.statusCode).toBe(204);

      // Verify it's gone from list
      const listRes = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources',
      }));
      const body = listRes.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  describe('POST /api/api-sources/:id/restore', () => {
    it('restores a soft-deleted source', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'To Restore' },
      }));
      const { id } = (createRes.json() as { data: { id: string } }).data;

      // Soft delete
      await app.inject(injectOpts({ method: 'DELETE', url: `/api/api-sources/${id}` }));

      // Restore
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${id}/restore`,
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { id: string; name: string } };
      expect(body.data.name).toBe('To Restore');

      // Verify it's back in list
      const listRes = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources',
      }));
      const listBody = listRes.json() as { data: unknown[] };
      expect(listBody.data).toHaveLength(1);
    });
  });

  // ── Credential CRUD ─────────────────────────────────────────────

  describe('Credential lifecycle', () => {
    let apiSourceId: string;

    beforeEach(async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'Cred Test API' },
      }));
      apiSourceId = (createRes.json() as { data: { id: string } }).data.id;
    });

    it('creates a credential and returns plaintext reference', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
          header_prefix: 'Bearer',
          resolve_strategy: 'literal',
          resolve_reference: 'sk-secret-key-1234567890abcdef',
        },
      }));

      expect(res.statusCode).toBe(201);
      const body = res.json() as { data: { id: string; resolve_reference: string; header_name: string } };
      expect(body.data.header_name).toBe('Authorization');
      expect(body.data.resolve_reference).toBe('sk-secret-key-1234567890abcdef');
    });

    it('lists credentials with masked values by default', async () => {
      await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
          resolve_strategy: 'literal',
          resolve_reference: 'long-secret-that-exceeds-twenty-characters',
        },
      }));

      const res = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${apiSourceId}/credentials`,
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ resolve_reference: string }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].resolve_reference).toContain('***');
      expect(body.data[0].resolve_reference).not.toBe('long-secret-that-exceeds-twenty-characters');
    });

    it('lists credentials with decrypted values when decrypt=true', async () => {
      await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
          resolve_strategy: 'literal',
          resolve_reference: 'my-full-secret-value',
        },
      }));

      const res = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${apiSourceId}/credentials?decrypt=true`,
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ resolve_reference: string }> };
      expect(body.data[0].resolve_reference).toBe('my-full-secret-value');
    });

    it('gets a single credential with masked value', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'X-API-Key',
          resolve_strategy: 'literal',
          resolve_reference: 'short',
        },
      }));
      const credId = (createRes.json() as { data: { id: string } }).data.id;

      const res = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${apiSourceId}/credentials/${credId}`,
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { resolve_reference: string } };
      expect(body.data.resolve_reference).toBe('***');
    });

    it('updates a credential', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
          resolve_strategy: 'literal',
          resolve_reference: 'original-secret',
        },
      }));
      const credId = (createRes.json() as { data: { id: string } }).data.id;

      const res = await app.inject(injectOpts({
        method: 'PATCH',
        url: `/api/api-sources/${apiSourceId}/credentials/${credId}`,
        payload: {
          header_name: 'X-Custom-Header',
          resolve_reference: 'new-secret-value-that-is-long-enough',
        },
      }));

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { header_name: string; resolve_reference: string } };
      expect(body.data.header_name).toBe('X-Custom-Header');
      expect(body.data.resolve_reference).toBe('new-secret-value-that-is-long-enough');
    });

    it('deletes a credential', async () => {
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
          resolve_strategy: 'literal',
          resolve_reference: 'secret',
        },
      }));
      const credId = (createRes.json() as { data: { id: string } }).data.id;

      const res = await app.inject(injectOpts({
        method: 'DELETE',
        url: `/api/api-sources/${apiSourceId}/credentials/${credId}`,
      }));

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const listRes = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${apiSourceId}/credentials`,
      }));
      const body = listRes.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('returns 404 for credential on non-existent source', async () => {
      const res = await app.inject(injectOpts({
        method: 'GET',
        url: '/api/api-sources/00000000-0000-0000-0000-000000000000/credentials',
      }));

      expect(res.statusCode).toBe(404);
    });

    it('rejects credential with invalid resolve_strategy', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
          resolve_strategy: 'invalid',
          resolve_reference: 'secret',
        },
      }));

      expect(res.statusCode).toBe(400);
    });

    it('rejects credential with missing required fields', async () => {
      const res = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${apiSourceId}/credentials`,
        payload: {
          header_name: 'Authorization',
        },
      }));

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Full lifecycle ─────────────────────────────────────────────

  describe('Full CRUD lifecycle', () => {
    it('create -> get -> update -> delete -> restore', async () => {
      // Create
      const createRes = await app.inject(injectOpts({
        method: 'POST',
        url: '/api/api-sources',
        payload: { name: 'Lifecycle Test', tags: ['v1'] },
      }));
      expect(createRes.statusCode).toBe(201);
      const { id } = (createRes.json() as { data: { id: string } }).data;

      // Get
      const getRes = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${id}`,
      }));
      expect(getRes.statusCode).toBe(200);
      expect((getRes.json() as { data: { name: string } }).data.name).toBe('Lifecycle Test');

      // Update
      const updateRes = await app.inject(injectOpts({
        method: 'PATCH',
        url: `/api/api-sources/${id}`,
        payload: { name: 'Updated Lifecycle', tags: ['v2'] },
      }));
      expect(updateRes.statusCode).toBe(200);
      expect((updateRes.json() as { data: { name: string } }).data.name).toBe('Updated Lifecycle');

      // Soft delete
      const deleteRes = await app.inject(injectOpts({
        method: 'DELETE',
        url: `/api/api-sources/${id}`,
      }));
      expect(deleteRes.statusCode).toBe(204);

      // Verify gone
      const getDeletedRes = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${id}`,
      }));
      expect(getDeletedRes.statusCode).toBe(404);

      // Restore
      const restoreRes = await app.inject(injectOpts({
        method: 'POST',
        url: `/api/api-sources/${id}/restore`,
      }));
      expect(restoreRes.statusCode).toBe(200);

      // Verify back
      const getFinalRes = await app.inject(injectOpts({
        method: 'GET',
        url: `/api/api-sources/${id}`,
      }));
      expect(getFinalRes.statusCode).toBe(200);
      expect((getFinalRes.json() as { data: { name: string } }).data.name).toBe('Updated Lifecycle');
    });
  });
});
