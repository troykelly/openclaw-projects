/**
 * Message embedding integration service.
 * Provides embedding generation and semantic search for external_message records.
 * Part of Issue #295.
 */

import type { Pool } from 'pg';
import { embeddingService } from './service.ts';
import { EmbeddingError } from './errors.ts';
import type { InternalJob, JobProcessorResult } from '../jobs/types.ts';

/** Embedding status for message records. */
export type MessageEmbeddingStatus = 'complete' | 'pending' | 'failed';

export interface MessageWithEmbedding {
  id: string;
  body: string;
  subject?: string;
  direction: string;
  channel: string;
  thread_id: string;
  received_at: string;
  embedding_status: MessageEmbeddingStatus;
  embedding_provider?: string;
  embedding_model?: string;
}

/**
 * Generate and store embedding for a message record.
 *
 * @param pool Database pool
 * @param message_id The message ID
 * @param content The content to embed (body + optional subject)
 * @returns The embedding status
 */
export async function generateMessageEmbedding(pool: Pool, message_id: string, content: string): Promise<MessageEmbeddingStatus> {
  // Check if embedding service is configured
  if (!embeddingService.isConfigured()) {
    // Mark as pending - can be backfilled later
    await pool.query(`UPDATE external_message SET embedding_status = 'pending' WHERE id = $1`, [message_id]);
    return 'pending';
  }

  try {
    const result = await embeddingService.embed(content);

    if (!result) {
      await pool.query(`UPDATE external_message SET embedding_status = 'pending' WHERE id = $1`, [message_id]);
      return 'pending';
    }

    // Store embedding in database
    await pool.query(
      `UPDATE external_message
       SET embedding = $1::vector,
           embedding_model = $2,
           embedding_provider = $3,
           embedding_status = 'complete'
       WHERE id = $4`,
      [`[${result.embedding.join(',')}]`, result.model, result.provider, message_id],
    );

    return 'complete';
  } catch (error) {
    // Log error but don't fail the request
    console.error(`[Embeddings] Failed to embed message ${message_id}:`, error instanceof EmbeddingError ? error.toSafeString() : (error as Error).message);

    // Mark as failed
    await pool.query(`UPDATE external_message SET embedding_status = 'failed' WHERE id = $1`, [message_id]);

    return 'failed';
  }
}

/**
 * Handle a message.embed job.
 *
 * This function:
 * 1. Fetches the message
 * 2. Generates embedding for body (+ subject if present)
 * 3. Updates the message with embedding data
 */
export async function handleMessageEmbedJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const payload = job.payload as { message_id: string };

  if (!payload.message_id) {
    return {
      success: false,
      error: 'Invalid job payload: missing message_id',
    };
  }

  // Fetch message - handle invalid UUID gracefully
  let result;
  try {
    result = await pool.query(
      `SELECT id::text as id, body, subject, embedding_status
       FROM external_message
       WHERE id = $1`,
      [payload.message_id],
    );
  } catch (error) {
    const err = error as Error;
    // Handle invalid UUID format
    if (err.message.includes('invalid input syntax for type uuid')) {
      return {
        success: false,
        error: `Message ${payload.message_id} not found (invalid ID format)`,
      };
    }
    throw error;
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      error: `Message ${payload.message_id} not found`,
    };
  }

  const message = result.rows[0] as {
    id: string;
    body: string;
    subject?: string;
    embedding_status: string;
  };

  // Skip if already complete
  if (message.embedding_status === 'complete') {
    return { success: true };
  }

  // Build content for embedding (subject + body for emails, just body for SMS)
  const content = message.subject ? `${message.subject}\n\n${message.body}` : message.body;

  // Generate embedding
  const status = await generateMessageEmbedding(pool, message.id, content);

  // If status is pending (no provider), that's still success
  // Job will be retried later or via backfill
  if (status === 'failed') {
    return {
      success: false,
      error: 'Failed to generate embedding',
    };
  }

  console.log(`[Embeddings] Message ${message.id}: status=${status}`);

  return { success: true };
}

/**
 * Enqueue an embedding job for a message.
 *
 * Creates an internal_job entry with kind='message.embed'.
 * Uses idempotency key to prevent duplicate jobs for the same message.
 *
 * Note: A database trigger (tr_message_queue_embedding from migration 039)
 * also enqueues jobs on INSERT. This function provides an application-level
 * path for explicit enqueue calls and backfill operations.
 *
 * @param pool Database pool
 * @param message_id The message ID
 */
export async function enqueueMessageEmbedJob(pool: Pool, message_id: string): Promise<void> {
  const idempotency_key = `message.embed:${message_id}`;

  await pool.query(
    `INSERT INTO internal_job (kind, payload, idempotency_key)
     VALUES ('message.embed', $1::jsonb, $2)
     ON CONFLICT ON CONSTRAINT internal_job_kind_idempotency_uniq DO NOTHING`,
    [JSON.stringify({ message_id: message_id }), idempotency_key],
  );
}

