/**
 * Integration tests for namespace move endpoints (Issue #1483).
 *
 * PATCH /api/<entity>/:id/namespace — Move an entity to a different namespace.
 *
 * Note: Auth is disabled in integration tests (setup-api.ts sets
 * OPENCLAW_PROJECTS_AUTH_DISABLED=true), so namespace grant-based access
 * control is NOT enforced. These tests verify the move mechanics, child
 * propagation, activity logging, and audit logging.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { getAuthHeaders } from './helpers/auth.ts';
import { signM2MToken } from '../src/api/auth/jwt.ts';

const TEST_EMAIL = 'ns-move-test@example.com';
const SOURCE_NS = 'ns-move-source';
const TARGET_NS = 'ns-move-target';

async function getM2MHeaders(): Promise<Record<string, string>> {
  const token = await signM2MToken('test-service', ['api:full']);
  return { authorization: `Bearer ${token}` };
}

describe('Namespace Move API (Issue #1483)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, TEST_EMAIL, SOURCE_NS);
    await pool.query(
      `INSERT INTO namespace_grant (email, namespace, role, is_default)
       VALUES ($1, $2, 'member', false)
       ON CONFLICT (email, namespace) DO NOTHING`,
      [TEST_EMAIL, TARGET_NS],
    );
  });

  // ============================================================
  // Work Item
  // ============================================================
  describe('PATCH /api/work-items/:id/namespace', () => {
    it('moves a work item to the target namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Test Task', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.namespace).toBe(TARGET_NS);

      // Verify in DB
      const check = await pool.query('SELECT namespace FROM work_item WHERE id = $1', [id]);
      expect(check.rows[0].namespace).toBe(TARGET_NS);
    });

    it('moves child work items recursively', async () => {
      // Create parent task
      const { rows: parentRows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Parent Task', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const parentId = parentRows[0].id;

      // Create child task under parent
      const { rows: childRows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status, parent_work_item_id)
         VALUES ('Child Task', 'task', 'task', $1, 'open', $2) RETURNING id::text as id`,
        [SOURCE_NS, parentId],
      );
      const childId = childRows[0].id;

      // Create grandchild task under child
      const { rows: grandchildRows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status, parent_work_item_id)
         VALUES ('Grandchild Task', 'task', 'task', $1, 'open', $2) RETURNING id::text as id`,
        [SOURCE_NS, childId],
      );
      const grandchildId = grandchildRows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${parentId}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);

      // Verify all descendants moved
      const children = await pool.query(
        'SELECT id::text as id, namespace FROM work_item WHERE id = ANY($1::uuid[])',
        [[parentId, childId, grandchildId]],
      );
      for (const row of children.rows) {
        expect(row.namespace).toBe(TARGET_NS);
      }
    });

    it('records work_item_activity for the move', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Activity Test', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      const activities = await pool.query(
        `SELECT activity_type, description FROM work_item_activity WHERE work_item_id = $1`,
        [id],
      );
      expect(activities.rows.length).toBeGreaterThanOrEqual(1);
      const moveActivity = activities.rows.find(
        (r: { activity_type: string }) => r.activity_type === 'namespace_move',
      );
      expect(moveActivity).toBeDefined();
      expect(moveActivity.description).toContain(SOURCE_NS);
      expect(moveActivity.description).toContain(TARGET_NS);
    });
  });

  // ============================================================
  // Contact
  // ============================================================
  describe('PATCH /api/contacts/:id/namespace', () => {
    it('moves a contact to the target namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Test Contact', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });
  });

  // ============================================================
  // Notebook + Notes
  // ============================================================
  describe('PATCH /api/notebooks/:id/namespace', () => {
    it('moves a notebook and its notes', async () => {
      const { rows: nbRows } = await pool.query(
        `INSERT INTO notebook (name, namespace) VALUES ('Test NB', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const nbId = nbRows[0].id;

      const { rows: noteRows } = await pool.query(
        `INSERT INTO note (title, content, namespace, notebook_id) VALUES ('Note 1', 'body', $1, $2) RETURNING id::text as id`,
        [SOURCE_NS, nbId],
      );
      const noteId = noteRows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/notebooks/${nbId}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);

      // Verify note also moved
      const noteCheck = await pool.query('SELECT namespace FROM note WHERE id = $1', [noteId]);
      expect(noteCheck.rows[0].namespace).toBe(TARGET_NS);
    });
  });

  // ============================================================
  // Memory
  // ============================================================
  describe('PATCH /api/memories/:id/namespace', () => {
    it('moves a memory to the target namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO memory (title, content, memory_type, namespace)
         VALUES ('Test Memory', 'Test memory content', 'fact', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });
  });

  // ============================================================
  // Validation
  // ============================================================
  describe('Validation', () => {
    it('returns 400 when target_namespace is missing', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Bad Request', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('target_namespace');
    });

    it('returns 400 for invalid namespace format', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Bad NS', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: '-invalid-ns!' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('format');
    });

    it('returns 400 for invalid UUID', async () => {
      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/work-items/not-a-uuid/namespace',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when entity does not exist', async () => {
      const fakeId = randomUUID();
      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${fakeId}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns the entity unchanged when already in target namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Same NS', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: SOURCE_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(SOURCE_NS);
    });
  });

  // ============================================================
  // M2M Token Access
  // ============================================================
  describe('M2M token access', () => {
    it('allows M2M token to move entities', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('M2M Move', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });
  });

  // ============================================================
  // Audit Log
  // ============================================================
  describe('Audit logging', () => {
    it('creates an audit_log entry on move', async () => {
      const { rows } = await pool.query(
        `INSERT INTO contact (display_name, namespace) VALUES ('Audit Contact', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      const audit = await pool.query(
        `SELECT action::text, entity_type, entity_id::text as entity_id, metadata
         FROM audit_log WHERE entity_id = $1::uuid AND action = 'namespace_move'`,
        [id],
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].entity_type).toBe('contact');
      const meta = audit.rows[0].metadata;
      expect(meta.from).toBe(SOURCE_NS);
      expect(meta.to).toBe(TARGET_NS);
    });
  });

  // ============================================================
  // Additional Entity Types (smoke tests)
  // ============================================================
  describe('Additional entity types', () => {
    it('moves a recipe', async () => {
      const { rows } = await pool.query(
        `INSERT INTO recipe (title, namespace) VALUES ('Test Recipe', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/recipes/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });

    it('moves a pantry item', async () => {
      const { rows } = await pool.query(
        `INSERT INTO pantry_item (name, location, namespace) VALUES ('Test Pantry', 'fridge', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/pantry/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });

    it('moves a skill store item', async () => {
      const { rows } = await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title, namespace)
         VALUES ('test-skill', '_default', 'Test Skill', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });

    it('moves a note independently', async () => {
      const { rows } = await pool.query(
        `INSERT INTO note (title, content, namespace) VALUES ('Solo Note', 'Content', $1) RETURNING id::text as id`,
        [SOURCE_NS],
      );
      const id = rows[0].id;

      const headers = await getAuthHeaders(TEST_EMAIL);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/notes/${id}/namespace`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { target_namespace: TARGET_NS },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().namespace).toBe(TARGET_NS);
    });
  });
});
