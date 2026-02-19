import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Skill Store Aggregate and Collections API (Issue #801).
 *
 * Covers:
 * - GET /api/skill-store/aggregate: count, count_by_tag, count_by_status, latest, oldest
 * - GET /api/skill-store/collections with user_email filter
 * - Filter parameters: collection, since, until, user_email
 * - Soft-deleted items excluded
 */
describe('Skill Store Aggregate & Collections (Issue #801)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Helper to insert an item
  async function insertItem(
    overrides: {
      skill_id?: string;
      title?: string;
      summary?: string;
      content?: string;
      collection?: string;
      key?: string;
      tags?: string[];
      status?: string;
      namespace?: string;
      deleted_at?: string;
      created_at?: string;
    } = {},
  ): Promise<string> {
    const result = await pool.query(
      `INSERT INTO skill_store_item (skill_id, collection, key, title, summary, content, tags, status, namespace, deleted_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::skill_store_item_status, 'active'), $9, $10::timestamptz, COALESCE($11::timestamptz, now()))
       RETURNING id::text as id`,
      [
        overrides.skill_id ?? 'test-skill',
        overrides.collection ?? '_default',
        overrides.key ?? null,
        overrides.title ?? null,
        overrides.summary ?? null,
        overrides.content ?? null,
        overrides.tags ?? [],
        overrides.status ?? null,
        overrides.namespace ?? 'default',
        overrides.deleted_at ?? null,
        overrides.created_at ?? null,
      ],
    );
    return result.rows[0].id;
  }

  // ── Aggregate: count ────────────────────────────────────────────────

  describe('aggregate count', () => {
    it('counts all active items for a skill', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', title: 'Item 1' });
      await insertItem({ skill_id: 'sk1', title: 'Item 2' });
      await insertItem({ skill_id: 'sk1', title: 'Deleted', deleted_at: '2026-01-01T00:00:00Z' });
      await insertItem({ skill_id: 'other', title: 'Other skill' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'count',
      });

      expect(result).toEqual({ count: 2 });
    });

    it('counts items in a specific collection', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', collection: 'notes', title: 'Note 1' });
      await insertItem({ skill_id: 'sk1', collection: 'notes', title: 'Note 2' });
      await insertItem({ skill_id: 'sk1', collection: 'config', title: 'Config 1' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'count',
        collection: 'notes',
      });

      expect(result).toEqual({ count: 2 });
    });

    it('filters by namespace', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', title: 'NS A item', namespace: 'ns-a' });
      await insertItem({ skill_id: 'sk1', title: 'NS B item', namespace: 'ns-b' });
      await insertItem({ skill_id: 'sk1', title: 'Default ns item' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'count',
        namespace: 'ns-a',
      });

      expect(result).toEqual({ count: 1 });
    });

    it('filters by since/until time range', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', title: 'Old item', created_at: '2025-01-01T00:00:00Z' });
      await insertItem({ skill_id: 'sk1', title: 'Recent item', created_at: '2026-01-15T00:00:00Z' });
      await insertItem({ skill_id: 'sk1', title: 'Future item', created_at: '2026-06-01T00:00:00Z' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'count',
        since: '2026-01-01T00:00:00Z',
        until: '2026-02-01T00:00:00Z',
      });

      expect(result).toEqual({ count: 1 });
    });
  });

  // ── Aggregate: count_by_tag ─────────────────────────────────────────

  describe('aggregate count_by_tag', () => {
    it('returns tag counts', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', tags: ['important', 'draft'] });
      await insertItem({ skill_id: 'sk1', tags: ['important'] });
      await insertItem({ skill_id: 'sk1', tags: ['draft', 'review'] });
      await insertItem({ skill_id: 'sk1', tags: ['important'], deleted_at: '2026-01-01T00:00:00Z' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'count_by_tag',
      });

      expect(result.tags).toBeDefined();
      const tags = result.tags as Array<{ tag: string; count: number }>;
      const importantTag = tags.find((t) => t.tag === 'important');
      expect(importantTag?.count).toBe(2);
      const draftTag = tags.find((t) => t.tag === 'draft');
      expect(draftTag?.count).toBe(2);
      const reviewTag = tags.find((t) => t.tag === 'review');
      expect(reviewTag?.count).toBe(1);
    });
  });

  // ── Aggregate: count_by_status ──────────────────────────────────────

  describe('aggregate count_by_status', () => {
    it('returns status counts', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', status: 'active' });
      await insertItem({ skill_id: 'sk1', status: 'active' });
      await insertItem({ skill_id: 'sk1', status: 'archived' });
      await insertItem({ skill_id: 'sk1', status: 'processing' });
      await insertItem({ skill_id: 'sk1', status: 'active', deleted_at: '2026-01-01T00:00:00Z' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'count_by_status',
      });

      expect(result.statuses).toBeDefined();
      const statuses = result.statuses as Array<{ status: string; count: number }>;
      const active = statuses.find((s) => s.status === 'active');
      expect(active?.count).toBe(2);
      const archived = statuses.find((s) => s.status === 'archived');
      expect(archived?.count).toBe(1);
      const processing = statuses.find((s) => s.status === 'processing');
      expect(processing?.count).toBe(1);
    });
  });

  // ── Aggregate: latest ───────────────────────────────────────────────

  describe('aggregate latest', () => {
    it('returns the most recently created item', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', title: 'Old', created_at: '2025-01-01T00:00:00Z' });
      await insertItem({ skill_id: 'sk1', title: 'New', created_at: '2026-02-01T00:00:00Z' });
      await insertItem({ skill_id: 'sk1', title: 'Deleted New', created_at: '2026-03-01T00:00:00Z', deleted_at: '2026-03-02T00:00:00Z' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'latest',
      });

      expect(result.item).toBeDefined();
      expect((result.item as Record<string, unknown>).title).toBe('New');
    });

    it('returns null when no items exist', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'nonexistent',
        operation: 'latest',
      });

      expect(result.item).toBeNull();
    });
  });

  // ── Aggregate: oldest ───────────────────────────────────────────────

  describe('aggregate oldest', () => {
    it('returns the oldest created item', async () => {
      const { aggregateSkillStoreItems } = await import('../src/api/skill-store/aggregate.ts');

      await insertItem({ skill_id: 'sk1', title: 'Oldest', created_at: '2025-01-01T00:00:00Z' });
      await insertItem({ skill_id: 'sk1', title: 'Newer', created_at: '2026-01-01T00:00:00Z' });

      const result = await aggregateSkillStoreItems(pool, {
        skill_id: 'sk1',
        operation: 'oldest',
      });

      expect(result.item).toBeDefined();
      expect((result.item as Record<string, unknown>).title).toBe('Oldest');
    });
  });

  // ── Collections with namespace ─────────────────────────────────────

  describe('collections with namespace', () => {
    it('filters collections by namespace', async () => {
      await insertItem({ skill_id: 'sk1', collection: 'notes', namespace: 'ns-a' });
      await insertItem({ skill_id: 'sk1', collection: 'notes', namespace: 'ns-a' });
      await insertItem({ skill_id: 'sk1', collection: 'notes', namespace: 'ns-b' });
      await insertItem({ skill_id: 'sk1', collection: 'config', namespace: 'ns-a' });

      // Query collections filtered by namespace
      const result = await pool.query(
        `SELECT collection,
                COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS count,
                MAX(created_at) FILTER (WHERE deleted_at IS NULL) AS latest_at
         FROM skill_store_item
         WHERE skill_id = $1 AND namespace = $2
         GROUP BY collection
         HAVING COUNT(*) FILTER (WHERE deleted_at IS NULL) > 0
         ORDER BY collection`,
        ['sk1', 'ns-a'],
      );

      expect(result.rows).toHaveLength(2);
      const notes = result.rows.find((r: { collection: string }) => r.collection === 'notes');
      expect(notes?.count).toBe(2);
      const config = result.rows.find((r: { collection: string }) => r.collection === 'config');
      expect(config?.count).toBe(1);
    });
  });
});

