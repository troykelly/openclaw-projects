/**
 * Integration tests for dev session tracking (Issue #1285).
 *
 * Tests CRUD for dev sessions, status transitions, webhook callbacks,
 * and filtering/search.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'dev-session-test@example.com';

describe('Dev Sessions API (Issue #1285)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;
  let project_id: string;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    // Clean up
    await pool.query(`DELETE FROM dev_session WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM work_item WHERE namespace = 'default'`);

    // Create a test project
    const projectResult = await pool.query(
      `INSERT INTO work_item (title, kind, namespace)
       VALUES ('Dev Session Test Project', 'project', 'default')
       RETURNING id::text as id`,
    );
    project_id = projectResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM dev_session WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM work_item WHERE namespace = 'default'`);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('dev_session table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'dev_session'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('project_id');
      expect(columns).toContain('session_name');
      expect(columns).toContain('node');
      expect(columns).toContain('status');
      expect(columns).toContain('task_summary');
      expect(columns).toContain('task_prompt');
      expect(columns).toContain('linked_issues');
      expect(columns).toContain('linked_prs');
      expect(columns).toContain('context_pct');
      expect(columns).toContain('webhook_id');
      expect(columns).toContain('completion_summary');
    });
  });

  // ─── POST /api/dev-sessions ────────────────────────────────────────────

  describe('POST /api/dev-sessions', () => {
    it('creates a dev session and returns it', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'dev-test-001',
          node: 'MST001-service',
          task_summary: 'Fix test parallelism',
          project_id: project_id,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.session_name).toBe('dev-test-001');
      expect(body.node).toBe('MST001-service');
      expect(body.status).toBe('active');
      expect(body.task_summary).toBe('Fix test parallelism');
      expect(body.project_id).toBe(project_id);
    });

    it('creates a session with optional fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'dev-test-002',
          node: 'MBP018-service',
          task_summary: 'Add feature X',
          task_prompt: 'Implement feature X with TDD',
          container: 'openclaw-devcontainer-1',
          container_user: 'vscode',
          repo_org: 'troykelly',
          repo_name: 'openclaw-projects',
          branch: 'issue/1285-dev-sessions',
          linked_issues: ['1285', '1286'],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.container).toBe('openclaw-devcontainer-1');
      expect(body.repo_org).toBe('troykelly');
      expect(body.linked_issues).toEqual(['1285', '1286']);
    });

    it('returns 400 when session_name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { node: 'MST001' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when node is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { session_name: 'test' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── GET /api/dev-sessions ─────────────────────────────────────────────

  describe('GET /api/dev-sessions', () => {
    it('lists dev sessions', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/dev-sessions',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessions).toBeDefined();
      expect(body.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/dev-sessions?status=active',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const session of body.sessions) {
        expect(session.status).toBe('active');
      }
    });

    it('filters by node', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/dev-sessions?node=MST001-service',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const session of body.sessions) {
        expect(session.node).toBe('MST001-service');
      }
    });

    it('filters by project_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/dev-sessions?project_id=${project_id}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      for (const session of body.sessions) {
        expect(session.project_id).toBe(project_id);
      }
    });
  });

  // ─── GET /api/dev-sessions/:id ─────────────────────────────────────────

  describe('GET /api/dev-sessions/:id', () => {
    it('returns a specific session by id', async () => {
      // Create one first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'get-test-001',
          node: 'MST001-service',
          task_summary: 'Get test',
        },
      });
      const sessionId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/dev-sessions/${sessionId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(sessionId);
      expect(body.session_name).toBe('get-test-001');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/dev-sessions/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── PATCH /api/dev-sessions/:id ───────────────────────────────────────

  describe('PATCH /api/dev-sessions/:id', () => {
    it('updates session fields', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'patch-test-001',
          node: 'MST001-service',
          task_summary: 'Patch test',
        },
      });
      const sessionId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/dev-sessions/${sessionId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          status: 'stalled',
          context_pct: 5,
          branch: 'fix/stalled-branch',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('stalled');
      expect(body.context_pct).toBe(5);
      expect(body.branch).toBe('fix/stalled-branch');
    });

    it('updates linked_prs and linked_issues', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'patch-test-002',
          node: 'MST001-service',
          task_summary: 'PR link test',
        },
      });
      const sessionId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/dev-sessions/${sessionId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          linked_prs: ['1290', '1291'],
          linked_issues: ['1285'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.linked_prs).toEqual(['1290', '1291']);
      expect(body.linked_issues).toEqual(['1285']);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/dev-sessions/00000000-0000-0000-0000-000000000099',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { status: 'completed' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/dev-sessions/:id/complete ───────────────────────────────

  describe('POST /api/dev-sessions/:id/complete', () => {
    it('marks a session as completed', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'complete-test-001',
          node: 'MST001-service',
          task_summary: 'Complete test',
        },
      });
      const sessionId = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/dev-sessions/${sessionId}/complete`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { completion_summary: 'Split tests into parallel projects' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('completed');
      expect(body.completion_summary).toBe('Split tests into parallel projects');
      expect(body.completed_at).toBeDefined();
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions/00000000-0000-0000-0000-000000000099/complete',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── DELETE /api/dev-sessions/:id ──────────────────────────────────────

  describe('DELETE /api/dev-sessions/:id', () => {
    it('deletes a session and returns 204', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/dev-sessions',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          session_name: 'delete-test-001',
          node: 'MST001-service',
          task_summary: 'Delete test',
        },
      });
      const sessionId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/dev-sessions/${sessionId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(204);

      // Verify deleted
      const check = await pool.query(`SELECT id FROM dev_session WHERE id = $1`, [sessionId]);
      expect(check.rows.length).toBe(0);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/dev-sessions/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
