/**
 * Webhook dispatcher for OpenClaw gateway.
 * Processes webhook_outbox entries and dispatches to OpenClaw.
 * Part of Issue #201.
 */

import type { Pool } from 'pg';
import type { WebhookOutboxEntry, WebhookDispatchResult, DispatchStats } from './types.ts';
import { getOpenClawConfig } from './config.ts';
import { isAbsoluteUrl, validateSsrf } from './ssrf.ts';

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Determine if an HTTP status code (or lack thereof) represents a retryable failure.
 *
 * Retryable: 408 (timeout), 409 (conflict), 425 (too early), 429 (rate limit),
 * 5xx (server errors), and network errors (no status code).
 * Non-retryable: all other 4xx client errors.
 */
export function isRetryable(statusCode?: number): boolean {
  if (statusCode === undefined) {
    // Network error / timeout — no HTTP response received
    return true;
  }
  if (statusCode >= 500) {
    return true;
  }
  if (statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429) {
    return true;
  }
  return false;
}

/**
 * Strip query string from a URL for safe logging.
 */
function sanitizeDestination(dest: string): string {
  try {
    const parsed = new URL(dest);
    return parsed.origin + parsed.pathname;
  } catch {
    // Not a valid absolute URL (e.g. relative path) — safe as-is
    return dest;
  }
}

/**
 * Truncate a string to a maximum length for log safety.
 */
function truncateForLog(value: string, maxLength: number = 256): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength) + '...[truncated]';
}

/**
 * Calculate exponential backoff delay.
 */
function getBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Generate a unique worker ID for locking.
 */
function getWorkerId(): string {
  return `worker-${process.pid}-${Date.now()}`;
}

/**
 * Dispatch a single webhook to OpenClaw.
 */
export async function dispatchWebhook(entry: WebhookOutboxEntry): Promise<WebhookDispatchResult> {
  const config = getOpenClawConfig();

  if (!config) {
    return {
      success: false,
      error: 'OpenClaw not configured',
    };
  }

  // Absolute URLs (user-supplied webhook_url) are dispatched directly.
  // Relative paths (internal hooks like /hooks/agent) are prefixed with gatewayUrl.
  const isExternal = isAbsoluteUrl(entry.destination);
  const url = isExternal ? entry.destination : `${config.gatewayUrl}${entry.destination}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isExternal) {
    // External webhooks: use ONLY the entry's headers (user-supplied credentials).
    // Never send our internal apiToken to external URLs.
    Object.assign(headers, entry.headers);
  } else {
    // Internal gateway webhooks: use apiToken (shared M2M JWT), then overlay entry headers.
    headers.Authorization = `Bearer ${config.apiToken}`;
    Object.assign(headers, entry.headers);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (config.timeoutSeconds || 120) * 1000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(entry.body),
      signal: controller.signal,
      redirect: 'manual', // Prevent SSRF bypass via redirect to internal IPs
    });

    clearTimeout(timeout);

    if (response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      return {
        success: true,
        statusCode: response.status,
        responseBody,
      };
    }

    // Handle error responses
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'Unable to read response body';
    }

    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${errorBody}`,
    };
  } catch (error) {
    clearTimeout(timeout);
    const err = error as Error;

    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timeout',
      };
    }

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Lock a webhook entry for processing.
 * Uses advisory locking to prevent concurrent processing.
 */
