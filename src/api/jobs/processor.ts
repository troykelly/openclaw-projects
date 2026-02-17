/**
 * Internal job processor.
 * Processes jobs from internal_job table and dispatches actions.
 * Part of Issue #222.
 */

import type { Pool } from 'pg';
import type { InternalJob, JobProcessorResult, JobProcessorStats, JobHandler } from './types.ts';
import { enqueueWebhook } from '../webhooks/dispatcher.ts';
import { buildReminderDuePayload, buildDeadlineApproachingPayload, getWebhookDestination } from '../webhooks/payloads.ts';
import { handleSmsSendJob } from '../twilio/sms-outbound.ts';
import { handleEmailSendJob } from '../postmark/email-outbound.ts';
import { handleMessageEmbedJob } from '../embeddings/message-integration.ts';
import { handleSkillStoreEmbedJob } from '../embeddings/skill-store-integration.ts';
import { handleContactSyncJob } from './sync-handler.ts';
import { computeNextRunAt } from '../skill-store/schedule-next-run.ts';

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
export async function claimJobs(pool: Pool, workerId: string, limit: number = 10): Promise<InternalJob[]> {
  const result = await pool.query(
    `SELECT
       id::text as id,
       kind,
       run_at as "run_at",
       payload,
       attempts,
       last_error as "last_error",
       locked_at as "locked_at",
       locked_by as "locked_by",
       completed_at as "completed_at",
       idempotency_key as "idempotency_key",
       created_at as "created_at",
       updated_at as "updated_at"
     FROM internal_job_claim($1, $2)`,
    [workerId, limit],
  );

  return result.rows as InternalJob[];
}

/**
 * Mark a job as completed.
 * Passes workerId for lock-owner verification (migration 063+).
 */
export async function completeJob(pool: Pool, jobId: string, workerId?: string): Promise<void> {
  if (workerId) {
    await pool.query(`SELECT internal_job_complete($1, $2)`, [jobId, workerId]);
  } else {
    await pool.query(`SELECT internal_job_complete($1)`, [jobId]);
  }
}

/**
 * Mark a job as failed with retry.
 * Passes workerId for lock-owner verification (migration 063+).
 */
export async function failJob(pool: Pool, jobId: string, error: string, retrySeconds: number = 60, workerId?: string): Promise<void> {
  if (workerId) {
    await pool.query(`SELECT internal_job_fail($1, $2, $3, $4)`, [jobId, error, retrySeconds, workerId]);
  } else {
    await pool.query(`SELECT internal_job_fail($1, $2, $3)`, [jobId, error, retrySeconds]);
  }
}

/**
 * Handle reminder.work_item.not_before job.
 * Fetches work item details and enqueues a webhook.
 */
async function handleReminderJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const work_item_id = job.payload.work_item_id as string;
  const notBefore = new Date(job.payload.not_before as string);

  // Fetch work item details
  const workItemResult = await pool.query(
    `SELECT
       id::text as id,
       title,
       description,
       work_item_kind::text as kind,
       status,
       user_email
     FROM work_item
     WHERE id = $1`,
    [work_item_id],
  );

  if (workItemResult.rows.length === 0) {
    return {
      success: false,
      error: `Work item ${work_item_id} not found`,
    };
  }

  const workItem = workItemResult.rows[0] as {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    user_email: string | null;
  };

  // Skip if already completed
  if (['completed', 'cancelled', 'archived', 'done'].includes(workItem.status)) {
    return { success: true }; // Silently skip completed items
  }

  // Build the webhook payload
  const payload = buildReminderDuePayload({
    work_item_id: workItem.id,
    work_item_title: workItem.title,
    work_item_description: workItem.description || undefined,
    work_item_kind: workItem.kind,
    not_before: notBefore,
    agent_id: workItem.user_email || undefined,
  });

  const destination = getWebhookDestination('reminder_due');
  const idempotency_key = `reminder:${work_item_id}:${notBefore.toISOString().split('T')[0]}`;

  // Enqueue the webhook
  await enqueueWebhook(pool, 'reminder.work_item.not_before', destination, payload, {
    idempotency_key,
  });

  return { success: true };
}

/**
 * Handle nudge.work_item.not_after job.
 * Fetches work item details and enqueues a webhook.
 */
