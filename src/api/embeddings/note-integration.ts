/**
 * Note embedding integration with embedding service.
 * Part of Epic #337, Issue #349
 *
 * This module provides functions to generate and update embeddings
 * for notes, with privacy-aware filtering and graceful degradation.
 */

import type { Pool } from 'pg';
import { embeddingService } from './service.ts';
import { EmbeddingError } from './errors.ts';

/** Embedding status for note records. */
export type NoteEmbeddingStatus = 'complete' | 'pending' | 'failed' | 'skipped';

/** Note visibility type */
export type NoteVisibility = 'private' | 'shared' | 'public';

export interface NoteForEmbedding {
  id: string;
  title: string;
  content: string;
  visibility: NoteVisibility;
  hideFromAgents: boolean;
}

export interface BackfillOptions {
  limit?: number;
  onlyPending?: boolean;
  batchSize?: number;
}

export interface BackfillResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ noteId: string; error: string }>;
}

export interface EmbeddingStatsResult {
  total: number;
  byStatus: {
    complete: number;
    pending: number;
    failed: number;
    skipped: number;
  };
  provider: string | null;
  model: string | null;
}

/**
 * Determine if a note should be embedded based on privacy settings.
 *
 * Embedding rules:
 * - Private notes with hideFromAgents: SKIP (no semantic search needed)
 * - Private notes without hideFromAgents: EMBED (owner can search)
 * - Shared/public notes: EMBED (searchable by authorized users)
 */
export function shouldEmbed(note: NoteForEmbedding): boolean {
  if (note.visibility === 'private' && note.hideFromAgents) {
    // Completely private - no semantic search needed
    return false;
  }
  return true;
}

/**
 * Update just the embedding status.
 */
async function updateEmbeddingStatus(pool: Pool, noteId: string, status: NoteEmbeddingStatus): Promise<void> {
  await pool.query(`UPDATE note SET embedding_status = $2 WHERE id = $1`, [noteId, status]);
}

/**
 * Generate and store embedding for a single note.
 *
 * @param pool Database pool
 * @param noteId The note ID
 * @returns The embedding status
 */
export async function embedNote(pool: Pool, noteId: string): Promise<NoteEmbeddingStatus> {
  // Fetch note data
  const result = await pool.query(
    `SELECT
      id::text as id, title, content, visibility,
      hide_from_agents as "hideFromAgents"
    FROM note
    WHERE id = $1 AND deleted_at IS NULL`,
    [noteId],
  );

  if (result.rows.length === 0) {
    return 'failed'; // Note not found
  }

  const note = result.rows[0] as NoteForEmbedding;

  // Check if note should be embedded based on privacy
  if (!shouldEmbed(note)) {
    await updateEmbeddingStatus(pool, noteId, 'skipped');
    return 'skipped';
  }

  // Check if embedding service is configured
  if (!embeddingService.isConfigured()) {
    // Mark as pending - can be backfilled later
    await updateEmbeddingStatus(pool, noteId, 'pending');
    return 'pending';
  }

  try {
    // Prepare text for embedding
    // Title is repeated to increase its weight in the embedding
    const text = `${note.title}\n\n${note.title}\n\n${note.content}`.slice(0, 8000);

    const embeddingResult = await embeddingService.embed(text);

    if (!embeddingResult) {
      await updateEmbeddingStatus(pool, noteId, 'pending');
      return 'pending';
    }

    // Store embedding in database
    await pool.query(
      `UPDATE note
       SET embedding = $1::vector,
           embedding_model = $2,
           embedding_provider = $3,
           embedding_status = 'complete'
       WHERE id = $4`,
      [`[${embeddingResult.embedding.join(',')}]`, embeddingResult.model, embeddingResult.provider, noteId],
    );

    return 'complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Pool-closed errors are expected during shutdown/test teardown
    if (msg.includes('Cannot use a pool after calling end')) {
      return 'failed';
    }
    // Log error but don't fail the request
    console.error(`[Embeddings] Failed to embed note ${noteId}:`, error instanceof EmbeddingError ? error.toSafeString() : msg);

    // Mark as failed (may also fail if pool is closed, ignore that)
    await updateEmbeddingStatus(pool, noteId, 'failed').catch(() => {});
    return 'failed';
  }
}

