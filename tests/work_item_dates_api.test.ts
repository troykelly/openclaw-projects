import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Dates API (issue #113)', () => {
  const app = buildServer();
  let pool: Pool;
  let work_item_id: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create a work item
    const created = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Work item with dates' },
    });
    work_item_id = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('PATCH /api/work-items/:id/dates', () => {
    it('updates dates with valid startDate and endDate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {
          start_date: '2026-03-01',
          end_date: '2026-03-15',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: {
          id: string;
          start_date: string;
          end_date: string;
          updated_at: string;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.item.id).toBe(work_item_id);
      expect(body.item.start_date).toBe('2026-03-01');
      expect(body.item.end_date).toBe('2026-03-15');
      expect(body.item.updated_at).toBeDefined();
    });

    it('updates only startDate when endDate is omitted', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {
          start_date: '2026-03-01',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { start_date: string; end_date: string | null };
      };
      expect(body.ok).toBe(true);
      expect(body.item.start_date).toBe('2026-03-01');
      expect(body.item.end_date).toBeNull();
    });

    it('updates only endDate when startDate is omitted', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {
          end_date: '2026-03-15',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { start_date: string | null; end_date: string };
      };
      expect(body.ok).toBe(true);
      expect(body.item.start_date).toBeNull();
      expect(body.item.end_date).toBe('2026-03-15');
    });

    it('clears dates when set to null', async () => {
      // First set dates
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: { start_date: '2026-03-01', end_date: '2026-03-15' },
      });

      // Then clear them
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: { start_date: null, end_date: null },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { start_date: string | null; end_date: string | null };
      };
      expect(body.item.start_date).toBeNull();
      expect(body.item.end_date).toBeNull();
    });

    it('returns 400 when startDate is after endDate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {
          start_date: '2026-03-15',
          end_date: '2026-03-01',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'start_date must be before or equal to end_date' });
    });

    it('returns 400 when no date fields provided', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'at least one date field is required' });
    });

    it('returns 400 for invalid date format', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {
          start_date: 'invalid-date',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid date format' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/dates',
        payload: {
          start_date: '2026-03-01',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('validates startDate against existing endDate', async () => {
      // First set endDate only
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: { end_date: '2026-03-01' },
      });

      // Try to set startDate after existing endDate
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: { start_date: '2026-03-15' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'start_date must be before or equal to end_date' });
    });

    it('validates endDate against existing startDate', async () => {
      // First set startDate only
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: { start_date: '2026-03-15' },
      });

      // Try to set endDate before existing startDate
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: { end_date: '2026-03-01' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'start_date must be before or equal to end_date' });
    });

    it('allows equal startDate and endDate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${work_item_id}/dates`,
        payload: {
          start_date: '2026-03-15',
          end_date: '2026-03-15',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { start_date: string; end_date: string };
      };
      expect(body.item.start_date).toBe('2026-03-15');
      expect(body.item.end_date).toBe('2026-03-15');
    });
  });
});
