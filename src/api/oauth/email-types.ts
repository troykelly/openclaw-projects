/**
 * Email API types for live provider access.
 * Part of Issue #1048.
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
  contentType: string;
  size: number;
  isInline: boolean;
}

/** A single email message as returned by provider APIs. */
export interface EmailMessage {
  /** Provider-side message ID. */
  id: string;
  /** Provider-side thread/conversation ID. */
  threadId?: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  /** Plain text body (preferred when available). */
  bodyText?: string;
  /** HTML body. */
  bodyHtml?: string;
  /** Short text snippet/preview. */
  snippet?: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  isDraft: boolean;
  /** Provider-specific labels/categories. */
  labels: string[];
  /** Attachment metadata (content not included). */
  attachments: EmailAttachment[];
  /** Provider-specific folder or label ID. */
  folderId?: string;
  /** Direct web link to view in provider's UI. */
  webLink?: string;
  provider: OAuthProvider;
}

/** A conversation thread grouping related messages. */
export interface EmailThread {
  id: string;
  subject: string;
  snippet?: string;
  messageCount: number;
  /** IDs of messages in this thread. */
  messageIds: string[];
  lastMessageAt: string;
  isRead: boolean;
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
  messageCount?: number;
  /** Number of unread messages (if available). */
  unreadCount?: number;
  provider: OAuthProvider;
}

/** Parameters for listing/searching emails. */
export interface EmailListParams {
  /** Folder ID or well-known name to filter by. */
  folderId?: string;
  /** Search query (provider-native syntax). */
  query?: string;
  /** Maximum number of results to return. */
  maxResults?: number;
  /** Pagination token from a previous response. */
  pageToken?: string;
  /** Whether to include spam and trash in results (default false). */
  includeSpamTrash?: boolean;
  /** Label IDs to filter by (Gmail-specific). */
  labelIds?: string[];
}

/** Paginated result for email listing. */
export interface EmailListResult {
  messages: EmailMessage[];
  nextPageToken?: string;
  /** Estimated total count (not always available). */
  resultSizeEstimate?: number;
}

/** Paginated result for thread listing. */
export interface EmailThreadListResult {
  threads: EmailThread[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/** Parameters for sending a new email. */
export interface EmailSendParams {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  /** Message ID to reply to (sets In-Reply-To and References headers). */
  replyToMessageId?: string;
  /** Thread ID when replying. */
  threadId?: string;
}

/** Result of sending an email. */
export interface EmailSendResult {
  messageId: string;
  threadId?: string;
  provider: OAuthProvider;
}

/** Parameters for creating a draft. */
export interface EmailDraftParams {
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  replyToMessageId?: string;
  threadId?: string;
}

/** Parameters for updating message state. */
export interface EmailUpdateParams {
  /** Mark as read or unread. */
  isRead?: boolean;
  /** Star or unstar. */
  isStarred?: boolean;
  /** Add label/category IDs. */
  addLabels?: string[];
  /** Remove label/category IDs. */
  removeLabels?: string[];
  /** Move to folder (Microsoft) or add/remove INBOX label (Gmail). */
  moveTo?: string;
}

/** Attachment content download result. */
export interface EmailAttachmentContent {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Base64-encoded content. */
  contentBase64: string;
}

/**
 * Provider-specific email operations interface.
 * Both Microsoft and Google implementations must satisfy this contract.
 */
export interface EmailProvider {
  /** List or search messages. */
  listMessages(accessToken: string, params: EmailListParams): Promise<EmailListResult>;
  /** Get a single message by ID. */
  getMessage(accessToken: string, messageId: string): Promise<EmailMessage>;
  /** List conversation threads. */
  listThreads(accessToken: string, params: EmailListParams): Promise<EmailThreadListResult>;
  /** Get a full thread with all messages. */
  getThread(accessToken: string, threadId: string): Promise<EmailThread & { messages: EmailMessage[] }>;
  /** List folders/labels. */
  listFolders(accessToken: string): Promise<EmailFolder[]>;
  /** Send a new email. */
  sendMessage(accessToken: string, params: EmailSendParams): Promise<EmailSendResult>;
  /** Create a draft. */
  createDraft(accessToken: string, params: EmailDraftParams): Promise<EmailMessage>;
  /** Update a draft. */
  updateDraft(accessToken: string, draftId: string, params: EmailDraftParams): Promise<EmailMessage>;
  /** Update message state (read, starred, labels, move). */
  updateMessage(accessToken: string, messageId: string, params: EmailUpdateParams): Promise<void>;
  /** Delete a message (move to trash or permanent delete). */
  deleteMessage(accessToken: string, messageId: string, permanent?: boolean): Promise<void>;
  /** Download attachment content. */
  getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<EmailAttachmentContent>;
}
