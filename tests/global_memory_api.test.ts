import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Global Memory API (issue #120)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId1: string;
  let workItemId2: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create work items for memory attachment
    const wi1 = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Project Alpha', kind: 'project' },
    });
    workItemId1 = (wi1.json() as { id: string }).id;

    const wi2 = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Project Beta', kind: 'project' },
    });
    workItemId2 = (wi2.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/memory', () => {
    it('returns empty array when no memories exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory',
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { items: unknown[]; total: number; has_more: boolean };
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.has_more).toBe(false);
    });

    it('returns all memories with linked work item info', async () => {
      // Create memories
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Memory 1', content: 'Content 1', type: 'note' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId2}/memories`,
        payload: { title: 'Memory 2', content: 'Content 2', type: 'decision' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory',
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        items: Array<{
          id: string;
          title: string;
          content: string;
          type: string;
          linked_item_id: string;
          linked_item_title: string;
          linked_item_kind: string;
          created_at: string;
          updated_at: string;
        }>;
        total: number;
        has_more: boolean;
      };
      expect(body.items.length).toBe(2);
      expect(body.total).toBe(2);
      expect(body.has_more).toBe(false);

      // Check that linked work item info is included
      const mem1 = body.items.find((m) => m.title === 'Memory 1');
      expect(mem1?.linked_item_title).toBe('Project Alpha');
      expect(mem1?.linked_item_kind).toBe('project');
      expect(mem1?.linked_item_id).toBe(workItemId1);
    });

    it('supports pagination with limit and offset', async () => {
      // Create 5 memories
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: `/api/work-items/${workItemId1}/memories`,
          payload: { title: `Memory ${i}`, content: `Content ${i}` },
        });
      }

      // Get first page
      const page1 = await app.inject({
        method: 'GET',
        url: '/api/memory?limit=2&offset=0',
      });
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json() as { items: unknown[]; total: number; has_more: boolean };
      expect(body1.items.length).toBe(2);
      expect(body1.total).toBe(5);
      expect(body1.has_more).toBe(true);

      // Get second page
      const page2 = await app.inject({
        method: 'GET',
        url: '/api/memory?limit=2&offset=2',
      });
      const body2 = page2.json() as { items: unknown[]; total: number; has_more: boolean };
      expect(body2.items.length).toBe(2);
      expect(body2.has_more).toBe(true);

      // Get last page
      const page3 = await app.inject({
        method: 'GET',
        url: '/api/memory?limit=2&offset=4',
      });
      const body3 = page3.json() as { items: unknown[]; total: number; has_more: boolean };
      expect(body3.items.length).toBe(1);
      expect(body3.has_more).toBe(false);
    });

    it('supports search by title', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Important Decision', content: 'We decided X' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Meeting Notes', content: 'Notes from meeting' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory?search=decision',
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { items: Array<{ title: string }>; total: number };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Important Decision');
      expect(body.total).toBe(1);
    });

    it('supports search by content', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Title 1', content: 'This contains the keyword unicorn' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Title 2', content: 'This has different content' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory?search=unicorn',
      });
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Title 1');
    });

    it('supports filtering by type', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'A Note', content: 'Note content', type: 'note' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'A Decision', content: 'Decision content', type: 'decision' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory?type=decision',
      });
      const body = res.json() as { items: Array<{ title: string; type: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].type).toBe('decision');
    });

    it('supports filtering by linked_item_kind', async () => {
      const init = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Initiative', kind: 'initiative' },
      });
      const initId = (init.json() as { id: string }).id;

      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Project Memory', content: 'Content' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${initId}/memories`,
        payload: { title: 'Initiative Memory', content: 'Content' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory?linked_item_kind=initiative',
      });
      const body = res.json() as { items: Array<{ title: string; linked_item_kind: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].linked_item_kind).toBe('initiative');
    });

    it('orders by most recent first', async () => {
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Older Memory', content: 'Content' },
      });
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId1}/memories`,
        payload: { title: 'Newer Memory', content: 'Content' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory',
      });
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items[0].title).toBe('Newer Memory');
      expect(body.items[1].title).toBe('Older Memory');
    });
  });
});
