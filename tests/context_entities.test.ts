/**
 * Tests for generic context entities with many-to-many entity linking (Issue #1275).
 * TDD RED phase — these tests define the desired API behaviour.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Context entities API (Issue #1275)', () => {
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

  // ── POST /api/contexts ─────────────────────────────────

  describe('POST /api/contexts', () => {
    it('creates a context with label and content', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: {
          label: 'CareSwap project info',
          content: 'CareSwap is a healthcare consent management platform.',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.label).toBe('CareSwap project info');
      expect(body.content).toBe('CareSwap is a healthcare consent management platform.');
      expect(body.content_type).toBe('text');
      expect(body.is_active).toBe(true);
      expect(body.created_at).toBeDefined();
    });

    it('creates a context with optional content_type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: {
          label: 'Deployment runbook',
          content: '# Steps\n1. Pull latest\n2. Deploy',
          content_type: 'markdown',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().content_type).toBe('markdown');
    });

    it('rejects missing label', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { content: 'Some content' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('label');
    });

    it('rejects missing content', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'A label' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('content');
    });

    it('rejects empty label', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: '   ', content: 'Some content' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/contexts ──────────────────────────────────

  describe('GET /api/contexts', () => {
    it('lists contexts with pagination', async () => {
      // Create two contexts
      await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'First', content: 'Content 1' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Second', content: 'Content 2' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contexts?limit=10&offset=0',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);
    });

    it('filters by search term in label', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'CareSwap context', content: 'Healthcare' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Deploy runbook', content: 'Deployment' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contexts?search=CareSwap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.items[0].label).toBe('CareSwap context');
    });

    it('only returns active contexts by default', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Active', content: 'Active content' },
      });
      const activeId = createRes.json().id;

      const createRes2 = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Deactivated', content: 'Deactivated content' },
      });
      const inactiveId = createRes2.json().id;

      // Deactivate one
      await app.inject({
        method: 'PATCH',
        url: `/api/contexts/${inactiveId}`,
        payload: { is_active: false },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contexts',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.items[0].id).toBe(activeId);
    });
  });

  // ── GET /api/contexts/:id ──────────────────────────────

  describe('GET /api/contexts/:id', () => {
    it('returns a single context by id', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'My context', content: 'Context body' },
      });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/contexts/${id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().label).toBe('My context');
    });

    it('returns 404 for non-existent context', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/contexts/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/contexts/:id ────────────────────────────

  describe('PATCH /api/contexts/:id', () => {
    it('updates label and content', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Original', content: 'Original content' },
      });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contexts/${id}`,
        payload: { label: 'Updated', content: 'Updated content' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().label).toBe('Updated');
      expect(res.json().content).toBe('Updated content');
    });

    it('can deactivate a context', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Active', content: 'Content' },
      });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contexts/${id}`,
        payload: { is_active: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().is_active).toBe(false);
    });

    it('returns 404 for non-existent context', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/contexts/00000000-0000-0000-0000-000000000000',
        payload: { label: 'Updated' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/contexts/:id ───────────────────────────

  describe('DELETE /api/contexts/:id', () => {
    it('deletes a context', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'To delete', content: 'Will be removed' },
      });
      const id = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/contexts/${id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/contexts/${id}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for non-existent context', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/contexts/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── Context Links ──────────────────────────────────────

  describe('POST /api/contexts/:id/links', () => {
    it('creates a link between context and target entity', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Project info', content: 'Project details' },
      });
      const contextId = ctxRes.json().id;

      // Create a work item to link to
      const wiRes = await pool.query(
        `INSERT INTO work_item (title, status) VALUES ('Test project', 'open') RETURNING id::text as id`,
      );
      const work_item_id = (wiRes.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: {
          target_type: 'project',
          target_id: work_item_id,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.context_id).toBe(contextId);
      expect(body.target_type).toBe('project');
      expect(body.target_id).toBe(work_item_id);
    });

    it('creates a link with optional priority', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'High-priority context', content: 'Important info' },
      });
      const contextId = ctxRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: {
          target_type: 'contact',
          target_id: '00000000-0000-0000-0000-000000000001',
          priority: 10,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().priority).toBe(10);
    });

    it('rejects duplicate link (same context + target_type + target_id)', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Context', content: 'Content' },
      });
      const contextId = ctxRes.json().id;
      const targetId = '00000000-0000-0000-0000-000000000001';

      await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: { target_type: 'project', target_id: targetId },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: { target_type: 'project', target_id: targetId },
      });

      expect(res.statusCode).toBe(409);
    });

    it('rejects missing target_type', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Context', content: 'Content' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/contexts/${ctxRes.json().id}/links`,
        payload: { target_id: '00000000-0000-0000-0000-000000000001' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent context', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contexts/00000000-0000-0000-0000-000000000000/links',
        payload: { target_type: 'project', target_id: '00000000-0000-0000-0000-000000000001' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/contexts/:id/links', () => {
    it('lists links for a context', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Multi-linked', content: 'Linked to many things' },
      });
      const contextId = ctxRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: { target_type: 'project', target_id: '00000000-0000-0000-0000-000000000001' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: { target_type: 'contact', target_id: '00000000-0000-0000-0000-000000000002' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contexts/${contextId}/links`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.links).toHaveLength(2);
    });
  });

  describe('DELETE /api/contexts/:id/links/:link_id', () => {
    it('removes a link', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Linked context', content: 'Has a link' },
      });
      const contextId = ctxRes.json().id;

      const linkRes = await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: { target_type: 'project', target_id: '00000000-0000-0000-0000-000000000001' },
      });
      const link_id = linkRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/contexts/${contextId}/links/${link_id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/contexts/${contextId}/links`,
      });
      expect(listRes.json().links).toHaveLength(0);
    });
  });

  // ── GET /api/entity-contexts — reverse lookup ──────────

  describe('GET /api/entity-contexts', () => {
    it('returns all contexts linked to a target entity', async () => {
      const targetId = '00000000-0000-0000-0000-000000000099';

      // Create two contexts and link both to same target
      const ctx1Res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Context A', content: 'Info A' },
      });
      const ctx2Res = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Context B', content: 'Info B' },
      });

      await app.inject({
        method: 'POST',
        url: `/api/contexts/${ctx1Res.json().id}/links`,
        payload: { target_type: 'project', target_id: targetId, priority: 1 },
      });
      await app.inject({
        method: 'POST',
        url: `/api/contexts/${ctx2Res.json().id}/links`,
        payload: { target_type: 'project', target_id: targetId, priority: 5 },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/entity-contexts?target_type=project&target_id=${targetId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contexts).toHaveLength(2);
      // Should be ordered by priority descending (highest first)
      expect(body.contexts[0].label).toBe('Context B');
      expect(body.contexts[1].label).toBe('Context A');
    });

    it('requires target_type and target_id params', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-contexts?target_type=project',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns empty array when no contexts linked', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/entity-contexts?target_type=project&target_id=00000000-0000-0000-0000-000000000099',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().contexts).toHaveLength(0);
    });
  });

  // ── Cascade delete ─────────────────────────────────────

  describe('Cascade delete', () => {
    it('deleting a context also removes its links', async () => {
      const ctxRes = await app.inject({
        method: 'POST',
        url: '/api/contexts',
        payload: { label: 'Will be deleted', content: 'And its links too' },
      });
      const contextId = ctxRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/contexts/${contextId}/links`,
        payload: { target_type: 'project', target_id: '00000000-0000-0000-0000-000000000001' },
      });

      // Delete the context
      await app.inject({
        method: 'DELETE',
        url: `/api/contexts/${contextId}`,
      });

      // Verify links are gone
      const linkCount = await pool.query(
        `SELECT COUNT(*) as count FROM context_link WHERE context_id = $1`,
        [contextId],
      );
      expect(parseInt((linkCount.rows[0] as { count: string }).count, 10)).toBe(0);
    });
  });
});
