/**
 * Memory API integration with embedding service.
 *
 * This module provides functions to generate and update embeddings
 * for memory records, with graceful degradation if embedding fails.
 * Location embedding support added in Epic #1204.
 */

import type { Pool } from 'pg';
import { EmbeddingError } from './errors.ts';
import { embeddingService } from './service.ts';

/** Embedding status for memory records. */
export type MemoryEmbeddingStatus = 'complete' | 'pending' | 'failed';

export interface MemoryWithEmbedding {
  id: string;
  title: string;
  content: string;
  type: string;
  linked_item_id: string;
  created_at: string;
  updated_at?: string;
  embedding_status: MemoryEmbeddingStatus;
  embedding_provider?: string;
  embedding_model?: string;
}

/**
 * Generate and store embedding for a memory record.
 *
 * This is called after memory creation/update. It generates an embedding
 * asynchronously and updates the record. If embedding fails, the record
 * is still valid but marked as 'failed' status.
 *
 * @param pool Database pool
 * @param memory_id The memory ID
 * @param content The content to embed (title + content concatenated)
 * @returns The embedding status
 */
export async function generateMemoryEmbedding(pool: Pool, memory_id: string, content: string): Promise<MemoryEmbeddingStatus> {
  // Check if embedding service is configured
  if (!embeddingService.isConfigured()) {
    // Mark as pending - can be backfilled later
    await pool.query(`UPDATE memory SET embedding_status = 'pending' WHERE id = $1`, [memory_id]);
    return 'pending';
  }

  try {
    const result = await embeddingService.embed(content);

    if (!result) {
      await pool.query(`UPDATE memory SET embedding_status = 'pending' WHERE id = $1`, [memory_id]);
      return 'pending';
    }

    // Store embedding in database
    await pool.query(
      `UPDATE memory
       SET embedding = $1::vector,
           embedding_model = $2,
           embedding_provider = $3,
           embedding_status = 'complete',
           updated_at = NOW()
       WHERE id = $4`,
      [`[${result.embedding.join(',')}]`, result.model, result.provider, memory_id],
    );

    return 'complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Pool-closed errors are expected during shutdown/test teardown
    if (msg.includes('Cannot use a pool after calling end')) {
      return 'failed';
    }
    // Log error but don't fail the request
    console.error(`[Embeddings] Failed to embed memory ${memory_id}:`, error instanceof EmbeddingError ? error.toSafeString() : msg);

    // Mark as failed (may also fail if pool is closed, ignore that)
    await pool.query(`UPDATE memory SET embedding_status = 'failed' WHERE id = $1`, [memory_id]).catch(() => {});

    return 'failed';
  }
}

/**
 * Generate and store a separate location embedding for a memory record.
 * Uses address + place_label text as input. Non-fatal on failure.
 * Part of Epic #1204, Issue #1210.
 *
 * @param pool Database pool
 * @param memory_id The memory ID
 * @param locationText The location text to embed (address + place_label)
 */
export async function generateLocationEmbedding(pool: Pool, memory_id: string, locationText: string): Promise<void> {
  if (!embeddingService.isConfigured() || !locationText.trim()) return;

  try {
    const result = await embeddingService.embed(locationText);
    if (!result) return;

    await pool.query(
      `UPDATE memory
       SET location_embedding = $1::vector
       WHERE id = $2`,
      [`[${result.embedding.join(',')}]`, memory_id],
    );
  } catch (error) {
    // Non-fatal: location embedding is a bonus relevance signal
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('Cannot use a pool after calling end')) {
      console.error(`[Embeddings] Failed to embed location for memory ${memory_id}:`, error instanceof EmbeddingError ? error.toSafeString() : msg);
    }
  }
}

/**
 * Search memories using semantic similarity.
 *
 * If embedding fails for the query, falls back to text search.
 *
 * @param pool Database pool
 * @param query Search query text
 * @param options Search options
 * @returns Search results with similarity scores
 */
