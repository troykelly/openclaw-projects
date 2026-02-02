/**
 * Postmark webhook types.
 * Part of Issue #203.
 */

/**
 * Postmark inbound email webhook payload.
 * @see https://postmarkapp.com/developer/webhooks/inbound-webhook
 */
export interface PostmarkInboundPayload {
  // Message identifiers
  MessageID: string;
  MessageStream?: string;

  // Sender/Recipient info
  FromFull: PostmarkAddress;
  ToFull: PostmarkAddress[];
  CcFull?: PostmarkAddress[];
  BccFull?: PostmarkAddress[];

  // Original sender string (e.g., "Name <email@example.com>")
  From: string;
  To: string;
  Cc?: string;
  Bcc?: string;

  // Reply addresses
  ReplyTo?: string;

  // Email content
  Subject: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;

  // Threading headers
  Headers: PostmarkHeader[];

  // Attachments
  Attachments?: PostmarkAttachment[];

  // Metadata
  Date: string;
  MailboxHash?: string;
  Tag?: string;
  OriginalRecipient?: string;
  RawEmail?: string;
}

/**
 * Postmark email address structure.
 */
export interface PostmarkAddress {
  Email: string;
  Name: string;
  MailboxHash?: string;
}

/**
 * Postmark email header.
 */
export interface PostmarkHeader {
  Name: string;
  Value: string;
}

/**
 * Postmark attachment metadata.
 */
export interface PostmarkAttachment {
  Name: string;
  Content: string; // Base64 encoded
  ContentType: string;
  ContentLength: number;
  ContentID?: string;
}

/**
 * Parsed email address.
 */
export interface ParsedEmailAddress {
  email: string;
  name: string | null;
}

/**
 * Result of processing a Postmark inbound email.
 */
export interface PostmarkEmailResult {
  contactId: string;
  endpointId: string;
  threadId: string;
  messageId: string;
  isNewContact: boolean;
  isNewThread: boolean;
}

/**
 * Attachment metadata stored in the database.
 */
export interface AttachmentMetadata {
  name: string;
  contentType: string;
  size: number;
  contentId?: string;
}
