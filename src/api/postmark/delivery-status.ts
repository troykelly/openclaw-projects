/**
 * Postmark delivery status webhook processing.
 * Part of Issue #294.
 */

import type { Pool } from 'pg';

/**
 * Postmark Delivery webhook payload.
 */
export interface PostmarkDeliveryPayload {
  RecordType: 'Delivery';
  MessageID: string;
  Recipient: string;
  Tag?: string;
  DeliveredAt: string;
  Details?: string;
  MessageStream: string;
  ServerID: number;
  Metadata?: Record<string, unknown>;
}

/**
 * Postmark Bounce webhook payload.
 */
export interface PostmarkBouncePayload {
  RecordType: 'Bounce';
  MessageID: string;
  Recipient: string;
  Type: string;
  TypeCode: number;
  Name: string;
  Tag?: string;
  Description?: string;
  Details?: string;
  Email: string;
  From: string;
  BouncedAt: string;
  MessageStream: string;
  ServerID: number;
  Metadata?: Record<string, unknown>;
}

/**
 * Postmark SpamComplaint webhook payload.
 */
export interface PostmarkSpamComplaintPayload {
  RecordType: 'SpamComplaint';
  MessageID: string;
  Recipient: string;
  Tag?: string;
  From: string;
  BouncedAt: string;
  Subject?: string;
  MessageStream: string;
  ServerID: number;
  Metadata?: Record<string, unknown>;
}

/**
 * Union type for all supported Postmark webhook payloads.
 */
export type PostmarkWebhookPayload = PostmarkDeliveryPayload | PostmarkBouncePayload | PostmarkSpamComplaintPayload;

/**
 * Result of processing a Postmark delivery status webhook.
 */
export interface DeliveryStatusResult {
  success: boolean;
  message_id?: string;
  not_found?: boolean;
  status_unchanged?: boolean;
  error?: string;
}

/**
 * Status priority for transition validation.
 * Higher number = more terminal state.
 */
const STATUS_PRIORITY: Record<string, number> = {
  pending: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  failed: 4,
  bounced: 5,
  undelivered: 5,
};

/**
 * Hard bounce types that indicate permanent delivery failure.
 */
const HARD_BOUNCE_TYPES = ['HardBounce', 'BadEmailAddress', 'Unsubscribe', 'AddressChange', 'DmarcPolicy'];

/**
 * Map Postmark record type and bounce type to our delivery status.
 */
function mapToDeliveryStatus(payload: PostmarkWebhookPayload): 'delivered' | 'failed' | 'bounced' | null {
  switch (payload.RecordType) {
    case 'Delivery':
      return 'delivered';
    case 'Bounce': {
      const bouncePayload = payload as PostmarkBouncePayload;
      if (HARD_BOUNCE_TYPES.includes(bouncePayload.Type)) {
        return 'bounced';
      }
      // Soft bounces map to failed (temporary, may retry)
      return 'failed';
    }
    case 'SpamComplaint':
      // Spam complaints are recorded but don't change status
      // (already delivered, user complained)
      return null;
    default:
      return null;
  }
}

/**
 * Check if a status transition is allowed.
 * Status can only move forward (to higher priority/more terminal states).
 */
function canTransition(currentStatus: string, newStatus: string): boolean {
  const currentPriority = STATUS_PRIORITY[currentStatus] ?? 0;
  const newPriority = STATUS_PRIORITY[newStatus] ?? 0;
  return newPriority > currentPriority;
}

/**
 * Process a Postmark delivery status webhook.
 *
 * This function:
 * 1. Finds the message by provider_message_id
 * 2. Validates the status transition
 * 3. Updates the message status and stores the raw webhook payload
 * 4. For hard bounces, flags the contact endpoint
 */
export async function processPostmarkDeliveryStatus(pool: Pool, payload: PostmarkWebhookPayload): Promise<DeliveryStatusResult> {
  const { MessageID } = payload;

  // Find message by provider_message_id
  const messageResult = await pool.query(
    `SELECT
       em.id::text as id,
       em.delivery_status::text as delivery_status,
       et.endpoint_id::text as endpoint_id
     FROM external_message em
     JOIN external_thread et ON et.id = em.thread_id
     WHERE em.provider_message_id = $1`,
    [MessageID],
  );

  if (messageResult.rows.length === 0) {
    return {
      success: false,
      not_found: true,
    };
  }

  const row = messageResult.rows[0] as {
    id: string;
    delivery_status: string;
    endpoint_id: string;
  };

  const message_id = row.id;
  const currentStatus = row.delivery_status;
  const endpointId = row.endpoint_id;

  // Determine new status
  const newStatus = mapToDeliveryStatus(payload);

  // For spam complaints, just record the raw payload but don't change status
  if (payload.RecordType === 'SpamComplaint') {
    await pool.query(
      `UPDATE external_message
       SET provider_status_raw = $2::jsonb,
           status_updated_at = now()
       WHERE id = $1`,
      [message_id, JSON.stringify(payload)],
    );

    return {
      success: true,
      message_id,
      status_unchanged: true,
    };
  }

  // Check if transition is allowed
  if (!newStatus || !canTransition(currentStatus, newStatus)) {
    // Still update raw payload for audit trail
    await pool.query(
      `UPDATE external_message
       SET provider_status_raw = $2::jsonb,
           status_updated_at = now()
       WHERE id = $1`,
      [message_id, JSON.stringify(payload)],
    );

    return {
      success: true,
      message_id,
      status_unchanged: true,
    };
  }

  // Update status and raw payload
  await pool.query(
    `UPDATE external_message
     SET delivery_status = $2::message_delivery_status,
         provider_status_raw = $3::jsonb,
         status_updated_at = now()
     WHERE id = $1`,
    [message_id, newStatus, JSON.stringify(payload)],
  );

  // For hard bounces, flag the contact endpoint
  if (payload.RecordType === 'Bounce' && HARD_BOUNCE_TYPES.includes((payload as PostmarkBouncePayload).Type)) {
    const bouncePayload = payload as PostmarkBouncePayload;
    await pool.query(
      `UPDATE contact_endpoint
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
       WHERE id = $1`,
      [
        endpointId,
        JSON.stringify({
          bounced: true,
          bounce_type: bouncePayload.Type,
          bounced_at: bouncePayload.BouncedAt,
        }),
      ],
    );
  }

  console.log(`[Postmark] Status updated: message_id=${message_id}, status=${newStatus}, type=${payload.RecordType}`);

  return {
    success: true,
    message_id,
  };
}
