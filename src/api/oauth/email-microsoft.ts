/**
 * Microsoft Graph Mail API implementation.
 * Part of Issue #1048.
 *
 * Provides live API access to email operations via Microsoft Graph:
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

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---- Graph API response types ----

interface GraphEmailAddress {
  emailAddress: {
    address: string;
    name?: string;
  };
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string;
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject: string;
  from?: GraphEmailAddress;
  toRecipients: GraphEmailAddress[];
  ccRecipients: GraphEmailAddress[];
  bccRecipients: GraphEmailAddress[];
  body: { contentType: string; content: string };
  bodyPreview?: string;
  receivedDateTime: string;
  isRead: boolean;
  flag?: { flagStatus: string };
  isDraft: boolean;
  categories: string[];
  hasAttachments: boolean;
  attachments?: GraphAttachment[];
  parentFolderId?: string;
  webLink?: string;
}

interface GraphMessageListResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

interface GraphMailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
  isHidden: boolean;
}

interface GraphMailFolderListResponse {
  value: GraphMailFolder[];
  '@odata.nextLink'?: string;
}

// Well-known folder name to our type mapping
const FOLDER_TYPE_MAP: Record<string, EmailFolder['type']> = {
  Inbox: 'inbox',
  'Sent Items': 'sent',
  SentItems: 'sent',
  Drafts: 'drafts',
  'Deleted Items': 'trash',
  DeletedItems: 'trash',
  'Junk Email': 'spam',
  JunkEmail: 'spam',
  Archive: 'archive',
};

// ---- Helpers ----

function mapAddress(addr: GraphEmailAddress): EmailAddress {
  return {
    email: addr.emailAddress.address,
    name: addr.emailAddress.name || undefined,
  };
}

function mapAttachment(att: GraphAttachment): EmailAttachment {
  return {
    id: att.id,
    name: att.name,
    contentType: att.contentType,
    size: att.size,
    isInline: att.isInline,
  };
}

function mapMessage(msg: GraphMessage): EmailMessage {
  return {
    id: msg.id,
    threadId: msg.conversationId,
    subject: msg.subject || '',
    from: msg.from ? mapAddress(msg.from) : { email: '' },
    to: (msg.toRecipients || []).map(mapAddress),
    cc: (msg.ccRecipients || []).map(mapAddress),
    bcc: (msg.bccRecipients || []).map(mapAddress),
    bodyText: msg.body.contentType === 'text' ? msg.body.content : undefined,
    bodyHtml: msg.body.contentType === 'html' ? msg.body.content : undefined,
    snippet: msg.bodyPreview,
    receivedAt: msg.receivedDateTime,
    isRead: msg.isRead,
    isStarred: msg.flag?.flagStatus === 'flagged',
    isDraft: msg.isDraft,
    labels: msg.categories || [],
    attachments: (msg.attachments || []).map(mapAttachment),
    folderId: msg.parentFolderId,
    webLink: msg.webLink,
    provider: 'microsoft',
  };
}

function mapFolder(folder: GraphMailFolder): EmailFolder {
  return {
    id: folder.id,
    name: folder.displayName,
    type: FOLDER_TYPE_MAP[folder.displayName] || 'other',
    messageCount: folder.totalItemCount,
    unreadCount: folder.unreadItemCount,
    provider: 'microsoft',
  };
}

function toGraphRecipient(addr: EmailAddress): GraphEmailAddress {
  return {
    emailAddress: {
      address: addr.email,
      name: addr.name,
    },
  };
}

async function graphFetch<T>(accessToken: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      // Request immutable IDs so message IDs are stable across moves/copies
      Prefer: 'IdType="ImmutableId"',
      ...options?.headers,
    },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    throw new OAuthError(
      `Rate limited by Microsoft Graph. Retry after ${retryAfter || 'unknown'} seconds`,
      'RATE_LIMITED',
      'microsoft',
      429,
    );
  }

  if (response.status === 404) {
    throw new OAuthError('Resource not found', 'NOT_FOUND', 'microsoft', 404);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Email/Microsoft] Graph API error:', { status: response.status, error: errorText, url });
    throw new OAuthError('Microsoft Graph API request failed', 'GRAPH_API_ERROR', 'microsoft', response.status);
  }

  // Some operations (DELETE, PATCH with 204) return no body
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ---- Provider implementation ----

const MESSAGE_SELECT = [
  'id', 'conversationId', 'subject', 'from', 'toRecipients', 'ccRecipients',
  'bccRecipients', 'body', 'bodyPreview', 'receivedDateTime', 'isRead',
  'flag', 'isDraft', 'categories', 'hasAttachments', 'parentFolderId', 'webLink',
].join(',');

export const microsoftEmailProvider: EmailProvider = {
  async listMessages(accessToken: string, params: EmailListParams): Promise<EmailListResult> {
    const top = Math.min(params.maxResults || 25, 100);
    const queryParams = new URLSearchParams({
      $top: String(top),
      $select: MESSAGE_SELECT,
      $orderby: 'receivedDateTime desc',
    });

    if (params.query) {
      queryParams.set('$search', `"${params.query}"`);
      // $search and $orderby cannot coexist in Graph API
      queryParams.delete('$orderby');
    }

    let baseUrl = `${GRAPH_BASE}/me/messages`;
    if (params.folderId) {
      baseUrl = `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(params.folderId)}/messages`;
    }

    const url = params.pageToken || `${baseUrl}?${queryParams.toString()}`;

    const data = await graphFetch<GraphMessageListResponse>(accessToken, url);

    return {
      messages: data.value.map(mapMessage),
      nextPageToken: data['@odata.nextLink'],
      resultSizeEstimate: data['@odata.count'],
    };
  },

  async getMessage(accessToken: string, messageId: string): Promise<EmailMessage> {
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=${MESSAGE_SELECT}&$expand=attachments($select=id,name,contentType,size,isInline)`;
    const msg = await graphFetch<GraphMessage>(accessToken, url);
    return mapMessage(msg);
  },

  async listThreads(accessToken: string, params: EmailListParams): Promise<EmailThreadListResult> {
    // Microsoft Graph doesn't have a native "threads" endpoint. We approximate
    // by listing messages grouped by conversationId. For efficiency we list
    // messages and group client-side.
    const listResult = await this.listMessages(accessToken, params);

    const threadMap = new Map<string, {
      messages: EmailMessage[];
      lastMessageAt: string;
    }>();

    for (const msg of listResult.messages) {
      const tid = msg.threadId || msg.id;
      const existing = threadMap.get(tid);
      if (existing) {
        existing.messages.push(msg);
        if (msg.receivedAt > existing.lastMessageAt) {
          existing.lastMessageAt = msg.receivedAt;
        }
      } else {
        threadMap.set(tid, { messages: [msg], lastMessageAt: msg.receivedAt });
      }
    }

    const threads: EmailThread[] = [];
    for (const [id, data] of threadMap) {
      const firstMsg = data.messages[0];
      const allParticipants = new Map<string, EmailAddress>();
      for (const m of data.messages) {
        if (m.from.email) allParticipants.set(m.from.email, m.from);
        for (const r of m.to) allParticipants.set(r.email, r);
      }

      threads.push({
        id,
        subject: firstMsg.subject,
        snippet: firstMsg.snippet,
        messageCount: data.messages.length,
        messageIds: data.messages.map((m) => m.id),
        lastMessageAt: data.lastMessageAt,
        isRead: data.messages.every((m) => m.isRead),
        labels: firstMsg.labels,
        participants: [...allParticipants.values()],
        provider: 'microsoft',
      });
    }

    return {
      threads,
      nextPageToken: listResult.nextPageToken,
      resultSizeEstimate: listResult.resultSizeEstimate,
    };
  },

  async getThread(accessToken: string, threadId: string): Promise<EmailThread & { messages: EmailMessage[] }> {
    // Fetch all messages in this conversation
    const url = `${GRAPH_BASE}/me/messages?$filter=conversationId eq '${threadId}'&$select=${MESSAGE_SELECT}&$orderby=receivedDateTime asc&$top=100&$expand=attachments($select=id,name,contentType,size,isInline)`;
    const data = await graphFetch<GraphMessageListResponse>(accessToken, url);
    const messages = data.value.map(mapMessage);

    if (messages.length === 0) {
      throw new OAuthError('Thread not found', 'NOT_FOUND', 'microsoft', 404);
    }

    const allParticipants = new Map<string, EmailAddress>();
    for (const m of messages) {
      if (m.from.email) allParticipants.set(m.from.email, m.from);
      for (const r of m.to) allParticipants.set(r.email, r);
    }

    const lastMsg = messages[messages.length - 1];

    return {
      id: threadId,
      subject: messages[0].subject,
      snippet: lastMsg.snippet,
      messageCount: messages.length,
      messageIds: messages.map((m) => m.id),
      lastMessageAt: lastMsg.receivedAt,
      isRead: messages.every((m) => m.isRead),
      labels: messages[0].labels,
      participants: [...allParticipants.values()],
      provider: 'microsoft',
      messages,
    };
  },

  async listFolders(accessToken: string): Promise<EmailFolder[]> {
    const folders: EmailFolder[] = [];
    let url: string | undefined = `${GRAPH_BASE}/me/mailFolders?$top=100`;

    while (url) {
      const data = await graphFetch<GraphMailFolderListResponse>(accessToken, url);
      folders.push(...data.value.filter((f) => !f.isHidden).map(mapFolder));
      url = data['@odata.nextLink'];
    }

    return folders;
  },

  async sendMessage(accessToken: string, params: EmailSendParams): Promise<EmailSendResult> {
    const message: Record<string, unknown> = {
      subject: params.subject,
      body: {
        contentType: params.bodyHtml ? 'html' : 'text',
        content: params.bodyHtml || params.bodyText || '',
      },
      toRecipients: params.to.map(toGraphRecipient),
    };

    if (params.cc && params.cc.length > 0) {
      message.ccRecipients = params.cc.map(toGraphRecipient);
    }
    if (params.bcc && params.bcc.length > 0) {
      message.bccRecipients = params.bcc.map(toGraphRecipient);
    }

    // For replies, create as reply then send
    if (params.replyToMessageId) {
      // Create a reply draft
      const replyDraft = await graphFetch<GraphMessage>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(params.replyToMessageId)}/createReply`,
        { method: 'POST', body: JSON.stringify({ message }) },
      );

      // Send the reply
      await graphFetch<undefined>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(replyDraft.id)}/send`,
        { method: 'POST' },
      );

      return {
        messageId: replyDraft.id,
        threadId: replyDraft.conversationId,
        provider: 'microsoft',
      };
    }

    // New message — use sendMail endpoint
    await graphFetch<undefined>(
      accessToken,
      `${GRAPH_BASE}/me/sendMail`,
      {
        method: 'POST',
        body: JSON.stringify({ message, saveToSentItems: true }),
      },
    );

    // sendMail doesn't return the message ID. Return a placeholder.
    return {
      messageId: '',
      threadId: undefined,
      provider: 'microsoft',
    };
  },

  async createDraft(accessToken: string, params: EmailDraftParams): Promise<EmailMessage> {
    const message: Record<string, unknown> = {
      subject: params.subject || '',
      body: {
        contentType: params.bodyHtml ? 'html' : 'text',
        content: params.bodyHtml || params.bodyText || '',
      },
    };

    if (params.to) message.toRecipients = params.to.map(toGraphRecipient);
    if (params.cc) message.ccRecipients = params.cc.map(toGraphRecipient);
    if (params.bcc) message.bccRecipients = params.bcc.map(toGraphRecipient);

    let url = `${GRAPH_BASE}/me/messages`;
    if (params.replyToMessageId) {
      url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(params.replyToMessageId)}/createReply`;
    }

    const draft = await graphFetch<GraphMessage>(accessToken, url, {
      method: 'POST',
      body: JSON.stringify(message),
    });

    return mapMessage(draft);
  },

  async updateDraft(accessToken: string, draftId: string, params: EmailDraftParams): Promise<EmailMessage> {
    const updates: Record<string, unknown> = {};

    if (params.subject !== undefined) updates.subject = params.subject;
    if (params.bodyHtml || params.bodyText) {
      updates.body = {
        contentType: params.bodyHtml ? 'html' : 'text',
        content: params.bodyHtml || params.bodyText,
      };
    }
    if (params.to) updates.toRecipients = params.to.map(toGraphRecipient);
    if (params.cc) updates.ccRecipients = params.cc.map(toGraphRecipient);
    if (params.bcc) updates.bccRecipients = params.bcc.map(toGraphRecipient);

    const updated = await graphFetch<GraphMessage>(
      accessToken,
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );

    return mapMessage(updated);
  },

  async updateMessage(accessToken: string, messageId: string, params: EmailUpdateParams): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (params.isRead !== undefined) {
      updates.isRead = params.isRead;
    }

    if (params.isStarred !== undefined) {
      updates.flag = { flagStatus: params.isStarred ? 'flagged' : 'notFlagged' };
    }

    if (params.addLabels || params.removeLabels) {
      // Microsoft uses categories, not labels. Map label operations to category changes.
      // Fetch current categories first
      const current = await graphFetch<GraphMessage>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=categories`,
      );
      const categories = new Set(current.categories || []);
      if (params.addLabels) params.addLabels.forEach((l) => categories.add(l));
      if (params.removeLabels) params.removeLabels.forEach((l) => categories.delete(l));
      updates.categories = [...categories];
    }

    if (Object.keys(updates).length > 0) {
      await graphFetch<undefined>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`,
        { method: 'PATCH', body: JSON.stringify(updates) },
      );
    }

    // Move to folder if requested
    if (params.moveTo) {
      await graphFetch<GraphMessage>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/move`,
        { method: 'POST', body: JSON.stringify({ destinationId: params.moveTo }) },
      );
    }
  },

  async deleteMessage(accessToken: string, messageId: string, permanent?: boolean): Promise<void> {
    if (permanent) {
      await graphFetch<undefined>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE' },
      );
    } else {
      // Move to Deleted Items
      await graphFetch<GraphMessage>(
        accessToken,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/move`,
        { method: 'POST', body: JSON.stringify({ destinationId: 'DeletedItems' }) },
      );
    }
  },

  async getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<EmailAttachmentContent> {
    const att = await graphFetch<GraphAttachment>(
      accessToken,
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    return {
      id: att.id,
      name: att.name,
      contentType: att.contentType,
      size: att.size,
      contentBase64: att.contentBytes || '',
    };
  },
};
