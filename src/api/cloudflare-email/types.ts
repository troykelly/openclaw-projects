/**
 * Cloudflare Email Workers webhook types.
 * Part of Issue #210.
 */

/**
 * Payload sent from Cloudflare Email Worker to our webhook.
 * This format is defined by the example Worker we document.
 */
export interface CloudflareEmailPayload {
  /** Sender email address */
  from: string;
  /** Recipient email address */
  to: string;
  /** Email subject line */
  subject: string;
  /** Plain text body (extracted from MIME) */
  text_body?: string;
  /** HTML body (extracted from MIME) */
  html_body?: string;
  /** Email headers object */
  headers: CloudflareEmailHeaders;
  /** Full raw MIME message (optional, for debugging) */
  raw?: string;
  /** ISO timestamp when Worker processed the email */
  timestamp: string;
}

/**
 * Email headers extracted by the Cloudflare Worker.
 */
export interface CloudflareEmailHeaders {
  /** Message-ID header */
  'message-id'?: string;
  /** In-Reply-To header for threading */
  'in-reply-to'?: string;
  /** References header for threading */
  references?: string;
  /** Additional headers the Worker may include */
  [key: string]: string | undefined;
}

/**
 * Result of processing a Cloudflare email webhook.
 */
export interface CloudflareEmailResult {
  /** Database ID of the contact */
  contactId: string;
  /** Database ID of the contact endpoint */
  endpointId: string;
  /** Database ID of the external thread */
  threadId: string;
  /** Database ID of the stored message */
  messageId: string;
  /** Whether a new contact was created */
  isNewContact: boolean;
  /** Whether a new thread was created */
  isNewThread: boolean;
}
