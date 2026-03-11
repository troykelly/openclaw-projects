/**
 * Tests for pinned memory feature (Issue #2380).
 * Verifies that memories can be pinned/unpinned and filtered by pinned status.
 *
 * Uses retries on deadlock to handle concurrent TRUNCATE from other test
 * processes sharing the same database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { runMigrate } from './helpers/migrate.ts';
import { getPoolConfig } from './helpers/db.ts';

/** Retry a database operation on deadlock (40P01) */
async function retryOnDeadlock<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
      if (code === '40P01' && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('retryOnDeadlock: unreachable');
}

describe('Pinned memories (issue #2380)', () => {
  let pool: Pool;
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    await runMigrate('up');
    pool = new Pool({ ...getPoolConfig(), max: 1 });
  });

  afterAll(async () => {
    try {
      await pool.query(`DELETE FROM memory WHERE tags @> ARRAY[$1]`, [`test-${runId}`]);
    } catch { /* ignore cleanup errors */ }
    await pool.end();
  });

  describe('Direct DB: pinned column', () => {
    it('defaults pinned to false', async () => {
      const result = await retryOnDeadlock(() => pool.query(
        `INSERT INTO memory (title, content, memory_type, tags)
         VALUES ('Pin default', $1, 'note', ARRAY[$2])
         RETURNING id::text, pinned`,
        [`Default pinned ${runId}`, `test-${runId}`],
      ));
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].pinned).toBe(false);
    });

    it('creates a pinned memory when pinned=true', async () => {
      const result = await retryOnDeadlock(() => pool.query(
        `INSERT INTO memory (title, content, memory_type, pinned, tags)
         VALUES ('Pinned', $1, 'preference', true, ARRAY[$2])
         RETURNING id::text, pinned`,
        [`Pinned content ${runId}`, `test-${runId}`],
      ));
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].pinned).toBe(true);
    });

    it('updates pinned flag', async () => {
      const insert = await retryOnDeadlock(() => pool.query(
        `INSERT INTO memory (title, content, memory_type, pinned, tags)
         VALUES ('Toggle', $1, 'note', false, ARRAY[$2])
         RETURNING id::text`,
        [`Toggle content ${runId}`, `test-${runId}`],
      ));
      const id = insert.rows[0].id;

      const pin = await retryOnDeadlock(() =>
        pool.query('UPDATE memory SET pinned = true WHERE id = $1 RETURNING pinned', [id]),
      );
      expect(pin.rows[0].pinned).toBe(true);

      const unpin = await retryOnDeadlock(() =>
        pool.query('UPDATE memory SET pinned = false WHERE id = $1 RETURNING pinned', [id]),
      );
      expect(unpin.rows[0].pinned).toBe(false);
    });

    it('partial index exists for pinned=true', async () => {
      const result = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_memory_pinned'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].indexdef).toContain('WHERE (pinned = true)');
    });
  });

  describe('Memory service: pinned support', () => {
    it('createMemory defaults pinned to false', async () => {
      const { createMemory } = await import('../src/api/memory/service.ts');
      const memory = await retryOnDeadlock(() => createMemory(pool, {
        title: 'Svc default',
        content: `Svc default pinned ${runId} ${Date.now()}`,
        tags: [`test-${runId}`],
      }));
      expect(memory.pinned).toBe(false);
    });

    it('createMemory sets pinned=true', async () => {
      const { createMemory } = await import('../src/api/memory/service.ts');
      const memory = await retryOnDeadlock(() => createMemory(pool, {
        title: 'Svc pinned',
        content: `Svc pinned content ${runId} ${Date.now()}`,
        pinned: true,
        tags: [`test-${runId}`],
      }));
      expect(memory.pinned).toBe(true);
    });

    it('updateMemory toggles pinned', async () => {
      const { updateMemory } = await import('../src/api/memory/service.ts');

      const insert = await retryOnDeadlock(() => pool.query(
        `INSERT INTO memory (title, content, memory_type, pinned, tags)
         VALUES ('Svc toggle', $1, 'note', false, ARRAY[$2])
         RETURNING id::text`,
        [`Svc toggle content ${runId}`, `test-${runId}`],
      ));
      const id = insert.rows[0].id;

      const pinned = await retryOnDeadlock(() => updateMemory(pool, id, { pinned: true }));
      expect(pinned).not.toBeNull();
      expect(pinned!.pinned).toBe(true);

      const unpinned = await retryOnDeadlock(() => updateMemory(pool, id, { pinned: false }));
      expect(unpinned).not.toBeNull();
      expect(unpinned!.pinned).toBe(false);
    });

    it('getMemory returns pinned field', async () => {
      const { getMemory } = await import('../src/api/memory/service.ts');

      const insert = await retryOnDeadlock(() => pool.query(
        `INSERT INTO memory (title, content, memory_type, pinned, tags)
         VALUES ('Svc get', $1, 'fact', true, ARRAY[$2])
         RETURNING id::text`,
        [`Svc get content ${runId}`, `test-${runId}`],
      ));
      const id = insert.rows[0].id;

      const fetched = await retryOnDeadlock(() => getMemory(pool, id));
      expect(fetched).not.toBeNull();
      expect(fetched!.pinned).toBe(true);
    });

    it('listMemories filters by pinned', async () => {
      const { listMemories } = await import('../src/api/memory/service.ts');

      const tag = `test-list-${runId}`;
      await retryOnDeadlock(() => pool.query(
        `INSERT INTO memory (title, content, memory_type, pinned, tags) VALUES
         ('LP1', $1, 'preference', true, ARRAY[$4]),
         ('LP2', $2, 'note', false, ARRAY[$4]),
         ('LP3', $3, 'fact', true, ARRAY[$4])`,
        [`Pinned A ${runId}`, `Regular B ${runId}`, `Pinned C ${runId}`, tag],
      ));

      const pinnedOnly = await retryOnDeadlock(() => listMemories(pool, { pinned: true, tags: [tag] }));
      expect(pinnedOnly.total).toBe(2);
      for (const mem of pinnedOnly.memories) {
        expect(mem.pinned).toBe(true);
      }

      const all = await retryOnDeadlock(() => listMemories(pool, { tags: [tag] }));
      expect(all.total).toBe(3);
    });
  });
});
