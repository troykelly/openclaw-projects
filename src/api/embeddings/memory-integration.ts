/**
 * Memory API integration with embedding service.
 *
 * This module provides functions to generate and update embeddings
 * for memory records, with graceful degradation if embedding fails.
 */

import type { Pool } from 'pg';
import { embeddingService } from './service.ts';
import { EmbeddingError } from './errors.ts';

/** Embedding status for memory records. */
export type MemoryEmbeddingStatus = 'complete' | 'pending' | 'failed';

export interface MemoryWithEmbedding {
  id: string;
  title: string;
  content: string;
  type: string;
  linkedItemId: string;
  createdAt: string;
  updatedAt?: string;
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
 * @param memoryId The memory ID
 * @param content The content to embed (title + content concatenated)
 * @returns The embedding status
 */
export async function generateMemoryEmbedding(
  pool: Pool,
  memoryId: string,
  content: string
): Promise<MemoryEmbeddingStatus> {
  // Check if embedding service is configured
  if (!embeddingService.isConfigured()) {
    // Mark as pending - can be backfilled later
    await pool.query(
      `UPDATE memory SET embedding_status = 'pending' WHERE id = $1`,
      [memoryId]
    );
    return 'pending';
  }

  try {
    const result = await embeddingService.embed(content);

    if (!result) {
      await pool.query(
        `UPDATE memory SET embedding_status = 'pending' WHERE id = $1`,
        [memoryId]
      );
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
      [
        `[${result.embedding.join(',')}]`,
        result.model,
        result.provider,
        memoryId,
      ]
    );

    return 'complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Pool-closed errors are expected during shutdown/test teardown
    if (msg.includes('Cannot use a pool after calling end')) {
      return 'failed';
    }
    // Log error but don't fail the request
    console.error(
      `[Embeddings] Failed to embed memory ${memoryId}:`,
      error instanceof EmbeddingError
        ? error.toSafeString()
        : msg
    );

    // Mark as failed (may also fail if pool is closed, ignore that)
    await pool.query(
      `UPDATE memory SET embedding_status = 'failed' WHERE id = $1`,
      [memoryId]
    ).catch(() => {});

    return 'failed';
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
    memoryType?: string;
    workItemId?: string;
    contactId?: string;
    relationshipId?: string;
    userEmail?: string;
    tags?: string[];
  } = {}
): Promise<{
  results: Array<MemoryWithEmbedding & { similarity: number }>;
  searchType: 'semantic' | 'text';
  queryEmbeddingProvider?: string;
}> {
  const { limit = 20, offset = 0, memoryType, workItemId, contactId, relationshipId, userEmail, tags } = options;

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
        error instanceof EmbeddingError
          ? error.toSafeString()
          : (error as Error).message
      );
    }
  }

  // Build query
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (memoryType) {
    conditions.push(`m.memory_type::text = $${paramIndex}`);
    params.push(memoryType);
    paramIndex++;
  }

  if (workItemId) {
    conditions.push(`m.work_item_id = $${paramIndex}`);
    params.push(workItemId);
    paramIndex++;
  }

  if (contactId) {
    conditions.push(`m.contact_id = $${paramIndex}`);
    params.push(contactId);
    paramIndex++;
  }

  if (relationshipId) {
    conditions.push(`m.relationship_id = $${paramIndex}`);
    params.push(relationshipId);
    paramIndex++;
  }

  if (userEmail) {
    conditions.push(`m.user_email = $${paramIndex}`);
    params.push(userEmail);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`m.tags @> $${paramIndex}`);
    params.push(tags);
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
    const fullWhereClause = whereClause
      ? `${whereClause} AND ${embeddingCondition}`
      : `WHERE ${embeddingCondition}`;

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
         m.work_item_id::text as "linkedItemId",
         m.created_at as "createdAt",
         m.updated_at as "updatedAt",
         m.embedding_status,
         m.embedding_provider,
         m.embedding_model,
         m.tags,
         1 - (m.embedding <=> $${embeddingParamIndex}::vector) as similarity
       FROM memory m
       ${fullWhereClause}
       ORDER BY m.embedding <=> $${embeddingParamIndex}::vector
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      params
    );

    return {
      results: result.rows as Array<MemoryWithEmbedding & { similarity: number }>,
      searchType: 'semantic',
      queryEmbeddingProvider: queryProvider,
    };
  }

  // Fall back to text search
  params.push(`%${query}%`);
  const searchParamIndex = paramIndex++;

  const searchCondition = `(m.title ILIKE $${searchParamIndex} OR m.content ILIKE $${searchParamIndex})`;
  const fullWhereClause = whereClause
    ? `${whereClause} AND ${searchCondition}`
    : `WHERE ${searchCondition}`;

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
       m.work_item_id::text as "linkedItemId",
       m.created_at as "createdAt",
       m.updated_at as "updatedAt",
       m.embedding_status,
       m.embedding_provider,
       m.embedding_model,
       0.5 as similarity
     FROM memory m
     ${fullWhereClause}
     ORDER BY m.updated_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params
  );

  return {
    results: result.rows as Array<MemoryWithEmbedding & { similarity: number }>,
    searchType: 'text',
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
    batchSize?: number;
    force?: boolean;
  } = {}
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const { batchSize = 100, force = false } = options;

  if (!embeddingService.isConfigured()) {
    throw new Error('No embedding provider configured');
  }

  // Find memories without embeddings (or all if force=true)
  const condition = force
    ? '1=1'
    : "(embedding_status IS NULL OR embedding_status != 'complete')";

  const result = await pool.query(
    `SELECT id::text as id, title, content
     FROM memory
     WHERE ${condition}
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize]
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