/**
 * Trigger embedding for a message asynchronously (non-blocking).
 * Call this after storing an inbound message to ensure embedding is enqueued.
 *
 * Enqueues an internal_job rather than generating the embedding inline,
 * to avoid blocking the inbound message webhook response.
 *
 * @param pool Database pool
 * @param message_id The message ID
 */
export function triggerMessageEmbedding(pool: Pool, message_id: string): void {
  enqueueMessageEmbedJob(pool, message_id).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot use a pool after calling end')) return;
    console.error(`[Embeddings] Failed to enqueue message embed job for ${message_id}:`, msg);
  });
}

/**
 * Search messages using semantic similarity.
 *
 * If embedding fails for the query, falls back to text search.
 */
export async function searchMessagesSemantic(
  pool: Pool,
  query: string,
  options: {
    limit?: number;
    offset?: number;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    date_from?: Date;
    date_to?: Date;
  } = {},
): Promise<{
  results: Array<MessageWithEmbedding & { similarity: number }>;
  search_type: 'semantic' | 'text';
  query_embedding_provider?: string;
}> {
  const { limit = 20, offset = 0, channel, direction, date_from, date_to } = options;

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

  // Build base conditions
  const conditions: string[] = [];
  const params: (string | number | Date)[] = [];
  let paramIndex = 1;

  if (channel) {
    conditions.push(`t.channel = $${paramIndex}`);
    params.push(channel);
    paramIndex++;
  }

  if (direction) {
    conditions.push(`m.direction = $${paramIndex}`);
    params.push(direction);
    paramIndex++;
  }

  if (date_from) {
    conditions.push(`m.received_at >= $${paramIndex}`);
    params.push(date_from);
    paramIndex++;
  }

  if (date_to) {
    conditions.push(`m.received_at <= $${paramIndex}`);
    params.push(date_to);
    paramIndex++;
  }

  // Semantic search with embedding
  if (queryEmbedding) {
    // Add embedding parameter
    const embeddingParam = `[${queryEmbedding.join(',')}]`;
    params.push(embeddingParam);
    const embeddingParamIndex = paramIndex++;

    // Only search messages that have embeddings
    conditions.push(`m.embedding IS NOT NULL`);
    conditions.push(`m.embedding_status = 'complete'`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitParamIndex = paramIndex++;
    params.push(offset);
    const offsetParamIndex = paramIndex++;

    const result = await pool.query(
      `SELECT
         m.id::text as id,
         m.body,
         m.subject,
         m.direction::text as direction,
         t.channel::text as channel,
         m.thread_id::text as thread_id,
         m.received_at,
         m.embedding_status,
         m.embedding_provider,
         m.embedding_model,
         1 - (m.embedding <=> $${embeddingParamIndex}::vector) as similarity
       FROM external_message m
       JOIN external_thread t ON t.id = m.thread_id
       ${whereClause}
       ORDER BY m.embedding <=> $${embeddingParamIndex}::vector
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      params,
    );

    return {
      results: result.rows as Array<MessageWithEmbedding & { similarity: number }>,
      search_type: 'semantic',
      query_embedding_provider: queryProvider,
    };
  }

  // Fall back to text search
  params.push(`%${query}%`);
  const searchParamIndex = paramIndex++;

  conditions.push(`(m.body ILIKE $${searchParamIndex} OR m.subject ILIKE $${searchParamIndex})`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  const limitParamIndex = paramIndex++;
  params.push(offset);
  const offsetParamIndex = paramIndex++;

  const result = await pool.query(
    `SELECT
       m.id::text as id,
       m.body,
       m.subject,
       m.direction::text as direction,
       t.channel::text as channel,
       m.thread_id::text as thread_id,
       m.received_at,
       m.embedding_status,
       m.embedding_provider,
       m.embedding_model,
       0.5 as similarity
     FROM external_message m
     JOIN external_thread t ON t.id = m.thread_id
     ${whereClause}
     ORDER BY m.received_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params,
  );

  return {
    results: result.rows as Array<MessageWithEmbedding & { similarity: number }>,
    search_type: 'text',
  };
}

/**
 * Backfill embeddings for messages that don't have them.
 */
export async function backfillMessageEmbeddings(
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

  // Find messages without embeddings (or all if force=true)
  const condition = force ? '1=1' : "(embedding_status IS NULL OR embedding_status != 'complete')";

  const result = await pool.query(
    `SELECT m.id::text as id, m.body, m.subject
     FROM external_message m
     WHERE ${condition}
       AND m.body IS NOT NULL
       AND length(trim(m.body)) > 0
     ORDER BY m.received_at ASC
     LIMIT $1`,
    [batch_size],
  );

  let succeeded = 0;
  let failed = 0;

  for (const row of result.rows as Array<{ id: string; body: string; subject?: string }>) {
    const content = row.subject ? `${row.subject}\n\n${row.body}` : row.body;

    const status = await generateMessageEmbedding(pool, row.id, content);

    if (status === 'complete') {
      succeeded++;
    } else if (status === 'failed') {
      failed++;
    }
    // pending doesn't count as success or failure
  }

  return {
    processed: result.rows.length,
    succeeded,
    failed,
  };
}
