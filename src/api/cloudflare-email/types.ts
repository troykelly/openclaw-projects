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
  contact_id: string;
  /** Database ID of the contact endpoint */
  endpointId: string;
  /** Database ID of the external thread */
  thread_id: string;
  /** Database ID of the stored message */
  message_id: string;
  /** Whether a new contact was created */
  isNewContact: boolean;
  /** Whether a new thread was created */
  isNewThread: boolean;
}

/**
 * Webhook response sent back to the Cloudflare Email Worker.
 *
 * The Worker inspects `action` to decide whether to accept or reject the email
 * at the SMTP level via `message.setReject()`. When action is "reject", the
 * Worker returns a permanent SMTP 550 error to the sending MTA.
 *
 * When action is "accept" and `auto_reply` is present, the Worker sends a
 * threaded reply to the sender via `message.reply()`.
 */
export interface CloudflareEmailWebhookResponse {
  success: boolean;
  /** Triage decision — "accept" stores the message, "reject" signals the Worker to bounce it. */
  action: 'accept' | 'reject';
  /** Human-readable reason when action is "reject". Sent as the SMTP rejection reason. */
  reject_reason?: string;
  /** IDs returned on successful acceptance. */
  receipt_id?: string;
  contact_id?: string;
  thread_id?: string;
  message_id?: string;
  /** Optional auto-reply for the Worker to send back to the sender. */
  auto_reply?: CloudflareEmailAutoReply;
}

/**
 * Auto-reply content for the Worker to send back to the sender
 * via `message.reply()`.
 */
export interface CloudflareEmailAutoReply {
  /** Subject line for the reply (typically "Re: <original subject>"). */
  subject: string;
  /** Plain text body. */
  text_body: string;
  /** HTML body (optional). */
  html_body?: string;
}
