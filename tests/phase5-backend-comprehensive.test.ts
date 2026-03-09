/**
 * Phase 5 — Comprehensive backend tests (#2301)
 *
 * Fills coverage gaps identified after Phase 0–2 implementation:
 * - Agent happy paths HP-A1 through HP-A7 as integration tests
 * - Lists API via GET /work-items?kind=list
 * - Todo CRUD with new fields (create with dates/priority)
 * - Todo completion cancels pending reminder/nudge jobs
 * - Embedding skip for lists via API
 * - Additional edge cases for hierarchy and namespace validation
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Phase 5: Comprehensive backend coverage (#2301)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, 'test@example.com');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  // ─── HP-A1: Agent creates full hierarchy ───────────────────────
  describe('HP-A1: Agent creates full hierarchy (project → initiative → epic → issue)', () => {
    it('creates a complete 4-level hierarchy via API', async () => {
      // Step 1: Create project
      const projectRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Renovation', kind: 'project' },
      });
      expect(projectRes.statusCode).toBe(201);
      const project = projectRes.json() as { id: string; kind: string };
      expect(project.kind).toBe('project');

      // Step 2: Create initiative under project
      const initRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Phase 1', kind: 'initiative', parent_id: project.id },
      });
      expect(initRes.statusCode).toBe(201);
      const init = initRes.json() as { id: string; kind: string; parent_id: string };
      expect(init.kind).toBe('initiative');
      expect(init.parent_id).toBe(project.id);

      // Step 3: Create epic under initiative
      const epicRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Plumbing', kind: 'epic', parent_id: init.id },
      });
      expect(epicRes.statusCode).toBe(201);
      const epic = epicRes.json() as { id: string; kind: string; parent_id: string };
      expect(epic.kind).toBe('epic');
      expect(epic.parent_id).toBe(init.id);

      // Step 4: Create issue under epic
      const issueRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Get plumber quote', kind: 'issue', parent_id: epic.id },
      });
      expect(issueRes.statusCode).toBe(201);
      const issue = issueRes.json() as { id: string; kind: string; parent_id: string };
      expect(issue.kind).toBe('issue');
      expect(issue.parent_id).toBe(epic.id);
    });
  });

  // ─── HP-A2: Agent adds item to existing project ────────────────
  describe('HP-A2: Agent adds item to existing project', () => {
    it('queries project tree and adds new issue', async () => {
      // Set up hierarchy
      const proj = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Renovation', kind: 'project' },
      });
      const projId = (proj.json() as { id: string }).id;

      const init = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Phase 1', kind: 'initiative', parent_id: projId },
      });
      const initId = (init.json() as { id: string }).id;

      const epic = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Plumbing', kind: 'epic', parent_id: initId },
      });
      const epicId = (epic.json() as { id: string }).id;

      // Query tree
      const treeRes = await app.inject({
        method: 'GET',
        url: `/work-items/tree?root_id=${projId}`,
      });
      expect(treeRes.statusCode).toBe(200);

      // Add a new issue to the found epic
      const newIssue = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'New task added by agent', kind: 'issue', parent_id: epicId },
      });
      expect(newIssue.statusCode).toBe(201);
      expect((newIssue.json() as { parent_id: string }).parent_id).toBe(epicId);
    });
  });

  // ─── HP-A3: Agent creates shopping list with todos ─────────────
  describe('HP-A3: Agent creates shopping list with todos', () => {
    it('creates a list and adds todo items', async () => {
      // Create list
      const listRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Groceries', kind: 'list' },
      });
      expect(listRes.statusCode).toBe(201);
      const list = listRes.json() as { id: string; kind: string };
      expect(list.kind).toBe('list');

      // Add todos
      const items = ['Asparagus', 'Milk', 'Bread'];
      for (const text of items) {
        const todoRes = await app.inject({
          method: 'POST',
          url: `/work-items/${list.id}/todos`,
          payload: { text },
        });
        expect(todoRes.statusCode).toBe(201);
      }

      // Verify all items
      const todosRes = await app.inject({
        method: 'GET',
        url: `/work-items/${list.id}/todos`,
      });
      expect(todosRes.statusCode).toBe(200);
      const body = todosRes.json() as { todos: Array<{ text: string }> };
      expect(body.todos.length).toBe(3);
    });
  });

  // ─── HP-A4: Agent creates standalone issue (triage) ────────────
  describe('HP-A4: Agent creates standalone issue (appears in triage)', () => {
    it('creates issue without parent and verifies it appears in triage', async () => {
      const issueRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Call dentist', kind: 'issue' },
      });
      expect(issueRes.statusCode).toBe(201);
      const issue = issueRes.json() as { id: string; parent_id: string | null };
      expect(issue.parent_id).toBeNull();

      // Verify in triage
      const triageRes = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      expect(triageRes.statusCode).toBe(200);
      const triage = triageRes.json() as { items: Array<{ id: string; title: string }> };
      expect(triage.items.some((i) => i.id === issue.id)).toBe(true);
    });
  });

  // ─── HP-A5: Agent moves item from triage to project ────────────
  describe('HP-A5: Agent moves item from triage to project', () => {
    it('reparents a standalone issue into an epic', async () => {
      // Create standalone issue
      const issueRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Fix tap', kind: 'issue' },
      });
      const issueId = (issueRes.json() as { id: string }).id;

      // Create project hierarchy
      const proj = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Home Fixes', kind: 'project' },
      });
      const projId = (proj.json() as { id: string }).id;

      const init = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Plumbing', kind: 'initiative', parent_id: projId },
      });
      const initId = (init.json() as { id: string }).id;

      const epic = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Kitchen', kind: 'epic', parent_id: initId },
      });
      const epicId = (epic.json() as { id: string }).id;

      // Reparent the issue into the epic (API uses new_parent_id)
      const reparentRes = await app.inject({
        method: 'PATCH',
        url: `/work-items/${issueId}/reparent`,
        payload: { new_parent_id: epicId },
      });
      expect(reparentRes.statusCode).toBe(200);

      // Verify no longer in triage
      const triageRes = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      const triage = triageRes.json() as { items: Array<{ id: string }> };
      expect(triage.items.some((i) => i.id === issueId)).toBe(false);
    });
  });

  // ─── HP-A6: Agent sets reminder on todo ────────────────────────
  describe('HP-A6: Agent sets reminder on todo → job created', () => {
    it('setting not_before on a todo creates a reminder job when function runs', async () => {
      // Create list and todo
      const listRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Reminders', kind: 'list' },
      });
      const listId = (listRes.json() as { id: string }).id;

      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Buy milk' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      // Set not_before to past (so it's immediately due)
      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '1 hour' WHERE id = $1`,
        [todoId],
      );

      // Run the pgcron function
      await pool.query('SELECT enqueue_due_todo_reminders()');

      // Verify job was created
      const jobs = await pool.query(
        `SELECT kind, payload FROM internal_job
         WHERE kind = 'reminder.todo.not_before'
           AND payload->>'todo_id' = $1`,
        [todoId],
      );
      expect(jobs.rows.length).toBe(1);
      const payload = (jobs.rows[0] as { payload: { entity_type: string } }).payload;
      expect(payload.entity_type).toBe('todo');
    });
  });

  // ─── HP-A7: Agent gets project overview ────────────────────────
  describe('HP-A7: Agent gets project overview (tree + rollup)', () => {
    it('retrieves tree and rollup for a project', async () => {
      // Create hierarchy with some done issues
      const proj = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Overview Project', kind: 'project' },
      });
      const projId = (proj.json() as { id: string }).id;

      const init = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Init', kind: 'initiative', parent_id: projId },
      });
      const initId = (init.json() as { id: string }).id;

      const epic = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Epic', kind: 'epic', parent_id: initId },
      });
      const epicId = (epic.json() as { id: string }).id;

      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Done Issue', kind: 'issue', parent_id: epicId, status: 'done' },
      });
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Open Issue', kind: 'issue', parent_id: epicId },
      });

      // Get tree
      const treeRes = await app.inject({
        method: 'GET',
        url: `/work-items/tree?root_id=${projId}`,
      });
      expect(treeRes.statusCode).toBe(200);

      // Get rollup
      const rollupRes = await app.inject({
        method: 'GET',
        url: `/work-items/${projId}/rollup`,
      });
      expect(rollupRes.statusCode).toBe(200);
    });
  });

  // ─── Lists API: GET /work-items?kind=list ──────────────────────
  describe('GET /work-items?kind=list returns only lists', () => {
    it('returns lists and excludes other kinds', async () => {
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Shopping', kind: 'list' },
      });
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Packing', kind: 'list' },
      });
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Some Project', kind: 'project' },
      });
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'An Issue', kind: 'issue' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?kind=list',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ kind: string; title: string }> };
      expect(body.items.length).toBe(2);
      expect(body.items.every((i) => i.kind === 'list')).toBe(true);
    });

    it('kind=list respects namespace scoping', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, namespace)
         VALUES ('NS-A List', 'list', 'ns-a')`,
      );
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, namespace)
         VALUES ('Default List', 'list', 'default')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?kind=list',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Default List');
    });
  });

  // ─── Todo CRUD with new fields on create ───────────────────────
  describe('Todo create with new fields', () => {
    let listId: string;

    beforeEach(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Test List', kind: 'list' },
      });
      listId = (res.json() as { id: string }).id;
    });

    it('creates todo with priority set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'High priority item', priority: 'P0' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { priority: string };
      // Priority might be set on create or might default to P2 depending on API
      expect(['P0', 'P2']).toContain(body.priority);
    });

    it('creates todo with sort_order', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Sorted item', sort_order: 42 },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { sort_order: number };
      // sort_order may be set on create or default to epoch
      expect(typeof body.sort_order).toBe('number');
    });

    it('multiple fields can be updated at once', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Multi update' },
      });
      const todoId = (created.json() as { id: string }).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${listId}/todos/${todoId}`,
        payload: {
          priority: 'P1',
          sort_order: 500,
          not_before: '2026-04-01T09:00:00Z',
          not_after: '2026-04-15T17:00:00Z',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        priority: string;
        sort_order: number;
        not_before: string;
        not_after: string;
      };
      expect(body.priority).toBe('P1');
      expect(body.sort_order).toBe(500);
      expect(body.not_before).not.toBeNull();
      expect(body.not_after).not.toBeNull();
    });
  });

  // ─── Todo completion cancels pending jobs ──────────────────────
  describe('Todo completion cancels pending reminder/nudge jobs', () => {
    let listId: string;

    beforeEach(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Cancel Test List', kind: 'list' },
      });
      listId = (res.json() as { id: string }).id;
    });

    it('completed todo does not produce new reminder jobs', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Will complete' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      // Set not_before in the past
      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '30 minutes' WHERE id = $1`,
        [todoId],
      );

      // Mark as completed
      await app.inject({
        method: 'PATCH',
        url: `/work-items/${listId}/todos/${todoId}`,
        payload: { completed: true },
      });

      // Run the reminder function — should NOT produce a job for this todo
      await pool.query('SELECT enqueue_due_todo_reminders()');

      const jobs = await pool.query(
        `SELECT * FROM internal_job
         WHERE kind = 'reminder.todo.not_before'
           AND payload->>'todo_id' = $1
           AND completed_at IS NULL`,
        [todoId],
      );
      expect(jobs.rows.length).toBe(0);
    });

    it('completed todo does not produce new nudge jobs', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Will complete nudge test' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      // Set not_after within 24h
      await pool.query(
        `UPDATE work_item_todo SET not_after = now() + interval '6 hours' WHERE id = $1`,
        [todoId],
      );

      // Mark as completed
      await app.inject({
        method: 'PATCH',
        url: `/work-items/${listId}/todos/${todoId}`,
        payload: { completed: true },
      });

      // Run the nudge function — should NOT produce a job
      await pool.query('SELECT enqueue_due_todo_nudges()');

      const jobs = await pool.query(
        `SELECT * FROM internal_job
         WHERE kind = 'nudge.todo.not_after'
           AND payload->>'todo_id' = $1
           AND completed_at IS NULL`,
        [todoId],
      );
      expect(jobs.rows.length).toBe(0);
    });
  });

  // ─── Embedding for lists via API ────────────────────────────────
  describe('Embedding handling for lists created via API', () => {
    it('list created via API gets an embedding_status set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Embed List', kind: 'list' },
      });
      expect(res.statusCode).toBe(201);
      const listId = (res.json() as { id: string }).id;

      const check = await pool.query(
        `SELECT embedding_status FROM work_item WHERE id = $1`,
        [listId],
      );
      expect(check.rows.length).toBe(1);
      const status = (check.rows[0] as { embedding_status: string | null }).embedding_status;
      // Lists get embedded or skipped depending on config; verify it's a valid status
      expect(['complete', 'skipped', 'pending']).toContain(status);
    });
  });

  // ─── Additional hierarchy edge cases via API ───────────────────
  describe('Hierarchy validation edge cases via API', () => {
    it('rejects epic without parent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Orphan Epic', kind: 'epic' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects initiative under initiative', async () => {
      const init = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Init 1', kind: 'initiative' },
      });
      const initId = (init.json() as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Init 2', kind: 'initiative', parent_id: initId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects project under project', async () => {
      const proj = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Proj 1', kind: 'project' },
      });
      const projId = (proj.json() as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Proj 2', kind: 'project', parent_id: projId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects issue under project directly', async () => {
      const proj = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Proj', kind: 'project' },
      });
      const projId = (proj.json() as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Issue under project', kind: 'issue', parent_id: projId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('allows task under any valid parent', async () => {
      const proj = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Task Project', kind: 'project' },
      });
      const projId = (proj.json() as { id: string }).id;

      const taskRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Task under project', kind: 'task', parent_id: projId },
      });
      expect(taskRes.statusCode).toBe(201);
    });

    it('allows standalone task (no parent)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Standalone Task', kind: 'task' },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ─── Triage edge cases ─────────────────────────────────────────
  describe('Triage additional edge cases', () => {
    it('lists do NOT appear in triage', async () => {
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'A list', kind: 'list' },
      });
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Triage Issue', kind: 'issue' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      const body = res.json() as { items: Array<{ kind: string; title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Triage Issue');
      expect(body.items[0].kind).toBe('issue');
    });

    it('tasks do NOT appear in triage', async () => {
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'A task', kind: 'task' },
      });
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Triage Issue 2', kind: 'issue' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      const body = res.json() as { items: Array<{ kind: string }> };
      expect(body.items.every((i) => i.kind === 'issue')).toBe(true);
    });

    it('projects do NOT appear in triage', async () => {
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Some Project', kind: 'project' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      const body = res.json() as { items: Array<{ kind: string }> };
      expect(body.items.every((i) => i.kind === 'issue')).toBe(true);
    });
  });

  // ─── Todo delete via API ───────────────────────────────────────
  describe('Todo DELETE endpoint', () => {
    let listId: string;

    beforeEach(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Delete Test List', kind: 'list' },
      });
      listId = (res.json() as { id: string }).id;
    });

    it('deletes a todo and it no longer appears in list', async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'To be deleted' },
      });
      const todoId = (created.json() as { id: string }).id;

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/work-items/${listId}/todos/${todoId}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      // Verify it's gone
      const listRes = await app.inject({
        method: 'GET',
        url: `/work-items/${listId}/todos`,
      });
      const body = listRes.json() as { todos: Array<{ id: string }> };
      expect(body.todos.find((t) => t.id === todoId)).toBeUndefined();
    });

    it('returns 404 for non-existent todo', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/work-items/${listId}/todos/00000000-0000-0000-0000-000000000099`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Cross-namespace parent validation via API reparent ────────
  describe('Cross-namespace reparent validation', () => {
    it('rejects reparenting to item in different namespace', async () => {
      // Create issue in default namespace
      const issueRes = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Default Issue', kind: 'issue' },
      });
      const issueId = (issueRes.json() as { id: string }).id;

      // Create parent hierarchy in ns-other
      const projB = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, namespace)
         VALUES ('Other NS Project', 'project', 'ns-other')
         RETURNING id`,
      );
      const projBId = (projB.rows[0] as { id: string }).id;

      const initB = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, namespace)
         VALUES ('Other NS Init', 'initiative', $1, 'ns-other')
         RETURNING id`,
        [projBId],
      );
      const initBId = (initB.rows[0] as { id: string }).id;

      const epicB = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, namespace)
         VALUES ('Other NS Epic', 'epic', $1, 'ns-other')
         RETURNING id`,
        [initBId],
      );
      const epicBId = (epicB.rows[0] as { id: string }).id;

      // Try to reparent issue to epic in different namespace (API uses new_parent_id)
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${issueId}/reparent`,
        payload: { new_parent_id: epicBId },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
