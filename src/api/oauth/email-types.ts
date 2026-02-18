/**
 * Email API types for live provider access.
 * Part of Issue #1048.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 *
 * These types define the unified interface for email operations across
 * Microsoft Graph Mail and Gmail APIs. Operations proxy through provider
 * APIs — no local storage.
 */

import type { OAuthProvider } from './types.ts';

/** Email address with optional display name. */
export interface EmailAddress {
  email: string;
  name?: string;
}

/** Email attachment metadata (content not fetched by default). */
export interface EmailAttachment {
  id: string;
  name: string;
  content_type: string;
  size: number;
  is_inline: boolean;
}

/** A single email message as returned by provider APIs. */
export interface EmailMessage {
  /** Provider-side message ID. */
  id: string;
  /** Provider-side thread/conversation ID. */
  thread_id?: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  /** Plain text body (preferred when available). */
  body_text?: string;
  /** HTML body. */
  body_html?: string;
  /** Short text snippet/preview. */
  snippet?: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  /** Provider-specific labels/categories. */
  labels: string[];
  /** Attachment metadata (content not included). */
  attachments: EmailAttachment[];
  /** Provider-specific folder or label ID. */
  folder_id?: string;
  /** Direct web link to view in provider's UI. */
  web_link?: string;
  provider: OAuthProvider;
}

/** A conversation thread grouping related messages. */
export interface EmailThread {
  id: string;
  subject: string;
  snippet?: string;
  message_count: number;
  /** IDs of messages in this thread. */
  message_ids: string[];
  last_message_at: string;
  is_read: boolean;
  labels: string[];
  participants: EmailAddress[];
  provider: OAuthProvider;
}

/** Email folder/label metadata. */
export interface EmailFolder {
  id: string;
  name: string;
  /** Well-known folder type if applicable. */
  type?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'other';
  /** Number of messages in the folder (if available). */
  message_count?: number;
  /** Number of unread messages (if available). */
  unread_count?: number;
  provider: OAuthProvider;
}

/** Parameters for listing/searching emails. */
export interface EmailListParams {
  /** Folder ID or well-known name to filter by. */
  folder_id?: string;
  /** Search query (provider-native syntax). */
  query?: string;
  /** Maximum number of results to return. */
  max_results?: number;
  /** Pagination token from a previous response. */
  page_token?: string;
  /** Whether to include spam and trash in results (default false). */
  include_spam_trash?: boolean;
  /** Label IDs to filter by (Gmail-specific). */
  label_ids?: string[];
}

/** Paginated result for email listing. */
export interface EmailListResult {
  messages: EmailMessage[];
  next_page_token?: string;
  /** Estimated total count (not always available). */
  result_size_estimate?: number;
}

/** Paginated result for thread listing. */
export interface EmailThreadListResult {
  threads: EmailThread[];
  next_page_token?: string;
  result_size_estimate?: number;
}

/** Parameters for sending a new email. */
export interface EmailSendParams {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  body_text?: string;
  body_html?: string;
  /** Message ID to reply to (sets In-Reply-To and References headers). */
  reply_to_message_id?: string;
  /** Thread ID when replying. */
  thread_id?: string;
}

/** Result of sending an email. */
export interface EmailSendResult {
  message_id: string;
  thread_id?: string;
  provider: OAuthProvider;
}

/** Parameters for creating a draft. */
export interface EmailDraftParams {
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  body_text?: string;
  body_html?: string;
  reply_to_message_id?: string;
  thread_id?: string;
}

/** Parameters for updating message state. */
export interface EmailUpdateParams {
  /** Mark as read or unread. */
  is_read?: boolean;
  /** Star or unstar. */
  is_starred?: boolean;
  /** Add label/category IDs. */
  add_labels?: string[];
  /** Remove label/category IDs. */
  remove_labels?: string[];
  /** Move to folder (Microsoft) or add/remove INBOX label (Gmail). */
  move_to?: string;
}

/** Attachment content download result. */
export interface EmailAttachmentContent {
  id: string;
  name: string;
  content_type: string;
  size: number;
  /** Base64-encoded content. */
  content_base64: string;
}

/**
 * Provider-specific email operations interface.
 * Both Microsoft and Google implementations must satisfy this contract.
 */
export interface EmailProvider {
  /** List or search messages. */
  listMessages(access_token: string, params: EmailListParams): Promise<EmailListResult>;
  /** Get a single message by ID. */
  getMessage(access_token: string, message_id: string): Promise<EmailMessage>;
  /** List conversation threads. */
  listThreads(access_token: string, params: EmailListParams): Promise<EmailThreadListResult>;
  /** Get a full thread with all messages. */
  getThread(access_token: string, thread_id: string): Promise<EmailThread & { messages: EmailMessage[] }>;
  /** List folders/labels. */
  listFolders(access_token: string): Promise<EmailFolder[]>;
  /** Send a new email. */
  sendMessage(access_token: string, params: EmailSendParams): Promise<EmailSendResult>;
  /** Create a draft. */
  createDraft(access_token: string, params: EmailDraftParams): Promise<EmailMessage>;
  /** Update a draft. */
  updateDraft(access_token: string, draftId: string, params: EmailDraftParams): Promise<EmailMessage>;
  /** Update message state (read, starred, labels, move). */
  updateMessage(access_token: string, message_id: string, params: EmailUpdateParams): Promise<void>;
  /** Delete a message (move to trash or permanent delete). */
  deleteMessage(access_token: string, message_id: string, permanent?: boolean): Promise<void>;
  /** Download attachment content. */
  getAttachment(access_token: string, message_id: string, attachmentId: string): Promise<EmailAttachmentContent>;
}