export async function searchMemoriesSemantic(
  pool: Pool,
  query: string,
  options: {
    limit?: number;
    offset?: number;
    memory_type?: string;
    work_item_id?: string;
    contact_id?: string;
    relationship_id?: string;
    project_id?: string;
    /** @deprecated user_email column dropped from memory table in Phase 4 (Epic #1418) */
    user_email?: string;
    tags?: string[];
    created_after?: Date;
    created_before?: Date;
  } = {},
): Promise<{
  results: Array<MemoryWithEmbedding & { similarity: number }>;
  search_type: 'semantic' | 'text';
  query_embedding_provider?: string;
}> {
  const { limit = 20, offset = 0, memory_type, work_item_id, contact_id, relationship_id, project_id, tags, created_after, created_before } = options;

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

  // Build query
  const conditions: string[] = [];
  const params: (string | number | string[])[] = [];
  let paramIndex = 1;

  if (memory_type) {
    conditions.push(`m.memory_type::text = $${paramIndex}`);
    params.push(memory_type);
    paramIndex++;
  }

  if (work_item_id) {
    conditions.push(`m.work_item_id = $${paramIndex}`);
    params.push(work_item_id);
    paramIndex++;
  }

  if (contact_id) {
    conditions.push(`m.contact_id = $${paramIndex}`);
    params.push(contact_id);
    paramIndex++;
  }

  if (relationship_id) {
    conditions.push(`m.relationship_id = $${paramIndex}`);
    params.push(relationship_id);
    paramIndex++;
  }

  if (project_id) {
    conditions.push(`m.project_id = $${paramIndex}`);
    params.push(project_id);
    paramIndex++;
  }

  // Epic #1418 Phase 4: user_email column dropped from memory table.
  // Namespace scoping is handled at the route level.

  if (tags && tags.length > 0) {
    conditions.push(`m.tags @> $${paramIndex}`);
    params.push(tags);
    paramIndex++;
  }

  // Temporal filters (issue #1272)
  if (created_after) {
    conditions.push(`m.created_at >= $${paramIndex}`);
    params.push(created_after.toISOString());
    paramIndex++;
  }
  if (created_before) {
    conditions.push(`m.created_at < $${paramIndex}`);
    params.push(created_before.toISOString());
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Semantic search with embedding
  if (queryEmbedding) {
    // Add embedding parameter
    const embeddingParam = `[${queryEmbedding.join(',')}]`;
    params.push(embeddingParam);
    const embeddingParamIndex = paramIndex++;

    // Only search memories that have embeddings
    const embeddingCondition = `m.embedding IS NOT NULL AND m.embedding_status = 'complete'`;
    const fullWhereClause = whereClause ? `${whereClause} AND ${embeddingCondition}` : `WHERE ${embeddingCondition}`;

    params.push(limit);
    const limitParamIndex = paramIndex++;
    params.push(offset);
    const offsetParamIndex = paramIndex++;

    const result = await pool.query(
      `SELECT
         m.id::text as id,
         m.title,
         m.content,
         m.memory_type::text as type,
         m.work_item_id::text as linked_item_id,
         m.created_at,
         m.updated_at,
         m.embedding_status,
         m.embedding_provider,
         m.embedding_model,
         m.tags,
         m.lat,
         m.lng,
         m.address,
         m.place_label,
         1 - (m.embedding <=> $${embeddingParamIndex}::vector) as similarity
       FROM memory m
       ${fullWhereClause}
       ORDER BY m.embedding <=> $${embeddingParamIndex}::vector
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      params,
    );

    return {
      results: result.rows as Array<MemoryWithEmbedding & { similarity: number }>,
      search_type: 'semantic',
      query_embedding_provider: queryProvider,
    };
  }

  // Fall back to text search
  params.push(`%${query}%`);
  const searchParamIndex = paramIndex++;

  const searchCondition = `(m.title ILIKE $${searchParamIndex} OR m.content ILIKE $${searchParamIndex})`;
  const fullWhereClause = whereClause ? `${whereClause} AND ${searchCondition}` : `WHERE ${searchCondition}`;

  params.push(limit);
  const limitParamIndex = paramIndex++;
  params.push(offset);
  const offsetParamIndex = paramIndex++;

  const result = await pool.query(
    `SELECT
       m.id::text as id,
       m.title,
       m.content,
       m.memory_type::text as type,
       m.work_item_id::text as linked_item_id,
       m.created_at,
       m.updated_at,
       m.embedding_status,
       m.embedding_provider,
       m.embedding_model,
       m.lat,
       m.lng,
       m.address,
       m.place_label,
       0.5 as similarity
     FROM memory m
     ${fullWhereClause}
     ORDER BY m.updated_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params,
  );

  return {
    results: result.rows as Array<MemoryWithEmbedding & { similarity: number }>,
    search_type: 'text',
  };
}

/**
 * Backfill embeddings for memories that don't have them.
 *
 * @param pool Database pool
 * @param options Backfill options
 * @returns Number of records processed
 */
export async function backfillMemoryEmbeddings(
  pool: Pool,
  options: {
    batch_size?: number;
    force?: boolean;
  } = {},
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const { batch_size = 100, force = false } = options;

  if (!embeddingService.isConfigured()) {
    throw new Error('No embedding provider configured');
  }

  // Find memories without embeddings (or all if force=true)
  const condition = force ? '1=1' : "(embedding_status IS NULL OR embedding_status != 'complete')";

  const result = await pool.query(
    `SELECT id::text as id, title, content
     FROM memory
     WHERE ${condition}
     ORDER BY created_at ASC
     LIMIT $1`,
    [batch_size],
  );

  let succeeded = 0;
  let failed = 0;

  for (const row of result.rows as Array<{ id: string; title: string; content: string }>) {
    const content = `${row.title}\n\n${row.content}`;
    const status = await generateMemoryEmbedding(pool, row.id, content);

    if (status === 'complete') {
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
