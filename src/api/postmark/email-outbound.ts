/**
 * Postmark email outbound sending service.
 * Part of Issue #293.
 */

import type { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { normalizeEmail, createEmailThreadKey } from './email-utils.ts';
import { getPostmarkConfig, isPostmarkConfigured } from './config.ts';
import { sendPostmarkEmail, type PostmarkEmail } from '../../email/postmark.ts';
import type { InternalJob, JobProcessorResult } from '../jobs/types.ts';

/**
 * Request to send an email message.
 */
export interface SendEmailRequest {
  /** Recipient email address */
  to: string;
  /** Email subject */
  subject: string;
  /** Plain text body */
  body: string;
  /** Optional HTML body */
  htmlBody?: string;
  /** Optional: link to existing thread */
  threadId?: string;
  /** Optional: In-Reply-To header value for threading */
  replyToMessageId?: string;
  /** Optional: client-provided idempotency key */
  idempotencyKey?: string;
}

/**
 * Response from enqueueing an email message.
 */
export interface SendEmailResponse {
  /** Our internal message ID */
  messageId: string;
  /** Thread ID for the conversation */
  threadId: string;
  /** Always 'queued' (async) */
  status: 'queued';
  /** Idempotency key for duplicate detection */
  idempotencyKey: string;
}

/**
 * Simple email validation regex.
 * More strict validation happens server-side via Postmark.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate an email address format.
 */
function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);

  if (!EMAIL_REGEX.test(normalized)) {
    throw new Error(`Invalid email address: ${email}`);
  }

  return normalized;
}

/**
 * Validate message fields.
 */
function validateEmailFields(subject: string, body: string): void {
  if (!subject || subject.trim().length === 0) {
    throw new Error('Subject is required and cannot be empty');
  }

  if (!body || body.trim().length === 0) {
    throw new Error('Body is required and cannot be empty');
  }
}

/**
 * Find or create contact endpoint for an email address.
 */
async function findOrCreateEndpoint(client: PoolClient, email: string): Promise<{ contactId: string; endpointId: string; isNew: boolean }> {
  // Try to find existing endpoint
  const existing = await client.query(
    `SELECT ce.id::text as endpoint_id, ce.contact_id::text as contact_id
     FROM contact_endpoint ce
     WHERE ce.endpoint_type = 'email'
       AND ce.normalized_value = normalize_contact_endpoint_value('email', $1)
     LIMIT 1`,
    [email],
  );

  if (existing.rows.length > 0) {
    return {
      contactId: existing.rows[0].contact_id,
      endpointId: existing.rows[0].endpoint_id,
      isNew: false,
    };
  }

  // Create new contact with email as display name
  const contact = await client.query(
    `INSERT INTO contact (display_name)
     VALUES ($1)
     RETURNING id::text as id`,
    [email],
  );
  const contactId = contact.rows[0].id;

  // Create endpoint
  const endpoint = await client.query(
    `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
     VALUES ($1, 'email', $2, $3::jsonb)
     RETURNING id::text as id`,
    [contactId, email, JSON.stringify({ source: 'outbound_email' })],
  );
  const endpointId = endpoint.rows[0].id;

  return { contactId, endpointId, isNew: true };
}

/**
 * Find or create thread for email conversation.
 */
async function findOrCreateThread(client: PoolClient, endpointId: string, toEmail: string, fromEmail: string, replyToMessageId?: string): Promise<string> {
  // Create thread key based on conversation participants
  // If replying, use the message ID for threading
  const threadKey = replyToMessageId
    ? createEmailThreadKey(replyToMessageId, null, [])
    : createEmailThreadKey(null, null, []) + ':' + [toEmail, fromEmail].sort().join(':');

  const result = await client.query(
    `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, metadata)
     VALUES ($1, 'email', $2, $3::jsonb)
     ON CONFLICT (channel, external_thread_key)
     DO UPDATE SET endpoint_id = EXCLUDED.endpoint_id, updated_at = now()
     RETURNING id::text as id`,
    [endpointId, threadKey, JSON.stringify({ toEmail, fromEmail, source: 'postmark_outbound' })],
  );

  return result.rows[0].id;
}

/**
 * Check for existing message with same idempotency key.
 */
async function findExistingMessage(client: PoolClient, idempotencyKey: string): Promise<{ messageId: string; threadId: string } | null> {
  const result = await client.query(
    `SELECT em.id::text as message_id, em.thread_id::text as thread_id
     FROM external_message em
     WHERE em.raw->>'idempotency_key' = $1
     LIMIT 1`,
    [idempotencyKey],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    messageId: result.rows[0].message_id,
    threadId: result.rows[0].thread_id,
  };
}

/**
 * Enqueue an email message for sending.
 *
 * This function:
 * 1. Validates the email address and message fields
 * 2. Creates or finds the contact/endpoint for the recipient
 * 3. Creates or finds the email thread
 * 4. Stores the message with status=pending
 * 5. Enqueues a job to send via Postmark
 *
 * Returns immediately (<100ms target) - actual sending is async.
 */