async function lockWebhookEntry(pool: Pool, entryId: string, workerId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE webhook_outbox
     SET locked_at = NOW(), locked_by = $2, updated_at = NOW()
     WHERE id = $1
       AND dispatched_at IS NULL
       AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '${LOCK_TIMEOUT_MS} milliseconds')
     RETURNING id`,
    [entryId, workerId],
  );

  return result.rowCount === 1;
}

/**
 * Mark a webhook as successfully dispatched.
 * Verifies lock ownership to prevent stale workers from mutating state.
 */
async function markDispatched(pool: Pool, entryId: string, workerId: string): Promise<void> {
  await pool.query(
    `UPDATE webhook_outbox
     SET dispatched_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     WHERE id = $1 AND locked_by = $2`,
    [entryId, workerId],
  );
}

/**
 * Record a dispatch failure with jittered backoff.
 * Verifies lock ownership to prevent stale workers from mutating state.
 */
async function recordFailure(pool: Pool, entryId: string, error: string, workerId: string): Promise<void> {
  const jitterMs = Math.floor(Math.random() * 1000);
  await pool.query(
    `UPDATE webhook_outbox
     SET attempts = attempts + 1,
         last_error = $2,
         locked_at = NULL,
         locked_by = NULL,
         run_at = NOW() + (POWER(2, LEAST(attempts, 5)) * INTERVAL '1 second') + ($3 * INTERVAL '1 millisecond'),
         updated_at = NOW()
     WHERE id = $1 AND locked_by = $4`,
    [entryId, truncateForLog(error), jitterMs, workerId],
  );
}

/**
 * Get pending webhook entries to process.
 */
export async function getPendingWebhooks(pool: Pool, limit: number = 100): Promise<WebhookOutboxEntry[]> {
  const result = await pool.query(
    `SELECT
       id::text as id,
       kind,
       destination,
       run_at as "runAt",
       headers,
       body,
       attempts,
       last_error as "lastError",
       locked_at as "lockedAt",
       locked_by as "lockedBy",
       dispatched_at as "dispatchedAt",
       idempotency_key as "idempotencyKey",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM webhook_outbox
     WHERE dispatched_at IS NULL
       AND run_at <= NOW()
       AND attempts < $1
       AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '${LOCK_TIMEOUT_MS} milliseconds')
     ORDER BY run_at ASC
     LIMIT $2`,
    [MAX_RETRIES, limit],
  );

  return result.rows as WebhookOutboxEntry[];
}

/**
 * Process all pending webhooks.
 */
export async function processPendingWebhooks(pool: Pool, limit: number = 100): Promise<DispatchStats> {
  const config = getOpenClawConfig();

  if (!config) {
    console.warn('[Webhooks] OpenClaw not configured, skipping dispatch');
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  const workerId = getWorkerId();
  const entries = await getPendingWebhooks(pool, limit);

  const stats: DispatchStats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const entry of entries) {
    // Try to lock the entry
    const locked = await lockWebhookEntry(pool, entry.id, workerId);

    if (!locked) {
      stats.skipped++;
      continue;
    }

    stats.processed++;

    // Dispatch-time SSRF re-validation for absolute URLs
    if (isAbsoluteUrl(entry.destination)) {
      const ssrfError = validateSsrf(entry.destination);
      if (ssrfError) {
        // Non-retryable: dead-letter immediately by maxing out attempts
        await pool.query(
          `UPDATE webhook_outbox
           SET attempts = $2,
               last_error = $3,
               locked_at = NULL,
               locked_by = NULL,
               updated_at = NOW()
           WHERE id = $1 AND locked_by = $4`,
          [entry.id, MAX_RETRIES, `SSRF blocked at dispatch: ${ssrfError}`, workerId],
        );
        stats.failed++;
        console.warn(`[Webhooks] SSRF blocked ${entry.kind} to ${sanitizeDestination(entry.destination)}: ${ssrfError}`);
        continue;
      }
    }

    const result = await dispatchWebhook(entry);

    if (result.success) {
      await markDispatched(pool, entry.id, workerId);
      stats.succeeded++;
      console.log(`[Webhooks] Dispatched ${entry.kind} to ${sanitizeDestination(entry.destination)}`);
    } else {
      if (!isRetryable(result.statusCode)) {
        // Non-retryable failure: dead-letter immediately
        await pool.query(
          `UPDATE webhook_outbox
           SET attempts = $2,
               last_error = $3,
               locked_at = NULL,
               locked_by = NULL,
               updated_at = NOW()
           WHERE id = $1 AND locked_by = $4`,
          [entry.id, MAX_RETRIES, truncateForLog(result.error || 'Unknown error'), workerId],
        );
        stats.failed++;
        console.warn(`[Webhooks] Non-retryable failure for ${entry.kind} (HTTP ${result.statusCode}), dead-lettered`);
      } else {
        await recordFailure(pool, entry.id, result.error || 'Unknown error', workerId);
        stats.failed++;
        console.warn(`[Webhooks] Failed to dispatch ${entry.kind}: ${truncateForLog(result.error || 'Unknown error')}`);
      }
    }
  }

  // Check for dead-lettered entries and warn
  const deadLetterResult = await pool.query(
    `SELECT COUNT(*) as count FROM webhook_outbox WHERE dispatched_at IS NULL AND attempts >= $1`,
    [MAX_RETRIES],
  );
  const deadLetterCount = parseInt((deadLetterResult.rows[0] as { count: string }).count, 10);
  if (deadLetterCount > 0) {
    console.warn(`[Webhooks] ${deadLetterCount} dead-lettered webhook(s) in outbox`);
  }

  return stats;
}

/**
 * Enqueue a webhook for dispatch.
 */
export async function enqueueWebhook(
  pool: Pool,
  kind: string,
  destination: string,
  body: Record<string, unknown>,
  options: {
    headers?: Record<string, string>;
    runAt?: Date;
    idempotencyKey?: string;
  } = {},
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO webhook_outbox (kind, destination, body, headers, run_at, idempotency_key)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, COALESCE($5, NOW()), $6)
     ON CONFLICT (kind, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING id::text as id`,
    [kind, destination, JSON.stringify(body), JSON.stringify(options.headers || {}), options.runAt || null, options.idempotencyKey || null],
  );

  if (result.rows.length === 0) {
    // Idempotency key collision - return existing entry ID
    const existing = await pool.query(`SELECT id::text as id FROM webhook_outbox WHERE kind = $1 AND idempotency_key = $2`, [kind, options.idempotencyKey]);
    return (existing.rows[0] as { id: string }).id;
  }

  return (result.rows[0] as { id: string }).id;
}

