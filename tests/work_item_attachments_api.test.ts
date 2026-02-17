import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Attachments and Dependencies API (issue #109)', () => {
  const app = buildServer();
  let pool: Pool;
  let work_item_id: string;
  let contact_id: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create a work item
    const wi = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Test Project', kind: 'project' },
    });
    work_item_id = (wi.json() as { id: string }).id;

    // Create a contact
    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { display_name: 'John Doe' },
    });
    contact_id = (contact.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/work-items/:id with attachments', () => {
    it('returns empty attachments array when no attachments exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { attachments: unknown[] };
      expect(body.attachments).toEqual([]);
    });

    it('returns linked memories as attachments', async () => {
      // Create a memory
      const memory = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/memories`,
        payload: { title: 'Important Note', content: 'Content here', type: 'note' },
      });
      const memory_id = (memory.json() as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        attachments: Array<{
          id: string;
          type: string;
          title: string;
          subtitle?: string;
          linkedAt: string;
        }>;
      };
      expect(body.attachments.length).toBe(1);
      expect(body.attachments[0].id).toBe(memory_id);
      expect(body.attachments[0].type).toBe('memory');
      expect(body.attachments[0].title).toBe('Important Note');
    });

    it('returns linked contacts as attachments', async () => {
      // Link a contact
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/contacts`,
        payload: { contact_id, relationship: 'owner' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        attachments: Array<{
          id: string;
          type: string;
          title: string;
          subtitle?: string;
        }>;
      };
      expect(body.attachments.length).toBe(1);
      expect(body.attachments[0].id).toBe(contact_id);
      expect(body.attachments[0].type).toBe('contact');
      expect(body.attachments[0].title).toBe('John Doe');
      expect(body.attachments[0].subtitle).toBe('owner');
    });

    it('returns multiple attachment types', async () => {
      // Create a memory
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/memories`,
        payload: { title: 'Memory 1', content: 'Content', type: 'note' },
      });

      // Link a contact
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/contacts`,
        payload: { contact_id, relationship: 'assignee' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        attachments: Array<{ type: string }>;
      };
      expect(body.attachments.length).toBe(2);
      const types = body.attachments.map((a) => a.type);
      expect(types).toContain('memory');
      expect(types).toContain('contact');
    });
  });

  describe('GET /api/work-items/:id with dependencies', () => {
    let blockedWorkItemId: string;
    let blockingWorkItemId: string;

    beforeEach(async () => {
      // Create an initiative under the project
      const init1 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Initiative 1', kind: 'initiative', parent_id: work_item_id },
      });
      blockedWorkItemId = (init1.json() as { id: string }).id;

      const init2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Initiative 2', kind: 'initiative', parent_id: work_item_id },
      });
      blockingWorkItemId = (init2.json() as { id: string }).id;
    });

    it('returns dependencies with kind and status', async () => {
      // Create a dependency: blockedWorkItemId depends on blockingWorkItemId
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'depends_on')`,
        [blockedWorkItemId, blockingWorkItemId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${blockedWorkItemId}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        dependencies: Array<{
          id: string;
          title: string;
          kind: string;
          status: string;
          direction: string;
        }>;
      };

      expect(body.dependencies.length).toBe(1);
      const dep = body.dependencies[0];
      expect(dep.id).toBe(blockingWorkItemId);
      expect(dep.title).toBe('Initiative 2');
      expect(dep.kind).toBe('initiative');
      expect(dep.status).toBe('open');
      expect(dep.direction).toBe('blocked_by');
    });

    it('returns dependencies in both directions', async () => {
      // blockedWorkItemId depends on blockingWorkItemId
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'depends_on')`,
        [blockedWorkItemId, blockingWorkItemId],
      );

      // Check from the blocking item's perspective
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${blockingWorkItemId}`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        dependencies: Array<{ direction: string }>;
      };

      expect(body.dependencies.length).toBe(1);
      expect(body.dependencies[0].direction).toBe('blocks');
    });
  });
});
