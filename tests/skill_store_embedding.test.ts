import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Tests for skill store embedding integration (issue #799).
 *
 * Covers:
 * - generateSkillStoreItemEmbedding: generate and store embedding for a skill store item
 * - handleSkillStoreEmbedJob: job handler for skill_store.embed jobs
 * - backfillSkillStoreEmbeddings: backfill items with pending embedding status
 * - getSkillStoreEmbeddingStats: return pending/complete/failed counts
 * - Embedding text derivation: summary (preferred) or content (fallback), with title prepended
 * - Status tracking: pending → complete or failed
 * - Bulk operations via internal_job entries
 */
describe('Skill Store Embedding Integration (Issue #799)', () => {
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

  // Helper to insert a skill store item and return its ID
  async function insertItem(
    overrides: {
      skill_id?: string;
      title?: string;
      summary?: string;
      content?: string;
      collection?: string;
      key?: string;
      embedding_status?: string;
      tags?: string[];
      status?: string;
    } = {},
  ): Promise<string> {
    const result = await pool.query(
      `INSERT INTO skill_store_item (skill_id, collection, key, title, summary, content, embedding_status, tags, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::skill_store_item_status, 'active'))
       RETURNING id::text as id`,
      [
        overrides.skill_id ?? 'test-skill',
        overrides.collection ?? '_default',
        overrides.key ?? null,
        overrides.title ?? null,
        overrides.summary ?? null,
        overrides.content ?? null,
        overrides.embedding_status ?? 'pending',
        overrides.tags ?? [],
        overrides.status ?? null,
      ],
    );
    return result.rows[0].id;
  }

  describe('generateSkillStoreItemEmbedding', () => {
    it('generates embedding and updates item status', async () => {
      const { generateSkillStoreItemEmbedding } = await import('../src/api/embeddings/skill-store-integration.ts');
      const { embeddingService } = await import('../src/api/embeddings/service.ts');

      const item_id = await insertItem({
        title: 'Test Item',
        summary: 'A test summary',
      });

      const status = await generateSkillStoreItemEmbedding(pool, item_id, 'Test Item\n\nA test summary');

      if (embeddingService.isConfigured()) {
        // If provider is configured, should succeed
        expect(status).toBe('complete');
        const row = await pool.query(
          `SELECT embedding_status, embedding IS NOT NULL as has_embedding
           FROM skill_store_item WHERE id = $1`,
          [item_id],
        );
        expect(row.rows[0].embedding_status).toBe('complete');
        expect(row.rows[0].has_embedding).toBe(true);
      } else {
        // If no provider, mark as pending for backfill
        expect(status).toBe('pending');
        const row = await pool.query(`SELECT embedding_status FROM skill_store_item WHERE id = $1`, [item_id]);
        expect(row.rows[0].embedding_status).toBe('pending');
      }
    });

    it('handles non-existent item IDs without throwing', async () => {
      const { generateSkillStoreItemEmbedding } = await import('../src/api/embeddings/skill-store-integration.ts');

      // Use a valid UUID format but non-existent item
      // The function updates 0 rows but doesn't throw
      const status = await generateSkillStoreItemEmbedding(pool, '00000000-0000-0000-0000-000000000000', 'some content');
      // Should not throw; returns some valid status
      expect(['pending', 'failed', 'complete']).toContain(status);
    });
  });

  describe('buildEmbeddingText', () => {
    it('uses title + summary when summary is available', async () => {
      const { buildSkillStoreEmbeddingText } = await import('../src/api/embeddings/skill-store-integration.ts');

      const text = buildSkillStoreEmbeddingText({
        title: 'My Title',
        summary: 'My Summary',
        content: 'Full content here',
      });
      expect(text).toBe('My Title\n\nMy Summary');
    });

    it('uses title + content when summary is not available', async () => {
      const { buildSkillStoreEmbeddingText } = await import('../src/api/embeddings/skill-store-integration.ts');

      const text = buildSkillStoreEmbeddingText({
        title: 'My Title',
        summary: null,
        content: 'Full content here',
      });
      expect(text).toBe('My Title\n\nFull content here');
    });

    it('uses summary alone when title is not available', async () => {
      const { buildSkillStoreEmbeddingText } = await import('../src/api/embeddings/skill-store-integration.ts');

      const text = buildSkillStoreEmbeddingText({
        title: null,
        summary: 'My Summary',
        content: null,
      });
      expect(text).toBe('My Summary');
    });

    it('uses content alone when both title and summary are missing', async () => {
      const { buildSkillStoreEmbeddingText } = await import('../src/api/embeddings/skill-store-integration.ts');

      const text = buildSkillStoreEmbeddingText({
        title: null,
        summary: null,
        content: 'Just content',
      });
      expect(text).toBe('Just content');
    });

    it('returns empty string when all fields are null', async () => {
      const { buildSkillStoreEmbeddingText } = await import('../src/api/embeddings/skill-store-integration.ts');

      const text = buildSkillStoreEmbeddingText({
        title: null,
        summary: null,
        content: null,
      });
      expect(text).toBe('');
    });
  });

  describe('handleSkillStoreEmbedJob', () => {
    it('returns failure for missing item_id in payload', async () => {
      const { handleSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const result = await handleSkillStoreEmbedJob(pool, {
        id: 'job-1',
        kind: 'skill_store.embed',
        runAt: new Date(),
        payload: {},
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        completed_at: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing item_id');
    });

    it('returns failure for non-existent item', async () => {
      const { handleSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const result = await handleSkillStoreEmbedJob(pool, {
        id: 'job-2',
        kind: 'skill_store.embed',
        runAt: new Date(),
        payload: { item_id: '00000000-0000-0000-0000-000000000000' },
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        completed_at: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('skips items already marked as complete', async () => {
      const { handleSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const item_id = await insertItem({
        title: 'Already embedded',
        summary: 'Already has embedding',
        embedding_status: 'complete',
      });

      const result = await handleSkillStoreEmbedJob(pool, {
        id: 'job-3',
        kind: 'skill_store.embed',
        runAt: new Date(),
        payload: { item_id: item_id },
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        completed_at: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(result.success).toBe(true);
    });

    it('processes a valid item and sets embedding status', async () => {
      const { handleSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const item_id = await insertItem({
        title: 'Test Item',
        summary: 'Test summary for embedding',
        embedding_status: 'pending',
      });

      const result = await handleSkillStoreEmbedJob(pool, {
        id: 'job-4',
        kind: 'skill_store.embed',
        runAt: new Date(),
        payload: { item_id: item_id },
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        completed_at: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // With no embedding service configured, it should succeed
      // but leave status as pending
      expect(result.success).toBe(true);
    });

    it('handles invalid UUID format gracefully', async () => {
      const { handleSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const result = await handleSkillStoreEmbedJob(pool, {
        id: 'job-5',
        kind: 'skill_store.embed',
        runAt: new Date(),
        payload: { item_id: 'not-a-uuid' },
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        completed_at: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('enqueueSkillStoreEmbedJob', () => {
    it('creates an internal_job entry with correct kind', async () => {
      const { enqueueSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const item_id = await insertItem({
        title: 'Enqueue test',
        summary: 'Test item for enqueue',
      });

      await enqueueSkillStoreEmbedJob(pool, item_id);

      const jobs = await pool.query(
        `SELECT kind, payload FROM internal_job
         WHERE kind = 'skill_store.embed'`,
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].kind).toBe('skill_store.embed');
      expect((jobs.rows[0].payload as Record<string, unknown>).item_id).toBe(item_id);
    });

    it('uses idempotency key to prevent duplicate jobs', async () => {
      const { enqueueSkillStoreEmbedJob } = await import('../src/api/embeddings/skill-store-integration.ts');

      const item_id = await insertItem({
        title: 'Dedup test',
        summary: 'Test deduplication',
      });

      // Enqueue twice with the same item
      await enqueueSkillStoreEmbedJob(pool, item_id);
      await enqueueSkillStoreEmbedJob(pool, item_id);

      const jobs = await pool.query(
        `SELECT count(*) FROM internal_job
         WHERE kind = 'skill_store.embed'
         AND payload->>'item_id' = $1`,
        [item_id],
      );
      // Should only have 1 job due to idempotency
      expect(parseInt(jobs.rows[0].count, 10)).toBe(1);
    });
  });

  describe('getSkillStoreEmbeddingStats', () => {
    it('returns correct counts by status', async () => {
      const { getSkillStoreEmbeddingStats } = await import('../src/api/embeddings/skill-store-integration.ts');

      // Insert items with different statuses
      await insertItem({ title: 'Complete 1', embedding_status: 'complete' });
      await insertItem({ title: 'Complete 2', embedding_status: 'complete' });
      await insertItem({ title: 'Pending 1', embedding_status: 'pending' });
      await insertItem({ title: 'Failed 1', embedding_status: 'failed' });

      const stats = await getSkillStoreEmbeddingStats(pool);

      expect(stats.total).toBe(4);
      expect(stats.by_status.complete).toBe(2);
      expect(stats.by_status.pending).toBe(1);
      expect(stats.by_status.failed).toBe(1);
    });

    it('excludes soft-deleted items', async () => {
      const { getSkillStoreEmbeddingStats } = await import('../src/api/embeddings/skill-store-integration.ts');

      await insertItem({ title: 'Active', embedding_status: 'complete' });

      const deletedId = await insertItem({ title: 'Deleted', embedding_status: 'complete' });
      await pool.query(`UPDATE skill_store_item SET deleted_at = now() WHERE id = $1`, [deletedId]);

      const stats = await getSkillStoreEmbeddingStats(pool);
      expect(stats.total).toBe(1);
      expect(stats.by_status.complete).toBe(1);
    });

    it('returns provider info', async () => {
      const { getSkillStoreEmbeddingStats } = await import('../src/api/embeddings/skill-store-integration.ts');

      const stats = await getSkillStoreEmbeddingStats(pool);
      // Provider may or may not be configured in test env
      expect(stats).toHaveProperty('provider');
      expect(stats).toHaveProperty('model');
    });
  });

  describe('backfillSkillStoreEmbeddings', () => {
    it('enqueues jobs for items with pending status', async () => {
      const { backfillSkillStoreEmbeddings } = await import('../src/api/embeddings/skill-store-integration.ts');

      await insertItem({ title: 'Pending 1', summary: 'Need embedding', embedding_status: 'pending' });
      await insertItem({ title: 'Pending 2', content: 'Also need embedding', embedding_status: 'pending' });
      await insertItem({ title: 'Complete', summary: 'Already done', embedding_status: 'complete' });

      const result = await backfillSkillStoreEmbeddings(pool, { batch_size: 100 });

      expect(result.enqueued).toBe(2);

      // Verify internal_job entries were created
      const jobs = await pool.query(`SELECT count(*) FROM internal_job WHERE kind = 'skill_store.embed'`);
      expect(parseInt(jobs.rows[0].count, 10)).toBe(2);
    });

    it('also enqueues jobs for failed items', async () => {
      const { backfillSkillStoreEmbeddings } = await import('../src/api/embeddings/skill-store-integration.ts');

      await insertItem({ title: 'Failed 1', summary: 'Retry me', embedding_status: 'failed' });

      const result = await backfillSkillStoreEmbeddings(pool, { batch_size: 100 });

      expect(result.enqueued).toBe(1);
    });

    it('skips items without any text content', async () => {
      const { backfillSkillStoreEmbeddings } = await import('../src/api/embeddings/skill-store-integration.ts');

      // Item with no title, summary, or content
      await insertItem({ embedding_status: 'pending' });

      const result = await backfillSkillStoreEmbeddings(pool, { batch_size: 100 });

      expect(result.enqueued).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('respects batch_size limit', async () => {
      const { backfillSkillStoreEmbeddings } = await import('../src/api/embeddings/skill-store-integration.ts');

      for (let i = 0; i < 5; i++) {
        await insertItem({ title: `Item ${i}`, summary: `Summary ${i}`, embedding_status: 'pending' });
      }

      const result = await backfillSkillStoreEmbeddings(pool, { batch_size: 3 });

      expect(result.enqueued).toBe(3);
    });

    it('excludes soft-deleted items', async () => {
      const { backfillSkillStoreEmbeddings } = await import('../src/api/embeddings/skill-store-integration.ts');

      const id = await insertItem({ title: 'Deleted Item', summary: 'Will be deleted', embedding_status: 'pending' });
      await pool.query(`UPDATE skill_store_item SET deleted_at = now() WHERE id = $1`, [id]);

      await insertItem({ title: 'Active Item', summary: 'Still here', embedding_status: 'pending' });

      const result = await backfillSkillStoreEmbeddings(pool, { batch_size: 100 });

      expect(result.enqueued).toBe(1);
    });
  });
});
