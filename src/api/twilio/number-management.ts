/**
 * Twilio phone number management service.
 * Part of Issue #300 - allows OpenClaw agents to self-configure Twilio integration.
 */

import type { Pool } from 'pg';
import type { IncomingPhoneNumberInstance } from 'twilio/lib/rest/api/v2010/account/incomingPhoneNumber.js';
import { isTwilioConfigured, requireTwilioClient } from './config.ts';

/**
 * Phone number capabilities.
 */
export interface PhoneNumberCapabilities {
  voice: boolean;
  sms: boolean;
  mms: boolean;
  fax: boolean;
}

/**
 * Summary information about a Twilio phone number.
 */
export interface PhoneNumberSummary {
  /** Phone number in E.164 format */
  phoneNumber: string;
  /** Human-readable name */
  friendlyName: string;
  /** Twilio Phone Number SID (PN...) */
  sid: string;
  /** Capabilities of this number */
  capabilities: PhoneNumberCapabilities;
}

/**
 * Detailed information about a Twilio phone number including webhook config.
 */
export interface PhoneNumberDetails extends PhoneNumberSummary {
  /** SMS webhook URL */
  smsUrl: string | null;
  /** SMS webhook HTTP method */
  smsMethod: string | null;
  /** SMS fallback URL */
  smsFallbackUrl: string | null;
  /** Voice webhook URL */
  voiceUrl: string | null;
  /** Voice webhook HTTP method */
  voiceMethod: string | null;
  /** Voice fallback URL */
  voiceFallbackUrl: string | null;
  /** Status callback URL */
  statusCallbackUrl: string | null;
  /** Status callback HTTP method */
  statusCallbackMethod: string | null;
}

/**
 * Options for updating phone number webhook configuration.
 */
export interface WebhookUpdateOptions {
  /** SMS webhook URL (empty string to clear) */
  smsUrl?: string;
  /** SMS webhook HTTP method */
  smsMethod?: 'GET' | 'POST';
  /** SMS fallback URL */
  smsFallbackUrl?: string;
  /** Voice webhook URL */
  voiceUrl?: string;
  /** Voice webhook HTTP method */
  voiceMethod?: 'GET' | 'POST';
  /** Voice fallback URL */
  voiceFallbackUrl?: string;
  /** Status callback URL */
  statusCallbackUrl?: string;
  /** Status callback HTTP method */
  statusCallbackMethod?: 'GET' | 'POST';
}

/**
 * Validate a webhook URL.
 * - Must be HTTPS (or empty string to clear)
 * - Must be a valid URL format
 * - Allows localhost for development
 */
function validateWebhookUrl(url: string, fieldName: string): void {
  // Empty string is allowed (clears the webhook)
  if (url === '') {
    return;
  }

  // Try to parse as URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL format for ${fieldName}: ${url}`);
  }

  // Must be HTTPS (allow localhost for dev)
  const isLocalhost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isLocalhost) {
    throw new Error(
      `${fieldName} must use HTTPS (got ${parsed.protocol}). Use https:// for webhook URLs.`
    );
  }
}

/**
 * List all phone numbers in the Twilio account.
 * Returns empty array if Twilio is not configured.
 */
export async function listPhoneNumbers(): Promise<PhoneNumberSummary[]> {
  if (!isTwilioConfigured()) {
    return [];
  }

  const client = requireTwilioClient();

  const numbers = await client.incomingPhoneNumbers.list();

  return numbers.map((num) => ({
    phoneNumber: num.phoneNumber,
    friendlyName: num.friendlyName,
    sid: num.sid,
    capabilities: {
      voice: num.capabilities?.voice ?? false,
      sms: num.capabilities?.sms ?? false,
      mms: num.capabilities?.mms ?? false,
      fax: num.capabilities?.fax ?? false,
    },
  }));
}

/**
 * Get detailed information about a specific phone number.
 * @param phoneNumber - Phone number in E.164 format or SID
 * @throws Error if Twilio not configured or number not found
 */
export async function getPhoneNumberDetails(
  phoneNumber: string
): Promise<PhoneNumberDetails> {
  if (!isTwilioConfigured()) {
    throw new Error('Twilio not configured');
  }

  const client = requireTwilioClient();

  // If it looks like a SID, fetch directly
  if (phoneNumber.startsWith('PN')) {
    const num = await client.incomingPhoneNumbers(phoneNumber).fetch();
    return formatPhoneNumberDetails(num);
  }

  // Otherwise, search by phone number
  const numbers = await client.incomingPhoneNumbers.list({
    phoneNumber: phoneNumber,
  });

  if (numbers.length === 0) {
    throw new Error(`Phone number not found: ${phoneNumber}`);
  }

  return formatPhoneNumberDetails(numbers[0]);
}

/**
 * Format a Twilio IncomingPhoneNumber instance to our details format.
 */
