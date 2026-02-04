import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Dates API (issue #113)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId: string;

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
    workItemId = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('PATCH /api/work-items/:id/dates', () => {
    it('updates dates with valid startDate and endDate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {
          startDate: '2026-03-01',
          endDate: '2026-03-15',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: {
          id: string;
          startDate: string;
          endDate: string;
          updatedAt: string;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.item.id).toBe(workItemId);
      expect(body.item.startDate).toBe('2026-03-01');
      expect(body.item.endDate).toBe('2026-03-15');
      expect(body.item.updatedAt).toBeDefined();
    });

    it('updates only startDate when endDate is omitted', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {
          startDate: '2026-03-01',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { startDate: string; endDate: string | null };
      };
      expect(body.ok).toBe(true);
      expect(body.item.startDate).toBe('2026-03-01');
      expect(body.item.endDate).toBeNull();
    });

    it('updates only endDate when startDate is omitted', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {
          endDate: '2026-03-15',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { startDate: string | null; endDate: string };
      };
      expect(body.ok).toBe(true);
      expect(body.item.startDate).toBeNull();
      expect(body.item.endDate).toBe('2026-03-15');
    });

    it('clears dates when set to null', async () => {
      // First set dates
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: { startDate: '2026-03-01', endDate: '2026-03-15' },
      });

      // Then clear them
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: { startDate: null, endDate: null },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { startDate: string | null; endDate: string | null };
      };
      expect(body.item.startDate).toBeNull();
      expect(body.item.endDate).toBeNull();
    });

    it('returns 400 when startDate is after endDate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {
          startDate: '2026-03-15',
          endDate: '2026-03-01',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'startDate must be before or equal to endDate' });
    });

    it('returns 400 when no date fields provided', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'at least one date field is required' });
    });

    it('returns 400 for invalid date format', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {
          startDate: 'invalid-date',
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
          startDate: '2026-03-01',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('validates startDate against existing endDate', async () => {
      // First set endDate only
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: { endDate: '2026-03-01' },
      });

      // Try to set startDate after existing endDate
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: { startDate: '2026-03-15' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'startDate must be before or equal to endDate' });
    });

    it('validates endDate against existing startDate', async () => {
      // First set startDate only
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: { startDate: '2026-03-15' },
      });

      // Try to set endDate before existing startDate
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: { endDate: '2026-03-01' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'startDate must be before or equal to endDate' });
    });

    it('allows equal startDate and endDate', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/dates`,
        payload: {
          startDate: '2026-03-15',
          endDate: '2026-03-15',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        ok: boolean;
        item: { startDate: string; endDate: string };
      };
      expect(body.item.startDate).toBe('2026-03-15');
      expect(body.item.endDate).toBe('2026-03-15');
    });
  });
});
