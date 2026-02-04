import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Timeline API: GET /api/work-items/:id/timeline', () => {
  let pool: Pool;
  const app = buildServer({ logger: false });

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  it('returns timeline data for a project with hierarchy', async () => {
    // Create a project with initiatives, epics, and issues
    const project = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, not_before, not_after, estimate_minutes)
       VALUES ('Project Alpha', 'project', '2025-01-01', '2025-03-31', 60)
       RETURNING id::text as id`
    );
    const projectId = project.rows[0].id;

    const initiative = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Initiative 1', 'initiative', $1, '2025-01-01', '2025-02-15', 120)
       RETURNING id::text as id`,
      [projectId]
    );
    const initiativeId = initiative.rows[0].id;

    const epic = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Epic 1', 'epic', $1, '2025-01-01', '2025-01-31', 180)
       RETURNING id::text as id`,
      [initiativeId]
    );
    const epicId = epic.rows[0].id;

    const issue1 = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Issue 1', 'issue', $1, '2025-01-01', '2025-01-15', 60)
       RETURNING id::text as id`,
      [epicId]
    );

    const issue2 = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Issue 2', 'issue', $1, '2025-01-16', '2025-01-31', 90)
       RETURNING id::text as id`,
      [epicId]
    );

    // Add a dependency: issue2 depends on issue1
    await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, 'depends_on')`,
      [issue2.rows[0].id, issue1.rows[0].id]
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/work-items/${projectId}/timeline`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.items).toHaveLength(5); // project + initiative + epic + 2 issues
    expect(body.dependencies).toHaveLength(1);

    // Check items have required fields
    const projectItem = body.items.find((i: { id: string }) => i.id === projectId);
    expect(projectItem).toBeDefined();
    expect(projectItem.title).toBe('Project Alpha');
    expect(projectItem.kind).toBe('project');
    expect(projectItem.not_before).toBeTruthy();
    expect(projectItem.not_after).toBeTruthy();
    expect(projectItem.level).toBe(0);

    // Check hierarchy levels
    const initItem = body.items.find((i: { id: string }) => i.id === initiativeId);
    expect(initItem.level).toBe(1);
    expect(initItem.parent_id).toBe(projectId);

    const epicItem = body.items.find((i: { id: string }) => i.id === epicId);
    expect(epicItem.level).toBe(2);

    // Check dependency
    expect(body.dependencies[0].from_id).toBe(issue2.rows[0].id);
    expect(body.dependencies[0].to_id).toBe(issue1.rows[0].id);
  });

  it('returns 404 for non-existent work item', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/work-items/00000000-0000-0000-0000-000000000000/timeline',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns timeline for a single item without children', async () => {
    const issue = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
       VALUES ('Standalone issue', 'issue', '2025-01-01', '2025-01-15')
       RETURNING id::text as id`
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/work-items/${issue.rows[0].id}/timeline`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Standalone issue');
    expect(body.dependencies).toHaveLength(0);
  });

  it('includes items without dates but with estimates', async () => {
    const project = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, estimate_minutes)
       VALUES ('No dates project', 'project', 480)
       RETURNING id::text as id`
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/work-items/${project.rows[0].id}/timeline`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].not_before).toBeNull();
    expect(body.items[0].not_after).toBeNull();
    expect(body.items[0].estimate_minutes).toBe(480);
  });
});
