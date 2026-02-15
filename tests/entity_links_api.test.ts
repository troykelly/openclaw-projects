/**
 * Tests for entity links API (Issue #1276).
 * Verifies schema, CRUD, validation, idempotency, and user_email scoping.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Entity Links API (Issue #1276)', () => {
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

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('entity_link table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_name = 'entity_link'
         ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => (r as { column_name: string }).column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('source_type');
      expect(cols).toContain('source_id');
      expect(cols).toContain('target_type');
      expect(cols).toContain('target_id');
      expect(cols).toContain('link_type');
      expect(cols).toContain('created_by');
      expect(cols).toContain('user_email');
      expect(cols).toContain('created_at');
    });

    it('has unique constraint on (source_type, source_id, target_type, target_id, link_type)', async () => {
      const result = await pool.query(
        `SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_name = 'entity_link' AND constraint_type = 'UNIQUE'`,
      );
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
      const names = result.rows.map((r) => (r as { constraint_name: string }).constraint_name);
      expect(names).toContain('uq_entity_link');
    });
  });

  // ── POST /api/entity-links ──────────────────────────────

  describe('POST /api/entity-links', () => {
    const validPayload = {
      source_type: 'message',
      source_id: '00000000-0000-0000-0000-000000000001',
      target_type: 'project',
      target_id: '00000000-0000-0000-0000-000000000002',
    };

    it('creates a link and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.source_type).toBe('message');
      expect(body.source_id).toBe(validPayload.source_id);
      expect(body.target_type).toBe('project');
      expect(body.target_id).toBe(validPayload.target_id);
      expect(body.link_type).toBe('related');
      expect(body.created_at).toBeDefined();
    });

    it('defaults link_type to related', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().link_type).toBe('related');
    });

    it('accepts explicit link_type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, link_type: 'caused_by' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().link_type).toBe('caused_by');
    });

    it('accepts created_by field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, created_by: 'agent' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().created_by).toBe('agent');
    });

    it('is idempotent (upsert on duplicate)', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, created_by: 'auto' },
      });
      expect(res1.statusCode).toBe(201);
      const id1 = res1.json().id;

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, created_by: 'agent' },
      });
      expect(res2.statusCode).toBe(201);
      expect(res2.json().id).toBe(id1);
      expect(res2.json().created_by).toBe('agent');
    });

    it('allows different link_types between same source and target', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, link_type: 'related' },
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, link_type: 'caused_by' },
      });
      expect(res2.statusCode).toBe(201);
      expect(res2.json().id).not.toBe(res1.json().id);
    });

    it('returns 400 for missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { source_type: 'message' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it('returns 400 for invalid source_type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, source_type: 'invalid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('source_type');
    });

    it('returns 400 for invalid target_type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, target_type: 'invalid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('target_type');
    });

    it('returns 400 for invalid link_type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, link_type: 'bad_type' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('link_type');
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: { ...validPayload, source_id: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('UUID');
    });
  });

  // ── GET /api/entity-links ──────────────────────────────

  describe('GET /api/entity-links', () => {
    const sourceId = '00000000-0000-0000-0000-000000000001';
    const targetId = '00000000-0000-0000-0000-000000000002';

    beforeEach(async () => {
      await truncateAllTables(pool);
      // Create two links
      await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: {
          source_type: 'message',
          source_id: sourceId,
          target_type: 'project',
          target_id: targetId,
          link_type: 'related',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: {
          source_type: 'message',
          source_id: sourceId,
          target_type: 'contact',
          target_id: '00000000-0000-0000-0000-000000000003',
          link_type: 'about',
        },
      });
    });

    it('returns links by source', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/entity-links?source_type=message&source_id=${sourceId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.links).toHaveLength(2);
    });

    it('returns links by target', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/entity-links?target_type=project&target_id=${targetId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.links).toHaveLength(1);
      expect(body.links[0].target_id).toBe(targetId);
    });

    it('filters by link_type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/entity-links?source_type=message&source_id=${sourceId}&link_type=about`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().links).toHaveLength(1);
      expect(res.json().links[0].link_type).toBe('about');
    });

    it('returns empty array when no links exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links?source_type=thread&source_id=00000000-0000-0000-0000-000000000099',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().links).toHaveLength(0);
    });

    it('returns 400 when neither source nor target provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when only source_type without source_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links?source_type=message',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/entity-links/:id ──────────────────────────

  describe('GET /api/entity-links/:id', () => {
    it('returns a single link by id', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: {
          source_type: 'todo',
          source_id: '00000000-0000-0000-0000-000000000010',
          target_type: 'contact',
          target_id: '00000000-0000-0000-0000-000000000020',
        },
      });
      const linkId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/entity-links/${linkId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(linkId);
      expect(res.json().source_type).toBe('todo');
    });

    it('returns 404 for non-existent link', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links/00000000-0000-0000-0000-999999999999',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid id format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /api/entity-links/:id ───────────────────────

  describe('DELETE /api/entity-links/:id', () => {
    it('removes a link and returns 204', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: {
          source_type: 'thread',
          source_id: '00000000-0000-0000-0000-000000000030',
          target_type: 'todo',
          target_id: '00000000-0000-0000-0000-000000000040',
        },
      });
      const linkId = createRes.json().id;

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/entity-links/${linkId}`,
      });
      expect(delRes.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/entity-links/${linkId}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for non-existent link', async () => {
      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/entity-links/00000000-0000-0000-0000-999999999999',
      });
      expect(delRes.statusCode).toBe(404);
    });
  });

  // ── user_email scoping ─────────────────────────────────

  describe('user_email scoping', () => {
    it('link created with user_email is visible when queried with same email', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/entity-links?user_email=alice@example.com',
        payload: {
          source_type: 'message',
          source_id: '00000000-0000-0000-0000-000000000050',
          target_type: 'project',
          target_id: '00000000-0000-0000-0000-000000000060',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links?source_type=message&source_id=00000000-0000-0000-0000-000000000050&user_email=alice@example.com',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().links).toHaveLength(1);
    });

    it('link created without user_email is visible to all users', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/entity-links',
        payload: {
          source_type: 'message',
          source_id: '00000000-0000-0000-0000-000000000050',
          target_type: 'project',
          target_id: '00000000-0000-0000-0000-000000000060',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-links?source_type=message&source_id=00000000-0000-0000-0000-000000000050&user_email=bob@example.com',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().links).toHaveLength(1);
    });
  });
});
