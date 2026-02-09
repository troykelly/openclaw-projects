/**
 * Twilio configuration and client initialization.
 * Part of Issue #291.
 */

import Twilio from 'twilio';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

/**
 * Check if Twilio is configured with required environment variables.
 */
export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

/**
 * Get Twilio configuration from environment variables.
 * Throws if required configuration is missing.
 */
export function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio not configured. Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER');
  }

  return { accountSid, authToken, fromNumber };
}

/**
 * Create a Twilio client instance.
 * Returns null if Twilio is not configured.
 */
export function createTwilioClient(): Twilio.Twilio | null {
  if (!isTwilioConfigured()) {
    return null;
  }

  const config = getTwilioConfig();
  return Twilio(config.accountSid, config.authToken);
}

/**
 * Create a Twilio client or throw if not configured.
 */
export function requireTwilioClient(): Twilio.Twilio {
  const client = createTwilioClient();
  if (!client) {
    throw new Error('Twilio not configured');
  }
  return client;
}
