/**
 * Postmark email webhook service.
 * Part of Issue #203.
 */

import { Pool } from 'pg';
import type { PostmarkInboundPayload, PostmarkEmailResult, AttachmentMetadata } from './types.ts';
import { normalizeEmail, getMessageId, getInReplyTo, getReferences, createEmailThreadKey, getBestPlainText } from './email-utils.ts';

/**
 * Process an inbound Postmark email webhook.
 *
 * This function:
 * 1. Parses and normalizes email addresses
 * 2. Creates or finds the contact/endpoint for the sender
 * 3. Creates or finds the email thread using Message-ID headers
 * 4. Stores the email with full Postmark payload
 *
 * @param pool - Database connection pool
 * @param payload - Postmark webhook payload
 * @returns Result with all created/found IDs
 */
export async function processPostmarkEmail(pool: Pool, payload: PostmarkInboundPayload): Promise<PostmarkEmailResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Extract sender info
    const senderEmail = normalizeEmail(payload.FromFull.Email);
    const senderName = payload.FromFull.Name || null;

    // Extract threading info from headers
    const messageId = getMessageId(payload.Headers) || payload.MessageID;
    const inReplyTo = getInReplyTo(payload.Headers);
    const references = getReferences(payload.Headers);

    // Try to find an existing endpoint for the sender's email
    const existingEndpoint = await client.query(
      `SELECT ce.id::text as id, ce.contact_id::text as contact_id
         FROM contact_endpoint ce
        WHERE ce.endpoint_type = 'email'
          AND ce.normalized_value = normalize_contact_endpoint_value('email', $1)
        LIMIT 1`,
      [senderEmail],
    );

    let contactId: string;
    let endpointId: string;
    let isNewContact = false;

    if (existingEndpoint.rows.length > 0) {
      endpointId = existingEndpoint.rows[0].id;
      contactId = existingEndpoint.rows[0].contact_id;

      // Update contact name if we have one and it's better than what we have
      if (senderName) {
        await client.query(
          `UPDATE contact
              SET display_name = $2,
                  updated_at = now()
            WHERE id = $1
              AND (display_name IS NULL OR display_name = '' OR display_name LIKE '%@%')`,
          [contactId, senderName],
        );
      }
    } else {
      // Create new contact
      isNewContact = true;
      const displayName = senderName || senderEmail;

      const contact = await client.query(
        `INSERT INTO contact (display_name)
         VALUES ($1)
         RETURNING id::text as id`,
        [displayName],
      );
      contactId = contact.rows[0].id;

      const endpoint = await client.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, metadata)
         VALUES ($1, 'email', $2, $3::jsonb)
         RETURNING id::text as id`,
        [
          contactId,
          senderEmail,
          JSON.stringify({
            source: 'postmark',
            mailboxHash: payload.FromFull.MailboxHash,
          }),
        ],
      );
      endpointId = endpoint.rows[0].id;
    }

    // Create or find thread
    const threadKey = createEmailThreadKey(messageId, inReplyTo, references);

    // Check if thread exists
    const existingThread = await client.query(
      `SELECT id::text as id FROM external_thread
        WHERE channel = 'email'
          AND external_thread_key = $1`,
      [threadKey],
    );

    let threadId: string;
    let isNewThread = false;

    if (existingThread.rows.length > 0) {
      threadId = existingThread.rows[0].id;

      // Update thread's endpoint to the latest sender
      await client.query(
        `UPDATE external_thread
            SET endpoint_id = $1, updated_at = now()
          WHERE id = $2`,
        [endpointId, threadId],
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
            source: 'postmark',
            subject: payload.Subject,
            messageId,
            inReplyTo,
            references,
          }),
        ],
      );
      threadId = thread.rows[0].id;
    }

    // Extract recipients
    const toAddresses = payload.ToFull.map((a) => normalizeEmail(a.Email));
    const ccAddresses = payload.CcFull?.map((a) => normalizeEmail(a.Email)) || [];

    // Extract attachment metadata
    const attachments: AttachmentMetadata[] = (payload.Attachments || []).map((a) => ({
      name: a.Name,
      contentType: a.ContentType,
      size: a.ContentLength,
      contentId: a.ContentID,
    }));

    // Get best plain text content
    const body = getBestPlainText(payload.TextBody, payload.HtmlBody);

    // Insert the message
    const message = await client.query(
      `INSERT INTO external_message (
         thread_id, external_message_key, direction, body, raw, received_at,
         subject, from_address, to_addresses, cc_addresses, attachments
       )
       VALUES ($1, $2, 'inbound', $3, $4::jsonb, $5::timestamptz,
               $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (thread_id, external_message_key)
       DO UPDATE SET
         body = EXCLUDED.body,
         raw = EXCLUDED.raw,
         subject = EXCLUDED.subject,
         from_address = EXCLUDED.from_address,
         to_addresses = EXCLUDED.to_addresses,
         cc_addresses = EXCLUDED.cc_addresses,
         attachments = EXCLUDED.attachments
       RETURNING id::text as id`,
      [threadId, messageId, body, JSON.stringify(payload), payload.Date, payload.Subject, senderEmail, toAddresses, ccAddresses, JSON.stringify(attachments)],
    );
    const messageDBId = message.rows[0].id;

    await client.query('COMMIT');

    return {
      contactId,
      endpointId,
      threadId,
      messageId: messageDBId,
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

/**
 * Get recent emails for an email address.
 *
 * @param pool - Database connection pool
 * @param email - Email address
 * @param limit - Maximum messages to return
 * @returns Array of email records
 */
export async function getRecentEmails(
  pool: Pool,
  email: string,
  limit: number = 50,
): Promise<
  Array<{
    id: string;
    threadId: string;
    direction: 'inbound' | 'outbound';
    subject: string | null;
    body: string | null;
    fromAddress: string | null;
    toAddresses: string[];
    receivedAt: Date;
  }>
> {
  const result = await pool.query(
    `SELECT em.id::text as id,
            em.thread_id::text as thread_id,
            em.direction::text as direction,
            em.subject,
            em.body,
            em.from_address,
            em.to_addresses,
            em.received_at
       FROM external_message em
       JOIN external_thread et ON et.id = em.thread_id
       JOIN contact_endpoint ce ON ce.id = et.endpoint_id
      WHERE et.channel = 'email'
        AND ce.normalized_value = normalize_contact_endpoint_value('email', $1)
      ORDER BY em.received_at DESC
      LIMIT $2`,
    [email, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    fromAddress: row.from_address,
    toAddresses: row.to_addresses || [],
    receivedAt: row.received_at,
  }));
}

/**
 * Find contact by email address.
 *
 * @param pool - Database connection pool
 * @param email - Email address
 * @returns Contact info or null if not found
 */
export async function findContactByEmail(pool: Pool, email: string): Promise<{ contactId: string; endpointId: string; displayName: string } | null> {
  const result = await pool.query(
    `SELECT ce.id::text as endpoint_id,
            c.id::text as contact_id,
            c.display_name
       FROM contact_endpoint ce
       JOIN contact c ON c.id = ce.contact_id
      WHERE ce.endpoint_type = 'email'
        AND ce.normalized_value = normalize_contact_endpoint_value('email', $1)
      LIMIT 1`,
    [email],
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
