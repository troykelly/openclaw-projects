/**
 * Memory lifecycle integration tests — Issues #2433, #2458, #2464
 * Tests cleanup-expired (soft/hard delete), is_active column, supersession chains,
 * and embedding regeneration on content change.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createMemory, cleanupExpiredMemories, updateMemory, getMemory, supersedeMemory, searchMemories, listMemories } from './service.ts';
import { createTestPool, truncateAllTables } from '../../../tests/helpers/db.ts';

describe('Memory lifecycle', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('cleanup-expired (soft delete by default)', () => {
    it('soft-deletes expired memories by setting is_active=false', async () => {
      const expired = await createMemory(pool, {
        title: 'Expiring',
        content: 'This will expire',
        expires_at: new Date('2020-01-01T00:00:00Z'), // expired
      });

      const count = await cleanupExpiredMemories(pool);
      expect(count).toBe(1);

      // Memory still exists but is inactive
      const mem = await getMemory(pool, expired.id);
      expect(mem).not.toBeNull();
      expect(mem!.is_active).toBe(false);
    });

    it('hard-deletes when hardDelete=true', async () => {
      await createMemory(pool, {
        title: 'Expiring',
        content: 'This will expire',
        expires_at: new Date('2020-01-01T00:00:00Z'),
      });

      const count = await cleanupExpiredMemories(pool, { hardDelete: true });
      expect(count).toBe(1);

      // Memory is actually deleted
      const result = await pool.query('SELECT COUNT(*) as cnt FROM memory');
      expect(parseInt(result.rows[0].cnt, 10)).toBe(0);
    });

    it('does not touch non-expired memories', async () => {
      await createMemory(pool, {
        title: 'Future',
        content: 'Not expired yet',
        expires_at: new Date('2030-01-01T00:00:00Z'),
      });

      const count = await cleanupExpiredMemories(pool);
      expect(count).toBe(0);
    });

    it('does not touch memories with no expiry', async () => {
      await createMemory(pool, {
        title: 'No expiry',
        content: 'Eternal memory',
      });

      const count = await cleanupExpiredMemories(pool);
      expect(count).toBe(0);
    });

    it('respects namespace isolation', async () => {
      await createMemory(pool, {
        title: 'Expiring A',
        content: 'Content A',
        namespace: 'ns-a',
        expires_at: new Date('2020-01-01T00:00:00Z'),
      });

      await createMemory(pool, {
        title: 'Expiring B',
        content: 'Content B',
        namespace: 'ns-b',
        expires_at: new Date('2020-01-01T00:00:00Z'),
      });

      // Cleanup only ns-a
      const count = await cleanupExpiredMemories(pool, { namespaces: ['ns-a'] });
      expect(count).toBe(1);

      // ns-b memory still active
      const result = await pool.query("SELECT is_active FROM memory WHERE namespace = 'ns-b'");
      expect(result.rows[0].is_active).toBe(true);
    });
  });

  describe('is_active column', () => {
    it('new memories have is_active=true', async () => {
      const mem = await createMemory(pool, {
        title: 'Active',
        content: 'Active memory',
      });
      expect(mem.is_active).toBe(true);
    });

    it('superseded memories have is_active=false', async () => {
      const old = await createMemory(pool, {
        title: 'Old',
        content: 'Old content',
      });

      await supersedeMemory(pool, old.id, {
        title: 'New',
        content: 'New content',
      });

      const oldMem = await getMemory(pool, old.id);
      expect(oldMem!.is_active).toBe(false);
    });
  });

  describe('supersession chains (#2433)', () => {
    it('search excludes superseded memories by default', async () => {
      const a = await createMemory(pool, {
        title: 'Memory A',
        content: 'First version of preference',
        memory_type: 'preference',
        namespace: 'test-ns',
      });

      const b = await supersedeMemory(pool, a.id, {
        title: 'Memory B',
        content: 'Second version of preference',
        memory_type: 'preference',
        namespace: 'test-ns',
      });

      // List should only return active memories
      const result = await listMemories(pool, { queryNamespaces: ['test-ns'] });
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].id).toBe(b!.id);
    });

    it('chain A→B→C: search returns only C', async () => {
      const a = await createMemory(pool, {
        title: 'A',
        content: 'Version A',
        namespace: 'test-ns',
      });

      const b = await supersedeMemory(pool, a.id, {
        title: 'B',
        content: 'Version B',
        namespace: 'test-ns',
      });

      const c = await supersedeMemory(pool, b!.id, {
        title: 'C',
        content: 'Version C',
        namespace: 'test-ns',
      });

      const result = await listMemories(pool, { queryNamespaces: ['test-ns'] });
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].id).toBe(c!.id);
    });

    it('include_superseded returns all memories in chain', async () => {
      const a = await createMemory(pool, {
        title: 'A',
        content: 'Version A content for chain test',
        namespace: 'test-ns',
      });

      await supersedeMemory(pool, a.id, {
        title: 'B',
        content: 'Version B content for chain test',
        namespace: 'test-ns',
      });

      const result = await listMemories(pool, {
        queryNamespaces: ['test-ns'],
        include_superseded: true,
      });
      expect(result.memories.length).toBe(2);
    });
  });

  describe('embedding regeneration on content change (#2433)', () => {
    it('sets embedding_status to pending when content changes', async () => {
      const mem = await createMemory(pool, {
        title: 'Test',
        content: 'Original content',
      });

      // Simulate embedding completion
      await pool.query("UPDATE memory SET embedding_status = 'complete' WHERE id = $1", [mem.id]);

      const updated = await updateMemory(pool, mem.id, { content: 'Changed content' });
      expect(updated!.embedding_status).toBe('pending');
    });

    it('does not reset embedding_status for non-content changes', async () => {
      const mem = await createMemory(pool, {
        title: 'Test',
        content: 'Content',
      });

      // Simulate embedding completion
      await pool.query("UPDATE memory SET embedding_status = 'complete' WHERE id = $1", [mem.id]);

      const updated = await updateMemory(pool, mem.id, { importance: 0.9 });
      // Should remain complete (embedding_status not part of RETURNING unless content changed)
      const fetched = await getMemory(pool, updated!.id);
      expect(fetched!.embedding_status).toBe('complete');
    });
  });

  describe('pgcron reaper job (#2464)', () => {
    it('reaper function is registered in cron.job', async () => {
      const result = await pool.query(
        "SELECT jobname, schedule FROM cron.job WHERE jobname = 'internal_memory_reaper_enqueue'",
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].schedule).toBe('0 */6 * * *');
    });

    it('enqueue_expired_memory_reaper creates internal_jobs for expired memories', async () => {
      await createMemory(pool, {
        title: 'Expired',
        content: 'Expired content',
        expires_at: new Date('2020-01-01T00:00:00Z'),
      });

      const result = await pool.query('SELECT enqueue_expired_memory_reaper()');
      expect(result.rows[0].enqueue_expired_memory_reaper).toBe(1);

      // Verify internal_job was created
      const jobs = await pool.query(
        "SELECT kind, payload FROM internal_job WHERE kind = 'memory.reaper.expired'",
      );
      expect(jobs.rows.length).toBe(1);
    });

    it('reaper function is idempotent (does not duplicate jobs)', async () => {
      await createMemory(pool, {
        title: 'Expired',
        content: 'Expired content',
        expires_at: new Date('2020-01-01T00:00:00Z'),
      });

      await pool.query('SELECT enqueue_expired_memory_reaper()');
      await pool.query('SELECT enqueue_expired_memory_reaper()');

      const jobs = await pool.query(
        "SELECT kind FROM internal_job WHERE kind = 'memory.reaper.expired'",
      );
      expect(jobs.rows.length).toBe(1);
    });
  });

  describe('indexes (#2459)', () => {
    it('idx_memory_expires_active exists', async () => {
      const result = await pool.query(
        "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memory_expires_active'",
      );
      expect(result.rows.length).toBe(1);
    });

    it('idx_memory_ns_created_active_embedded exists', async () => {
      const result = await pool.query(
        "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memory_ns_created_active_embedded'",
      );
      expect(result.rows.length).toBe(1);
    });

    it('idx_memory_tags supports @> operator', async () => {
      // Verify GIN index on tags exists
      const result = await pool.query(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_memory_tags'",
      );
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].indexdef).toContain('gin');
    });
  });
});
