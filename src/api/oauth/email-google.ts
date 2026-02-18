/**
 * Gmail API implementation.
 * Part of Issue #1048.
 *
 * Provides live API access to email operations via Gmail API:
 * list, read, search, send, draft, update, delete, and attachment download.
 */

import { OAuthError } from './types.ts';
import type {
  EmailProvider,
  EmailMessage,
  EmailThread,
  EmailFolder,
  EmailAttachment,
  EmailAttachmentContent,
  EmailAddress,
  EmailListParams,
  EmailListResult,
  EmailThreadListResult,
  EmailSendParams,
  EmailSendResult,
  EmailDraftParams,
  EmailUpdateParams,
} from './email-types.ts';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';

// ---- Gmail API response types ----

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  partId: string;
  mimeType: string;
  headers: GmailHeader[];
  body: { attachmentId?: string; size: number; data?: string };
  parts?: GmailMessagePart[];
  filename?: string;
}

interface GmailMessage {
  id: string;
  thread_id: string;
  label_ids: string[];
  snippet: string;
  payload: GmailMessagePart;
  internalDate: string;
  sizeEstimate: number;
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; thread_id: string }>;
  next_page_token?: string;
  result_size_estimate?: number;
}

interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
  messages: GmailMessage[];
}

interface GmailThreadListResponse {
  threads?: Array<{ id: string; snippet: string; historyId: string }>;
  next_page_token?: string;
  result_size_estimate?: number;
}

interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

interface GmailLabelsListResponse {
  labels: GmailLabel[];
}

interface GmailDraftResponse {
  id: string;
  message: GmailMessage;
}

interface GmailAttachmentResponse {
  attachmentId: string;
  size: number;
  data: string;
}

// Well-known label to folder type mapping
const LABEL_TYPE_MAP: Record<string, EmailFolder['type']> = {
  INBOX: 'inbox',
  SENT: 'sent',
  DRAFT: 'drafts',
  TRASH: 'trash',
  SPAM: 'spam',
};

// ---- Helpers ----

async function gmailFetch<T>(access_token: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    throw new OAuthError(
      `Rate limited by Gmail API. Retry after ${retryAfter || 'unknown'} seconds`,
      'RATE_LIMITED',
      'google',
      429,
    );
  }

  if (response.status === 401) {
    throw new OAuthError('Access token expired or invalid', 'TOKEN_EXPIRED', 'google', 401);
  }

  if (response.status === 403) {
    throw new OAuthError('Insufficient permissions for this operation', 'FORBIDDEN', 'google', 403);
  }

  if (response.status === 404) {
    throw new OAuthError('Resource not found', 'NOT_FOUND', 'google', 404);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Email/Google] Gmail API error:', { status: response.status, error: errorText, url });
    throw new OAuthError('Gmail API request failed', 'GMAIL_API_ERROR', 'google', response.status);
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Parse an RFC 2822 address string like "Name <email@example.com>" into parts. */
export function parseEmailAddress(raw: string): EmailAddress {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].replace(/^["']|["']$/g, '').trim(), email: match[2] };
  }
  return { email: raw.trim() };
}

/** Parse a comma-separated list of addresses. */
export function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw) return [];
  // Split on commas that are not inside angle brackets
  return raw.split(/,(?=[^>]*(?:<|$))/).map((s) => parseEmailAddress(s.trim())).filter((a) => a.email);
}

/** Get a header value from a Gmail message part. */
function getHeader(part: GmailMessagePart, name: string): string | undefined {
  const header = part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value;
}

