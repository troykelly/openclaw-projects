import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Reparent API (issue #105)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createItem(title: string, kind: string, parent_id?: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title, kind, parent_id },
    });
    return (res.json() as { id: string }).id;
  }

  describe('PATCH /api/work-items/:id/reparent', () => {
    it('moves epic to different initiative', async () => {
      // Create project -> initiative1 -> epic
      //                -> initiative2 (target)
      const project_id = await createItem('Project', 'project');
      const init1Id = await createItem('Initiative 1', 'initiative', project_id);
      const init2Id = await createItem('Initiative 2', 'initiative', project_id);
      const epicId = await createItem('Epic', 'epic', init1Id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${epicId}/reparent`,
        payload: { new_parent_id: init2Id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      // Verify the epic is now under initiative 2
      const check = await pool.query('SELECT parent_work_item_id::text as parent_id FROM work_item WHERE id = $1', [epicId]);
      expect((check.rows[0] as { parent_id: string }).parent_id).toBe(init2Id);
    });

    it('moves issue to different epic', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);
      const epic1Id = await createItem('Epic 1', 'epic', initId);
      const epic2Id = await createItem('Epic 2', 'epic', initId);
      const issueId = await createItem('Issue', 'issue', epic1Id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${issueId}/reparent`,
        payload: { new_parent_id: epic2Id },
      });
      expect(res.statusCode).toBe(200);

      const check = await pool.query('SELECT parent_work_item_id::text as parent_id FROM work_item WHERE id = $1', [issueId]);
      expect((check.rows[0] as { parent_id: string }).parent_id).toBe(epic2Id);
    });

    it('moves initiative to different project', async () => {
      const project1Id = await createItem('Project 1', 'project');
      const project2Id = await createItem('Project 2', 'project');
      const initId = await createItem('Initiative', 'initiative', project1Id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${initId}/reparent`,
        payload: { new_parent_id: project2Id },
      });
      expect(res.statusCode).toBe(200);

      const check = await pool.query('SELECT parent_work_item_id::text as parent_id FROM work_item WHERE id = $1', [initId]);
      expect((check.rows[0] as { parent_id: string }).parent_id).toBe(project2Id);
    });

    it('moves initiative to root (null parent)', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${initId}/reparent`,
        payload: { new_parent_id: null },
      });
      expect(res.statusCode).toBe(200);

      const check = await pool.query('SELECT parent_work_item_id FROM work_item WHERE id = $1', [initId]);
      expect(check.rows[0].parent_work_item_id).toBeNull();
    });

    it('respects afterId for positioning among new siblings', async () => {
      const project_id = await createItem('Project', 'project');
      const init1Id = await createItem('Initiative 1', 'initiative', project_id);
      const init2Id = await createItem('Initiative 2', 'initiative', project_id);
      const epic1Id = await createItem('Epic A', 'epic', init1Id);
      const epic2Id = await createItem('Epic B', 'epic', init2Id);
      const epic3Id = await createItem('Epic C', 'epic', init2Id);

      // Normalize sort orders in init2
      await pool.query('UPDATE work_item SET sort_order = 1000 WHERE id = $1', [epic2Id]);
      await pool.query('UPDATE work_item SET sort_order = 2000 WHERE id = $1', [epic3Id]);

      // Move epic1 to init2, after epic2
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${epic1Id}/reparent`,
        payload: { new_parent_id: init2Id, after_id: epic2Id },
      });
      expect(res.statusCode).toBe(200);

      // Check order - should be B, A, C
      const siblings = await pool.query(
        `SELECT id::text as id FROM work_item
         WHERE parent_work_item_id = $1
         ORDER BY sort_order`,
        [init2Id],
      );
      const order = siblings.rows.map((r: { id: string }) => r.id);
      expect(order[0]).toBe(epic2Id); // B
      expect(order[1]).toBe(epic1Id); // A (moved)
      expect(order[2]).toBe(epic3Id); // C
    });

    it('returns 400 when epic is moved to project (wrong hierarchy)', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);
      const epicId = await createItem('Epic', 'epic', initId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${epicId}/reparent`,
        payload: { new_parent_id: project_id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('epic parent must be initiative');
    });

    it('returns 400 when issue is moved to initiative (wrong hierarchy)', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);
      const epicId = await createItem('Epic', 'epic', initId);
      const issueId = await createItem('Issue', 'issue', epicId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${issueId}/reparent`,
        payload: { new_parent_id: initId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('issue parent must be epic');
    });

    it('returns 400 when initiative is moved to initiative (wrong hierarchy)', async () => {
      const project_id = await createItem('Project', 'project');
      const init1Id = await createItem('Initiative 1', 'initiative', project_id);
      const init2Id = await createItem('Initiative 2', 'initiative', project_id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${init1Id}/reparent`,
        payload: { new_parent_id: init2Id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('initiative parent must be project');
    });

    it('returns 400 when project is moved to have a parent', async () => {
      const project1Id = await createItem('Project 1', 'project');
      const project2Id = await createItem('Project 2', 'project');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${project1Id}/reparent`,
        payload: { new_parent_id: project2Id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('project cannot have parent');
    });

    it('returns 400 when trying to create circular reference', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);
      const epicId = await createItem('Epic', 'epic', initId);

      // Try to make initiative a child of epic (circular through hierarchy)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${initId}/reparent`,
        payload: { new_parent_id: epicId },
      });
      expect(res.statusCode).toBe(400);
      // Either hierarchy error or circular error is acceptable
      expect(res.json().error).toBeDefined();
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/reparent',
        payload: { new_parent_id: null },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 for non-existent new parent', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${initId}/reparent`,
        payload: { new_parent_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'parent not found' });
    });

    it('returns 400 when reparenting to self', async () => {
      const project_id = await createItem('Project', 'project');
      const initId = await createItem('Initiative', 'initiative', project_id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${initId}/reparent`,
        payload: { new_parent_id: initId },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('cannot be its own parent');
    });
  });
});
