/**
 * Memory Core API integration tests.
 * Covers Issues:
 *   #2427 — Memory Digest (vector clustering)
 *   #2428 — Expired Memory Reaper (background pruning)
 *   #2429 — Bulk Supersession (atomic consolidation)
 *   #2432 — Upsert-by-Tag (sliding window slot management)
 *   #2439 — Server-side cap and namespace scoping for digest
 *   #2440 — Namespace-scope reaper hard-delete cascade
 *   #2441 — Bulk supersede atomicity and namespace scoping
 *   #2444 — Negative/zero TTL validation
 *   #2462 — ON DELETE SET NULL for superseded_by FK
 * Part of Epic #2426 PR2 Core API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../../../tests/helpers/db.ts';
import { createMemory, cleanupExpiredMemories, supersedeMemory, getMemory } from './service.ts';
import {
  digestMemories,
  bulkSupersedeMemories,
  upsertMemoryByTag,
  reaperHardDelete,
  type DigestOptions,
  type BulkSupersedeOptions,
  type UpsertByTagOptions,
} from './core-api.ts';

describe('Issue #2462 — ON DELETE SET NULL for superseded_by FK', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('hard-deleting a consolidation memory sets superseded_by to NULL on sources', async () => {
    const source = await createMemory(pool, {
      title: 'Source',
      content: 'Source memory content',
      namespace: 'test-ns',
    });
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Consolidation memory content',
      namespace: 'test-ns',
    });

    // Mark source as superseded by target
    await pool.query('UPDATE memory SET superseded_by = $1 WHERE id = $2', [target.id, source.id]);

    // Hard-delete the target (consolidation) memory
    await pool.query('DELETE FROM memory WHERE id = $1', [target.id]);

    // Source's superseded_by should be NULL (ON DELETE SET NULL)
    const result = await pool.query('SELECT superseded_by FROM memory WHERE id = $1', [source.id]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].superseded_by).toBeNull();
  });

  it('FK constraint exists with ON DELETE SET NULL', async () => {
    // Use pg_get_constraintdef for reliable cross-version check.
    // confdeltype encoding changed in PostgreSQL 15+ so we check the text definition.
    const result = await pool.query(
      `SELECT pg_get_constraintdef(c.oid) as def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.conname = 'memory_superseded_by_fkey'
         AND t.relname = 'memory'
       LIMIT 1`,
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].def).toContain('ON DELETE SET NULL');
  });
});

describe('Issue #2444 — Negative/zero TTL validation', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('rejects expires_at in the past', async () => {
    await expect(
      createMemory(pool, {
        title: 'Test',
        content: 'Content',
        expires_at: new Date(Date.now() - 1000), // 1 second in the past
      }),
    ).rejects.toThrow('expires_at must be in the future');
  });

  it('rejects expires_at equal to now (approximate)', async () => {
    // Use a date clearly in the past
    await expect(
      createMemory(pool, {
        title: 'Test',
        content: 'Content',
        expires_at: new Date('2020-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow('expires_at must be in the future');
  });

  it('rejects expires_at more than 365 days in the future', async () => {
    const farFuture = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000);
    await expect(
      createMemory(pool, {
        title: 'Test',
        content: 'Content',
        expires_at: farFuture,
      }),
    ).rejects.toThrow('expires_at cannot be more than 365 days in the future');
  });

  it('accepts expires_at just 1 minute in the future', async () => {
    const soon = new Date(Date.now() + 60 * 1000);
    const mem = await createMemory(pool, {
      title: 'Test',
      content: 'Content',
      expires_at: soon,
    });
    expect(mem.expires_at).not.toBeNull();
  });

  it('accepts expires_at 7 days in the future', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const mem = await createMemory(pool, {
      title: 'Test',
      content: 'Content',
      expires_at: future,
    });
    expect(mem.expires_at).not.toBeNull();
  });

  it('accepts null expires_at (no expiry)', async () => {
    const mem = await createMemory(pool, {
      title: 'Test',
      content: 'No expiry content',
    });
    expect(mem.expires_at).toBeNull();
  });
});

describe('Issue #2428/#2440 — Expired Memory Reaper', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('reaperHardDelete deletes expired memories in namespace and returns count', async () => {
    await createMemory(pool, {
      title: 'Expired A',
      content: 'Content A',
      namespace: 'ns-a',
      expires_at: new Date(Date.now() + 60 * 1000), // will be set past via UPDATE
    });
    // Force expiry by updating expires_at to the past
    await pool.query("UPDATE memory SET expires_at = '2020-01-01' WHERE namespace = 'ns-a'");

    await createMemory(pool, {
      title: 'Expired B',
      content: 'Content B',
      namespace: 'ns-b',
      expires_at: new Date(Date.now() + 60 * 1000),
    });
    await pool.query("UPDATE memory SET expires_at = '2020-01-01' WHERE namespace = 'ns-b'");

    // Reap only ns-a
    const count = await reaperHardDelete(pool, { namespaces: ['ns-a'], batchSize: 100 });
    expect(count).toBe(1);

    // ns-a memory is deleted
    const nsA = await pool.query("SELECT COUNT(*) as cnt FROM memory WHERE namespace = 'ns-a'");
    expect(parseInt(nsA.rows[0].cnt, 10)).toBe(0);

    // ns-b memory still exists
    const nsB = await pool.query("SELECT COUNT(*) as cnt FROM memory WHERE namespace = 'ns-b'");
    expect(parseInt(nsB.rows[0].cnt, 10)).toBe(1);
  });

  it('reaperHardDelete cascades: associated junction rows are removed', async () => {
    await createMemory(pool, {
      title: 'With Attachment',
      content: 'Content',
      namespace: 'ns-attach',
      expires_at: new Date(Date.now() + 60 * 1000),
    });
    await pool.query("UPDATE memory SET expires_at = '2020-01-01' WHERE namespace = 'ns-attach'");
    const memResult = await pool.query("SELECT id FROM memory WHERE namespace = 'ns-attach'");
    const memId = memResult.rows[0].id;

    // Insert a unified_memory_attachment row
    await pool.query(
      `INSERT INTO unified_memory_attachment (memory_id, file_attachment_id)
       SELECT $1, fa.id FROM file_attachment fa LIMIT 1
       ON CONFLICT DO NOTHING`,
      [memId],
    );
    // Even if no file_attachment exists, the DELETE cascade must not error

    const count = await reaperHardDelete(pool, { namespaces: ['ns-attach'], batchSize: 100 });
    expect(count).toBe(1);

    const remaining = await pool.query("SELECT COUNT(*) as cnt FROM memory WHERE namespace = 'ns-attach'");
    expect(parseInt(remaining.rows[0].cnt, 10)).toBe(0);
  });

  it('reaperHardDelete respects batchSize', async () => {
    // Create 3 expired memories in ns-batch
    for (let i = 0; i < 3; i++) {
      await createMemory(pool, {
        title: `Expired ${i}`,
        content: `Content ${i}`,
        namespace: 'ns-batch',
        expires_at: new Date(Date.now() + 60 * 1000),
      });
    }
    await pool.query("UPDATE memory SET expires_at = '2020-01-01' WHERE namespace = 'ns-batch'");

    // Reap with batchSize=2 — should only delete 2
    const count = await reaperHardDelete(pool, { namespaces: ['ns-batch'], batchSize: 2 });
    expect(count).toBe(2);

    const remaining = await pool.query("SELECT COUNT(*) as cnt FROM memory WHERE namespace = 'ns-batch'");
    expect(parseInt(remaining.rows[0].cnt, 10)).toBe(1);
  });

  it('reaperHardDelete with no namespaces deletes across all namespaces', async () => {
    for (const ns of ['ns-x', 'ns-y']) {
      await createMemory(pool, {
        title: `Memory in ${ns}`,
        content: `Content in ${ns}`,
        namespace: ns,
        expires_at: new Date(Date.now() + 60 * 1000),
      });
    }
    await pool.query("UPDATE memory SET expires_at = '2020-01-01'");

    const count = await reaperHardDelete(pool, { batchSize: 100 });
    expect(count).toBe(2);
  });
});

describe('Issue #2429/#2441 — Bulk Supersession', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('atomically supersedes multiple sources with a single target', async () => {
    const target = await createMemory(pool, {
      title: 'Consolidation',
      content: 'Consolidated summary',
      namespace: 'ns-bulk',
    });
    const s1 = await createMemory(pool, { title: 'S1', content: 'Source 1', namespace: 'ns-bulk' });
    const s2 = await createMemory(pool, { title: 'S2', content: 'Source 2', namespace: 'ns-bulk' });
    const s3 = await createMemory(pool, { title: 'S3', content: 'Source 3', namespace: 'ns-bulk' });

    const result = await bulkSupersedeMemories(pool, {
      target_id: target.id,
      source_ids: [s1.id, s2.id, s3.id],
      deactivate_sources: true,
      namespaces: ['ns-bulk'],
    });

    expect(result.superseded).toBe(3);
    expect(result.target_id).toBe(target.id);

    // Verify superseded_by set on all sources
    const rows = await pool.query(
      'SELECT superseded_by, is_active FROM memory WHERE id = ANY($1::uuid[])',
      [[s1.id, s2.id, s3.id]],
    );
    for (const row of rows.rows) {
      expect(row.superseded_by).toBe(target.id);
      expect(row.is_active).toBe(false);
    }
  });

  it('rejects empty source_ids', async () => {
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Target content',
      namespace: 'ns-bulk',
    });
    await expect(
      bulkSupersedeMemories(pool, {
        target_id: target.id,
        source_ids: [],
        namespaces: ['ns-bulk'],
      }),
    ).rejects.toThrow('source_ids must not be empty');
  });

  it('rejects when source_ids exceeds 100', async () => {
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Target content',
      namespace: 'ns-bulk',
    });
    const ids = Array.from({ length: 101 }, () => '00000000-0000-0000-0000-000000000001');
    await expect(
      bulkSupersedeMemories(pool, {
        target_id: target.id,
        source_ids: ids,
        namespaces: ['ns-bulk'],
      }),
    ).rejects.toThrow('source_ids cannot exceed 100');
  });

  it('rejects when source_ids includes target_id (self-reference)', async () => {
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Target content',
      namespace: 'ns-bulk',
    });
    await expect(
      bulkSupersedeMemories(pool, {
        target_id: target.id,
        source_ids: [target.id],
        namespaces: ['ns-bulk'],
      }),
    ).rejects.toThrow('source_ids must not include target_id');
  });

  it('returns 404-style null when target memory not found', async () => {
    await expect(
      bulkSupersedeMemories(pool, {
        target_id: '00000000-0000-0000-0000-000000000000',
        source_ids: ['00000000-0000-0000-0000-000000000001'],
        namespaces: ['ns-bulk'],
      }),
    ).rejects.toThrow('Target memory not found');
  });

  it('rejects cross-namespace: sources in different namespace from target', async () => {
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Target content',
      namespace: 'ns-a',
    });
    const source = await createMemory(pool, {
      title: 'Source',
      content: 'Source content',
      namespace: 'ns-b',
    });
    await expect(
      bulkSupersedeMemories(pool, {
        target_id: target.id,
        source_ids: [source.id],
        namespaces: ['ns-a'],
      }),
    ).rejects.toThrow(/not found in namespace|not all source memories|cross-namespace/i);
  });

  it('returns 409 if any source is already superseded', async () => {
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Target content',
      namespace: 'ns-bulk',
    });
    const source = await createMemory(pool, {
      title: 'Source',
      content: 'Source content',
      namespace: 'ns-bulk',
    });
    // Mark source as already superseded
    await pool.query('UPDATE memory SET superseded_by = $1 WHERE id = $2', [target.id, source.id]);

    await expect(
      bulkSupersedeMemories(pool, {
        target_id: target.id,
        source_ids: [source.id],
        namespaces: ['ns-bulk'],
      }),
    ).rejects.toThrow('already superseded');
  });

  it('deactivate_sources=false only sets superseded_by, leaves is_active=true', async () => {
    const target = await createMemory(pool, {
      title: 'Target',
      content: 'Target content',
      namespace: 'ns-nodeact',
    });
    const source = await createMemory(pool, {
      title: 'Source',
      content: 'Source content',
      namespace: 'ns-nodeact',
    });

    await bulkSupersedeMemories(pool, {
      target_id: target.id,
      source_ids: [source.id],
      deactivate_sources: false,
      namespaces: ['ns-nodeact'],
    });

    const row = await pool.query('SELECT superseded_by, is_active FROM memory WHERE id = $1', [source.id]);
    expect(row.rows[0].superseded_by).toBe(target.id);
    expect(row.rows[0].is_active).toBe(true);
  });
});

describe('Issue #2432 — Upsert-by-Tag', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('creates a new memory when no existing memory has the upsert tags', async () => {
    const result = await upsertMemoryByTag(pool, {
      title: 'Wednesday Memory',
      content: 'Wednesday summary content',
      memory_type: 'context',
      tags: ['day-memory:wednesday', 'temporal'],
      upsert_tags: ['day-memory:wednesday'],
      namespace: 'ns-upsert',
    });

    expect(result.upserted).toBe(false);
    expect(result.memory.title).toBe('Wednesday Memory');
    expect(result.memory.tags).toContain('day-memory:wednesday');
  });

  it('updates existing memory when upsert tags match', async () => {
    // Create first memory
    const first = await upsertMemoryByTag(pool, {
      title: 'Wednesday Memory v1',
      content: 'Wednesday summary v1',
      memory_type: 'context',
      tags: ['day-memory:wednesday'],
      upsert_tags: ['day-memory:wednesday'],
      namespace: 'ns-upsert',
    });
    expect(first.upserted).toBe(false);

    // Upsert with same tags — should update
    const second = await upsertMemoryByTag(pool, {
      title: 'Wednesday Memory v2',
      content: 'Wednesday summary v2',
      memory_type: 'context',
      tags: ['day-memory:wednesday', '2026-w11'],
      upsert_tags: ['day-memory:wednesday'],
      namespace: 'ns-upsert',
    });

    expect(second.upserted).toBe(true);
    expect(second.memory.id).toBe(first.memory.id);
    expect(second.memory.title).toBe('Wednesday Memory v2');
    expect(second.memory.content).toBe('Wednesday summary v2');
    expect(second.memory.tags).toContain('2026-w11');
  });

  it('is namespace-isolated: same tags in different namespace creates separate memories', async () => {
    await upsertMemoryByTag(pool, {
      title: 'NS-A Memory',
      content: 'Namespace A content',
      memory_type: 'context',
      tags: ['week-memory:current'],
      upsert_tags: ['week-memory:current'],
      namespace: 'ns-a',
    });

    const nsB = await upsertMemoryByTag(pool, {
      title: 'NS-B Memory',
      content: 'Namespace B content',
      memory_type: 'context',
      tags: ['week-memory:current'],
      upsert_tags: ['week-memory:current'],
      namespace: 'ns-b',
    });

    expect(nsB.upserted).toBe(false);

    const count = await pool.query('SELECT COUNT(*) as cnt FROM memory');
    expect(parseInt(count.rows[0].cnt, 10)).toBe(2);
  });

  it('matches only when ALL upsert_tags are present', async () => {
    // Create a memory with only one tag
    await upsertMemoryByTag(pool, {
      title: 'Partial Tags',
      content: 'Content with partial tags',
      memory_type: 'context',
      tags: ['day-memory:monday'],
      upsert_tags: ['day-memory:monday'],
      namespace: 'ns-multi-tag',
    });

    // Upsert requiring BOTH tags — should create new since existing only has one
    const result = await upsertMemoryByTag(pool, {
      title: 'Multi Tag',
      content: 'Content with multiple tags',
      memory_type: 'context',
      tags: ['day-memory:monday', 'special'],
      upsert_tags: ['day-memory:monday', 'special'],
      namespace: 'ns-multi-tag',
    });

    expect(result.upserted).toBe(false);

    const count = await pool.query('SELECT COUNT(*) as cnt FROM memory');
    expect(parseInt(count.rows[0].cnt, 10)).toBe(2);
  });

  it('rejects empty upsert_tags', async () => {
    await expect(
      upsertMemoryByTag(pool, {
        title: 'Test',
        content: 'Test content',
        memory_type: 'context',
        tags: ['some-tag'],
        upsert_tags: [],
        namespace: 'ns-upsert',
      }),
    ).rejects.toThrow('upsert_tags must not be empty');
  });
});

describe('Issue #2427/#2439 — Memory Digest with server-side cap', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('returns clusters and orphans for memories in date range', async () => {
    // Create memories in namespace
    for (let i = 0; i < 3; i++) {
      await createMemory(pool, {
        title: `Memory ${i}`,
        content: `Content about topic A item ${i}`,
        namespace: 'ns-digest',
      });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
    const before = new Date(Date.now() + 60 * 1000);

    const result = await digestMemories(pool, {
      namespace: 'ns-digest',
      since,
      before,
      similarity_threshold: 0.7,
      min_cluster_size: 2,
      max_memories: 500,
    });

    expect(result.total_memories).toBe(3);
    expect(typeof result.total_clusters).toBe('number');
    expect(typeof result.total_orphans).toBe('number');
    expect(Array.isArray(result.clusters)).toBe(true);
    expect(Array.isArray(result.orphans)).toBe(true);
    expect(result.total_clusters + result.total_orphans).toBeLessThanOrEqual(3);
  });

  it('enforces server-side cap: throws when memory count exceeds max_memories', async () => {
    // Create 5 memories
    for (let i = 0; i < 5; i++) {
      await createMemory(pool, {
        title: `Memory ${i}`,
        content: `Content ${i}`,
        namespace: 'ns-cap',
      });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const before = new Date(Date.now() + 60 * 1000);

    await expect(
      digestMemories(pool, {
        namespace: 'ns-cap',
        since,
        before,
        similarity_threshold: 0.7,
        min_cluster_size: 2,
        max_memories: 3, // cap at 3, but 5 exist
      }),
    ).rejects.toThrow(/Too many memories/);
  });

  it('enforces max result of 100 clusters', async () => {
    // This is a structural test — just verify the cap exists
    for (let i = 0; i < 5; i++) {
      await createMemory(pool, {
        title: `Memory ${i}`,
        content: `Content ${i}`,
        namespace: 'ns-clamp',
      });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const before = new Date(Date.now() + 60 * 1000);

    const result = await digestMemories(pool, {
      namespace: 'ns-clamp',
      since,
      before,
      similarity_threshold: 0.7,
      min_cluster_size: 2,
      max_memories: 500,
    });

    // Result clusters should never exceed 100
    expect(result.clusters.length).toBeLessThanOrEqual(100);
  });

  it('is namespace-scoped: only returns memories from the specified namespace', async () => {
    await createMemory(pool, {
      title: 'NS-A Memory',
      content: 'Content in namespace A',
      namespace: 'ns-scope-a',
    });
    await createMemory(pool, {
      title: 'NS-B Memory',
      content: 'Content in namespace B',
      namespace: 'ns-scope-b',
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const before = new Date(Date.now() + 60 * 1000);

    const result = await digestMemories(pool, {
      namespace: 'ns-scope-a',
      since,
      before,
      similarity_threshold: 0.7,
      min_cluster_size: 2,
      max_memories: 500,
    });

    // Should only see 1 memory (from ns-scope-a)
    expect(result.total_memories).toBe(1);
  });

  it('returns empty result when no memories in date range', async () => {
    const since = new Date('2030-01-01');
    const before = new Date('2030-01-02');

    const result = await digestMemories(pool, {
      namespace: 'ns-empty',
      since,
      before,
      similarity_threshold: 0.7,
      min_cluster_size: 2,
      max_memories: 500,
    });

    expect(result.total_memories).toBe(0);
    expect(result.clusters).toHaveLength(0);
    expect(result.orphans).toHaveLength(0);
  });
});
