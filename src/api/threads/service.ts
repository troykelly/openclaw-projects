/**
 * Thread history service.
 * Part of Epic #199, Issue #226
 */

import type { Pool } from 'pg';
import type {
  ThreadInfo,
  ThreadMessage,
  RelatedWorkItem,
  ContactMemory,
  ThreadHistoryResponse,
  ThreadHistoryOptions,
  ThreadListOptions,
  ThreadListResponse,
  ThreadListItem,
} from './types.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Fetch thread information by ID.
 */
async function fetchThreadInfo(pool: Pool, threadId: string): Promise<ThreadInfo | null> {
  const result = await pool.query(
    `SELECT
       et.id::text as id,
       et.channel::text as channel,
       et.external_thread_key as "externalThreadKey",
       et.created_at as "createdAt",
       et.updated_at as "updatedAt",
       c.id::text as "contactId",
       c.display_name as "displayName",
       c.notes
     FROM external_thread et
     JOIN contact_endpoint ce ON ce.id = et.endpoint_id
     JOIN contact c ON c.id = ce.contact_id
     WHERE et.id = $1`,
    [threadId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0] as {
    id: string;
    channel: string;
    externalThreadKey: string;
    createdAt: string;
    updatedAt: string;
    contactId: string;
    displayName: string;
    notes: string | null;
  };

  return {
    id: row.id,
    channel: row.channel,
    externalThreadKey: row.externalThreadKey,
    contact: {
      id: row.contactId,
      displayName: row.displayName,
      notes: row.notes || undefined,
    },
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/**
 * Fetch messages for a thread with pagination.
 */
async function fetchMessages(pool: Pool, threadId: string, options: ThreadHistoryOptions): Promise<{ messages: ThreadMessage[]; hasMore: boolean }> {
  const limit = Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const params: (string | number | Date)[] = [threadId, limit + 1];
  const conditions: string[] = ['em.thread_id = $1'];
  let paramIndex = 3;

  if (options.before) {
    conditions.push(`em.received_at < $${paramIndex}`);
    params.push(options.before);
    paramIndex++;
  }

  if (options.after) {
    conditions.push(`em.received_at > $${paramIndex}`);
    params.push(options.after);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
       em.id::text as id,
       em.direction::text as direction,
       em.body,
       em.subject,
       em.from_address as "fromAddress",
       em.received_at as "receivedAt",
       em.created_at as "createdAt"
     FROM external_message em
     WHERE ${whereClause}
     ORDER BY em.received_at DESC
     LIMIT $2`,
    params,
  );

  const hasMore = result.rows.length > limit;
  const messages = result.rows.slice(0, limit).map((row) => {
    const r = row as {
      id: string;
      direction: string;
      body: string | null;
      subject: string | null;
      fromAddress: string | null;
      receivedAt: string;
      createdAt: string;
    };
    return {
      id: r.id,
      direction: r.direction as 'inbound' | 'outbound',
      body: r.body,
      subject: r.subject || undefined,
      fromAddress: r.fromAddress || undefined,
      receivedAt: new Date(r.receivedAt),
      createdAt: new Date(r.createdAt),
    };
  });

  // Reverse to get chronological order (oldest first)
  messages.reverse();

  return { messages, hasMore };
}

/**
 * Fetch work items related to a thread.
 */
async function fetchRelatedWorkItems(pool: Pool, threadId: string): Promise<RelatedWorkItem[]> {
  const result = await pool.query(
    `SELECT
       wi.id::text as id,
       wi.title,
       wi.status,
       wi.work_item_kind::text as "workItemKind",
       wi.not_before as "notBefore",
       wi.not_after as "notAfter"
     FROM work_item wi
     JOIN work_item_communication wic ON wic.work_item_id = wi.id
     WHERE wic.thread_id = $1
     ORDER BY wi.updated_at DESC
     LIMIT 20`,
    [threadId],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      title: string;
      status: string;
      workItemKind: string;
      notBefore: string | null;
      notAfter: string | null;
    };
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      workItemKind: r.workItemKind,
      notBefore: r.notBefore ? new Date(r.notBefore) : undefined,
      notAfter: r.notAfter ? new Date(r.notAfter) : undefined,
    };
  });
}

/**
 * Fetch memories related to the contact.
 */
async function fetchContactMemories(pool: Pool, contactId: string): Promise<ContactMemory[]> {
  const result = await pool.query(
    `SELECT
       m.id::text as id,
       m.memory_type as "memoryType",
       m.title,
       m.content,
       m.importance
     FROM memory m
     WHERE m.contact_id = $1
       AND (m.expires_at IS NULL OR m.expires_at > NOW())
       AND m.superseded_by IS NULL
     ORDER BY m.importance DESC, m.created_at DESC
     LIMIT 10`,
    [contactId],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      memoryType: string;
      title: string;
      content: string;
      importance: number;
    };
    return {
      id: r.id,
      memoryType: r.memoryType,
      title: r.title,
      content: r.content,
      importance: r.importance,
    };
  });
}

/**
 * Get thread history with messages, related work items, and contact memories.
 */
export async function getThreadHistory(pool: Pool, threadId: string, options: ThreadHistoryOptions = {}): Promise<ThreadHistoryResponse | null> {
  // Fetch thread info first
  const thread = await fetchThreadInfo(pool, threadId);

  if (!thread) {
    return null;
  }

  // Fetch messages
  const { messages, hasMore } = await fetchMessages(pool, threadId, options);

  // Fetch related work items (default: include)
  const relatedWorkItems = options.includeWorkItems !== false ? await fetchRelatedWorkItems(pool, threadId) : [];

  // Fetch contact memories (default: include)
  const contactMemories = options.includeMemories !== false ? await fetchContactMemories(pool, thread.contact.id) : [];

  // Build pagination info
  const pagination: ThreadHistoryResponse['pagination'] = {
    hasMore,
  };

  if (messages.length > 0) {
    pagination.oldestTimestamp = messages[0].receivedAt.toISOString();
    pagination.newestTimestamp = messages[messages.length - 1].receivedAt.toISOString();
  }

  return {
    thread,
    messages,
    relatedWorkItems,
    contactMemories,
    pagination,
  };
}

/**
 * Check if a thread exists.
 */
export async function threadExists(pool: Pool, threadId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM external_thread WHERE id = $1`, [threadId]);
  return result.rows.length > 0;
}

/**
 * List threads with pagination and filtering.
 */
export async function listThreads(pool: Pool, options: ThreadListOptions = {}): Promise<ThreadListResponse> {
  const limit = options.limit || 20;
  const offset = options.offset || 0;
  const params: (string | number)[] = [];
  const whereClauses: string[] = [];

  let paramIndex = 1;

  // Filter by channel
  if (options.channel) {
    whereClauses.push(`et.channel = $${paramIndex}`);
    params.push(options.channel);
    paramIndex++;
  }

  // Filter by contact_id
  if (options.contactId) {
    whereClauses.push(`ce.contact_id = $${paramIndex}`);
    params.push(options.contactId);
    paramIndex++;
  }

  // Issue #1172: optional user_email scoping
  if (options.userEmail) {
    whereClauses.push(`et.user_email = $${paramIndex}`);
    params.push(options.userEmail);
    paramIndex++;
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT et.id)::int as count
     FROM external_thread et
     JOIN contact_endpoint ce ON ce.id = et.endpoint_id
     ${whereClause}`,
    params,
  );
  const total = countResult.rows[0].count as number;

  // Get threads with last message
  params.push(limit + 1); // Fetch one extra to determine hasMore
  const limitParam = paramIndex;
  paramIndex++;

  params.push(offset);
  const offsetParam = paramIndex;

  const result = await pool.query(
    `SELECT
       et.id::text as id,
       et.channel::text as channel,
       et.external_thread_key as "externalThreadKey",
       et.created_at as "createdAt",
       et.updated_at as "updatedAt",
       c.id::text as "contactId",
       c.display_name as "displayName",
       c.notes,
       (SELECT COUNT(*)::int FROM external_message WHERE thread_id = et.id) as "messageCount",
       lm.id::text as "lastMessageId",
       lm.direction::text as "lastMessageDirection",
       lm.body as "lastMessageBody",
       lm.subject as "lastMessageSubject",
       lm.received_at as "lastMessageReceivedAt"
     FROM external_thread et
     JOIN contact_endpoint ce ON ce.id = et.endpoint_id
     JOIN contact c ON c.id = ce.contact_id
     LEFT JOIN LATERAL (
       SELECT id, direction, body, subject, received_at
       FROM external_message
       WHERE thread_id = et.id
       ORDER BY received_at DESC
       LIMIT 1
     ) lm ON true
     ${whereClause}
     ORDER BY COALESCE(lm.received_at, et.updated_at) DESC
     LIMIT $${limitParam}
     OFFSET $${offsetParam}`,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);

  const threads: ThreadListItem[] = rows.map((row) => {
    const r = row as {
      id: string;
      channel: string;
      externalThreadKey: string;
      createdAt: string;
      updatedAt: string;
      contactId: string;
      displayName: string;
      notes: string | null;
      messageCount: number;
      lastMessageId: string | null;
      lastMessageDirection: string | null;
      lastMessageBody: string | null;
      lastMessageSubject: string | null;
      lastMessageReceivedAt: string | null;
    };

    const thread: ThreadListItem = {
      id: r.id,
      channel: r.channel,
      externalThreadKey: r.externalThreadKey,
      contact: {
        id: r.contactId,
        displayName: r.displayName,
        notes: r.notes || undefined,
      },
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
      messageCount: r.messageCount,
    };

    if (r.lastMessageId) {
      thread.lastMessage = {
        id: r.lastMessageId,
        direction: r.lastMessageDirection as 'inbound' | 'outbound',
        body: r.lastMessageBody,
        subject: r.lastMessageSubject || undefined,
        receivedAt: new Date(r.lastMessageReceivedAt!),
      };
    }

    return thread;
  });

  return {
    threads,
    total,
    pagination: {
      limit,
      offset,
      hasMore,
    },
  };
}