/** Decode base64url-encoded data from Gmail API. */
function decodeBase64Url(data: string): string {
  // Convert base64url to base64
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Extract plain text and HTML body from a Gmail message. */
function extractBody(part: GmailMessagePart): { text?: string; html?: string } {
  const result: { text?: string; html?: string } = {};

  if (part.mimeType === 'text/plain' && part.body.data) {
    result.text = decodeBase64Url(part.body.data);
  } else if (part.mimeType === 'text/html' && part.body.data) {
    result.html = decodeBase64Url(part.body.data);
  }

  // Recurse into multipart parts
  if (part.parts) {
    for (const child of part.parts) {
      const childBody = extractBody(child);
      if (childBody.text && !result.text) result.text = childBody.text;
      if (childBody.html && !result.html) result.html = childBody.html;
    }
  }

  return result;
}

/** Extract attachment metadata from a Gmail message. */
function extractAttachments(part: GmailMessagePart): EmailAttachment[] {
  const attachments: EmailAttachment[] = [];

  if (part.filename && part.body.attachmentId) {
    attachments.push({
      id: part.body.attachmentId,
      name: part.filename,
      content_type: part.mimeType,
      size: part.body.size,
      is_inline: getHeader(part, 'Content-Disposition')?.startsWith('inline') || false,
    });
  }

  if (part.parts) {
    for (const child of part.parts) {
      attachments.push(...extractAttachments(child));
    }
  }

  return attachments;
}

function mapGmailMessage(msg: GmailMessage): EmailMessage {
  const body = extractBody(msg.payload);
  const from = getHeader(msg.payload, 'From');
  const to = getHeader(msg.payload, 'To');
  const cc = getHeader(msg.payload, 'Cc');
  const bcc = getHeader(msg.payload, 'Bcc');
  const subject = getHeader(msg.payload, 'Subject');

  return {
    id: msg.id,
    thread_id: msg.thread_id,
    subject: subject || '',
    from: from ? parseEmailAddress(from) : { email: '' },
    to: parseAddressList(to),
    cc: parseAddressList(cc),
    bcc: parseAddressList(bcc),
    body_text: body.text,
    body_html: body.html,
    snippet: msg.snippet,
    received_at: new Date(parseInt(msg.internalDate, 10)).toISOString(),
    is_read: !msg.label_ids.includes('UNREAD'),
    is_starred: msg.label_ids.includes('STARRED'),
    is_draft: msg.label_ids.includes('DRAFT'),
    labels: msg.label_ids,
    attachments: extractAttachments(msg.payload),
    provider: 'google',
  };
}

/** Strip CR/LF to prevent header injection in RFC 2822 fields. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

/** Build a raw RFC 2822 email for Gmail API send/draft. */
function buildRawEmail(params: EmailSendParams | EmailDraftParams): string {
  const headers: string[] = [];

  const formatAddr = (a: EmailAddress): string => {
    if (a.name) {
      const safeName = sanitizeHeaderValue(a.name).replace(/"/g, '\\"');
      return `"${safeName}" <${sanitizeHeaderValue(a.email)}>`;
    }
    return sanitizeHeaderValue(a.email);
  };

  const to = (params.to || []).map(formatAddr).join(', ');
  if (to) headers.push(`To: ${to}`);

  const cc = (params.cc || []).map(formatAddr).join(', ');
  if (cc) headers.push(`Cc: ${cc}`);

  const bcc = (params.bcc || []).map(formatAddr).join(', ');
  if (bcc) headers.push(`Bcc: ${bcc}`);

  headers.push(`Subject: ${sanitizeHeaderValue(params.subject || '')}`);

  if ('reply_to_message_id' in params && params.reply_to_message_id) {
    headers.push(`In-Reply-To: ${sanitizeHeaderValue(params.reply_to_message_id)}`);
    headers.push(`References: ${sanitizeHeaderValue(params.reply_to_message_id)}`);
  }

  if (params.body_html) {
    headers.push('Content-Type: text/html; charset=utf-8');
    headers.push('');
    headers.push(params.body_html);
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    headers.push('');
    headers.push(params.body_text || '');
  }

  const raw = headers.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

// ---- Provider implementation ----

export const googleEmailProvider: EmailProvider = {
  async listMessages(access_token: string, params: EmailListParams): Promise<EmailListResult> {
    const max_results = Math.min(params.max_results || 25, 100);
    const queryParams = new URLSearchParams({
      max_results: String(max_results),
    });

    if (params.query) {
      queryParams.set('q', params.query);
    }

    if (params.page_token) {
      queryParams.set('page_token', params.page_token);
    }

    if (params.label_ids && params.label_ids.length > 0) {
      for (const label of params.label_ids) {
        queryParams.append('label_ids', label);
      }
    } else if (params.folder_id) {
      queryParams.append('label_ids', params.folder_id);
    }

    if (params.include_spam_trash) {
      queryParams.set('include_spam_trash', 'true');
    }

    // First, list message IDs
    const listData = await gmailFetch<GmailMessageListResponse>(
      access_token,
      `${GMAIL_BASE}/users/me/messages?${queryParams.toString()}`,
    );

    if (!listData.messages || listData.messages.length === 0) {
      return { messages: [], next_page_token: listData.next_page_token, result_size_estimate: listData.result_size_estimate };
    }

    // Fetch each message's full content in parallel. Use allSettled so one
    // failed message doesn't fail the entire listing.
    const messageResults = await Promise.allSettled(
      listData.messages.map((m) =>
        gmailFetch<GmailMessage>(
          access_token,
          `${GMAIL_BASE}/users/me/messages/${m.id}?format=full`,
        ),
      ),
    );

    const fullMessages = messageResults
      .filter((r): r is PromiseFulfilledResult<GmailMessage> => r.status === 'fulfilled')
      .map((r) => r.value);

    return {
      messages: fullMessages.map(mapGmailMessage),
      next_page_token: listData.next_page_token,
      result_size_estimate: listData.result_size_estimate,
    };
  },

  async getMessage(access_token: string, message_id: string): Promise<EmailMessage> {
    const msg = await gmailFetch<GmailMessage>(
      access_token,
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}?format=full`,
    );
    return mapGmailMessage(msg);
  },

  async listThreads(access_token: string, params: EmailListParams): Promise<EmailThreadListResult> {
    const max_results = Math.min(params.max_results || 25, 100);
    const queryParams = new URLSearchParams({
      max_results: String(max_results),
    });

    if (params.query) queryParams.set('q', params.query);
    if (params.page_token) queryParams.set('page_token', params.page_token);

    if (params.label_ids && params.label_ids.length > 0) {
      for (const label of params.label_ids) {
        queryParams.append('label_ids', label);
      }
    } else if (params.folder_id) {
      queryParams.append('label_ids', params.folder_id);
    }

    if (params.include_spam_trash) {
      queryParams.set('include_spam_trash', 'true');
    }

    const listData = await gmailFetch<GmailThreadListResponse>(
      access_token,
      `${GMAIL_BASE}/users/me/threads?${queryParams.toString()}`,
    );

    if (!listData.threads || listData.threads.length === 0) {
      return { threads: [], next_page_token: listData.next_page_token, result_size_estimate: listData.result_size_estimate };
    }

    // Fetch each thread's metadata (we only need the last message for the listing)
    const threadPromises = listData.threads.map((t) =>
      gmailFetch<GmailThread>(
        access_token,
        `${GMAIL_BASE}/users/me/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
      ),
    );

    const fullThreads = await Promise.all(threadPromises);

    const threads: EmailThread[] = fullThreads.map((t) => {
      const messages = t.messages || [];
      const lastMsg = messages[messages.length - 1];
      const firstMsg = messages[0];

      const allParticipants = new Map<string, EmailAddress>();
      for (const m of messages) {
        const from = getHeader(m.payload, 'From');
        if (from) {
          const addr = parseEmailAddress(from);
          allParticipants.set(addr.email, addr);
        }
      }

      return {
        id: t.id,
        subject: firstMsg ? (getHeader(firstMsg.payload, 'Subject') || '') : '',
        snippet: t.snippet,
        message_count: messages.length,
        message_ids: messages.map((m) => m.id),
        last_message_at: lastMsg ? new Date(parseInt(lastMsg.internalDate, 10)).toISOString() : '',
        is_read: messages.every((m) => !m.label_ids.includes('UNREAD')),
        labels: lastMsg?.label_ids || [],
        participants: [...allParticipants.values()],
        provider: 'google',
      };
    });

    return {
      threads,
      next_page_token: listData.next_page_token,
      result_size_estimate: listData.result_size_estimate,
    };
  },

  async getThread(access_token: string, thread_id: string): Promise<EmailThread & { messages: EmailMessage[] }> {
    const thread = await gmailFetch<GmailThread>(
      access_token,
      `${GMAIL_BASE}/users/me/threads/${encodeURIComponent(thread_id)}?format=full`,
    );

    const messages = (thread.messages || []).map(mapGmailMessage);

    if (messages.length === 0) {
      throw new OAuthError('Thread not found or empty', 'NOT_FOUND', 'google', 404);
    }

    const allParticipants = new Map<string, EmailAddress>();
    for (const m of messages) {
      if (m.from.email) allParticipants.set(m.from.email, m.from);
      for (const r of m.to) allParticipants.set(r.email, r);
    }

    const lastMsg = messages[messages.length - 1];

    return {
      id: thread.id,
      subject: messages[0].subject,
      snippet: thread.snippet,
      message_count: messages.length,
      message_ids: messages.map((m) => m.id),
      last_message_at: lastMsg.received_at,
      is_read: messages.every((m) => m.is_read),
      labels: lastMsg.labels,
      participants: [...allParticipants.values()],
      provider: 'google',
      messages,
    };
  },

  async listFolders(access_token: string): Promise<EmailFolder[]> {
    const data = await gmailFetch<GmailLabelsListResponse>(
      access_token,
      `${GMAIL_BASE}/users/me/labels`,
    );

    return data.labels.map((label) => ({
      id: label.id,
      name: label.name,
      type: LABEL_TYPE_MAP[label.id] || 'other',
      message_count: label.messagesTotal,
      unread_count: label.messagesUnread,
      provider: 'google',
    }));
  },

  async sendMessage(access_token: string, params: EmailSendParams): Promise<EmailSendResult> {
    const body: Record<string, unknown> = {
      raw: buildRawEmail(params),
    };

    if (params.thread_id) {
      body.thread_id = params.thread_id;
    }

    const result = await gmailFetch<GmailMessage>(
      access_token,
      `${GMAIL_BASE}/users/me/messages/send`,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return {
      message_id: result.id,
      thread_id: result.thread_id,
      provider: 'google',
    };
  },

  async createDraft(access_token: string, params: EmailDraftParams): Promise<EmailMessage> {
    const draftBody: Record<string, unknown> = {
      message: {
        raw: buildRawEmail(params as EmailSendParams),
      },
    };

    if (params.thread_id) {
      (draftBody.message as Record<string, unknown>).thread_id = params.thread_id;
    }

    const draft = await gmailFetch<GmailDraftResponse>(
      access_token,
      `${GMAIL_BASE}/users/me/drafts`,
      { method: 'POST', body: JSON.stringify(draftBody) },
    );

    // Fetch the full message
    return this.getMessage(access_token, draft.message.id);
  },

  async updateDraft(access_token: string, draftId: string, params: EmailDraftParams): Promise<EmailMessage> {
    const draftBody: Record<string, unknown> = {
      message: {
        raw: buildRawEmail(params as EmailSendParams),
      },
    };

    if (params.thread_id) {
      (draftBody.message as Record<string, unknown>).thread_id = params.thread_id;
    }

    const draft = await gmailFetch<GmailDraftResponse>(
      access_token,
      `${GMAIL_BASE}/users/me/drafts/${encodeURIComponent(draftId)}`,
      { method: 'PUT', body: JSON.stringify(draftBody) },
    );

    return this.getMessage(access_token, draft.message.id);
  },

  async updateMessage(access_token: string, message_id: string, params: EmailUpdateParams): Promise<void> {
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];

    if (params.is_read === true) removeLabelIds.push('UNREAD');
    if (params.is_read === false) addLabelIds.push('UNREAD');

    if (params.is_starred === true) addLabelIds.push('STARRED');
    if (params.is_starred === false) removeLabelIds.push('STARRED');

    if (params.add_labels) addLabelIds.push(...params.add_labels);
    if (params.remove_labels) removeLabelIds.push(...params.remove_labels);

    // Handle move_to by adding new label and removing INBOX (standard Gmail move pattern)
    if (params.move_to) {
      addLabelIds.push(params.move_to);
      if (params.move_to !== 'INBOX') {
        removeLabelIds.push('INBOX');
      }
    }

    if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
      await gmailFetch<GmailMessage>(
        access_token,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}/modify`,
        {
          method: 'POST',
          body: JSON.stringify({ addLabelIds, removeLabelIds }),
        },
      );
    }
  },

  async deleteMessage(access_token: string, message_id: string, permanent?: boolean): Promise<void> {
    if (permanent) {
      await gmailFetch<undefined>(
        access_token,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}`,
        { method: 'DELETE' },
      );
    } else {
      await gmailFetch<undefined>(
        access_token,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}/trash`,
        { method: 'POST' },
      );
    }
  },

  async getAttachment(access_token: string, message_id: string, attachmentId: string): Promise<EmailAttachmentContent> {
    const att = await gmailFetch<GmailAttachmentResponse>(
      access_token,
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    // Gmail returns base64url-encoded content; convert to standard base64
    const base64 = att.data.replace(/-/g, '+').replace(/_/g, '/');

    return {
      id: att.attachmentId,
      name: '', // Gmail attachment endpoint doesn't return the name
      content_type: '', // Nor the content type — caller already has this from the message
      size: att.size,
      content_base64: base64,
    };
  },
};
