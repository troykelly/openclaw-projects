/**
 * Unit tests for API source soft-delete integration.
 * Verifies api_source integrates with the soft-delete module.
 * Part of API Onboarding feature (#1792).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

import {
  softDeleteApiSource,
  restoreApiSource,
  getApiSource,
  createApiSource,
} from '../../../src/api/api-sources/service.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockPool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  } as unknown as Pool;
}

const SOURCE_ID = '11111111-1111-1111-1111-111111111111';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('API Source Soft-Delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('softDeleteApiSource', () => {
    it('sets deleted_at and returns true', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: SOURCE_ID }],
        rowCount: 1,
      } as never);

      const result = await softDeleteApiSource(pool, SOURCE_ID, 'default');

      expect(result).toBe(true);
      const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
      expect(sql).toContain('deleted_at');
      expect(sql).toContain('UPDATE');
    });

    it('returns false for non-existent source', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await softDeleteApiSource(pool, SOURCE_ID, 'default');
      expect(result).toBe(false);
    });

    it('returns false if already deleted', async () => {
      const pool = createMockPool();
      // deleted_at IS NULL condition fails
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await softDeleteApiSource(pool, SOURCE_ID, 'default');
      expect(result).toBe(false);
    });
  });

  describe('restoreApiSource', () => {
    it('clears deleted_at and returns the source', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{
          id: SOURCE_ID,
          namespace: 'default',
          name: 'Restored API',
          description: null,
          spec_url: null,
          servers: [],
          spec_version: null,
          spec_hash: null,
          tags: [],
          refresh_interval_seconds: null,
          last_fetched_at: null,
          status: 'active',
          error_message: null,
          created_by_agent: null,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        }],
        rowCount: 1,
      } as never);

      const result = await restoreApiSource(pool, SOURCE_ID, 'default');

      expect(result).not.toBeNull();
      expect(result!.deleted_at).toBeNull();
      expect(result!.name).toBe('Restored API');
    });

    it('returns null for non-deleted source', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await restoreApiSource(pool, SOURCE_ID, 'default');
      expect(result).toBeNull();
    });

    it('returns null for wrong namespace', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await restoreApiSource(pool, SOURCE_ID, 'wrong-ns');
      expect(result).toBeNull();
    });
  });

  describe('getApiSource excludes soft-deleted', () => {
    it('returns null for soft-deleted source', async () => {
      const pool = createMockPool();
      // The WHERE clause includes `deleted_at IS NULL` so it returns no rows
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await getApiSource(pool, SOURCE_ID, 'default');
      expect(result).toBeNull();
    });
  });

  describe('Route integration: trash and restore endpoints', () => {
    it('DELETE /api/api-sources/:id maps to softDeleteApiSource', () => {
      // This is a structural test — verify that the routes.ts file
      // registers the DELETE endpoint mapping to softDeleteApiSource.
      // The route is verified in the HTTP route tests (routes.test.ts).
      // Here we verify the service function has the expected signature.
      expect(typeof softDeleteApiSource).toBe('function');
      expect(softDeleteApiSource.length).toBe(3); // pool, id, namespace
    });

    it('POST /api/api-sources/:id/restore maps to restoreApiSource', () => {
      expect(typeof restoreApiSource).toBe('function');
      expect(restoreApiSource.length).toBe(3); // pool, id, namespace
    });
  });
});
