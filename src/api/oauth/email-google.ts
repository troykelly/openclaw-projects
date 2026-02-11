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
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailMessagePart;
  internalDate: string;
  sizeEstimate: number;
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
  messages: GmailMessage[];
}

interface GmailThreadListResponse {
  threads?: Array<{ id: string; snippet: string; historyId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
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

async function gmailFetch<T>(accessToken: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
      contentType: part.mimeType,
      size: part.body.size,
      isInline: getHeader(part, 'Content-Disposition')?.startsWith('inline') || false,
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
    threadId: msg.threadId,
    subject: subject || '',
    from: from ? parseEmailAddress(from) : { email: '' },
    to: parseAddressList(to),
    cc: parseAddressList(cc),
    bcc: parseAddressList(bcc),
    bodyText: body.text,
    bodyHtml: body.html,
    snippet: msg.snippet,
    receivedAt: new Date(parseInt(msg.internalDate, 10)).toISOString(),
    isRead: !msg.labelIds.includes('UNREAD'),
    isStarred: msg.labelIds.includes('STARRED'),
    isDraft: msg.labelIds.includes('DRAFT'),
    labels: msg.labelIds,
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

  if ('replyToMessageId' in params && params.replyToMessageId) {
    headers.push(`In-Reply-To: ${sanitizeHeaderValue(params.replyToMessageId)}`);
    headers.push(`References: ${sanitizeHeaderValue(params.replyToMessageId)}`);
  }

  if (params.bodyHtml) {
    headers.push('Content-Type: text/html; charset=utf-8');
    headers.push('');
    headers.push(params.bodyHtml);
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    headers.push('');
    headers.push(params.bodyText || '');
  }

  const raw = headers.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

// ---- Provider implementation ----

export const googleEmailProvider: EmailProvider = {
  async listMessages(accessToken: string, params: EmailListParams): Promise<EmailListResult> {
    const maxResults = Math.min(params.maxResults || 25, 100);
    const queryParams = new URLSearchParams({
      maxResults: String(maxResults),
    });

    if (params.query) {
      queryParams.set('q', params.query);
    }

    if (params.pageToken) {
      queryParams.set('pageToken', params.pageToken);
    }

    if (params.labelIds && params.labelIds.length > 0) {
      for (const label of params.labelIds) {
        queryParams.append('labelIds', label);
      }
    } else if (params.folderId) {
      queryParams.append('labelIds', params.folderId);
    }

    if (params.includeSpamTrash) {
      queryParams.set('includeSpamTrash', 'true');
    }

    // First, list message IDs
    const listData = await gmailFetch<GmailMessageListResponse>(
      accessToken,
      `${GMAIL_BASE}/users/me/messages?${queryParams.toString()}`,
    );

    if (!listData.messages || listData.messages.length === 0) {
      return { messages: [], nextPageToken: listData.nextPageToken, resultSizeEstimate: listData.resultSizeEstimate };
    }

    // Then fetch each message's full content in parallel (batch)
    const messagePromises = listData.messages.map((m) =>
      gmailFetch<GmailMessage>(
        accessToken,
        `${GMAIL_BASE}/users/me/messages/${m.id}?format=full`,
      ),
    );

    const fullMessages = await Promise.all(messagePromises);

    return {
      messages: fullMessages.map(mapGmailMessage),
      nextPageToken: listData.nextPageToken,
      resultSizeEstimate: listData.resultSizeEstimate,
    };
  },

  async getMessage(accessToken: string, messageId: string): Promise<EmailMessage> {
    const msg = await gmailFetch<GmailMessage>(
      accessToken,
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    return mapGmailMessage(msg);
  },

  async listThreads(accessToken: string, params: EmailListParams): Promise<EmailThreadListResult> {
    const maxResults = Math.min(params.maxResults || 25, 100);
    const queryParams = new URLSearchParams({
      maxResults: String(maxResults),
    });

    if (params.query) queryParams.set('q', params.query);
    if (params.pageToken) queryParams.set('pageToken', params.pageToken);

    if (params.labelIds && params.labelIds.length > 0) {
      for (const label of params.labelIds) {
        queryParams.append('labelIds', label);
      }
    } else if (params.folderId) {
      queryParams.append('labelIds', params.folderId);
    }

    if (params.includeSpamTrash) {
      queryParams.set('includeSpamTrash', 'true');
    }

    const listData = await gmailFetch<GmailThreadListResponse>(
      accessToken,
      `${GMAIL_BASE}/users/me/threads?${queryParams.toString()}`,
    );

    if (!listData.threads || listData.threads.length === 0) {
      return { threads: [], nextPageToken: listData.nextPageToken, resultSizeEstimate: listData.resultSizeEstimate };
    }

    // Fetch each thread's metadata (we only need the last message for the listing)
    const threadPromises = listData.threads.map((t) =>
      gmailFetch<GmailThread>(
        accessToken,
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
        messageCount: messages.length,
        messageIds: messages.map((m) => m.id),
        lastMessageAt: lastMsg ? new Date(parseInt(lastMsg.internalDate, 10)).toISOString() : '',
        isRead: messages.every((m) => !m.labelIds.includes('UNREAD')),
        labels: lastMsg?.labelIds || [],
        participants: [...allParticipants.values()],
        provider: 'google',
      };
    });

    return {
      threads,
      nextPageToken: listData.nextPageToken,
      resultSizeEstimate: listData.resultSizeEstimate,
    };
  },

  async getThread(accessToken: string, threadId: string): Promise<EmailThread & { messages: EmailMessage[] }> {
    const thread = await gmailFetch<GmailThread>(
      accessToken,
      `${GMAIL_BASE}/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
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
      messageCount: messages.length,
      messageIds: messages.map((m) => m.id),
      lastMessageAt: lastMsg.receivedAt,
      isRead: messages.every((m) => m.isRead),
      labels: lastMsg.labels,
      participants: [...allParticipants.values()],
      provider: 'google',
      messages,
    };
  },

  async listFolders(accessToken: string): Promise<EmailFolder[]> {
    const data = await gmailFetch<GmailLabelsListResponse>(
      accessToken,
      `${GMAIL_BASE}/users/me/labels`,
    );

    return data.labels.map((label) => ({
      id: label.id,
      name: label.name,
      type: LABEL_TYPE_MAP[label.id] || 'other',
      messageCount: label.messagesTotal,
      unreadCount: label.messagesUnread,
      provider: 'google',
    }));
  },

  async sendMessage(accessToken: string, params: EmailSendParams): Promise<EmailSendResult> {
    const body: Record<string, unknown> = {
      raw: buildRawEmail(params),
    };

    if (params.threadId) {
      body.threadId = params.threadId;
    }

    const result = await gmailFetch<GmailMessage>(
      accessToken,
      `${GMAIL_BASE}/users/me/messages/send`,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return {
      messageId: result.id,
      threadId: result.threadId,
      provider: 'google',
    };
  },

  async createDraft(accessToken: string, params: EmailDraftParams): Promise<EmailMessage> {
    const draftBody: Record<string, unknown> = {
      message: {
        raw: buildRawEmail(params as EmailSendParams),
      },
    };

    if (params.threadId) {
      (draftBody.message as Record<string, unknown>).threadId = params.threadId;
    }

    const draft = await gmailFetch<GmailDraftResponse>(
      accessToken,
      `${GMAIL_BASE}/users/me/drafts`,
      { method: 'POST', body: JSON.stringify(draftBody) },
    );

    // Fetch the full message
    return this.getMessage(accessToken, draft.message.id);
  },

  async updateDraft(accessToken: string, draftId: string, params: EmailDraftParams): Promise<EmailMessage> {
    const draftBody: Record<string, unknown> = {
      message: {
        raw: buildRawEmail(params as EmailSendParams),
      },
    };

    if (params.threadId) {
      (draftBody.message as Record<string, unknown>).threadId = params.threadId;
    }

    const draft = await gmailFetch<GmailDraftResponse>(
      accessToken,
      `${GMAIL_BASE}/users/me/drafts/${encodeURIComponent(draftId)}`,
      { method: 'PUT', body: JSON.stringify(draftBody) },
    );

    return this.getMessage(accessToken, draft.message.id);
  },

  async updateMessage(accessToken: string, messageId: string, params: EmailUpdateParams): Promise<void> {
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];

    if (params.isRead === true) removeLabelIds.push('UNREAD');
    if (params.isRead === false) addLabelIds.push('UNREAD');

    if (params.isStarred === true) addLabelIds.push('STARRED');
    if (params.isStarred === false) removeLabelIds.push('STARRED');

    if (params.addLabels) addLabelIds.push(...params.addLabels);
    if (params.removeLabels) removeLabelIds.push(...params.removeLabels);

    // Handle moveTo by adding new label and removing INBOX (standard Gmail move pattern)
    if (params.moveTo) {
      addLabelIds.push(params.moveTo);
      if (params.moveTo !== 'INBOX') {
        removeLabelIds.push('INBOX');
      }
    }

    if (addLabelIds.length > 0 || removeLabelIds.length > 0) {
      await gmailFetch<GmailMessage>(
        accessToken,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/modify`,
        {
          method: 'POST',
          body: JSON.stringify({ addLabelIds, removeLabelIds }),
        },
      );
    }
  },

  async deleteMessage(accessToken: string, messageId: string, permanent?: boolean): Promise<void> {
    if (permanent) {
      await gmailFetch<undefined>(
        accessToken,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      );
    } else {
      await gmailFetch<undefined>(
        accessToken,
        `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/trash`,
        { method: 'POST' },
      );
    }
  },

  async getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<EmailAttachmentContent> {
    const att = await gmailFetch<GmailAttachmentResponse>(
      accessToken,
      `${GMAIL_BASE}/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    // Gmail returns base64url-encoded content; convert to standard base64
    const base64 = att.data.replace(/-/g, '+').replace(/_/g, '/');

    return {
      id: att.attachmentId,
      name: '', // Gmail attachment endpoint doesn't return the name
      contentType: '', // Nor the content type — caller already has this from the message
      size: att.size,
      contentBase64: base64,
    };
  },
};
