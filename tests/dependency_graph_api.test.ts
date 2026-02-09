import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Dependency Graph API: GET /api/work-items/:id/dependency-graph', () => {
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

  it('returns graph data with nodes and edges for a project', async () => {
    // Create items with dependencies
    const project = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, not_before, not_after, estimate_minutes)
       VALUES ('Project', 'project', '2025-01-01', '2025-03-31', 60)
       RETURNING id::text as id`,
    );
    const projectId = project.rows[0].id;

    const init = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Initiative', 'initiative', $1, '2025-01-01', '2025-02-15', 120)
       RETURNING id::text as id`,
      [projectId],
    );

    const epic = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Epic', 'epic', $1, '2025-01-01', '2025-01-31', 180)
       RETURNING id::text as id`,
      [init.rows[0].id],
    );

    const issueA = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Issue A', 'issue', $1, '2025-01-01', '2025-01-10', 480)
       RETURNING id::text as id`,
      [epic.rows[0].id],
    );

    const issueB = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Issue B', 'issue', $1, '2025-01-11', '2025-01-20', 240)
       RETURNING id::text as id`,
      [epic.rows[0].id],
    );

    const issueC = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before, not_after, estimate_minutes)
       VALUES ('Issue C', 'issue', $1, '2025-01-21', '2025-01-31', 120)
       RETURNING id::text as id`,
      [epic.rows[0].id],
    );

    // Add dependencies: A -> B -> C (chain)
    await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, 'depends_on')`,
      [issueB.rows[0].id, issueA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, 'depends_on')`,
      [issueC.rows[0].id, issueB.rows[0].id],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/work-items/${projectId}/dependency-graph`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // Should have nodes and edges
    expect(body.nodes).toBeDefined();
    expect(body.edges).toBeDefined();
    expect(body.critical_path).toBeDefined();

    // 6 nodes: project + init + epic + 3 issues
    expect(body.nodes).toHaveLength(6);

    // 2 dependency edges
    expect(body.edges).toHaveLength(2);

    // Critical path should include the chain A -> B -> C
    expect(body.critical_path.length).toBeGreaterThan(0);
    const pathIds = body.critical_path.map((n: { id: string }) => n.id);
    expect(pathIds).toContain(issueA.rows[0].id);
    expect(pathIds).toContain(issueB.rows[0].id);
    expect(pathIds).toContain(issueC.rows[0].id);
  });

  it('returns 404 for non-existent work item', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/work-items/00000000-0000-0000-0000-000000000000/dependency-graph',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns single-node critical path when no dependencies exist', async () => {
    const issue = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
       VALUES ('Standalone', 'issue', '2025-01-01', '2025-01-15')
       RETURNING id::text as id`,
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/work-items/${issue.rows[0].id}/dependency-graph`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toHaveLength(0);
    // Single node is still technically the "critical path" (just one item)
    expect(body.critical_path).toHaveLength(1);
    expect(body.critical_path[0].id).toBe(issue.rows[0].id);
  });

  it('identifies blockers (open items blocking other open items)', async () => {
    const project = await pool.query(
      `INSERT INTO work_item (title, work_item_kind)
       VALUES ('Project', 'project')
       RETURNING id::text as id`,
    );
    const projectId = project.rows[0].id;

    const init = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
       VALUES ('Init', 'initiative', $1)
       RETURNING id::text as id`,
      [projectId],
    );

    const epic = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
       VALUES ('Epic', 'epic', $1)
       RETURNING id::text as id`,
      [init.rows[0].id],
    );

    const blocker = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, status, estimate_minutes)
       VALUES ('Blocker (open)', 'issue', $1, 'open', 120)
       RETURNING id::text as id`,
      [epic.rows[0].id],
    );

    const blocked = await pool.query(
      `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, status, estimate_minutes)
       VALUES ('Blocked (open)', 'issue', $1, 'open', 60)
       RETURNING id::text as id`,
      [epic.rows[0].id],
    );

    await pool.query(
      `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
       VALUES ($1, $2, 'depends_on')`,
      [blocked.rows[0].id, blocker.rows[0].id],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/work-items/${projectId}/dependency-graph`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // The blocker node should be marked as is_blocker
    const blockerNode = body.nodes.find((n: { id: string }) => n.id === blocker.rows[0].id);
    expect(blockerNode).toBeDefined();
    expect(blockerNode.is_blocker).toBe(true);
  });
});
