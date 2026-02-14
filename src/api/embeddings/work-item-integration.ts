/**
 * Work item embedding integration.
 *
 * Provides functions to generate, store, search, and backfill embeddings
 * for work_item records. Follows the same pattern as memory-integration.ts.
 *
 * Part of Issue #1216.
 */

import type { Pool } from 'pg';
import { embeddingService } from './service.ts';
import { EmbeddingError } from './errors.ts';

/** Embedding status for work item records. */
export type WorkItemEmbeddingStatus = 'complete' | 'pending' | 'failed' | 'skipped';

/**
 * Generate and store embedding for a work item.
 *
 * Called after work item creation or title/description update.
 * If embedding fails, the record is still valid but marked accordingly.
 *
 * @param pool Database pool
 * @param workItemId The work item ID
 * @param content The content to embed (title + description concatenated)
 * @returns The embedding status
 */
export async function generateWorkItemEmbedding(
  pool: Pool,
  workItemId: string,
  content: string,
): Promise<WorkItemEmbeddingStatus> {
  if (!embeddingService.isConfigured()) {
    await pool.query(`UPDATE work_item SET embedding_status = 'pending' WHERE id = $1`, [workItemId]);
    return 'pending';
  }

  // Skip embedding for very short content (single-word titles with no description)
  const trimmed = content.trim();
  if (trimmed.length < 3) {
    await pool.query(`UPDATE work_item SET embedding_status = 'skipped' WHERE id = $1`, [workItemId]);
    return 'skipped';
  }

  try {
    const result = await embeddingService.embed(trimmed);

    if (!result) {
      await pool.query(`UPDATE work_item SET embedding_status = 'pending' WHERE id = $1`, [workItemId]);
      return 'pending';
    }

    await pool.query(
      `UPDATE work_item
       SET embedding = $1::vector,
           embedding_model = $2,
           embedding_provider = $3,
           embedding_status = 'complete',
           updated_at = NOW()
       WHERE id = $4`,
      [`[${result.embedding.join(',')}]`, result.model, result.provider, workItemId],
    );

    return 'complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Cannot use a pool after calling end')) {
      return 'failed';
    }
    console.error(
      `[Embeddings] Failed to embed work item ${workItemId}:`,
      error instanceof EmbeddingError ? error.toSafeString() : msg,
    );

    await pool.query(`UPDATE work_item SET embedding_status = 'failed' WHERE id = $1`, [workItemId]).catch(() => {});

    return 'failed';
  }
}

/**
 * Backfill embeddings for work items that don't have them.
 *
 * @param pool Database pool
 * @param options Backfill options
 * @returns Number of records processed
 */
export async function backfillWorkItemEmbeddings(
  pool: Pool,
  options: {
    batchSize?: number;
    force?: boolean;
  } = {},
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const { batchSize = 100, force = false } = options;

  if (!embeddingService.isConfigured()) {
    throw new Error('No embedding provider configured');
  }

  const condition = force ? '1=1' : "(embedding_status IS NULL OR embedding_status NOT IN ('complete', 'skipped'))";

  const result = await pool.query(
    `SELECT id::text as id, title, description
     FROM work_item
     WHERE ${condition} AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize],
  );

  let succeeded = 0;
  let failed = 0;

  for (const row of result.rows as Array<{ id: string; title: string; description: string | null }>) {
    const content = row.description ? `${row.title}\n\n${row.description}` : row.title;
    const status = await generateWorkItemEmbedding(pool, row.id, content);

    if (status === 'complete' || status === 'skipped') {
      succeeded++;
    } else {
      failed++;
    }
  }

  return {
    processed: result.rows.length,
    succeeded,
    failed,
  };
}
