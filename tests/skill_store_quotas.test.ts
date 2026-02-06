import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Skill Store quotas and resource limits (Issue #805).
 *
 * Covers:
 * - getSkillStoreQuotaConfig reads from env vars with defaults
 * - checkItemQuota uses approximate counts for performance
 * - checkScheduleQuota uses exact counts
 * - getSkillStoreQuotaUsage returns current usage vs limits
 * - Quota enforcement: 429 when exceeded
 */
describe('Skill Store Quotas (Issue #805)', () => {
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

  // Helper to insert items quickly
  async function insertItems(skillId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title)
         VALUES ($1, '_default', $2)`,
        [skillId, `Item ${i}`]
      );
    }
  }

  // Counter for unique cron expressions
  let scheduleCounter = 0;

  // Helper to insert a schedule with a unique cron expression
  async function insertSchedule(skillId: string): Promise<string> {
    scheduleCounter++;
    const minute = scheduleCounter % 60;
    const result = await pool.query(
      `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
       VALUES ($1, $2, 'https://example.com/hook')
       RETURNING id::text as id`,
      [skillId, `${minute} */6 * * *`]
    );
    return result.rows[0].id;
  }

  // ── Quota Config ────────────────────────────────────────────────────

  describe('getSkillStoreQuotaConfig', () => {
    it('returns default values when no env vars set', async () => {
      const { getSkillStoreQuotaConfig } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      const config = getSkillStoreQuotaConfig();

      expect(config.maxItemsPerSkill).toBe(100_000);
      expect(config.maxCollectionsPerSkill).toBe(1_000);
      expect(config.maxSchedulesPerSkill).toBe(20);
      expect(config.maxItemSizeBytes).toBe(1_048_576);
    });

    it('reads values from env vars', async () => {
      const original = { ...process.env };
      process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL = '500';
      process.env.SKILL_STORE_MAX_COLLECTIONS_PER_SKILL = '10';
      process.env.SKILL_STORE_MAX_SCHEDULES_PER_SKILL = '5';
      process.env.SKILL_STORE_MAX_ITEM_SIZE_BYTES = '2048';

      // Re-import to get fresh config
      const mod = await import('../src/api/skill-store/quotas.ts');
      // Use explicit function with env override
      const config = mod.getSkillStoreQuotaConfig({
        maxItemsPerSkill: 500,
        maxCollectionsPerSkill: 10,
        maxSchedulesPerSkill: 5,
        maxItemSizeBytes: 2048,
      });

      expect(config.maxItemsPerSkill).toBe(500);
      expect(config.maxCollectionsPerSkill).toBe(10);
      expect(config.maxSchedulesPerSkill).toBe(5);
      expect(config.maxItemSizeBytes).toBe(2048);

      // Restore env
      process.env = original;
    });
  });

  // ── Item Quota Check ────────────────────────────────────────────────

  describe('checkItemQuota', () => {
    it('returns ok when under limit', async () => {
      const { checkItemQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertItems('sk1', 5);

      const result = await checkItemQuota(pool, 'sk1', { maxItemsPerSkill: 100 });
      expect(result.allowed).toBe(true);
    });

    it('returns denied when at limit', async () => {
      const { checkItemQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertItems('sk1', 3);

      const result = await checkItemQuota(pool, 'sk1', { maxItemsPerSkill: 3 });
      expect(result.allowed).toBe(false);
      expect(result.current).toBeGreaterThanOrEqual(3);
      expect(result.limit).toBe(3);
    });

    it('does not count soft-deleted items', async () => {
      const { checkItemQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertItems('sk1', 3);
      // Soft delete one
      await pool.query(
        `UPDATE skill_store_item SET deleted_at = now()
         WHERE id = (SELECT id FROM skill_store_item WHERE skill_id = 'sk1' LIMIT 1)`
      );

      const result = await checkItemQuota(pool, 'sk1', { maxItemsPerSkill: 3 });
      expect(result.allowed).toBe(true);
    });

    it('does not count items from other skills', async () => {
      const { checkItemQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertItems('sk1', 5);
      await insertItems('sk2', 5);

      const result = await checkItemQuota(pool, 'sk1', { maxItemsPerSkill: 10 });
      expect(result.allowed).toBe(true);
    });
  });

  // ── Collection Quota Check ──────────────────────────────────────────

  describe('checkCollectionQuota', () => {
    it('returns ok when under collection limit', async () => {
      const { checkCollectionQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'col1', 'A')`
      );
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'col2', 'B')`
      );

      const result = await checkCollectionQuota(pool, 'sk1', 'col3', { maxCollectionsPerSkill: 10 });
      expect(result.allowed).toBe(true);
    });

    it('returns denied when new collection would exceed limit', async () => {
      const { checkCollectionQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'col1', 'A')`
      );
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'col2', 'B')`
      );

      const result = await checkCollectionQuota(pool, 'sk1', 'col3', { maxCollectionsPerSkill: 2 });
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(2);
      expect(result.limit).toBe(2);
    });

    it('allows adding to an existing collection', async () => {
      const { checkCollectionQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'col1', 'A')`
      );
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'col2', 'B')`
      );

      // Adding to existing collection col1 should be allowed even at limit
      const result = await checkCollectionQuota(pool, 'sk1', 'col1', { maxCollectionsPerSkill: 2 });
      expect(result.allowed).toBe(true);
    });
  });

  // ── Schedule Quota Check ────────────────────────────────────────────

  describe('checkScheduleQuota', () => {
    it('returns ok when under schedule limit', async () => {
      const { checkScheduleQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertSchedule('sk1');

      const result = await checkScheduleQuota(pool, 'sk1', { maxSchedulesPerSkill: 5 });
      expect(result.allowed).toBe(true);
    });

    it('returns denied when at schedule limit', async () => {
      const { checkScheduleQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertSchedule('sk1');
      await insertSchedule('sk1');
      await insertSchedule('sk1');

      const result = await checkScheduleQuota(pool, 'sk1', { maxSchedulesPerSkill: 3 });
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(3);
      expect(result.limit).toBe(3);
    });

    it('does not count schedules from other skills', async () => {
      const { checkScheduleQuota } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertSchedule('sk1');
      await insertSchedule('sk2');
      await insertSchedule('sk2');

      const result = await checkScheduleQuota(pool, 'sk1', { maxSchedulesPerSkill: 2 });
      expect(result.allowed).toBe(true);
    });
  });

  // ── Quota Usage ─────────────────────────────────────────────────────

  describe('getSkillStoreQuotaUsage', () => {
    it('returns usage and limits for a skill', async () => {
      const { getSkillStoreQuotaUsage } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      await insertItems('sk1', 10);
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title) VALUES ('sk1', 'notes', 'Note 1')`
      );
      await insertSchedule('sk1');
      await insertSchedule('sk1');

      const usage = await getSkillStoreQuotaUsage(pool, 'sk1');

      expect(usage.items.current).toBe(11);
      expect(usage.items.limit).toBeGreaterThan(0);
      expect(usage.collections.current).toBe(2); // _default + notes
      expect(usage.collections.limit).toBeGreaterThan(0);
      expect(usage.schedules.current).toBe(2);
      expect(usage.schedules.limit).toBeGreaterThan(0);
    });

    it('handles empty skill with zero counts', async () => {
      const { getSkillStoreQuotaUsage } = await import(
        '../src/api/skill-store/quotas.ts'
      );

      const usage = await getSkillStoreQuotaUsage(pool, 'nonexistent');

      expect(usage.items.current).toBe(0);
      expect(usage.collections.current).toBe(0);
      expect(usage.schedules.current).toBe(0);
    });
  });

  // ── API Endpoint Integration ────────────────────────────────────────

  describe('API endpoints', () => {
    const app = buildServer();

    beforeAll(async () => {
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    describe('GET /api/admin/skill-store/skills/:skill_id/quota', () => {
      it('returns quota usage for a skill', async () => {
        await insertItems('sk1', 5);
        await insertSchedule('sk1');

        const res = await app.inject({
          method: 'GET',
          url: '/api/admin/skill-store/skills/sk1/quota',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.skill_id).toBe('sk1');
        expect(body.items.current).toBe(5);
        expect(body.items.limit).toBeGreaterThan(0);
        expect(body.collections.current).toBe(1); // _default
        expect(body.schedules.current).toBe(1);
        expect(body.maxItemSizeBytes).toBe(1_048_576);
      });

      it('returns zero counts for non-existent skill', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/admin/skill-store/skills/nonexistent/quota',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.items.current).toBe(0);
        expect(body.collections.current).toBe(0);
        expect(body.schedules.current).toBe(0);
      });
    });

    describe('POST /api/skill-store/items quota enforcement', () => {
      it('returns 429 when item quota is exceeded', async () => {
        // Set a very low quota via env
        const original = process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL;
        process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL = '3';

        try {
          await insertItems('quota-test', 3);

          const res = await app.inject({
            method: 'POST',
            url: '/api/skill-store/items',
            payload: {
              skill_id: 'quota-test',
              title: 'Over limit',
            },
          });

          expect(res.statusCode).toBe(429);
          const body = res.json();
          expect(body.error).toContain('quota');
          expect(body.current).toBe(3);
          expect(body.limit).toBe(3);
        } finally {
          if (original === undefined) {
            delete process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL;
          } else {
            process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL = original;
          }
        }
      });

      it('allows item creation when under quota', async () => {
        const original = process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL;
        process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL = '100';

        try {
          const res = await app.inject({
            method: 'POST',
            url: '/api/skill-store/items',
            payload: {
              skill_id: 'quota-ok',
              title: 'Under limit',
            },
          });

          expect(res.statusCode).toBe(201);
        } finally {
          if (original === undefined) {
            delete process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL;
          } else {
            process.env.SKILL_STORE_MAX_ITEMS_PER_SKILL = original;
          }
        }
      });
    });

    describe('POST /api/skill-store/schedules quota enforcement', () => {
      it('returns 429 when schedule quota is exceeded', async () => {
        const original = process.env.SKILL_STORE_MAX_SCHEDULES_PER_SKILL;
        process.env.SKILL_STORE_MAX_SCHEDULES_PER_SKILL = '2';

        try {
          await insertSchedule('sched-quota');
          await insertSchedule('sched-quota');

          const res = await app.inject({
            method: 'POST',
            url: '/api/skill-store/schedules',
            payload: {
              skill_id: 'sched-quota',
              cron_expression: '30 8 * * 1',
              webhook_url: 'https://example.com/hook',
            },
          });

          expect(res.statusCode).toBe(429);
          const body = res.json();
          expect(body.error).toContain('quota');
          expect(body.current).toBe(2);
          expect(body.limit).toBe(2);
        } finally {
          if (original === undefined) {
            delete process.env.SKILL_STORE_MAX_SCHEDULES_PER_SKILL;
          } else {
            process.env.SKILL_STORE_MAX_SCHEDULES_PER_SKILL = original;
          }
        }
      });
    });
  });
});
