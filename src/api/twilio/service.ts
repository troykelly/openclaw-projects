/**
 * Twilio SMS webhook service.
 * Part of Issue #202.
 */

import { Pool } from 'pg';
import type { TwilioSmsWebhookPayload, TwilioSmsResult, E164PhoneNumber } from './types.ts';
import { normalizePhoneNumber, createSmsThreadKey } from './phone-utils.ts';

/**
 * Process an inbound Twilio SMS webhook.
 *
 * This function:
 * 1. Normalizes phone numbers to E.164 format
 * 2. Creates or finds the contact/endpoint for the sender
 * 3. Creates or finds the SMS thread
 * 4. Stores the message with full Twilio payload
 *
 * @param pool - Database connection pool
 * @param payload - Twilio webhook payload
 * @returns Result with all created/found IDs
 */
export async function processTwilioSms(pool: Pool, payload: TwilioSmsWebhookPayload): Promise<TwilioSmsResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Normalize phone numbers (Twilio usually sends E.164 already)
    const fromPhone: E164PhoneNumber = normalizePhoneNumber(payload.From);
    const toPhone: E164PhoneNumber = normalizePhoneNumber(payload.To);

    // Try to find an existing endpoint for the sender's phone number
    const existingEndpoint = await client.query(
      `SELECT ce.id::text as id, ce.contact_id::text as contact_id
         FROM contact_endpoint ce
        WHERE ce.endpoint_type = 'phone'
          AND ce.normalized_value = normalize_contact_endpoint_value('phone', $1)
        LIMIT 1`,
      [fromPhone],
    );

    let contactId: string;
    let endpointId: string;
    let isNewContact = false;

    if (existingEndpoint.rows.length > 0) {
      endpointId = existingEndpoint.rows[0].id;
      contactId = existingEndpoint.rows[0].contact_id;
    } else {
      // Create new contact with phone number as display name
      // The display name can be updated later when we learn the actual name
      const displayName = formatDisplayNameFromPayload(payload);
      isNewContact = true;

      const contact = await client.query(
        `INSERT INTO contact (display_name)
         VALUES ($1)
         RETURNING id::text as id`,
        [displayName],
      );
      contactId = contact.rows[0].id;

      const endpoint = await client.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
         VALUES ($1, 'phone', $2, $3::jsonb)
         RETURNING id::text as id`,
        [
          contactId,
          fromPhone,
          JSON.stringify({
            source: 'twilio',
            fromCity: payload.FromCity,
            fromState: payload.FromState,
            fromCountry: payload.FromCountry,
          }),
        ],
      );
      endpointId = endpoint.rows[0].id;
    }

    // Create or find thread for this SMS conversation
    const threadKey = createSmsThreadKey(fromPhone, toPhone);

    const thread = await client.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, metadata)
       VALUES ($1, 'phone', $2, $3::jsonb)
       ON CONFLICT (channel, external_thread_key)
       DO UPDATE SET endpoint_id = EXCLUDED.endpoint_id, updated_at = now()
       RETURNING id::text as id`,
      [
        endpointId,
        threadKey,
        JSON.stringify({
          fromPhone,
          toPhone,
          source: 'twilio',
        }),
      ],
    );
    const threadId = thread.rows[0].id;

    // Insert the message with full Twilio payload
    const message = await client.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw, received_at)
       VALUES ($1, $2, 'inbound', $3, $4::jsonb, now())
       ON CONFLICT (thread_id, external_message_key)
       DO UPDATE SET body = EXCLUDED.body, raw = EXCLUDED.raw
       RETURNING id::text as id`,
      [threadId, payload.MessageSid, payload.Body, JSON.stringify(payload)],
    );
    const messageId = message.rows[0].id;

    await client.query('COMMIT');

    return {
      contactId,
      endpointId,
      threadId,
      messageId,
      isNewContact,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create a display name from Twilio payload.
 * Uses geographic info if available, otherwise the phone number.
 */
function formatDisplayNameFromPayload(payload: TwilioSmsWebhookPayload): string {
  const fromPhone = normalizePhoneNumber(payload.From);

  // If we have location info, include it
  if (payload.FromCity && payload.FromState) {
    return `${fromPhone} (${payload.FromCity}, ${payload.FromState})`;
  }

  if (payload.FromCountry) {
    return `${fromPhone} (${payload.FromCountry})`;
  }

  return fromPhone;
}

/**
 * Get recent SMS messages for a phone number.
 *
 * @param pool - Database connection pool
 * @param phone - Phone number in E.164 format
 * @param limit - Maximum messages to return
 * @returns Array of message records
 */
export async function getRecentSmsMessages(
  pool: Pool,
  phone: E164PhoneNumber,
  limit: number = 50,
): Promise<
  Array<{
    id: string;
    threadId: string;
    direction: 'inbound' | 'outbound';
    body: string | null;
    receivedAt: Date;
    raw: Record<string, unknown>;
  }>
> {
  const result = await pool.query(
    `SELECT em.id::text as id,
            em.thread_id::text as thread_id,
            em.direction::text as direction,
            em.body,
            em.received_at,
            em.raw
       FROM external_message em
       JOIN external_thread et ON et.id = em.thread_id
       JOIN contact_endpoint ce ON ce.id = et.endpoint_id
      WHERE et.channel = 'phone'
        AND ce.normalized_value = normalize_contact_endpoint_value('phone', $1)
      ORDER BY em.received_at DESC
      LIMIT $2`,
    [phone, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    body: row.body,
    receivedAt: row.received_at,
    raw: row.raw,
  }));
}

/**
 * Find contact by phone number.
 *
 * @param pool - Database connection pool
 * @param phone - Phone number in E.164 format
 * @returns Contact info or null if not found
 */
export async function findContactByPhone(pool: Pool, phone: E164PhoneNumber): Promise<{ contactId: string; endpointId: string; displayName: string } | null> {
  const result = await pool.query(
    `SELECT ce.id::text as endpoint_id,
            c.id::text as contact_id,
            c.display_name
       FROM contact_endpoint ce
       JOIN contact c ON c.id = ce.contact_id
      WHERE ce.endpoint_type = 'phone'
        AND ce.normalized_value = normalize_contact_endpoint_value('phone', $1)
      LIMIT 1`,
    [phone],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    contactId: result.rows[0].contact_id,
    endpointId: result.rows[0].endpoint_id,
    displayName: result.rows[0].display_name,
  };
}