async function handleNudgeJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const work_item_id = job.payload.work_item_id as string;
  const notAfter = new Date(job.payload.not_after as string);

  // Fetch work item details
  const workItemResult = await pool.query(
    `SELECT
       id::text as id,
       title,
       work_item_kind::text as kind,
       status,
       user_email
     FROM work_item
     WHERE id = $1`,
    [work_item_id],
  );

  if (workItemResult.rows.length === 0) {
    return {
      success: false,
      error: `Work item ${work_item_id} not found`,
    };
  }

  const workItem = workItemResult.rows[0] as {
    id: string;
    title: string;
    kind: string;
    status: string;
    user_email: string | null;
  };

  // Skip if already completed
  if (['completed', 'cancelled', 'archived', 'done'].includes(workItem.status)) {
    return { success: true };
  }

  // Calculate hours remaining
  const hoursRemaining = Math.max(0, Math.round((notAfter.getTime() - Date.now()) / (1000 * 60 * 60)));

  // Build the webhook payload
  const payload = buildDeadlineApproachingPayload({
    work_item_id: workItem.id,
    work_item_title: workItem.title,
    work_item_kind: workItem.kind,
    not_after: notAfter,
    hours_remaining: hoursRemaining,
    agent_id: workItem.user_email || undefined,
  });

  const destination = getWebhookDestination('deadline_approaching');
  const idempotency_key = `nudge:${work_item_id}:${notAfter.toISOString().split('T')[0]}`;

  // Enqueue the webhook
  await enqueueWebhook(pool, 'nudge.work_item.not_after', destination, payload, {
    idempotency_key,
  });

  return { success: true };
}

/**
 * Handle skill_store.scheduled_process job.
 * Reads schedule, fires webhook via webhook_outbox, updates last_run_at/status.
 * Respects max_retries from payload; after max consecutive failures, auto-disables.
 */
async function handleScheduledProcessJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const payload = job.payload as {
    schedule_id?: string;
    skill_id?: string;
    collection?: string | null;
    webhook_url?: string;
    webhook_headers?: Record<string, string>;
    payload_template?: Record<string, unknown>;
    max_retries?: number;
    consecutive_failures?: number;
    manual_trigger?: boolean;
  };

  if (!payload.schedule_id) {
    return {
      success: false,
      error: 'Invalid job payload: missing schedule_id',
    };
  }

  // Verify schedule still exists and read current state from DB
  const scheduleResult = await pool.query(
    `SELECT id::text as id, skill_id, collection, webhook_url, webhook_headers,
            payload_template, max_retries, enabled, consecutive_failures,
            cron_expression, timezone
     FROM skill_store_schedule WHERE id = $1`,
    [payload.schedule_id],
  );

  if (scheduleResult.rows.length === 0) {
    return {
      success: false,
      error: `Schedule ${payload.schedule_id} not found`,
    };
  }

  const schedule = scheduleResult.rows[0] as {
    id: string;
    skill_id: string;
    collection: string | null;
    webhook_url: string;
    webhook_headers: Record<string, string>;
    payload_template: Record<string, unknown>;
    max_retries: number;
    enabled: boolean;
    consecutive_failures: number;
    cron_expression: string;
    timezone: string;
  };

  // Read consecutive_failures from DB (Issue #825: was previously read from
  // payload where it was never set, making auto-disable dead code)
  const consecutiveFailures = schedule.consecutive_failures;
  const maxRetries = schedule.max_retries;

  if (consecutiveFailures >= maxRetries) {
    // Auto-disable the schedule after max_retries consecutive failures
    await pool.query(
      `UPDATE skill_store_schedule
       SET enabled = false, last_run_status = 'failed', last_run_at = NOW()
       WHERE id = $1`,
      [schedule.id],
    );

    console.warn(`[Jobs] Auto-disabled schedule ${schedule.id} after ${consecutiveFailures} consecutive failures`);

    return { success: true };
  }

  // Build the webhook payload: merge payload_template + runtime data
  const webhookBody: Record<string, unknown> = {
    ...(schedule.payload_template || {}),
    skill_id: schedule.skill_id,
    collection: schedule.collection,
    schedule_id: schedule.id,
    triggered_at: new Date().toISOString(),
  };

  if (payload.manual_trigger) {
    webhookBody.manual_trigger = true;
  }

  try {
    // Enqueue to webhook_outbox for reliable delivery
    const idempotency_key = `schedule:${schedule.id}:${new Date().toISOString().slice(0, 16)}`;
    await enqueueWebhook(pool, 'skill_store.scheduled_process', schedule.webhook_url, webhookBody, {
      headers: schedule.webhook_headers || undefined,
      idempotency_key,
    });

    // Update schedule with success; reset consecutive_failures and advance next_run_at (Issue #825, #1356)
    const nextRunAt = computeNextRunAt(schedule.cron_expression, schedule.timezone);
    await pool.query(
      `UPDATE skill_store_schedule
       SET last_run_at = NOW(), last_run_status = 'success', consecutive_failures = 0, next_run_at = $2
       WHERE id = $1`,
      [schedule.id, nextRunAt],
    );

    return { success: true };
  } catch (error) {
    const err = error as Error;

    // Update schedule with failure; increment consecutive_failures and advance next_run_at (Issue #825, #1356)
    const failNextRunAt = computeNextRunAt(schedule.cron_expression, schedule.timezone);
    await pool.query(
      `UPDATE skill_store_schedule
       SET last_run_at = NOW(), last_run_status = 'failed',
           consecutive_failures = consecutive_failures + 1, next_run_at = $2
       WHERE id = $1`,
      [schedule.id, failNextRunAt],
    );

    return {
      success: false,
      error: `Failed to enqueue webhook for schedule ${schedule.id}: ${err.message}`,
    };
  }
}

