/**
 * Skill Store embedding integration with embedding service.
 *
 * This module provides functions to generate and update embeddings
 * for skill_store_item records, with graceful degradation if embedding fails.
 *
 * Part of Epic #794, Issue #799.
 */

import type { Pool } from 'pg';
import { embeddingService } from './service.ts';
import { EmbeddingError } from './errors.ts';
import type { InternalJob, JobProcessorResult } from '../jobs/types.ts';

/** Embedding status for skill store item records. */
export type SkillStoreEmbeddingStatus = 'complete' | 'pending' | 'failed' | 'skipped';

/** Shape of a skill store item row for embedding purposes. */
export interface SkillStoreItemForEmbedding {
  id: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  embedding_status: string;
}

/** Stats returned by getSkillStoreEmbeddingStats. */
export interface SkillStoreEmbeddingStatsResult {
  total: number;
  by_status: {
    complete: number;
    pending: number;
    failed: number;
  };
  provider: string | null;
  model: string | null;
}

/** Result from backfillSkillStoreEmbeddings. */
export interface SkillStoreBackfillResult {
  enqueued: number;
  skipped: number;
}

/**
 * Build embedding text from skill store item fields.
 *
 * Priority: summary (preferred) or content (fallback), with title prepended.
 * This matches the issue spec: "Embedding text derived from: summary (preferred)
 * or content (fallback), with title prepended."
 */
export function buildSkillStoreEmbeddingText(item: { title: string | null; summary: string | null; content: string | null }): string {
  const body_text = item.summary ?? item.content ?? '';
  if (item.title && body_text) {
    return `${item.title}\n\n${body_text}`;
  }
  return item.title ?? body_text;
}

/**
 * Generate and store embedding for a skill store item.
 *
 * Called after item creation/update. Generates an embedding
 * asynchronously and updates the record. If embedding fails, the record
 * is still valid but marked as 'failed' status.
 *
 * @param pool Database pool
 * @param item_id The skill store item ID
 * @param content The content to embed
 * @returns The embedding status
 */
export async function generateSkillStoreItemEmbedding(pool: Pool, item_id: string, content: string): Promise<SkillStoreEmbeddingStatus> {
  // Check if embedding service is configured
  if (!embeddingService.isConfigured()) {
    // Mark as pending — can be backfilled later
    await pool.query(`UPDATE skill_store_item SET embedding_status = 'pending' WHERE id = $1`, [item_id]);
    return 'pending';
  }

  try {
    const result = await embeddingService.embed(content);

    if (!result) {
      await pool.query(`UPDATE skill_store_item SET embedding_status = 'pending' WHERE id = $1`, [item_id]);
      return 'pending';
    }

    // Store embedding in database
    await pool.query(
      `UPDATE skill_store_item
       SET embedding = $1::vector,
           embedding_model = $2,
           embedding_provider = $3,
           embedding_status = 'complete'
       WHERE id = $4`,
      [`[${result.embedding.join(',')}]`, result.model, result.provider, item_id],
    );

    return 'complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Pool-closed errors are expected during shutdown/test teardown
    if (msg.includes('Cannot use a pool after calling end')) {
      return 'failed';
    }
    // Log error but don't fail the request
    console.error(`[Embeddings] Failed to embed skill store item ${item_id}:`, error instanceof EmbeddingError ? error.toSafeString() : msg);

    // Mark as failed (may also fail if pool is closed, ignore that)
    await pool.query(`UPDATE skill_store_item SET embedding_status = 'failed' WHERE id = $1`, [item_id]).catch(() => {});

    return 'failed';
  }
}

/**
 * Enqueue an embedding job for a skill store item.
 *
 * Creates an internal_job entry with kind='skill_store.embed'.
 * Uses idempotency key to prevent duplicate jobs for the same item.
 *
 * @param pool Database pool
 * @param item_id The skill store item ID
 */
export async function enqueueSkillStoreEmbedJob(pool: Pool, item_id: string): Promise<void> {
  const idempotency_key = `skill_store.embed:${item_id}`;

  await pool.query(
    `INSERT INTO internal_job (kind, payload, idempotency_key)
     VALUES ('skill_store.embed', $1::jsonb, $2)
     ON CONFLICT ON CONSTRAINT internal_job_kind_idempotency_uniq DO NOTHING`,
    [JSON.stringify({ item_id: item_id }), idempotency_key],
  );
}

/**
 * Handle a skill_store.embed job.
 *
 * 1. Fetches the item
 * 2. Builds embedding text from title + summary/content
 * 3. Generates and stores embedding
 */
export async function handleSkillStoreEmbedJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const payload = job.payload as { item_id?: string };

  if (!payload.item_id) {
    return {
      success: false,
      error: 'Invalid job payload: missing item_id',
    };
  }

  // Fetch item — handle invalid UUID gracefully
  let result;
  try {
    result = await pool.query(
      `SELECT id::text as id, title, summary, content, embedding_status
       FROM skill_store_item
       WHERE id = $1 AND deleted_at IS NULL`,
      [payload.item_id],
    );
  } catch (error) {
    const err = error as Error;
    // Handle invalid UUID format
    if (err.message.includes('invalid input syntax for type uuid')) {
      return {
        success: false,
        error: `Skill store item ${payload.item_id} not found (invalid ID format)`,
      };
    }
    throw error;
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      error: `Skill store item ${payload.item_id} not found`,
    };
  }

  const item = result.rows[0] as SkillStoreItemForEmbedding;

  // Skip if already in a terminal state
  if (item.embedding_status === 'complete' || item.embedding_status === 'skipped') {
    return { success: true };
  }

  // Build content for embedding
  const text = buildSkillStoreEmbeddingText(item);

  if (!text || text.trim().length === 0) {
    // Nothing to embed — set terminal 'skipped' status to prevent
    // infinite backfill re-enqueue (Issue #830)
    await pool.query(`UPDATE skill_store_item SET embedding_status = 'skipped' WHERE id = $1`, [item.id]);
    return { success: true };
  }

  // Generate embedding
  const status = await generateSkillStoreItemEmbedding(pool, item.id, text);

  // If status is pending (no provider), that's still success
  // Job will be retried later or via backfill
  if (status === 'failed') {
    return {
      success: false,
      error: 'Failed to generate embedding',
    };
  }

  console.log(`[Embeddings] Skill store item ${item.id}: status=${status}`);

  return { success: true };
}

/**
 * Trigger embedding for a skill store item asynchronously (non-blocking).
 * This should be called from item create/update operations.
 *
 * Enqueues an internal_job rather than firing the embedding inline,
 * to avoid N concurrent API calls during bulk operations.
 *
 * @param pool Database pool
 * @param item_id The skill store item ID
 */
export function triggerSkillStoreItemEmbedding(pool: Pool, item_id: string): void {
  // Enqueue async — don't wait for result
  enqueueSkillStoreEmbedJob(pool, item_id).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot use a pool after calling end')) return;
    console.error(`[Embeddings] Failed to enqueue skill store embed job for ${item_id}:`, msg);
  });
}

/**
 * Backfill embeddings for skill store items with pending or failed status.
 *
 * Instead of calling the embedding API directly, this enqueues internal_job
 * entries to be processed by the job processor, avoiding N concurrent API calls.
 *
 * @param pool Database pool
 * @param options Backfill options
 * @returns Number of items enqueued and skipped
 */
export async function backfillSkillStoreEmbeddings(
  pool: Pool,
  options: {
    batch_size?: number;
  } = {},
): Promise<SkillStoreBackfillResult> {
  const { batch_size = 100 } = options;

  // Find items with pending or failed embedding status that have text content
  const result = await pool.query(
    `SELECT id::text as id, title, summary, content
     FROM skill_store_item
     WHERE deleted_at IS NULL
       AND (embedding_status IS NULL OR embedding_status IN ('pending', 'failed'))
     ORDER BY created_at ASC
     LIMIT $1`,
    [batch_size],
  );

  let enqueued = 0;
  let skipped = 0;

  for (const row of result.rows as Array<{ id: string; title: string | null; summary: string | null; content: string | null }>) {
    const text = buildSkillStoreEmbeddingText(row);

    if (!text || text.trim().length === 0) {
      // Set terminal 'skipped' status to prevent infinite re-enqueue (Issue #830)
      await pool.query(`UPDATE skill_store_item SET embedding_status = 'skipped' WHERE id = $1`, [row.id]);
      skipped++;
      continue;
    }

    await enqueueSkillStoreEmbedJob(pool, row.id);
    enqueued++;
  }

  return { enqueued, skipped };
}

/**
 * Get embedding statistics for skill store items.
 *
 * @param pool Database pool
 * @returns Embedding statistics by status
 */
export async function getSkillStoreEmbeddingStats(pool: Pool): Promise<SkillStoreEmbeddingStatsResult> {
  // Get counts by status (excluding soft-deleted items)
  const statusResult = await pool.query(`
    SELECT
      embedding_status,
      COUNT(*) as count
    FROM skill_store_item
    WHERE deleted_at IS NULL
    GROUP BY embedding_status
  `);

  const by_status = {
    complete: 0,
    pending: 0,
    failed: 0,
  };

  let total = 0;
  for (const row of statusResult.rows) {
    const status = row.embedding_status as SkillStoreEmbeddingStatus | null;
    const count = parseInt(row.count, 10);
    total += count;

    if (status === 'complete') {
      by_status.complete = count;
    } else if (status === 'failed') {
      by_status.failed = count;
    } else {
      // null or 'pending'
      by_status.pending += count;
    }
  }

  // Get current provider/model info
  const configSummary = embeddingService.getConfig();

  return {
    total,
    by_status,
    provider: configSummary?.provider ?? null,
    model: configSummary?.model ?? null,
  };
}
