/**
 * Internal job processor.
 * Processes jobs from internal_job table and dispatches actions.
 * Part of Issue #222.
 */

import type { Pool } from 'pg';
import type {
  InternalJob,
  JobProcessorResult,
  JobProcessorStats,
  JobHandler,
} from './types.js';
import { enqueueWebhook } from '../webhooks/dispatcher.js';
import {
  buildReminderDuePayload,
  buildDeadlineApproachingPayload,
  getWebhookDestination,
} from '../webhooks/payloads.js';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 5;

/**
 * Generate a unique worker ID for locking.
 */
function getWorkerId(): string {
  return `job-worker-${process.pid}-${Date.now()}`;
}

/**
 * Claim pending jobs for processing.
 */
export async function claimJobs(
  pool: Pool,
  workerId: string,
  limit: number = 10
): Promise<InternalJob[]> {
  const result = await pool.query(
    `SELECT
       id::text as id,
       kind,
       run_at as "runAt",
       payload,
       attempts,
       last_error as "lastError",
       locked_at as "lockedAt",
       locked_by as "lockedBy",
       completed_at as "completedAt",
       idempotency_key as "idempotencyKey",
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM internal_job_claim($1, $2)`,
    [workerId, limit]
  );

  return result.rows as InternalJob[];
}

/**
 * Mark a job as completed.
 */
export async function completeJob(
  pool: Pool,
  jobId: string
): Promise<void> {
  await pool.query(`SELECT internal_job_complete($1)`, [jobId]);
}

/**
 * Mark a job as failed with retry.
 */
export async function failJob(
  pool: Pool,
  jobId: string,
  error: string,
  retrySeconds: number = 60
): Promise<void> {
  await pool.query(`SELECT internal_job_fail($1, $2, $3)`, [
    jobId,
    error,
    retrySeconds,
  ]);
}

/**
 * Handle reminder.work_item.not_before job.
 * Fetches work item details and enqueues a webhook.
 */
async function handleReminderJob(
  pool: Pool,
  job: InternalJob
): Promise<JobProcessorResult> {
  const workItemId = job.payload.work_item_id as string;
  const notBefore = new Date(job.payload.not_before as string);

  // Fetch work item details
  const workItemResult = await pool.query(
    `SELECT
       id::text as id,
       title,
       description,
       work_item_kind::text as kind,
       status
     FROM work_item
     WHERE id = $1`,
    [workItemId]
  );

  if (workItemResult.rows.length === 0) {
    return {
      success: false,
      error: `Work item ${workItemId} not found`,
    };
  }

  const workItem = workItemResult.rows[0] as {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
  };

  // Skip if already completed
  if (['completed', 'cancelled', 'archived', 'done'].includes(workItem.status)) {
    return { success: true }; // Silently skip completed items
  }

  // Build the webhook payload
  const payload = buildReminderDuePayload({
    workItemId: workItem.id,
    workItemTitle: workItem.title,
    workItemDescription: workItem.description || undefined,
    workItemKind: workItem.kind,
    notBefore,
  });

  const destination = getWebhookDestination('reminder_due');
  const idempotencyKey = `reminder:${workItemId}:${notBefore.toISOString().split('T')[0]}`;

  // Enqueue the webhook
  await enqueueWebhook(pool, 'reminder.work_item.not_before', destination, payload, {
    idempotencyKey,
  });

  return { success: true };
}

/**
 * Handle nudge.work_item.not_after job.
 * Fetches work item details and enqueues a webhook.
 */
async function handleNudgeJob(
  pool: Pool,
  job: InternalJob
): Promise<JobProcessorResult> {
  const workItemId = job.payload.work_item_id as string;
  const notAfter = new Date(job.payload.not_after as string);

  // Fetch work item details
  const workItemResult = await pool.query(
    `SELECT
       id::text as id,
       title,
       work_item_kind::text as kind,
       status
     FROM work_item
     WHERE id = $1`,
    [workItemId]
  );

  if (workItemResult.rows.length === 0) {
    return {
      success: false,
      error: `Work item ${workItemId} not found`,
    };
  }

  const workItem = workItemResult.rows[0] as {
    id: string;
    title: string;
    kind: string;
    status: string;
  };

  // Skip if already completed
  if (['completed', 'cancelled', 'archived', 'done'].includes(workItem.status)) {
    return { success: true };
  }

  // Calculate hours remaining
  const hoursRemaining = Math.max(
    0,
    Math.round((notAfter.getTime() - Date.now()) / (1000 * 60 * 60))
  );

  // Build the webhook payload
  const payload = buildDeadlineApproachingPayload({
    workItemId: workItem.id,
    workItemTitle: workItem.title,
    workItemKind: workItem.kind,
    notAfter,
    hoursRemaining,
  });

  const destination = getWebhookDestination('deadline_approaching');
  const idempotencyKey = `nudge:${workItemId}:${notAfter.toISOString().split('T')[0]}`;

  // Enqueue the webhook
  await enqueueWebhook(pool, 'nudge.work_item.not_after', destination, payload, {
    idempotencyKey,
  });

  return { success: true };
}

/**
 * Get handler for a job kind.
 */
function getJobHandler(
  pool: Pool,
  kind: string
): ((job: InternalJob) => Promise<JobProcessorResult>) | null {
  switch (kind) {
    case 'reminder.work_item.not_before':
      return (job) => handleReminderJob(pool, job);
    case 'nudge.work_item.not_after':
      return (job) => handleNudgeJob(pool, job);
    default:
      return null;
  }
}

/**
 * Process pending internal jobs.
 */
export async function processJobs(
  pool: Pool,
  limit: number = 10
): Promise<JobProcessorStats> {
  const workerId = getWorkerId();
  const jobs = await claimJobs(pool, workerId, limit);

  const stats: JobProcessorStats = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const job of jobs) {
    stats.processed++;

    const handler = getJobHandler(pool, job.kind);

    if (!handler) {
      console.warn(`[Jobs] Unknown job kind: ${job.kind}`);
      await failJob(pool, job.id, `Unknown job kind: ${job.kind}`);
      stats.failed++;
      continue;
    }

    try {
      const result = await handler(job);

      if (result.success) {
        await completeJob(pool, job.id);
        stats.succeeded++;
        console.log(`[Jobs] Completed ${job.kind} job ${job.id}`);
      } else {
        const retrySeconds = Math.pow(2, job.attempts) * 60; // Exponential backoff
        await failJob(pool, job.id, result.error || 'Unknown error', retrySeconds);
        stats.failed++;
        console.warn(`[Jobs] Failed ${job.kind} job ${job.id}: ${result.error}`);
      }
    } catch (error) {
      const err = error as Error;
      const retrySeconds = Math.pow(2, job.attempts) * 60;
      await failJob(pool, job.id, err.message, retrySeconds);
      stats.failed++;
      console.error(`[Jobs] Error processing ${job.kind} job ${job.id}:`, err);
    }
  }

  return stats;
}

/**
 * Get pending job count by kind.
 */
export async function getPendingJobCounts(
  pool: Pool
): Promise<Record<string, number>> {
  const result = await pool.query(
    `SELECT kind, COUNT(*) as count
     FROM internal_job
     WHERE completed_at IS NULL
     GROUP BY kind`
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    const r = row as { kind: string; count: string };
    counts[r.kind] = parseInt(r.count, 10);
  }

  return counts;
}
