/**
 * Unit tests for API source <-> work item linkage.
 * Part of API Onboarding feature (#1788).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

import {
  linkApiSourceToWorkItem,
  unlinkApiSourceFromWorkItem,
  getApiSourceLinks,
  getWorkItemApiSources,
} from '../../../src/api/api-sources/links.ts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockPool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  } as unknown as Pool;
}

const SOURCE_ID = '11111111-1111-1111-1111-111111111111';
const WORK_ITEM_ID = '22222222-2222-2222-2222-222222222222';
const WORK_ITEM_ID_2 = '33333333-3333-3333-3333-333333333333';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('API Source Links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('linkApiSourceToWorkItem', () => {
    it('links an API source to a work item', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ api_source_id: SOURCE_ID, work_item_id: WORK_ITEM_ID, created_at: new Date() }],
        rowCount: 1,
      } as never);

      const result = await linkApiSourceToWorkItem(pool, SOURCE_ID, WORK_ITEM_ID);

      expect(result).toBe(true);
      expect(pool.query).toHaveBeenCalledTimes(1);
      const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
      expect(sql).toContain('INSERT');
      expect(sql).toContain('api_source_link');
    });

    it('is idempotent — duplicate link does not error', async () => {
      const pool = createMockPool();
      // ON CONFLICT DO NOTHING returns rowCount: 0 on duplicate
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await linkApiSourceToWorkItem(pool, SOURCE_ID, WORK_ITEM_ID);

      // Should not throw, returns false since no row was inserted
      expect(result).toBe(false);
    });
  });

  describe('unlinkApiSourceFromWorkItem', () => {
    it('removes a link', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ api_source_id: SOURCE_ID, work_item_id: WORK_ITEM_ID }],
        rowCount: 1,
      } as never);

      const result = await unlinkApiSourceFromWorkItem(pool, SOURCE_ID, WORK_ITEM_ID);

      expect(result).toBe(true);
      const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
      expect(sql).toContain('DELETE');
    });

    it('returns false if link does not exist', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as never);

      const result = await unlinkApiSourceFromWorkItem(pool, SOURCE_ID, WORK_ITEM_ID);

      expect(result).toBe(false);
    });
  });

  describe('getApiSourceLinks', () => {
    it('returns work item IDs linked to an API source', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [
          { work_item_id: WORK_ITEM_ID, created_at: new Date() },
          { work_item_id: WORK_ITEM_ID_2, created_at: new Date() },
        ],
        rowCount: 2,
      } as never);

      const links = await getApiSourceLinks(pool, SOURCE_ID);

      expect(links).toHaveLength(2);
      expect(links.map((l) => l.work_item_id)).toContain(WORK_ITEM_ID);
      expect(links.map((l) => l.work_item_id)).toContain(WORK_ITEM_ID_2);
    });

    it('returns empty array when no links exist', async () => {
      const pool = createMockPool();
      const links = await getApiSourceLinks(pool, SOURCE_ID);
      expect(links).toEqual([]);
    });
  });

  describe('getWorkItemApiSources', () => {
    it('returns API source IDs linked to a work item', async () => {
      const pool = createMockPool();
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [
          { api_source_id: SOURCE_ID, created_at: new Date() },
        ],
        rowCount: 1,
      } as never);

      const links = await getWorkItemApiSources(pool, WORK_ITEM_ID);

      expect(links).toHaveLength(1);
      expect(links[0].api_source_id).toBe(SOURCE_ID);
    });
  });
});
