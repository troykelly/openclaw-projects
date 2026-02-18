/**
 * Twilio SMS delivery status webhook handler.
 * Part of Issue #292.
 */

import type { Pool } from 'pg';

/**
 * Twilio status callback payload.
 * @see https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
 */
export interface TwilioStatusCallback {
  /** Message SID (our provider_message_id) */
  MessageSid: string;
  /** Current message status */
  MessageStatus: TwilioMessageStatus;
  /** Twilio Account SID */
  AccountSid: string;
  /** Recipient phone number */
  To: string;
  /** Sender phone number */
  From: string;
  /** API version */
  ApiVersion?: string;
  /** Error code if failed (30001-30999) */
  ErrorCode?: string;
  /** Error message if failed */
  ErrorMessage?: string;
  /** SMS SID (may be same as MessageSid) */
  SmsSid?: string;
  /** SMS status (may be same as MessageStatus) */
  SmsStatus?: string;
}

/**
 * Twilio message statuses.
 */
export type TwilioMessageStatus = 'accepted' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'receiving' | 'received' | 'read';

/**
 * Our delivery status enum values.
 */
export type DeliveryStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'undelivered';

/**
 * Result of processing a delivery status callback.
 */
export interface DeliveryStatusResult {
  /** Whether processing succeeded */
  success: boolean;
  /** Our internal message ID (if found) */
  message_id?: string;
  /** Whether message was not found */
  not_found?: boolean;
  /** Whether status was unchanged (already at or past this status) */
  status_unchanged?: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Map Twilio status to our delivery status.
 */
function mapTwilioStatus(twilioStatus: TwilioMessageStatus): DeliveryStatus {
  switch (twilioStatus) {
    case 'accepted':
    case 'queued':
      return 'queued';
    case 'sending':
      return 'sending';
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'read':
      return 'delivered';
    case 'undelivered':
      return 'undelivered';
    case 'failed':
      return 'failed';
    default:
      // For receiving/received (inbound), keep as-is or default to sent
      return 'sent';
  }
}

/**
 * Get the ordinal value for status comparison.
 * Higher ordinal = more progressed status.
 */
function getStatusOrdinal(status: DeliveryStatus): number {
  switch (status) {
    case 'pending':
      return 1;
    case 'queued':
      return 2;
    case 'sending':
      return 3;
    case 'sent':
      return 4;
    case 'delivered':
      return 5;
    case 'failed':
    case 'bounced':
    case 'undelivered':
      return 10; // Terminal states
    default:
      return 0;
  }
}

/**
 * Check if we can transition from current to new status.
 * Terminal states (delivered, failed, bounced, undelivered) cannot be changed.
 */
function canTransition(current: DeliveryStatus, next: DeliveryStatus): boolean {
  const currentOrdinal = getStatusOrdinal(current);
  const nextOrdinal = getStatusOrdinal(next);

  // Can't change terminal states
  if (currentOrdinal >= 10) {
    return false;
  }

  // Can always go to terminal states
  if (nextOrdinal >= 10) {
    return true;
  }

  // Forward progress only
  return nextOrdinal > currentOrdinal;
}

/**
 * Process a Twilio delivery status callback.
 *
 * This function:
 * 1. Looks up the message by provider_message_id (MessageSid)
 * 2. Maps the Twilio status to our status enum
 * 3. Updates delivery_status and provider_status_raw
 * 4. Respects status transition rules (forward only)
 */
export async function processDeliveryStatus(pool: Pool, callback: TwilioStatusCallback): Promise<DeliveryStatusResult> {
  const { MessageSid, MessageStatus } = callback;

  if (!MessageSid || !MessageStatus) {
    return {
      success: false,
      error: 'Missing required fields: MessageSid, MessageStatus',
    };
  }

  // Look up message by provider_message_id
  const message = await pool.query(
    `SELECT id::text as id, delivery_status::text as current_status
     FROM external_message
     WHERE provider_message_id = $1`,
    [MessageSid],
  );

  if (message.rows.length === 0) {
    console.warn(`[Twilio] Status callback for unknown MessageSid: ${MessageSid}`);
    return {
      success: false,
      not_found: true,
    };
  }

  const message_id = message.rows[0].id;
  const currentStatus = message.rows[0].current_status as DeliveryStatus;
  const newStatus = mapTwilioStatus(MessageStatus);

  // Check if we can transition to the new status
  if (!canTransition(currentStatus, newStatus)) {
    console.log(`[Twilio] Status unchanged for ${MessageSid}: ${currentStatus} -> ${MessageStatus} (mapped: ${newStatus})`);
    return {
      success: true,
      message_id,
      status_unchanged: true,
    };
  }

  // Update the message status and store full callback payload
  try {
    await pool.query(
      `UPDATE external_message
       SET delivery_status = $2::message_delivery_status,
           provider_status_raw = $3::jsonb
       WHERE id = $1`,
      [message_id, newStatus, JSON.stringify(callback)],
    );

    console.log(`[Twilio] Status updated for ${MessageSid}: ${currentStatus} -> ${newStatus}`);

    return {
      success: true,
      message_id,
    };
  } catch (error) {
    const err = error as Error;

    // Handle status transition errors from the database trigger
    if (err.message.includes('transition') || err.message.includes('terminal')) {
      console.warn(`[Twilio] Status transition rejected by DB: ${currentStatus} -> ${newStatus}`);
      return {
        success: true,
        message_id,
        status_unchanged: true,
      };
    }

    console.error(`[Twilio] Status update error for ${MessageSid}:`, err);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Check if a status is terminal (no further updates expected).
 */
export function isTerminalStatus(status: DeliveryStatus): boolean {
  return ['delivered', 'failed', 'bounced', 'undelivered'].includes(status);
}