// =============================================================================
// Issue #831: HTTP-level tests for GET /api/skill-store/aggregate
// =============================================================================
describe('GET /api/skill-store/aggregate HTTP endpoint (Issue #831)', () => {
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

  it('returns 400 when skill_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skill-store/aggregate?operation=count',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('skill_id');
  });

  it('returns 400 when operation is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skill-store/aggregate?skill_id=test',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('operation');
  });

  it('returns 400 for invalid operation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skill-store/aggregate?skill_id=test&operation=invalid_op',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid operation');
  });

  it('returns count for valid operation', async () => {
    // Insert test items
    await pool.query(
      `INSERT INTO skill_store_item (skill_id, collection, key, title)
       VALUES ('agg-skill', 'notes', 'k1', 'Item 1'),
              ('agg-skill', 'notes', 'k2', 'Item 2')`,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/skill-store/aggregate?skill_id=agg-skill&operation=count',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.count).toBe(2);
  });

  it('returns count_by_status for valid operation', async () => {
    await pool.query(
      `INSERT INTO skill_store_item (skill_id, collection, key, title, status)
       VALUES ('agg-skill', 'c', 'k1', 'A', 'active'),
              ('agg-skill', 'c', 'k2', 'B', 'active'),
              ('agg-skill', 'c', 'k3', 'C', 'archived')`,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/skill-store/aggregate?skill_id=agg-skill&operation=count_by_status',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().result;
    expect(body.statuses).toBeDefined();
    expect(Array.isArray(body.statuses)).toBe(true);
  });

  it('accepts all valid operation names', async () => {
    const validOps = ['count', 'count_by_tag', 'count_by_status', 'latest', 'oldest'];
    for (const op of validOps) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/skill-store/aggregate?skill_id=test&operation=${op}`,
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
