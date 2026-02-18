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
  content_type: string;
  size: number;
  is_inline: boolean;
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
  body: { content_type: string; content: string };
  bodyPreview?: string;
  receivedDateTime: string;
  is_read: boolean;
  flag?: { flagStatus: string };
  is_draft: boolean;
  categories: string[];
  hasAttachments: boolean;
  attachments?: GraphAttachment[];
  parentFolderId?: string;
  web_link?: string;
}

interface GraphMessageListResponse {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

interface GraphMailFolder {
  id: string;
  display_name: string;
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
    content_type: att.content_type,
    size: att.size,
    is_inline: att.is_inline,
  };
}

function mapMessage(msg: GraphMessage): EmailMessage {
  return {
    id: msg.id,
    thread_id: msg.conversationId,
    subject: msg.subject || '',
    from: msg.from ? mapAddress(msg.from) : { email: '' },
    to: (msg.toRecipients || []).map(mapAddress),
    cc: (msg.ccRecipients || []).map(mapAddress),
    bcc: (msg.bccRecipients || []).map(mapAddress),
    body_text: msg.body.content_type === 'text' ? msg.body.content : undefined,
    body_html: msg.body.content_type === 'html' ? msg.body.content : undefined,
    snippet: msg.bodyPreview,
    received_at: msg.receivedDateTime,
    is_read: msg.is_read,
    is_starred: msg.flag?.flagStatus === 'flagged',
    is_draft: msg.is_draft,
    labels: msg.categories || [],
    attachments: (msg.attachments || []).map(mapAttachment),
    folder_id: msg.parentFolderId,
    web_link: msg.web_link,
    provider: 'microsoft',
  };
}