/**
 * Retry a specific webhook entry.
 */
export async function retryWebhook(pool: Pool, entryId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE webhook_outbox
     SET run_at = NOW(),
         attempts = 0,
         last_error = NULL,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND dispatched_at IS NULL
     RETURNING id`,
    [entryId],
  );

  return result.rowCount === 1;
}

/**
 * Get webhook outbox entries with filtering.
 */
export async function getWebhookOutbox(
  pool: Pool,
  options: {
    status?: 'pending' | 'failed' | 'dispatched';
    kind?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ entries: WebhookOutboxEntry[]; total: number }> {
  const { status, kind, limit = 50, offset = 0 } = options;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (status === 'pending') {
    conditions.push(`dispatched_at IS NULL AND attempts < ${MAX_RETRIES}`);
  } else if (status === 'failed') {
    conditions.push(`dispatched_at IS NULL AND attempts >= ${MAX_RETRIES}`);
  } else if (status === 'dispatched') {
    conditions.push('dispatched_at IS NOT NULL');
  }

  if (kind) {
    conditions.push(`kind = $${paramIndex}`);
    params.push(kind);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as count FROM webhook_outbox ${whereClause}`, params);
  const total = parseInt((countResult.rows[0] as { count: string }).count, 10);

  // Get entries
  params.push(limit, offset);
  const result = await pool.query(
    `SELECT
       id::text as id,
       kind,
       destination,
       run_at as "runAt",
       headers,
       body,
       attempts,
       last_error as "lastError",
       locked_at as "lockedAt",
       locked_by as "lockedBy",
       dispatched_at as "dispatchedAt",
       idempotency_key as "idempotencyKey",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM webhook_outbox
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return {
    entries: result.rows as WebhookOutboxEntry[],
    total,
  };
}
