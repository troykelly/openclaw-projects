/**
 * Dev session embedding worker.
 * Issue #1987 — Dev session semantic search with embeddings.
 *
 * Polls dev_session rows with embedding_status = 'pending',
 * generates embeddings from combined text fields, and writes
 * vectors back to the database.
 */

import type { Pool } from 'pg';

export const DEV_SESSION_EMBEDDING_BATCH_SIZE = 20;
const EXPECTED_DIMENSIONS = 1024;

interface DevSessionRow {
  id: string;
  task_summary: string | null;
  task_prompt: string | null;
  completion_summary: string | null;
  session_name: string;
}

/**
 * Build the text to embed from a dev session's fields.
 * Combines task_summary, task_prompt, and completion_summary with labels.
 */
export function buildEmbeddingText(row: DevSessionRow): string | null {
  const parts: string[] = [];

  if (row.session_name) {
    parts.push(`Session: ${row.session_name}`);
  }
  if (row.task_summary) {
    parts.push(`Summary: ${row.task_summary}`);
  }
  if (row.task_prompt) {
    parts.push(`Prompt: ${row.task_prompt}`);
  }
  if (row.completion_summary) {
    parts.push(`Completion: ${row.completion_summary}`);
  }

  const text = parts.join('\n\n');
  return text.trim().length > 0 ? text : null;
}

/**
 * Validate that an embedding vector has the expected dimensions and finite values.
 */
function isValidEmbedding(embedding: number[]): boolean {
  if (!Array.isArray(embedding) || embedding.length !== EXPECTED_DIMENSIONS) {
    return false;
  }
  return embedding.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Process dev sessions that need embeddings.
 *
 * @returns Number of sessions successfully processed.
 */
export async function processDevSessionEmbeddings(
  pool: Pool,
  batchSize: number = DEV_SESSION_EMBEDDING_BATCH_SIZE,
): Promise<number> {
  const result = await pool.query(
    `SELECT id, session_name, task_summary, task_prompt, completion_summary
     FROM dev_session
     WHERE embedding_status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize],
  );

  if (result.rows.length === 0) return 0;

  const { createEmbeddingService } = await import('../api/embeddings/service.ts');
  const embeddingService = createEmbeddingService();

  if (!embeddingService.isConfigured()) {
    return 0;
  }

  let processed = 0;

  for (const row of result.rows as DevSessionRow[]) {
    const text = buildEmbeddingText(row);

    if (!text) {
      // No embeddable text — mark as skipped
      await pool.query(
        `UPDATE dev_session SET embedding_status = 'skipped' WHERE id = $1`,
        [row.id],
      );
      processed++;
      continue;
    }

    try {
      const embResult = await embeddingService.embed(text);

      if (embResult && isValidEmbedding(embResult.embedding)) {
        await pool.query(
          `UPDATE dev_session
           SET embedding = $1::vector,
               embedding_status = 'complete'
           WHERE id = $2`,
          [JSON.stringify(embResult.embedding), row.id],
        );
      } else {
        await pool.query(
          `UPDATE dev_session SET embedding_status = 'failed' WHERE id = $1`,
          [row.id],
        );
      }
      processed++;
    } catch (err) {
      console.error(
        `[dev-session-embeddings] Failed to embed session ${row.id}:`,
        (err as Error).message,
      );
      try {
        await pool.query(
          `UPDATE dev_session SET embedding_status = 'failed' WHERE id = $1`,
          [row.id],
        );
      } catch {
        // Best-effort; will retry on next tick
      }
      continue;
    }
  }

  return processed;
}