function mapFolder(folder: GraphMailFolder): EmailFolder {
  return {
    id: folder.id,
    name: folder.display_name,
    type: FOLDER_TYPE_MAP[folder.display_name] || 'other',
    message_count: folder.totalItemCount,
    unread_count: folder.unreadItemCount,
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

async function graphFetch<T>(access_token: string, url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${access_token}`,
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

  if (response.status === 401) {
    throw new OAuthError('Access token expired or invalid', 'TOKEN_EXPIRED', 'microsoft', 401);
  }

  if (response.status === 403) {
    throw new OAuthError('Insufficient permissions for this operation', 'FORBIDDEN', 'microsoft', 403);
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
  'bccRecipients', 'body', 'bodyPreview', 'receivedDateTime', 'is_read',
  'flag', 'is_draft', 'categories', 'hasAttachments', 'parentFolderId', 'web_link',
].join(',');

export const microsoftEmailProvider: EmailProvider = {
  async listMessages(access_token: string, params: EmailListParams): Promise<EmailListResult> {
    const top = Math.min(params.max_results || 25, 100);
    const queryParams = new URLSearchParams({
      $top: String(top),
      $select: MESSAGE_SELECT,
      $orderby: 'receivedDateTime desc',
    });

    if (params.query) {
      // Escape double quotes in search query to prevent KQL injection
      const sanitizedQuery = params.query.replace(/"/g, '\\"');
      queryParams.set('$search', `"${sanitizedQuery}"`);
      // $search and $orderby cannot coexist in Graph API
      queryParams.delete('$orderby');
    }

    let baseUrl = `${GRAPH_BASE}/me/messages`;
    if (params.folder_id) {
      baseUrl = `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(params.folder_id)}/messages`;
    }

    const url = params.page_token || `${baseUrl}?${queryParams.toString()}`;

    const data = await graphFetch<GraphMessageListResponse>(access_token, url);

    return {
      messages: data.value.map(mapMessage),
      next_page_token: data['@odata.nextLink'],
      result_size_estimate: data['@odata.count'],
    };
  },

  async getMessage(access_token: string, message_id: string): Promise<EmailMessage> {
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}?$select=${MESSAGE_SELECT}&$expand=attachments($select=id,name,content_type,size,is_inline)`;
    const msg = await graphFetch<GraphMessage>(access_token, url);
    return mapMessage(msg);
  },

  async listThreads(access_token: string, params: EmailListParams): Promise<EmailThreadListResult> {
    // Microsoft Graph doesn't have a native "threads" endpoint. We approximate
    // by listing messages grouped by conversationId. For efficiency we list
    // messages and group client-side.
    const listResult = await this.listMessages(access_token, params);

    const threadMap = new Map<string, {
      messages: EmailMessage[];
      last_message_at: string;
    }>();

    for (const msg of listResult.messages) {
      const tid = msg.thread_id || msg.id;
      const existing = threadMap.get(tid);
      if (existing) {
        existing.messages.push(msg);
        if (msg.received_at > existing.last_message_at) {
          existing.last_message_at = msg.received_at;
        }
      } else {
        threadMap.set(tid, { messages: [msg], last_message_at: msg.received_at });
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
        message_count: data.messages.length,
        message_ids: data.messages.map((m) => m.id),
        last_message_at: data.last_message_at,
        is_read: data.messages.every((m) => m.is_read),
        labels: firstMsg.labels,
        participants: [...allParticipants.values()],
        provider: 'microsoft',
      });
    }

    return {
      threads,
      next_page_token: listResult.next_page_token,
      result_size_estimate: listResult.result_size_estimate,
    };
  },

  async getThread(access_token: string, thread_id: string): Promise<EmailThread & { messages: EmailMessage[] }> {
    // Fetch all messages in this conversation
    // Sanitize thread_id for OData $filter to prevent injection
    const sanitizedThreadId = thread_id.replace(/'/g, "''");
    const url = `${GRAPH_BASE}/me/messages?$filter=conversationId eq '${sanitizedThreadId}'&$select=${MESSAGE_SELECT}&$orderby=receivedDateTime asc&$top=100&$expand=attachments($select=id,name,content_type,size,is_inline)`;
    const data = await graphFetch<GraphMessageListResponse>(access_token, url);
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
      id: thread_id,
      subject: messages[0].subject,
      snippet: lastMsg.snippet,
      message_count: messages.length,
      message_ids: messages.map((m) => m.id),
      last_message_at: lastMsg.received_at,
      is_read: messages.every((m) => m.is_read),
      labels: messages[0].labels,
      participants: [...allParticipants.values()],
      provider: 'microsoft',
      messages,
    };
  },

  async listFolders(access_token: string): Promise<EmailFolder[]> {
    const folders: EmailFolder[] = [];
    let url: string | undefined = `${GRAPH_BASE}/me/mailFolders?$top=100`;

    while (url) {
      const data: GraphMailFolderListResponse = await graphFetch<GraphMailFolderListResponse>(access_token, url);
      folders.push(...data.value.filter((f: GraphMailFolder) => !f.isHidden).map(mapFolder));
      url = data['@odata.nextLink'];
    }

    return folders;
  },

  async sendMessage(access_token: string, params: EmailSendParams): Promise<EmailSendResult> {
    const message: Record<string, unknown> = {
      subject: params.subject,
      body: {
        content_type: params.body_html ? 'html' : 'text',
        content: params.body_html || params.body_text || '',
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
    if (params.reply_to_message_id) {
      // Create a reply draft
      const replyDraft = await graphFetch<GraphMessage>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(params.reply_to_message_id)}/createReply`,
        { method: 'POST', body: JSON.stringify({ message }) },
      );

      // Send the reply
      await graphFetch<undefined>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(replyDraft.id)}/send`,
        { method: 'POST' },
      );

      return {
        message_id: replyDraft.id,
        thread_id: replyDraft.conversationId,
        provider: 'microsoft',
      };
    }

    // New message — use sendMail endpoint
    await graphFetch<undefined>(
      access_token,
      `${GRAPH_BASE}/me/sendMail`,
      {
        method: 'POST',
        body: JSON.stringify({ message, saveToSentItems: true }),
      },
    );

    // sendMail doesn't return the message ID. Return a placeholder.
    return {
      message_id: '',
      thread_id: undefined,
      provider: 'microsoft',
    };
  },

  async createDraft(access_token: string, params: EmailDraftParams): Promise<EmailMessage> {
    const message: Record<string, unknown> = {
      subject: params.subject || '',
      body: {
        content_type: params.body_html ? 'html' : 'text',
        content: params.body_html || params.body_text || '',
      },
    };

    if (params.to) message.toRecipients = params.to.map(toGraphRecipient);
    if (params.cc) message.ccRecipients = params.cc.map(toGraphRecipient);
    if (params.bcc) message.bccRecipients = params.bcc.map(toGraphRecipient);

    let url = `${GRAPH_BASE}/me/messages`;
    if (params.reply_to_message_id) {
      url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(params.reply_to_message_id)}/createReply`;
    }

    const draft = await graphFetch<GraphMessage>(access_token, url, {
      method: 'POST',
      body: JSON.stringify(message),
    });

    return mapMessage(draft);
  },

  async updateDraft(access_token: string, draftId: string, params: EmailDraftParams): Promise<EmailMessage> {
    const updates: Record<string, unknown> = {};

    if (params.subject !== undefined) updates.subject = params.subject;
    if (params.body_html || params.body_text) {
      updates.body = {
        content_type: params.body_html ? 'html' : 'text',
        content: params.body_html || params.body_text,
      };
    }
    if (params.to) updates.toRecipients = params.to.map(toGraphRecipient);
    if (params.cc) updates.ccRecipients = params.cc.map(toGraphRecipient);
    if (params.bcc) updates.bccRecipients = params.bcc.map(toGraphRecipient);

    const updated = await graphFetch<GraphMessage>(
      access_token,
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(draftId)}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );

    return mapMessage(updated);
  },

  async updateMessage(access_token: string, message_id: string, params: EmailUpdateParams): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (params.is_read !== undefined) {
      updates.is_read = params.is_read;
    }

    if (params.is_starred !== undefined) {
      updates.flag = { flagStatus: params.is_starred ? 'flagged' : 'notFlagged' };
    }

    if (params.add_labels || params.remove_labels) {
      // Microsoft uses categories, not labels. Map label operations to category changes.
      // Fetch current categories first
      const current = await graphFetch<GraphMessage>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}?$select=categories`,
      );
      const categories = new Set(current.categories || []);
      if (params.add_labels) params.add_labels.forEach((l) => categories.add(l));
      if (params.remove_labels) params.remove_labels.forEach((l) => categories.delete(l));
      updates.categories = [...categories];
    }

    if (Object.keys(updates).length > 0) {
      await graphFetch<undefined>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}`,
        { method: 'PATCH', body: JSON.stringify(updates) },
      );
    }

    // Move to folder if requested
    if (params.move_to) {
      await graphFetch<GraphMessage>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}/move`,
        { method: 'POST', body: JSON.stringify({ destinationId: params.move_to }) },
      );
    }
  },

  async deleteMessage(access_token: string, message_id: string, permanent?: boolean): Promise<void> {
    if (permanent) {
      await graphFetch<undefined>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}`,
        { method: 'DELETE' },
      );
    } else {
      // Move to Deleted Items
      await graphFetch<GraphMessage>(
        access_token,
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}/move`,
        { method: 'POST', body: JSON.stringify({ destinationId: 'DeletedItems' }) },
      );
    }
  },

  async getAttachment(access_token: string, message_id: string, attachmentId: string): Promise<EmailAttachmentContent> {
    const att = await graphFetch<GraphAttachment>(
      access_token,
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    return {
      id: att.id,
      name: att.name,
      content_type: att.content_type,
      size: att.size,
      content_base64: att.contentBytes || '',
    };
  },
};
