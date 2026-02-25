/**
 * Integration tests for Issue #1796: by-ID operations should work across
 * namespaces without requiring an explicit X-Namespace header.
 *
 * UUIDs are globally unique, so by-ID lookups (GET/PATCH/DELETE) should
 * succeed regardless of which namespace the entity lives in — as long as
 * the caller has access to that namespace.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { signM2MToken } from '../src/api/auth/jwt.ts';

const CUSTOM_NS = 'ns-byid-test';

async function getM2MHeaders(): Promise<Record<string, string>> {
  const token = await signM2MToken('test-service', ['api:full']);
  return { authorization: `Bearer ${token}` };
}

describe('By-ID operations across namespaces (Issue #1796)', () => {
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
  });

  describe('work items', () => {
    it('GET /api/work-items/:id returns item in non-default namespace without X-Namespace', async () => {
      // Create a work item in a non-default namespace
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Test Task', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [CUSTOM_NS],
      );
      const id = rows[0].id;

      // Request without X-Namespace header — should still find the item
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(id);
      expect(body.namespace).toBe(CUSTOM_NS);
    });

    it('PATCH /api/work-items/:id/status works without X-Namespace for non-default namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Status Test', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [CUSTOM_NS],
      );
      const id = rows[0].id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/status`,
        headers: { 'content-type': 'application/json' },
        payload: { status: 'in_progress' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('in_progress');
    });
  });

  describe('contacts', () => {
    it('GET /api/contacts/:id returns contact in non-default namespace without X-Namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO contact (display_name, namespace)
         VALUES ('Test Contact', $1) RETURNING id::text as id`,
        [CUSTOM_NS],
      );
      const id = rows[0].id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(id);
      expect(body.namespace).toBe(CUSTOM_NS);
    });
  });

  describe('M2M tokens', () => {
    it('GET /api/work-items/:id with M2M token finds item in non-default namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('M2M Test', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [CUSTOM_NS],
      );
      const id = rows[0].id;

      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(id);
      expect(body.namespace).toBe(CUSTOM_NS);
    });

    it('GET /api/contacts/:id with M2M token finds contact in non-default namespace', async () => {
      const { rows } = await pool.query(
        `INSERT INTO contact (display_name, namespace)
         VALUES ('M2M Contact', $1) RETURNING id::text as id`,
        [CUSTOM_NS],
      );
      const id = rows[0].id;

      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(id);
      expect(body.namespace).toBe(CUSTOM_NS);
    });

    it('still respects explicit X-Namespace when provided', async () => {
      // Item in custom namespace
      const { rows } = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind, namespace, status)
         VALUES ('Scoped Test', 'task', 'task', $1, 'open') RETURNING id::text as id`,
        [CUSTOM_NS],
      );
      const id = rows[0].id;

      // Request with wrong namespace — should 404
      const headers = await getM2MHeaders();
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id}`,
        headers: { ...headers, 'x-namespace': 'wrong-namespace' },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
