/**
 * Integration tests for memory lifecycle seed data (Issue #2461).
 *
 * Verifies that memory seed entries can be inserted into the database
 * and cover all required lifecycle scenarios:
 * - Permanent, ephemeral, expired, pinned, superseded memories
 * - Sliding window tag patterns
 * - Multi-namespace memories
 * - Varied importance and confidence scores
 * - Idempotent (ON CONFLICT DO NOTHING)
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { seedMemories, SEED_MEMORY_COUNT, SEED_AGENT_LABEL, ALT_NAMESPACE } from '../scripts/seed-dev-memories.ts';

describe('Memory Lifecycle Seed Data (#2461)', () => {
  let pool: Pool;
  const namespace = 'default';
  const email = 'test@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // Delete only our seed memories to avoid TRUNCATE deadlocks
    // with concurrent test runs from other agents
    await pool.query(`DELETE FROM memory WHERE created_by_agent = $1`, [SEED_AGENT_LABEL]);

    // Ensure test user and namespaces exist (idempotent)
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email`,
      [email],
    );
    await pool.query(
      `INSERT INTO namespace_grant (email, namespace, access, is_home)
       VALUES ($1, $2, 'readwrite', true)
       ON CONFLICT (email, namespace) DO NOTHING`,
      [email, namespace],
    );
    await pool.query(
      `INSERT INTO namespace_grant (email, namespace, access, is_home)
       VALUES ($1, $2, 'readwrite', false)
       ON CONFLICT (email, namespace) DO NOTHING`,
      [email, ALT_NAMESPACE],
    );
  });

  it('should insert all seed memories without errors', async () => {
    await expect(seedMemories(pool, namespace)).resolves.toBeUndefined();
  });

  it('should create at least 20 memory entries', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = $1`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(20);
  });

  it(`should create exactly ${SEED_MEMORY_COUNT} entries`, async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = $1`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(SEED_MEMORY_COUNT);
  });

  it('should include permanent memories (no expiry)', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1
         AND expires_at IS NULL AND superseded_by IS NULL AND is_active = true`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(5);
  });

  it('should include ephemeral memories with future expiry', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1
         AND expires_at IS NOT NULL AND expires_at > now() AND is_active = true`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(5);
  });

  it('should include expired memories (is_active=true for reaper testing)', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1
         AND expires_at IS NOT NULL AND expires_at < now() AND is_active = true`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(3);
  });

  it('should include a supersession chain', async () => {
    await seedMemories(pool, namespace);
    const superseded = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1 AND superseded_by IS NOT NULL`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(superseded.rows[0].count, 10)).toBeGreaterThanOrEqual(2);

    const active = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1
         AND tags @> ARRAY['supersession-chain'] AND is_active = true AND superseded_by IS NULL`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(active.rows[0].count, 10)).toBeGreaterThanOrEqual(1);
  });

  it('should include sliding window tagged memories', async () => {
    await seedMemories(pool, namespace);
    for (const tag of ['day-memory:monday', 'day-memory:tuesday', 'week-memory:current']) {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM memory
         WHERE created_by_agent = $1 AND tags @> ARRAY[$2]`,
        [SEED_AGENT_LABEL, tag],
      );
      expect(parseInt(result.rows[0].count, 10), `Missing tag: ${tag}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('should include pinned memories', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1 AND pinned = true`,
      [SEED_AGENT_LABEL],
    );
    // MEM_PIN_1, MEM_PIN_2, and MEM_SLIDE_TUE are pinned
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(2);
  });

  it('should include memories in an alternate namespace', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = $1 AND namespace != 'default'`,
      [SEED_AGENT_LABEL],
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(2);
  });

  it('should include varied importance and confidence scores', async () => {
    await seedMemories(pool, namespace);
    const result = await pool.query<{ min_imp: number; max_imp: number; min_conf: number; max_conf: number }>(
      `SELECT min(importance) AS min_imp, max(importance) AS max_imp,
              min(confidence) AS min_conf, max(confidence) AS max_conf
       FROM memory WHERE created_by_agent = $1`,
      [SEED_AGENT_LABEL],
    );
    const row = result.rows[0];
    expect(row.max_imp - row.min_imp).toBeGreaterThanOrEqual(3);
    expect(row.max_conf - row.min_conf).toBeGreaterThan(0);
  });

  it('should be idempotent (ON CONFLICT DO NOTHING)', async () => {
    await seedMemories(pool, namespace);
    const before = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = $1`,
      [SEED_AGENT_LABEL],
    );

    // Run again — should not duplicate
    await seedMemories(pool, namespace);

    const after = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = $1`,
      [SEED_AGENT_LABEL],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
