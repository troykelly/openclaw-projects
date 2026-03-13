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

/** Fixed UUIDs matching seed-dev-data.ts for idempotency */
const MEM_PERM_1 = '10000000-0007-4000-a000-000000000001';
const MEM_PERM_2 = '10000000-0007-4000-a000-000000000002';
const MEM_PERM_3 = '10000000-0007-4000-a000-000000000003';
const MEM_PERM_4 = '10000000-0007-4000-a000-000000000004';
const MEM_PERM_5 = '10000000-0007-4000-a000-000000000005';
const MEM_EPH_1H = '10000000-0007-4000-a000-000000000010';
const MEM_EPH_6H = '10000000-0007-4000-a000-000000000011';
const MEM_EPH_24H = '10000000-0007-4000-a000-000000000012';
const MEM_EPH_3D = '10000000-0007-4000-a000-000000000013';
const MEM_EPH_7D = '10000000-0007-4000-a000-000000000014';
const MEM_EXP_1 = '10000000-0007-4000-a000-000000000020';
const MEM_EXP_2 = '10000000-0007-4000-a000-000000000021';
const MEM_EXP_3 = '10000000-0007-4000-a000-000000000022';
const MEM_SUPER_A = '10000000-0007-4000-a000-000000000030';
const MEM_SUPER_B = '10000000-0007-4000-a000-000000000031';
const MEM_SUPER_C = '10000000-0007-4000-a000-000000000032';
const MEM_SLIDE_MON = '10000000-0007-4000-a000-000000000040';
const MEM_SLIDE_TUE = '10000000-0007-4000-a000-000000000041';
const MEM_SLIDE_WK = '10000000-0007-4000-a000-000000000042';
const MEM_PIN_1 = '10000000-0007-4000-a000-000000000050';
const MEM_PIN_2 = '10000000-0007-4000-a000-000000000051';
const MEM_NS_1 = '10000000-0007-4000-a000-000000000060';
const MEM_NS_2 = '10000000-0007-4000-a000-000000000061';

function hoursFromNow(n: number): string {
  const d = new Date();
  d.setTime(d.getTime() + n * 60 * 60 * 1000);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

async function insertMemory(
  pool: Pool,
  id: string,
  namespace: string,
  title: string,
  content: string,
  opts: {
    memory_type?: string;
    importance?: number;
    confidence?: number;
    expires_at?: string | null;
    superseded_by?: string | null;
    is_active?: boolean;
    pinned?: boolean;
    tags?: string[];
    created_by_agent?: string | null;
  } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO memory (id, namespace, title, content, memory_type, importance, confidence, expires_at, superseded_by, is_active, pinned, tags, created_by_agent, embedding_status)
     VALUES ($1, $2, $3, $4, $5::memory_type, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      namespace,
      title,
      content,
      opts.memory_type ?? 'note',
      opts.importance ?? 5,
      opts.confidence ?? 1.0,
      opts.expires_at ?? null,
      opts.superseded_by ?? null,
      opts.is_active ?? true,
      opts.pinned ?? false,
      opts.tags ?? [],
      opts.created_by_agent ?? 'seed-test',
    ],
  );
}