/**
 * Get handler for a job kind.
 */
function getJobHandler(pool: Pool, kind: string): ((job: InternalJob) => Promise<JobProcessorResult>) | null {
  switch (kind) {
    case 'reminder.work_item.not_before':
      return (job) => handleReminderJob(pool, job);
    case 'nudge.work_item.not_after':
      return (job) => handleNudgeJob(pool, job);
    case 'message.send.sms':
      return (job) => handleSmsSendJob(pool, job);
    case 'message.send.email':
      return (job) => handleEmailSendJob(pool, job);
    case 'message.embed':
      return (job) => handleMessageEmbedJob(pool, job);
    case 'skill_store.embed':
      return (job) => handleSkillStoreEmbedJob(pool, job);
    case 'skill_store.scheduled_process':
      return (job) => handleScheduledProcessJob(pool, job);
    case 'oauth.sync.contacts':
      return (job) => handleContactSyncJob(pool, job);
    default:
      return null;
  }
}

/**
 * Process pending internal jobs.
 */
export async function processJobs(pool: Pool, limit: number = 10): Promise<JobProcessorStats> {
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
      // Dead-letter unknown job kinds: complete (don't retry) so they stop cycling
      console.error(`[Jobs] Dead-lettered unknown job kind: ${job.kind} (job ${job.id})`);
      await completeJob(pool, job.id, workerId);
      stats.failed++;
      continue;
    }

    try {
      const result = await handler(job);

      if (result.success) {
        await completeJob(pool, job.id, workerId);
        stats.succeeded++;
        console.log(`[Jobs] Completed ${job.kind} job ${job.id}`);
      } else {
        const retrySeconds = Math.pow(2, job.attempts) * 60; // Exponential backoff
        await failJob(pool, job.id, result.error || 'Unknown error', retrySeconds, workerId);
        stats.failed++;
        console.warn(`[Jobs] Failed ${job.kind} job ${job.id}: ${result.error}`);
      }
    } catch (error) {
      const err = error as Error;
      const retrySeconds = Math.pow(2, job.attempts) * 60;
      await failJob(pool, job.id, err.message, retrySeconds, workerId);
      stats.failed++;
      console.error(`[Jobs] Error processing ${job.kind} job ${job.id}:`, err);
    }
  }

  return stats;
}

/**
 * Get pending job count by kind.
 */
export async function getPendingJobCounts(pool: Pool): Promise<Record<string, number>> {
  const result = await pool.query(
    `SELECT kind, COUNT(*) as count
     FROM internal_job
     WHERE completed_at IS NULL
     GROUP BY kind`,
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    const r = row as { kind: string; count: string };
    counts[r.kind] = parseInt(r.count, 10);
  }

  return counts;
}
