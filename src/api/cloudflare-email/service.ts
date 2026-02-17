/**
 * Cloudflare Email Workers webhook service.
 * Part of Issue #210.
 */

import { Pool } from 'pg';
import type { CloudflareEmailPayload, CloudflareEmailResult } from './types.ts';
import { normalizeEmail, createEmailThreadKey, getBestPlainText } from '../postmark/email-utils.ts';

/**
 * Parse the Message-ID header, removing angle brackets if present.
 */
function parseMessageId(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^<|>$/g, '').trim() || null;
}

/**
 * Parse the References header into an array of message IDs.
 */
function parseReferences(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((ref) => ref.replace(/^<|>$/g, '').trim())
    .filter(Boolean);
}

/**
 * Process an inbound Cloudflare email webhook.
 *
 * This function:
 * 1. Parses and normalizes email addresses
 * 2. Creates or finds the contact/endpoint for the sender
 * 3. Creates or finds the email thread using Message-ID headers
 * 4. Stores the email with the full payload
 *
 * @param pool - Database connection pool
 * @param payload - Cloudflare Worker webhook payload
 * @returns Result with all created/found IDs
 */
export async function processCloudflareEmail(pool: Pool, payload: CloudflareEmailPayload): Promise<CloudflareEmailResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Extract sender info
    const senderEmail = normalizeEmail(payload.from);

    // Extract threading info from headers
    const message_id = parseMessageId(payload.headers['message-id']) || `cf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inReplyTo = parseMessageId(payload.headers['in-reply-to']);
    const references = parseReferences(payload.headers.references);

    // Try to find an existing endpoint for the sender's email
    const existingEndpoint = await client.query(
      `SELECT ce.id::text as id, ce.contact_id::text as contact_id
         FROM contact_endpoint ce
        WHERE ce.endpoint_type = 'email'
          AND ce.normalized_value = normalize_contact_endpoint_value('email', $1)
        LIMIT 1`,
      [senderEmail],
    );

    let contact_id: string;
    let endpointId: string;
    let isNewContact = false;

    if (existingEndpoint.rows.length > 0) {
      endpointId = existingEndpoint.rows[0].id;
      contact_id = existingEndpoint.rows[0].contact_id;
    } else {
      // Create new contact
      isNewContact = true;
      const display_name = senderEmail;

      const contact = await client.query(
        `INSERT INTO contact (display_name)
         VALUES ($1)
         RETURNING id::text as id`,
        [display_name],
      );
      contact_id = contact.rows[0].id;

      const endpoint = await client.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
         VALUES ($1, 'email', $2, $3::jsonb)
         RETURNING id::text as id`,
        [
          contact_id,
          senderEmail,
          JSON.stringify({
            source: 'cloudflare-email',
          }),
        ],
      );
      endpointId = endpoint.rows[0].id;
    }

    // Create or find thread
    const threadKey = createEmailThreadKey(message_id, inReplyTo, references);

    // Check if thread exists
    const existingThread = await client.query(
      `SELECT id::text as id FROM external_thread
        WHERE channel = 'email'
          AND external_thread_key = $1`,
      [threadKey],
    );

    let thread_id: string;
    let isNewThread = false;

    if (existingThread.rows.length > 0) {
      thread_id = existingThread.rows[0].id;

      // Update thread's endpoint to the latest sender
      await client.query(
        `UPDATE external_thread
            SET endpoint_id = $1, updated_at = now()
          WHERE id = $2`,
        [endpointId, thread_id],
      );
    } else {
      isNewThread = true;

      const thread = await client.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, metadata)
         VALUES ($1, 'email', $2, $3::jsonb)
         RETURNING id::text as id`,
        [
          endpointId,
          threadKey,
          JSON.stringify({
            source: 'cloudflare-email',
            subject: payload.subject,
            message_id,
            inReplyTo,
            references,
          }),
        ],
      );
      thread_id = thread.rows[0].id;
    }

    // Get best plain text content
    const body = getBestPlainText(payload.text_body, payload.html_body);

    // Normalize recipient
    const toAddress = normalizeEmail(payload.to);

    // Insert the message
    const message = await client.query(
      `INSERT INTO external_message (
         thread_id, external_message_key, direction, body, raw, received_at,
         subject, from_address, to_addresses
       )
       VALUES ($1, $2, 'inbound', $3, $4::jsonb, $5::timestamptz,
               $6, $7, $8)
       ON CONFLICT (thread_id, external_message_key)
       DO UPDATE SET
         body = EXCLUDED.body,
         raw = EXCLUDED.raw,
         subject = EXCLUDED.subject,
         from_address = EXCLUDED.from_address,
         to_addresses = EXCLUDED.to_addresses
       RETURNING id::text as id`,
      [thread_id, message_id, body, JSON.stringify(payload), payload.timestamp || new Date().toISOString(), payload.subject, senderEmail, [toAddress]],
    );
    const messageDBId = message.rows[0].id;

    await client.query('COMMIT');

    return {
      contact_id,
      endpointId,
      thread_id,
      message_id: messageDBId,
      isNewContact,
      isNewThread,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
