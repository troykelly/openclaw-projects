/**
 * Durable Writes for Symphony Orchestrated Runs
 *
 * Critical DB writes (status, activity) retry on failure instead of
 * swallowing errors. When retries are exhausted, failed payloads go
 * to a dead-letter queue (symphony_dead_letter table).
 *
 * Issue #2212 — Structured Logging & Trace Correlation
 */

import type { Pool, PoolClient } from 'pg';
import { Counter } from '../worker/metrics.ts';

/** Default max retries before dead-lettering. */
export const DEFAULT_MAX_RETRIES = 3;

/** Base delay for exponential backoff between retries (ms). */
const BASE_DELAY_MS = 100;

/** Max delay between retries (ms). */
const MAX_DELAY_MS = 5000;

// ─── Prometheus metrics ───

export const symphonyDurableWriteRetries = new Counter(
  'symphony_durable_write_retries_total',
  'Total retry attempts for durable writes',
);

export const symphonyDeadLetterCount = new Counter(
  'symphony_dead_letter_count',
  'Total items written to the dead-letter queue',
);

/** Options for a durable write operation. */
export interface DurableWriteOptions {
  /** Maximum retries before dead-lettering. Default: 3. */
  maxRetries?: number;
  /** Source identifier for DLQ tracking (e.g., 'run_event', 'activity'). */
  source: string;
  /** Namespace for the DLQ entry. */
  namespace: string;
}

/** Result of a durable write attempt. */
export interface DurableWriteResult {
  success: boolean;
  attempts: number;
  deadLettered: boolean;
  error?: string;
}

/**
 * Execute a critical DB write with retry and dead-letter fallback.
 *
 * @param pool      Database pool (or client).
 * @param writeFn   The write function to execute. Receives a pool/client.
 * @param payload   JSONB payload to store in DLQ on permanent failure.
 * @param options   Configuration for retries and DLQ.
 */
export async function durableWrite(
  pool: Pool,
  writeFn: (executor: Pool) => Promise<void>,
  payload: Record<string, unknown>,
  options: DurableWriteOptions,
): Promise<DurableWriteResult> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await writeFn(pool);
      return { success: true, attempts: attempt, deadLettered: false };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      symphonyDurableWriteRetries.inc();

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(
          BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100),
          MAX_DELAY_MS,
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — dead-letter
  const errorMessage = lastError?.message ?? 'Unknown error';

  try {
    await writeToDeadLetter(pool, {
      namespace: options.namespace,
      payload,
      error: errorMessage,
      source: options.source,
    });
    symphonyDeadLetterCount.inc();

    return {
      success: false,
      attempts: maxRetries,
      deadLettered: true,
      error: errorMessage,
    };
  } catch (dlqError) {
    // DLQ write itself failed — log to stderr with all available context
    const dlqErr = dlqError instanceof Error ? dlqError : new Error(String(dlqError));
    console.error(
      `[Symphony:DLQ] CRITICAL: Dead-letter write failed. ` +
      `source=${options.source} namespace=${options.namespace} ` +
      `original_error="${errorMessage}" dlq_error="${dlqErr.message}" ` +
      `payload=${JSON.stringify(payload)}`,
    );

    return {
      success: false,
      attempts: maxRetries,
      deadLettered: false,
      error: `Write and DLQ both failed: ${errorMessage}; DLQ: ${dlqErr.message}`,
    };
  }
}

/**
 * Write a failed payload to the dead-letter queue table.
 */
export async function writeToDeadLetter(
  pool: Pool | PoolClient,
  entry: {
    namespace: string;
    payload: Record<string, unknown>;
    error: string;
    source: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO symphony_dead_letter (namespace, payload, error, source)
     VALUES ($1, $2::jsonb, $3, $4)
     RETURNING id::text as id`,
    [entry.namespace, JSON.stringify(entry.payload), entry.error, entry.source],
  );

  return result.rows[0].id;
}

/**
 * Resolve a dead-letter entry (mark as resolved).
 */
export async function resolveDeadLetter(
  pool: Pool | PoolClient,
  id: string,
  resolvedBy: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE symphony_dead_letter
     SET resolved_at = NOW(), resolved_by = $2
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING id`,
    [id, resolvedBy],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Get unresolved dead-letter entries.
 */
export async function getUnresolvedDeadLetters(
  pool: Pool | PoolClient,
  options?: { namespace?: string; source?: string; limit?: number },
): Promise<Array<{
  id: string;
  namespace: string;
  payload: Record<string, unknown>;
  error: string;
  source: string;
  created_at: string;
}>> {
  const conditions: string[] = ['resolved_at IS NULL'];
  const params: (string | number)[] = [];
  let idx = 1;

  if (options?.namespace) {
    conditions.push(`namespace = $${idx}`);
    params.push(options.namespace);
    idx++;
  }

  if (options?.source) {
    conditions.push(`source = $${idx}`);
    params.push(options.source);
    idx++;
  }

  const limit = options?.limit ?? 100;
  params.push(limit);

  const result = await pool.query(
    `SELECT id::text as id, namespace, payload, error, source, created_at::text as created_at
     FROM symphony_dead_letter
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at ASC
     LIMIT $${idx}`,
    params,
  );

  return result.rows as Array<{
    id: string;
    namespace: string;
    payload: Record<string, unknown>;
    error: string;
    source: string;
    created_at: string;
  }>;
}

/** Utility: sleep for ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
