import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Reorder API (issue #104)', () => {
  const app = buildServer();
  let pool: Pool;
  let parent_id: string;
  let childIds: string[];

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    childIds = [];

    // Create parent initiative (top-level)
    const parent = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Parent Initiative', kind: 'initiative' },
    });
    parent_id = (parent.json() as { id: string }).id;

    // Create 4 child epics under the initiative
    for (const name of ['A', 'B', 'C', 'D']) {
      const child = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: `Epic ${name}`, kind: 'epic', parent_id },
      });
      childIds.push((child.json() as { id: string }).id);
    }
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function getSiblingOrder(): Promise<string[]> {
    const result = await pool.query(
      `SELECT id::text as id FROM work_item
       WHERE parent_work_item_id = $1
       ORDER BY sort_order ASC`,
      [parent_id],
    );
    return result.rows.map((r: { id: string }) => r.id);
  }

  describe('PATCH /api/work-items/:id/reorder', () => {
    it('moves item to first position when afterId is null', async () => {
      // Move D to first (after null = beginning)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[3]}/reorder`,
        payload: { after_id: null },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const order = await getSiblingOrder();
      expect(order[0]).toBe(childIds[3]); // D first
      expect(order[1]).toBe(childIds[0]); // A second
    });

    it('moves item to last position when beforeId is null', async () => {
      // Move A to last (before null = end)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[0]}/reorder`,
        payload: { before_id: null },
      });
      expect(res.statusCode).toBe(200);

      const order = await getSiblingOrder();
      expect(order[3]).toBe(childIds[0]); // A last
    });

    it('moves item after a specific sibling', async () => {
      // First normalize the sort_orders to have gaps
      for (let i = 0; i < childIds.length; i++) {
        await pool.query('UPDATE work_item SET sort_order = $1 WHERE id = $2', [(i + 1) * 1000, childIds[i]]);
      }

      // Move D after A (A, D, B, C)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[3]}/reorder`,
        payload: { after_id: childIds[0] },
      });
      expect(res.statusCode).toBe(200);

      const order = await getSiblingOrder();
      expect(order[0]).toBe(childIds[0]); // A
      expect(order[1]).toBe(childIds[3]); // D
      expect(order[2]).toBe(childIds[1]); // B
      expect(order[3]).toBe(childIds[2]); // C
    });

    it('moves item before a specific sibling', async () => {
      // First normalize the sort_orders to have gaps
      for (let i = 0; i < childIds.length; i++) {
        await pool.query('UPDATE work_item SET sort_order = $1 WHERE id = $2', [(i + 1) * 1000, childIds[i]]);
      }

      // Move D before B (A, D, B, C)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[3]}/reorder`,
        payload: { before_id: childIds[1] },
      });
      expect(res.statusCode).toBe(200);

      const order = await getSiblingOrder();
      expect(order[0]).toBe(childIds[0]); // A
      expect(order[1]).toBe(childIds[3]); // D
      expect(order[2]).toBe(childIds[1]); // B
      expect(order[3]).toBe(childIds[2]); // C
    });

    it('returns 400 when neither afterId nor beforeId provided', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[0]}/reorder`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'after_id or before_id is required' });
    });

    it('returns 400 when both afterId and beforeId provided', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[0]}/reorder`,
        payload: { after_id: childIds[1], before_id: childIds[2] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'provide only one of after_id or before_id' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/reorder',
        payload: { after_id: null },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 when target is not a sibling', async () => {
      // Create another initiative with its own child
      const otherParent = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Other Initiative', kind: 'initiative' },
      });
      const otherParentId = (otherParent.json() as { id: string }).id;

      const otherChild = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Other Epic', kind: 'epic', parent_id: otherParentId },
      });
      const otherChildId = (otherChild.json() as { id: string }).id;

      // Try to reorder relative to non-sibling
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[0]}/reorder`,
        payload: { after_id: otherChildId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'target must be a sibling' });
    });

    it('returns 400 when target does not exist', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[0]}/reorder`,
        payload: { after_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'target not found' });
    });

    it('handles reordering to same position (no-op)', async () => {
      // First normalize the sort_orders to have gaps
      for (let i = 0; i < childIds.length; i++) {
        await pool.query('UPDATE work_item SET sort_order = $1 WHERE id = $2', [(i + 1) * 1000, childIds[i]]);
      }

      // Move B after A (it's already there)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${childIds[1]}/reorder`,
        payload: { after_id: childIds[0] },
      });
      expect(res.statusCode).toBe(200);

      const order = await getSiblingOrder();
      expect(order).toEqual(childIds); // Order unchanged
    });

    it('handles reordering top-level items (null parent)', async () => {
      // Create another top-level initiative
      const init2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Second Initiative', kind: 'initiative' },
      });
      const init2Id = (init2.json() as { id: string }).id;

      // Move second initiative before first
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${init2Id}/reorder`,
        payload: { before_id: parent_id },
      });
      expect(res.statusCode).toBe(200);

      // Verify order of top-level items
      const result = await pool.query(
        `SELECT id::text as id FROM work_item
         WHERE parent_work_item_id IS NULL
         ORDER BY sort_order ASC`,
      );
      const topLevelOrder = result.rows.map((r: { id: string }) => r.id);
      expect(topLevelOrder[0]).toBe(init2Id);
      expect(topLevelOrder[1]).toBe(parent_id);
    });
  });
});