describe('Memory Lifecycle Seed Data (#2461)', () => {
  let pool: Pool;
  const namespace = 'default';
  const altNamespace = 'test-isolated';
  const email = 'test@example.com';

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    // Delete only our seed-test memories to avoid TRUNCATE deadlocks
    // with concurrent test runs from other agents
    await pool.query(`DELETE FROM memory WHERE created_by_agent = 'seed-test'`);

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
      [email, altNamespace],
    );
  });

  async function seedAllMemories(): Promise<void> {
    // 5 permanent memories
    await insertMemory(pool, MEM_PERM_1, namespace, 'Notification preference', 'User prefers SMS over email.', {
      memory_type: 'preference', importance: 8, confidence: 0.95, tags: ['notifications'],
    });
    await insertMemory(pool, MEM_PERM_2, namespace, 'Home address', 'User lives at 42 Wallaby Way.', {
      memory_type: 'fact', importance: 7, confidence: 1.0, tags: ['address'],
    });
    await insertMemory(pool, MEM_PERM_3, namespace, 'Chose React over Vue', 'Decision to use React 19.', {
      memory_type: 'decision', importance: 9, confidence: 0.9, tags: ['tech-stack'],
    });
    await insertMemory(pool, MEM_PERM_4, namespace, 'Renovation budget context', 'Total budget is $85,000.', {
      memory_type: 'context', importance: 6, confidence: 0.85, tags: ['renovation'],
    });
    await insertMemory(pool, MEM_PERM_5, namespace, 'API design guidelines doc', 'Team follows OpenClaw API guide.', {
      memory_type: 'reference', importance: 4, confidence: 1.0, tags: ['api'],
    });

    // 5 ephemeral memories (future expiry)
    await insertMemory(pool, MEM_EPH_1H, namespace, 'Current meeting notes', 'Standup notes.', {
      memory_type: 'context', importance: 3, confidence: 0.8, expires_at: hoursFromNow(1), tags: ['meeting'],
    });
    await insertMemory(pool, MEM_EPH_6H, namespace, 'Debugging session context', 'Memory leak investigation.', {
      memory_type: 'context', importance: 5, confidence: 0.7, expires_at: hoursFromNow(6), tags: ['debugging'],
    });
    await insertMemory(pool, MEM_EPH_24H, namespace, 'Today focus items', 'Focus: finish PR review.', {
      memory_type: 'note', importance: 6, confidence: 0.9, expires_at: hoursFromNow(24), tags: ['daily'],
    });
    await insertMemory(pool, MEM_EPH_3D, namespace, 'Sprint goal reminder', 'Complete memory lifecycle MVP.', {
      memory_type: 'context', importance: 7, confidence: 0.85, expires_at: daysFromNow(3), tags: ['sprint'],
    });
    await insertMemory(pool, MEM_EPH_7D, namespace, 'Weekly experiment tracker', 'Testing new embedding model.', {
      memory_type: 'note', importance: 4, confidence: 0.6, expires_at: daysFromNow(7), tags: ['experiment'],
    });

    // 3 expired memories (is_active=true for reaper testing)
    await insertMemory(pool, MEM_EXP_1, namespace, 'Yesterday meeting notes', 'Deployment timeline.', {
      memory_type: 'context', importance: 3, confidence: 0.7, expires_at: hoursFromNow(-2), is_active: true, tags: ['expired-test'],
    });
    await insertMemory(pool, MEM_EXP_2, namespace, 'Old debugging context', 'CORS issue on staging.', {
      memory_type: 'context', importance: 2, confidence: 0.5, expires_at: daysFromNow(-1), is_active: true, tags: ['expired-test'],
    });
    await insertMemory(pool, MEM_EXP_3, namespace, 'Stale cache investigation', 'Redis TTL issue.', {
      memory_type: 'note', importance: 1, confidence: 0.4, expires_at: daysFromNow(-3), is_active: true, tags: ['expired-test'],
    });

    // Supersession chain: A → B → C
    await insertMemory(pool, MEM_SUPER_C, namespace, 'Project stack: React 19 + Next.js 15', 'Final decision.', {
      memory_type: 'decision', importance: 9, confidence: 1.0, tags: ['supersession-chain'],
    });
    await insertMemory(pool, MEM_SUPER_B, namespace, 'Project stack: React 19 + Vite', 'Updated decision.', {
      memory_type: 'decision', importance: 9, confidence: 0.8, superseded_by: MEM_SUPER_C, is_active: false, tags: ['supersession-chain'],
    });
    await insertMemory(pool, MEM_SUPER_A, namespace, 'Project stack: React 18 + CRA', 'Initial decision.', {
      memory_type: 'decision', importance: 9, confidence: 0.6, superseded_by: MEM_SUPER_B, is_active: false, tags: ['supersession-chain'],
    });

    // Sliding window memories
    await insertMemory(pool, MEM_SLIDE_MON, namespace, 'Monday daily summary', 'Auth middleware refactor.', {
      memory_type: 'context', importance: 5, confidence: 0.9, tags: ['day-memory:monday', 'daily-summary'],
    });
    await insertMemory(pool, MEM_SLIDE_TUE, namespace, 'Tuesday daily summary', 'Reaper function, digest endpoint.', {
      memory_type: 'context', importance: 5, confidence: 0.9, pinned: true, tags: ['day-memory:tuesday', 'daily-summary'],
    });
    await insertMemory(pool, MEM_SLIDE_WK, namespace, 'Week 11 summary', 'Sprint focus: memory lifecycle.', {
      memory_type: 'context', importance: 7, confidence: 0.85, tags: ['week-memory:current', 'weekly-summary'],
    });

    // Pinned memories
    await insertMemory(pool, MEM_PIN_1, namespace, 'User timezone', 'Australia/Sydney timezone.', {
      memory_type: 'preference', importance: 10, confidence: 1.0, pinned: true, tags: ['critical-context'],
    });
    await insertMemory(pool, MEM_PIN_2, namespace, 'Communication style', 'Concise, direct, no emojis.', {
      memory_type: 'preference', importance: 10, confidence: 0.95, pinned: true, tags: ['critical-context'],
    });

    // Alternate namespace memories
    await insertMemory(pool, MEM_NS_1, altNamespace, 'Isolated project config', 'Separate database and pipeline.', {
      memory_type: 'context', importance: 6, confidence: 1.0, tags: ['isolation-test'],
    });
    await insertMemory(pool, MEM_NS_2, altNamespace, 'Isolated user preference', 'Verbose logging enabled.', {
      memory_type: 'preference', importance: 5, confidence: 0.9, tags: ['isolation-test'],
    });
  }

  it('should insert all seed memories without errors', async () => {
    await expect(seedAllMemories()).resolves.toBeUndefined();
  });

  it('should create at least 20 memory entries', async () => {
    await seedAllMemories();
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = 'seed-test'`,
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(20);
  });

  it('should include permanent memories (no expiry)', async () => {
    await seedAllMemories();
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test'
         AND expires_at IS NULL AND superseded_by IS NULL AND is_active = true`,
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(5);
  });

  it('should include ephemeral memories with future expiry', async () => {
    await seedAllMemories();
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test'
         AND expires_at IS NOT NULL AND expires_at > now() AND is_active = true`,
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(5);
  });

  it('should include expired memories (is_active=true for reaper testing)', async () => {
    await seedAllMemories();
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test'
         AND expires_at IS NOT NULL AND expires_at < now() AND is_active = true`,
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(3);
  });

  it('should include a supersession chain', async () => {
    await seedAllMemories();
    const superseded = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test' AND superseded_by IS NOT NULL`,
    );
    expect(parseInt(superseded.rows[0].count, 10)).toBeGreaterThanOrEqual(2);

    const active = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test'
         AND tags @> ARRAY['supersession-chain'] AND is_active = true AND superseded_by IS NULL`,
    );
    expect(parseInt(active.rows[0].count, 10)).toBeGreaterThanOrEqual(1);
  });

  it('should include sliding window tagged memories', async () => {
    await seedAllMemories();
    for (const tag of ['day-memory:monday', 'day-memory:tuesday', 'week-memory:current']) {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM memory
         WHERE created_by_agent = 'seed-test' AND tags @> ARRAY[$1]`,
        [tag],
      );
      expect(parseInt(result.rows[0].count, 10), `Missing tag: ${tag}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('should include pinned memories', async () => {
    await seedAllMemories();
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test' AND pinned = true`,
    );
    // MEM_PIN_1, MEM_PIN_2, and MEM_SLIDE_TUE are pinned
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(2);
  });

  it('should include memories in an alternate namespace', async () => {
    await seedAllMemories();
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory
       WHERE created_by_agent = 'seed-test' AND namespace != 'default'`,
    );
    expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(2);
  });

  it('should include varied importance and confidence scores', async () => {
    await seedAllMemories();
    const result = await pool.query<{ min_imp: number; max_imp: number; min_conf: number; max_conf: number }>(
      `SELECT min(importance) AS min_imp, max(importance) AS max_imp,
              min(confidence) AS min_conf, max(confidence) AS max_conf
       FROM memory WHERE created_by_agent = 'seed-test'`,
    );
    const row = result.rows[0];
    expect(row.max_imp - row.min_imp).toBeGreaterThanOrEqual(3);
    expect(row.max_conf - row.min_conf).toBeGreaterThan(0);
  });

  it('should be idempotent (ON CONFLICT DO NOTHING)', async () => {
    await seedAllMemories();
    const before = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = 'seed-test'`,
    );

    // Run again — should not duplicate
    await seedAllMemories();

    const after = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory WHERE created_by_agent = 'seed-test'`,
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
