/**
 * Terminal entry embedding worker.
 * Issue #1861 — Terminal entry embedding pipeline.
 *
 * Polls terminal_session_entry rows that have no embedding yet,
 * generates embeddings via the embedding service, and writes vectors
 * back to the database.
 *
 * Respects per-session flags:
 *   - embed_commands: embed 'command' + 'output' + 'annotation' entries
 *   - embed_scrollback: also embed 'scrollback' entries
 */

import type { Pool } from 'pg';

export const TERMINAL_EMBEDDING_BATCH_SIZE = 50;

interface EntryRow {
  id: string;
  session_id: string;
  kind: string;
  content: string;
  embed_commands: boolean;
  embed_scrollback: boolean;
}

/**
 * Process un-embedded terminal session entries.
 *
 * @returns Number of entries successfully processed (embedded or skipped).
 */
export async function processTerminalEmbeddings(
  pool: Pool,
  batchSize: number = TERMINAL_EMBEDDING_BATCH_SIZE,
): Promise<number> {
  // Fetch entries that need embedding, joining with terminal_session for flags
  const result = await pool.query(
    `SELECT e.id, e.session_id, e.kind, e.content,
            s.embed_commands, s.embed_scrollback
     FROM terminal_session_entry e
     JOIN terminal_session s ON e.session_id = s.id
     WHERE e.embedded_at IS NULL
     ORDER BY e.captured_at ASC
     LIMIT $1`,
    [batchSize],
  );

  if (result.rows.length === 0) return 0;

  // Dynamic import to avoid hard dependency at module level
  const { createEmbeddingService } = await import('../api/embeddings/service.ts');
  const embeddingService = createEmbeddingService();

  if (!embeddingService.isConfigured()) {
    return 0;
  }

  let processed = 0;

  for (const row of result.rows as EntryRow[]) {
    const shouldEmbed = shouldEmbedEntry(row);

    if (!shouldEmbed) {
      // Mark as skipped — set embedded_at but leave embedding NULL
      await pool.query(
        `UPDATE terminal_session_entry
         SET embedded_at = now()
         WHERE id = $1`,
        [row.id],
      );
      processed++;
      continue;
    }

    try {
      const embResult = await embeddingService.embed(row.content);

      if (embResult) {
        await pool.query(
          `UPDATE terminal_session_entry
           SET embedding = $1::vector, embedded_at = now()
           WHERE id = $2`,
          [JSON.stringify(embResult.embedding), row.id],
        );
      } else {
        // Embedding returned null — mark as skipped
        await pool.query(
          `UPDATE terminal_session_entry
           SET embedded_at = now()
           WHERE id = $1`,
          [row.id],
        );
      }
      processed++;
    } catch (err) {
      console.error(
        `[terminal-embeddings] Failed to embed entry ${row.id} (${row.kind}):`,
        (err as Error).message,
      );
      // Skip this entry, continue with others
      continue;
    }
  }

  return processed;
}

/**
 * Determine whether an entry should be embedded based on session flags.
 *
 * - 'command', 'output', 'annotation': embed if embed_commands is true
 * - 'scrollback': embed only if embed_scrollback is true
 * - 'error': always embed (errors are always valuable for search)
 */
function shouldEmbedEntry(row: EntryRow): boolean {
  switch (row.kind) {
    case 'command':
    case 'output':
    case 'annotation':
      return row.embed_commands;
    case 'scrollback':
      return row.embed_scrollback;
    case 'error':
      return true;
    default:
      return false;
  }
}
