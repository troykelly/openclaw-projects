/**
 * Twilio SMS outbound sending service.
 * Part of Issue #291.
 */

import type { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhoneNumber, createSmsThreadKey } from './phone-utils.ts';
import { getTwilioConfig, requireTwilioClient, isTwilioConfigured } from './config.ts';
import type { E164PhoneNumber } from './types.ts';
import type { InternalJob, JobProcessorResult } from '../jobs/types.ts';

/**
 * Request to send an SMS message.
 */
export interface SendSmsRequest {
  /** Recipient phone number (will be normalized to E.164) */
  to: string;
  /** Message body */
  body: string;
  /** Optional: link to existing thread */
  threadId?: string;
  /** Optional: client-provided idempotency key */
  idempotencyKey?: string;
}

/**
 * Response from enqueueing an SMS message.
 */
export interface SendSmsResponse {
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
 * Validate a phone number is in E.164 format or can be converted.
 */
function validatePhoneNumber(phone: string): E164PhoneNumber {
  // Strip non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');

  // Must have at least some digits
  if (cleaned.replace(/\D/g, '').length < 7) {
    throw new Error(`Invalid phone number: ${phone}`);
  }

  return normalizePhoneNumber(phone);
}

/**
 * Validate message body.
 */
function validateMessageBody(body: string): void {
  if (!body || body.trim().length === 0) {
    throw new Error('Message body is required and cannot be empty');
  }
}

/**
 * Find or create contact endpoint for a phone number.
 */
async function findOrCreateEndpoint(
  client: PoolClient,
  phone: E164PhoneNumber
): Promise<{ contactId: string; endpointId: string; isNew: boolean }> {
  // Try to find existing endpoint
  const existing = await client.query(
    `SELECT ce.id::text as endpoint_id, ce.contact_id::text as contact_id
     FROM contact_endpoint ce
     WHERE ce.endpoint_type = 'phone'
       AND ce.normalized_value = normalize_contact_endpoint_value('phone', $1)
     LIMIT 1`,
    [phone]
  );

  if (existing.rows.length > 0) {
    return {
      contactId: existing.rows[0].contact_id,
      endpointId: existing.rows[0].endpoint_id,
      isNew: false,
    };
  }

  // Create new contact with phone as display name
  const contact = await client.query(
    `INSERT INTO contact (display_name)
     VALUES ($1)
     RETURNING id::text as id`,
    [phone]
  );
  const contactId = contact.rows[0].id;

  // Create endpoint
  const endpoint = await client.query(
    `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
     VALUES ($1, 'phone', $2, $3::jsonb)
     RETURNING id::text as id`,
    [contactId, phone, JSON.stringify({ source: 'outbound_sms' })]
  );
  const endpointId = endpoint.rows[0].id;

  return { contactId, endpointId, isNew: true };
}

/**
 * Find or create thread for SMS conversation.
 */
async function findOrCreateThread(
  client: PoolClient,
  endpointId: string,
  fromPhone: E164PhoneNumber,
  toPhone: E164PhoneNumber
): Promise<string> {
  const threadKey = createSmsThreadKey(fromPhone, toPhone);

  const result = await client.query(
    `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, metadata)
     VALUES ($1, 'phone', $2, $3::jsonb)
     ON CONFLICT (channel, external_thread_key)
     DO UPDATE SET endpoint_id = EXCLUDED.endpoint_id, updated_at = now()
     RETURNING id::text as id`,
    [
      endpointId,
      threadKey,
      JSON.stringify({ fromPhone, toPhone, source: 'twilio_outbound' }),
    ]
  );

  return result.rows[0].id;
}

/**
 * Check for existing message with same idempotency key.
 */
async function findExistingMessage(
  client: PoolClient,
  idempotencyKey: string
): Promise<{ messageId: string; threadId: string } | null> {
  const result = await client.query(
    `SELECT em.id::text as message_id, em.thread_id::text as thread_id
     FROM external_message em
     WHERE em.raw->>'idempotency_key' = $1
     LIMIT 1`,
    [idempotencyKey]
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
 * Enqueue an SMS message for sending.
 *
 * This function:
 * 1. Validates the phone number and message body
 * 2. Creates or finds the contact/endpoint for the recipient
 * 3. Creates or finds the SMS thread
 * 4. Stores the message with status=pending
 * 5. Enqueues a job to send via Twilio
 *
 * Returns immediately (<100ms target) - actual sending is async.
 */
export async function enqueueSmsMessage(
  pool: Pool,
  request: SendSmsRequest
): Promise<SendSmsResponse> {
  // Validate inputs
  const toPhone = validatePhoneNumber(request.to);
  validateMessageBody(request.body);

  // Get configured from number (for thread key)
  const fromPhone = isTwilioConfigured()
    ? normalizePhoneNumber(getTwilioConfig().fromNumber)
    : '+10000000000'; // Placeholder for tests

  // Generate idempotency key if not provided
  const idempotencyKey = request.idempotencyKey || `sms:${uuidv4()}`;

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
    const { endpointId } = await findOrCreateEndpoint(client, toPhone);

    // Find or create thread
    let threadId: string;
    if (request.threadId) {
      // Verify thread exists
      const thread = await client.query(
        `SELECT id FROM external_thread WHERE id = $1`,
        [request.threadId]
      );
      if (thread.rows.length === 0) {
        throw new Error(`Thread not found: ${request.threadId}`);
      }
      threadId = request.threadId;
    } else {
      threadId = await findOrCreateThread(client, endpointId, fromPhone, toPhone);
    }

    // Generate message key
    const messageKey = `outbound:${uuidv4()}`;

    // Insert message with pending status
    const message = await client.query(
      `INSERT INTO external_message (
         thread_id, external_message_key, direction, body, delivery_status, raw
       )
       VALUES ($1, $2, 'outbound', $3, 'pending', $4::jsonb)
       RETURNING id::text as id`,
      [
        threadId,
        messageKey,
        request.body,
        JSON.stringify({
          to: toPhone,
          from: fromPhone,
          idempotency_key: idempotencyKey,
        }),
      ]
    );
    const messageId = message.rows[0].id;

    // Enqueue job for sending
    await client.query(
      `SELECT internal_job_enqueue($1, now(), $2, $3)`,
      [
        'message.send.sms',
        JSON.stringify({
          message_id: messageId,
          to: toPhone,
          from: fromPhone,
          body: request.body,
        }),
        idempotencyKey,
      ]
    );

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
 * Handle a message.send.sms job.
 *
 * This function:
 * 1. Sends the message via Twilio API
 * 2. Updates the message status and provider_message_id
 * 3. Returns success/failure for the job processor
 */
export async function handleSmsSendJob(
  pool: Pool,
  job: InternalJob
): Promise<JobProcessorResult> {
  const payload = job.payload as {
    message_id: string;
    to: string;
    from?: string;
    body: string;
  };

  if (!payload.message_id || !payload.to || !payload.body) {
    return {
      success: false,
      error: 'Invalid job payload: missing message_id, to, or body',
    };
  }

  // Check if Twilio is configured
  if (!isTwilioConfigured()) {
    // Update message to failed if Twilio not configured
    await pool.query(
      `UPDATE external_message
       SET delivery_status = 'failed',
           provider_status_raw = $2::jsonb
       WHERE id = $1`,
      [payload.message_id, JSON.stringify({ error: 'Twilio not configured' })]
    );
    throw new Error('Twilio not configured');
  }

  try {
    // Update status to sending
    await pool.query(
      `UPDATE external_message SET delivery_status = 'sending' WHERE id = $1`,
      [payload.message_id]
    );

    // Get Twilio client
    const twilioClient = requireTwilioClient();
    const config = getTwilioConfig();

    // Send via Twilio
    const twilioMessage = await twilioClient.messages.create({
      to: payload.to,
      from: payload.from || config.fromNumber,
      body: payload.body,
    });

    // Update message with provider info
    await pool.query(
      `UPDATE external_message
       SET delivery_status = 'sent',
           provider_message_id = $2,
           provider_status_raw = $3::jsonb
       WHERE id = $1`,
      [
        payload.message_id,
        twilioMessage.sid,
        JSON.stringify({
          sid: twilioMessage.sid,
          status: twilioMessage.status,
          dateCreated: twilioMessage.dateCreated,
          direction: twilioMessage.direction,
        }),
      ]
    );

    console.log(
      `[Twilio] SMS sent: messageId=${payload.message_id}, sid=${twilioMessage.sid}`
    );

    return { success: true };
  } catch (error) {
    const err = error as Error;

    // Update message to failed
    await pool.query(
      `UPDATE external_message
       SET delivery_status = 'failed',
           provider_status_raw = $2::jsonb
       WHERE id = $1`,
      [payload.message_id, JSON.stringify({ error: err.message })]
    );

    console.error(`[Twilio] SMS send failed: messageId=${payload.message_id}`, err);

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Get the configured Twilio from number.
 */
export function getConfiguredFromNumber(): string | null {
  if (!isTwilioConfigured()) {
    return null;
  }
  return getTwilioConfig().fromNumber;
}