function formatPhoneNumberDetails(
  num: IncomingPhoneNumberInstance
): PhoneNumberDetails {
  const n = num;
  return {
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    sid: n.sid,
    capabilities: {
      voice: n.capabilities?.voice ?? false,
      sms: n.capabilities?.sms ?? false,
      mms: n.capabilities?.mms ?? false,
      fax: n.capabilities?.fax ?? false,
    },
    smsUrl: n.smsUrl || null,
    smsMethod: n.smsMethod || null,
    smsFallbackUrl: n.smsFallbackUrl || null,
    voiceUrl: n.voiceUrl || null,
    voiceMethod: n.voiceMethod || null,
    voiceFallbackUrl: n.voiceFallbackUrl || null,
    statusCallbackUrl: n.statusCallback || null,
    statusCallbackMethod: n.statusCallbackMethod || null,
  };
}

/**
 * Update webhook configuration for a phone number.
 * @param phoneNumber - Phone number in E.164 format or SID
 * @param options - Webhook URLs and methods to update
 * @param pool - Optional database pool for audit logging
 * @param actorId - Optional actor ID for audit logging
 * @throws Error if Twilio not configured, number not found, or invalid URLs
 */
export async function updatePhoneNumberWebhooks(
  phoneNumber: string,
  options: WebhookUpdateOptions,
  pool?: Pool,
  actorId?: string
): Promise<PhoneNumberDetails> {
  if (!isTwilioConfigured()) {
    throw new Error('Twilio not configured');
  }

  // Validate all provided URLs
  if (options.smsUrl !== undefined) {
    validateWebhookUrl(options.smsUrl, 'smsUrl');
  }
  if (options.smsFallbackUrl !== undefined) {
    validateWebhookUrl(options.smsFallbackUrl, 'smsFallbackUrl');
  }
  if (options.voiceUrl !== undefined) {
    validateWebhookUrl(options.voiceUrl, 'voiceUrl');
  }
  if (options.voiceFallbackUrl !== undefined) {
    validateWebhookUrl(options.voiceFallbackUrl, 'voiceFallbackUrl');
  }
  if (options.statusCallbackUrl !== undefined) {
    validateWebhookUrl(options.statusCallbackUrl, 'statusCallbackUrl');
  }

  const client = requireTwilioClient();

  // Find the phone number SID
  let sid: string;
  if (phoneNumber.startsWith('PN')) {
    sid = phoneNumber;
  } else {
    const numbers = await client.incomingPhoneNumbers.list({
      phoneNumber: phoneNumber,
    });
    if (numbers.length === 0) {
      throw new Error(`Phone number not found: ${phoneNumber}`);
    }
    sid = numbers[0].sid;
  }

  // Build update payload
  const updatePayload: Record<string, string> = {};

  if (options.smsUrl !== undefined) {
    updatePayload.smsUrl = options.smsUrl;
  }
  if (options.smsMethod !== undefined) {
    updatePayload.smsMethod = options.smsMethod;
  }
  if (options.smsFallbackUrl !== undefined) {
    updatePayload.smsFallbackUrl = options.smsFallbackUrl;
  }
  if (options.voiceUrl !== undefined) {
    updatePayload.voiceUrl = options.voiceUrl;
  }
  if (options.voiceMethod !== undefined) {
    updatePayload.voiceMethod = options.voiceMethod;
  }
  if (options.voiceFallbackUrl !== undefined) {
    updatePayload.voiceFallbackUrl = options.voiceFallbackUrl;
  }
  if (options.statusCallbackUrl !== undefined) {
    updatePayload.statusCallback = options.statusCallbackUrl;
  }
  if (options.statusCallbackMethod !== undefined) {
    updatePayload.statusCallbackMethod = options.statusCallbackMethod;
  }

  // Get current config before update for audit logging
  const currentConfig = await client.incomingPhoneNumbers(sid).fetch();

  // Perform the update
  const updated = await client.incomingPhoneNumbers(sid).update(updatePayload);

  console.log(
    `[Twilio] Updated phone number webhooks: ${phoneNumber} (${sid})`,
    Object.keys(updatePayload)
  );

  // Audit log the change
  if (pool) {
    try {
      await pool.query(
        `SELECT create_audit_log(
          $1::audit_actor_type,
          $2,
          'webhook'::audit_action_type,
          'twilio_phone_number',
          NULL,
          $3::jsonb,
          $4::jsonb
        )`,
        [
          actorId ? 'agent' : 'system',
          actorId || null,
          JSON.stringify({
            old: {
              smsUrl: currentConfig.smsUrl,
              voiceUrl: currentConfig.voiceUrl,
              statusCallbackUrl: currentConfig.statusCallback,
            },
            new: updatePayload,
          }),
          JSON.stringify({
            phone_number: phoneNumber,
            phone_number_sid: sid,
          }),
        ]
      );
    } catch (auditError) {
      // Log but don't fail the operation if audit logging fails
      console.error('[Twilio] Failed to create audit log entry:', auditError);
    }
  }

  return formatPhoneNumberDetails(updated);
}
