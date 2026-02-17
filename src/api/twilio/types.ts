/**
 * Twilio webhook types.
 * Part of Issue #202.
 */

/**
 * Twilio SMS webhook payload (URL-encoded form data).
 * @see https://www.twilio.com/docs/messaging/twiml#request-parameters
 */
export interface TwilioSmsWebhookPayload {
  // Core message fields
  MessageSid: string;
  SmsSid?: string;
  AccountSid: string;
  MessagingServiceSid?: string;
  From: string;
  To: string;
  Body: string;

  // Optional media fields
  NumMedia?: string;
  MediaContentType0?: string;
  MediaUrl0?: string;
  // Can have MediaContentType1, MediaUrl1, etc. for multiple attachments

  // Geographic info
  FromCity?: string;
  FromState?: string;
  FromZip?: string;
  FromCountry?: string;
  ToCity?: string;
  ToState?: string;
  ToZip?: string;
  ToCountry?: string;

  // API version
  ApiVersion?: string;
}

/**
 * Normalized phone number in E.164 format.
 * Always starts with + followed by country code and number.
 */
export type E164PhoneNumber = string;

/**
 * Result of processing a Twilio SMS webhook.
 */
export interface TwilioSmsResult {
  contact_id: string;
  endpointId: string;
  thread_id: string;
  message_id: string;
  isNewContact: boolean;
}

/**
 * Twilio TwiML response for SMS.
 * Empty response means no reply.
 */
export interface TwilioSmsResponse {
  // Return empty string for no TwiML response
  twiml: string;
}
