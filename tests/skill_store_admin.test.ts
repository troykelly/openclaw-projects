import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Skill Store Admin API endpoints (Issue #804).
 *
 * Covers:
 * - GET /api/admin/skill-store/stats
 * - GET /api/admin/skill-store/skills
 * - GET /api/admin/skill-store/skills/:skill_id
 * - GET /api/admin/skill-store/embeddings/status (already exists from #799, verify integration)
 * - DELETE /api/admin/skill-store/skills/:skill_id (hard purge)
 */
describe('Skill Store Admin API (Issue #804)', () => {
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

  /** Helper to insert items directly into the database */
  async function insertItem(overrides: Record<string, unknown> = {}) {
    const defaults = {
      skill_id: 'test-skill',
      collection: '_default',
      title: 'Test Item',
      status: 'active',
      data: '{}',
      tags: '{}',
    };
    const merged = { ...defaults, ...overrides };
    const result = await pool.query(
      `INSERT INTO skill_store_item (skill_id, collection, title, status, data, tags, embedding_status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7)
       RETURNING id, skill_id, collection, status`,
      [
        merged.skill_id,
        merged.collection,
        merged.title,
        merged.status,
        merged.data,
        merged.tags,
        merged.embedding_status ?? 'pending',
      ]
    );
    return result.rows[0];
  }

  /** Helper to insert a schedule directly */
  async function insertSchedule(overrides: Record<string, unknown> = {}) {
    const defaults = {
      skill_id: 'test-skill',
      cron_expression: '0 * * * *',
      webhook_url: 'https://example.com/hook',
      enabled: true,
    };
    const merged = { ...defaults, ...overrides };
    const result = await pool.query(
      `INSERT INTO skill_store_schedule (skill_id, collection, cron_expression, webhook_url, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        merged.skill_id,
        merged.collection ?? null,
        merged.cron_expression,
        merged.webhook_url,
        merged.enabled,
      ]
    );
    return result.rows[0];
  }

  // ── GET /api/admin/skill-store/stats ──────────────────────────────────

  describe('GET /api/admin/skill-store/stats', () => {
    it('returns global stats with empty database', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/stats',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('total_items');
      expect(body).toHaveProperty('by_status');
      expect(body).toHaveProperty('by_skill');
      expect(body).toHaveProperty('storage_estimate');
      expect(body.total_items).toBe(0);
    });

    it('returns correct counts by status', async () => {
      await insertItem({ skill_id: 'a', status: 'active' });
      await insertItem({ skill_id: 'a', status: 'active' });
      await insertItem({ skill_id: 'a', status: 'archived' });
      await insertItem({ skill_id: 'b', status: 'processing' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/stats',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total_items).toBe(4);
      expect(body.by_status.active).toBe(2);
      expect(body.by_status.archived).toBe(1);
      expect(body.by_status.processing).toBe(1);
    });

    it('returns counts by skill', async () => {
      await insertItem({ skill_id: 'skill-a' });
      await insertItem({ skill_id: 'skill-a' });
      await insertItem({ skill_id: 'skill-b' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/stats',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.by_skill).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skill_id: 'skill-a', count: 2 }),
          expect.objectContaining({ skill_id: 'skill-b', count: 1 }),
        ])
      );
    });

    it('excludes soft-deleted items from total', async () => {
      await insertItem({ skill_id: 'a', status: 'active' });
      // Insert and soft-delete
      const deleted = await insertItem({ skill_id: 'a', status: 'active' });
      await pool.query('UPDATE skill_store_item SET deleted_at = now() WHERE id = $1', [deleted.id]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/stats',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total_items).toBe(1);
    });

    it('returns storage estimate', async () => {
      await insertItem({ skill_id: 'a', data: JSON.stringify({ large: 'x'.repeat(1000) }) });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/stats',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.storage_estimate).toHaveProperty('total_bytes');
      expect(typeof body.storage_estimate.total_bytes).toBe('number');
    });
  });

  // ── GET /api/admin/skill-store/skills ─────────────────────────────────

  describe('GET /api/admin/skill-store/skills', () => {
    it('returns empty array when no skills exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skills).toEqual([]);
    });

    it('lists all skill_ids with counts', async () => {
      await insertItem({ skill_id: 'alpha' });
      await insertItem({ skill_id: 'alpha' });
      await insertItem({ skill_id: 'alpha', collection: 'notes' });
      await insertItem({ skill_id: 'beta' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skills).toHaveLength(2);

      const alpha = body.skills.find((s: Record<string, unknown>) => s.skill_id === 'alpha');
      const beta = body.skills.find((s: Record<string, unknown>) => s.skill_id === 'beta');
      expect(alpha).toBeDefined();
      expect(alpha.item_count).toBe(3);
      expect(alpha.collection_count).toBe(2); // _default + notes
      expect(beta.item_count).toBe(1);
    });

    it('includes last_activity timestamp', async () => {
      await insertItem({ skill_id: 'test-skill' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skills[0]).toHaveProperty('last_activity');
      expect(body.skills[0].last_activity).toBeTruthy();
    });

    it('excludes soft-deleted items from counts', async () => {
      await insertItem({ skill_id: 'test-skill' });
      const deleted = await insertItem({ skill_id: 'test-skill' });
      await pool.query('UPDATE skill_store_item SET deleted_at = now() WHERE id = $1', [deleted.id]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skills[0].item_count).toBe(1);
    });
  });

  // ── GET /api/admin/skill-store/skills/:skill_id ────────────────────────

  describe('GET /api/admin/skill-store/skills/:skill_id', () => {
    it('returns 404 for non-existent skill', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills/nonexistent',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns detailed view of a skill', async () => {
      await insertItem({ skill_id: 'detail-skill', collection: '_default', status: 'active' });
      await insertItem({ skill_id: 'detail-skill', collection: '_default', status: 'active' });
      await insertItem({ skill_id: 'detail-skill', collection: 'notes', status: 'archived' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills/detail-skill',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skill_id).toBe('detail-skill');
      expect(body.total_items).toBe(3);
      expect(body).toHaveProperty('collections');
      expect(body).toHaveProperty('by_status');
      expect(body).toHaveProperty('embedding_status');
    });

    it('includes collection breakdown', async () => {
      await insertItem({ skill_id: 'x', collection: '_default' });
      await insertItem({ skill_id: 'x', collection: '_default' });
      await insertItem({ skill_id: 'x', collection: 'config' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills/x',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      const defaultCol = body.collections.find((c: Record<string, unknown>) => c.collection === '_default');
      const configCol = body.collections.find((c: Record<string, unknown>) => c.collection === 'config');
      expect(defaultCol.count).toBe(2);
      expect(configCol.count).toBe(1);
    });

    it('includes embedding status breakdown', async () => {
      await insertItem({ skill_id: 'emb', embedding_status: 'complete' });
      await insertItem({ skill_id: 'emb', embedding_status: 'pending' });
      await insertItem({ skill_id: 'emb', embedding_status: 'failed' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills/emb',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.embedding_status.complete).toBe(1);
      expect(body.embedding_status.pending).toBe(1);
      expect(body.embedding_status.failed).toBe(1);
    });

    it('includes schedule list when schedules exist', async () => {
      await insertItem({ skill_id: 'sched-skill' });
      await insertSchedule({ skill_id: 'sched-skill', cron_expression: '0 * * * *' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills/sched-skill',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.schedules).toHaveLength(1);
      expect(body.schedules[0]).toHaveProperty('cron_expression');
    });

    it('excludes soft-deleted items', async () => {
      await insertItem({ skill_id: 'del-skill' });
      const deleted = await insertItem({ skill_id: 'del-skill' });
      await pool.query('UPDATE skill_store_item SET deleted_at = now() WHERE id = $1', [deleted.id]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/skills/del-skill',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total_items).toBe(1);
    });
  });

  // ── GET /api/admin/skill-store/embeddings/status ─────────────────────

  describe('GET /api/admin/skill-store/embeddings/status', () => {
    it('returns embedding statistics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/skill-store/embeddings/status',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('byStatus');
    });
  });

  // ── DELETE /api/admin/skill-store/skills/:skill_id ─────────────────────

  describe('DELETE /api/admin/skill-store/skills/:skill_id', () => {
    it('requires X-Confirm-Delete header', async () => {
      await insertItem({ skill_id: 'purge-skill' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/skill-store/skills/purge-skill',
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('X-Confirm-Delete');
    });

    it('rejects wrong X-Confirm-Delete value', async () => {
      await insertItem({ skill_id: 'purge-skill' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/skill-store/skills/purge-skill',
        headers: { 'x-confirm-delete': 'false' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('hard deletes all items for a skill', async () => {
      await insertItem({ skill_id: 'purge-me', collection: '_default' });
      await insertItem({ skill_id: 'purge-me', collection: 'notes' });
      await insertItem({ skill_id: 'keep-me' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/skill-store/skills/purge-me',
        headers: { 'x-confirm-delete': 'true' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deleted_count).toBe(2);
      expect(body.skill_id).toBe('purge-me');

      // Verify items are gone (hard delete, not soft)
      const remaining = await pool.query(
        "SELECT count(*)::int AS cnt FROM skill_store_item WHERE skill_id = 'purge-me'"
      );
      expect(remaining.rows[0].cnt).toBe(0);

      // Verify other skills untouched
      const kept = await pool.query(
        "SELECT count(*)::int AS cnt FROM skill_store_item WHERE skill_id = 'keep-me'"
      );
      expect(kept.rows[0].cnt).toBe(1);
    });

    it('also deletes schedules for the skill', async () => {
      await insertItem({ skill_id: 'sched-purge' });
      await insertSchedule({ skill_id: 'sched-purge' });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/skill-store/skills/sched-purge',
        headers: { 'x-confirm-delete': 'true' },
      });
      expect(res.statusCode).toBe(200);

      const schedules = await pool.query(
        "SELECT count(*)::int AS cnt FROM skill_store_schedule WHERE skill_id = 'sched-purge'"
      );
      expect(schedules.rows[0].cnt).toBe(0);
    });

    it('returns 404 for non-existent skill', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/skill-store/skills/nonexistent',
        headers: { 'x-confirm-delete': 'true' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('includes soft-deleted items in purge', async () => {
      await insertItem({ skill_id: 'full-purge' });
      const softDeleted = await insertItem({ skill_id: 'full-purge' });
      await pool.query('UPDATE skill_store_item SET deleted_at = now() WHERE id = $1', [softDeleted.id]);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/admin/skill-store/skills/full-purge',
        headers: { 'x-confirm-delete': 'true' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Hard purge removes ALL items including soft-deleted
      expect(body.deleted_count).toBe(2);

      const remaining = await pool.query(
        "SELECT count(*)::int AS cnt FROM skill_store_item WHERE skill_id = 'full-purge'"
      );
      expect(remaining.rows[0].cnt).toBe(0);
    });
  });
});