/**
 * Trigger embedding for a note asynchronously (non-blocking).
 * This is called from note create/update operations.
 *
 * @param pool Database pool
 * @param noteId The note ID
 */
export function triggerNoteEmbedding(pool: Pool, noteId: string): void {
  // Run async, don't wait for result
  embedNote(pool, noteId).catch((err) => {
    // Pool-closed errors are expected during shutdown/test teardown
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot use a pool after calling end')) return;
    console.error(`[Embeddings] Background embedding failed for note ${noteId}:`, err);
  });
}

/**
 * Backfill embeddings for notes missing them.
 *
 * @param pool Database pool
 * @param options Backfill options
 * @returns Backfill results
 */
export async function backfillNoteEmbeddings(pool: Pool, options: BackfillOptions = {}): Promise<BackfillResult> {
  const { limit = 100, onlyPending = true, batchSize = 10 } = options;

  if (!embeddingService.isConfigured()) {
    throw new Error('No embedding provider configured');
  }

  // Find notes needing embeddings
  const statusFilter = onlyPending ? "embedding_status IN ('pending', 'failed')" : "embedding IS NULL OR embedding_status != 'complete'";

  const notesResult = await pool.query(
    `SELECT
      id::text as id, title, content, visibility,
      hide_from_agents as "hideFromAgents"
    FROM note
    WHERE deleted_at IS NULL AND (${statusFilter})
    ORDER BY updated_at DESC
    LIMIT $1`,
    [limit],
  );

  const notes = notesResult.rows as NoteForEmbedding[];

  const result: BackfillResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Process in batches to respect rate limits
  for (let i = 0; i < notes.length; i += batchSize) {
    const batch = notes.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (note) => {
        result.processed++;

        // Check if should skip due to privacy
        if (!shouldEmbed(note)) {
          await updateEmbeddingStatus(pool, note.id, 'skipped');
          result.skipped++;
          return;
        }

        try {
          const status = await embedNote(pool, note.id);

          if (status === 'complete') {
            result.succeeded++;
          } else if (status === 'skipped') {
            result.skipped++;
          } else {
            result.failed++;
            result.errors.push({ noteId: note.id, error: `Status: ${status}` });
          }
        } catch (error) {
          result.failed++;
          result.errors.push({
            noteId: note.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }),
    );

    // Rate limit: wait between batches
    if (i + batchSize < notes.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return result;
}

/**
 * Get embedding statistics for notes.
 *
 * @param pool Database pool
 * @returns Embedding statistics
 */
export async function getNoteEmbeddingStats(pool: Pool): Promise<EmbeddingStatsResult> {
  // Get counts by status
  const statusResult = await pool.query(`
    SELECT
      embedding_status,
      COUNT(*) as count
    FROM note
    WHERE deleted_at IS NULL
    GROUP BY embedding_status
  `);

  const byStatus = {
    complete: 0,
    pending: 0,
    failed: 0,
    skipped: 0,
  };

  let total = 0;
  for (const row of statusResult.rows) {
    const status = row.embedding_status as NoteEmbeddingStatus | null;
    const count = parseInt(row.count, 10);
    total += count;

    if (status === 'complete') {
      byStatus.complete = count;
    } else if (status === 'failed') {
      byStatus.failed = count;
    } else if (status === 'skipped') {
      byStatus.skipped = count;
    } else {
      // null or 'pending'
      byStatus.pending += count;
    }
  }

  // Get current provider/model info
  const configSummary = embeddingService.getConfig();

  return {
    total,
    byStatus,
    provider: configSummary?.provider ?? null,
    model: configSummary?.model ?? null,
  };
}

/**
 * Search notes using semantic similarity.
 *
 * If embedding fails for the query, falls back to text search.
 *
 * @param pool Database pool
 * @param query Search query text
 * @param userEmail User making the query (for access control)
 * @param options Search options
 * @returns Search results with similarity scores
 */
export async function searchNotesSemantic(
  pool: Pool,
  query: string,
  userEmail: string,
  options: {
    limit?: number;
    offset?: number;
    notebookId?: string;
    tags?: string[];
  } = {},
): Promise<{
  results: Array<{
    id: string;
    title: string;
    content: string;
    similarity: number;
    updatedAt: Date;
  }>;
  searchType: 'semantic' | 'text';
  queryEmbeddingProvider?: string;
}> {
  const { limit = 20, offset = 0, notebookId, tags } = options;

  // Try to generate embedding for query
  let queryEmbedding: number[] | null = null;
  let queryProvider: string | undefined;

  if (embeddingService.isConfigured()) {
    try {
      const result = await embeddingService.embed(query);
      if (result) {
        queryEmbedding = result.embedding;
        queryProvider = result.provider;
      }
    } catch (error) {
      console.warn(
        '[Embeddings] Query embedding failed, falling back to text search:',
        error instanceof EmbeddingError ? error.toSafeString() : (error as Error).message,
      );
    }
  }

  // Build access control condition
  // User can see: own notes OR shared with them OR public
  const accessCondition = `(
    n.user_email = $1
    OR n.visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM note_share ns
      WHERE ns.note_id = n.id
      AND ns.shared_with_email = $1
      AND (ns.expires_at IS NULL OR ns.expires_at > NOW())
    )
  )`;

  // Build dynamic WHERE clause
  const conditions: string[] = ['n.deleted_at IS NULL', accessCondition];
  const params: (string | string[] | number)[] = [userEmail];
  let paramIndex = 2;

  if (notebookId) {
    conditions.push(`n.notebook_id = $${paramIndex}`);
    params.push(notebookId);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`n.tags && $${paramIndex}`);
    params.push(tags);
    paramIndex++;
  }

  // Semantic search with embedding
  if (queryEmbedding) {
    conditions.push(`n.embedding IS NOT NULL AND n.embedding_status = 'complete'`);

    const embeddingParam = `[${queryEmbedding.join(',')}]`;
    params.push(embeddingParam);
    const embeddingParamIndex = paramIndex++;

    params.push(limit);
    const limitParamIndex = paramIndex++;
    params.push(offset);
    const offsetParamIndex = paramIndex++;

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT
        n.id::text as id,
        n.title,
        n.content,
        n.updated_at as "updatedAt",
        1 - (n.embedding <=> $${embeddingParamIndex}::vector) as similarity
      FROM note n
      WHERE ${whereClause}
      ORDER BY n.embedding <=> $${embeddingParamIndex}::vector
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      params,
    );

    return {
      results: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        similarity: parseFloat(row.similarity),
        updatedAt: new Date(row.updatedAt),
      })),
      searchType: 'semantic',
      queryEmbeddingProvider: queryProvider,
    };
  }

  // Fall back to text search
  params.push(`%${query}%`);
  const searchParamIndex = paramIndex++;

  conditions.push(`(n.title ILIKE $${searchParamIndex} OR n.content ILIKE $${searchParamIndex})`);

  params.push(limit);
  const limitParamIndex = paramIndex++;
  params.push(offset);
  const offsetParamIndex = paramIndex++;

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
      n.id::text as id,
      n.title,
      n.content,
      n.updated_at as "updatedAt",
      0.5 as similarity
    FROM note n
    WHERE ${whereClause}
    ORDER BY n.updated_at DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params,
  );

  return {
    results: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      similarity: parseFloat(row.similarity),
      updatedAt: new Date(row.updatedAt),
    })),
    searchType: 'text',
  };
}