export async function enqueueEmailMessage(pool: Pool, request: SendEmailRequest): Promise<SendEmailResponse> {
  // Validate inputs
  const toEmail = validateEmail(request.to);
  validateEmailFields(request.subject, request.body);

  // Get configured from email (or placeholder for tests)
  const fromEmail = isPostmarkConfigured() ? process.env.POSTMARK_FROM_EMAIL! : 'noreply@example.com';

  // Generate idempotency key if not provided
  const idempotencyKey = request.idempotencyKey || `email:${uuidv4()}`;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for existing message with same idempotency key
    const existing = await findExistingMessage(client, idempotencyKey);
    if (existing) {
      await client.query('COMMIT');
      return {
        messageId: existing.messageId,
        threadId: existing.threadId,
        status: 'queued',
        idempotencyKey,
      };
    }

    // Find or create contact/endpoint
    const { endpointId } = await findOrCreateEndpoint(client, toEmail);

    // Find or create thread
    let threadId: string;
    if (request.threadId) {
      // Verify thread exists
      const thread = await client.query(`SELECT id FROM external_thread WHERE id = $1`, [request.threadId]);
      if (thread.rows.length === 0) {
        throw new Error(`Thread not found: ${request.threadId}`);
      }
      threadId = request.threadId;
    } else {
      threadId = await findOrCreateThread(client, endpointId, toEmail, fromEmail, request.replyToMessageId);
    }

    // Generate message key
    const messageKey = `outbound:${uuidv4()}`;

    // Insert message with pending status
    const message = await client.query(
      `INSERT INTO external_message (
         thread_id, external_message_key, direction, body, delivery_status,
         subject, from_address, to_addresses, raw
       )
       VALUES ($1, $2, 'outbound', $3, 'pending', $4, $5, $6, $7::jsonb)
       RETURNING id::text as id`,
      [
        threadId,
        messageKey,
        request.body,
        request.subject,
        fromEmail,
        [toEmail],
        JSON.stringify({
          to: toEmail,
          from: fromEmail,
          subject: request.subject,
          body: request.body,
          htmlBody: request.htmlBody,
          replyToMessageId: request.replyToMessageId,
          idempotency_key: idempotencyKey,
        }),
      ],
    );
    const messageId = message.rows[0].id;

    // Enqueue job for sending
    await client.query(`SELECT internal_job_enqueue($1, now(), $2, $3)`, [
      'message.send.email',
      JSON.stringify({
        message_id: messageId,
        to: toEmail,
        from: fromEmail,
        subject: request.subject,
        body: request.body,
        htmlBody: request.htmlBody,
        replyToMessageId: request.replyToMessageId,
      }),
      idempotencyKey,
    ]);

    await client.query('COMMIT');

    return {
      messageId,
      threadId,
      status: 'queued',
      idempotencyKey,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Handle a message.send.email job.
 *
 * This function:
 * 1. Sends the email via Postmark API
 * 2. Updates the message status and provider_message_id
 * 3. Returns success/failure for the job processor
 */
export async function handleEmailSendJob(pool: Pool, job: InternalJob): Promise<JobProcessorResult> {
  const payload = job.payload as {
    message_id: string;
    to: string;
    from?: string;
    subject: string;
    body: string;
    htmlBody?: string;
    replyToMessageId?: string;
  };

  if (!payload.message_id || !payload.to || !payload.subject || !payload.body) {
    return {
      success: false,
      error: 'Invalid job payload: missing required fields',
    };
  }

  // Check if Postmark is configured
  if (!isPostmarkConfigured()) {
    await pool.query(
      `UPDATE external_message
       SET delivery_status = 'failed',
           provider_status_raw = $2::jsonb
       WHERE id = $1`,
      [payload.message_id, JSON.stringify({ error: 'Postmark not configured' })],
    );
    throw new Error('Postmark not configured');
  }

  try {
    // Update status to sending
    await pool.query(`UPDATE external_message SET delivery_status = 'sending' WHERE id = $1`, [payload.message_id]);

    // Get Postmark config
    const config = await getPostmarkConfig();

    // Build email payload
    const email: PostmarkEmail = {
      From: payload.from || config.fromEmail,
      To: payload.to,
      Subject: payload.subject,
      TextBody: payload.body,
    };

    if (payload.htmlBody) {
      email.HtmlBody = payload.htmlBody;
    }

    // Add threading headers if replying
    if (payload.replyToMessageId) {
      // Note: Postmark doesn't directly support In-Reply-To header via their API
      // For full threading support, we'd need to use their raw email endpoint
      // For now, we store the info but don't add the header
    }

    // Send via Postmark
    const result = await sendPostmarkEmail(config.serverToken, email);

    // Update message with provider info
    await pool.query(
      `UPDATE external_message
       SET delivery_status = 'sent',
           provider_message_id = $2,
           provider_status_raw = $3::jsonb
       WHERE id = $1`,
      [
        payload.message_id,
        result.MessageID,
        JSON.stringify({
          MessageID: result.MessageID,
          To: result.To,
          SubmittedAt: result.SubmittedAt,
          ErrorCode: result.ErrorCode,
          Message: result.Message,
        }),
      ],
    );

    console.log(`[Postmark] Email sent: messageId=${payload.message_id}, postmarkId=${result.MessageID}`);

    return { success: true };
  } catch (error) {
    const err = error as Error;

    // Update message to failed
    await pool.query(
      `UPDATE external_message
       SET delivery_status = 'failed',
           provider_status_raw = $2::jsonb
       WHERE id = $1`,
      [payload.message_id, JSON.stringify({ error: err.message })],
    );

    console.error(`[Postmark] Email send failed: messageId=${payload.message_id}`, err);

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Get the configured Postmark from email.
 */
export function getConfiguredFromEmail(): string | null {
  return process.env.POSTMARK_FROM_EMAIL || null;
}
