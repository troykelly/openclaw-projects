/**
 * Thread history service.
 * Part of Epic #199, Issue #226
 */

import type { Pool } from 'pg';
import type { ThreadInfo, ThreadMessage, RelatedWorkItem, ContactMemory, ThreadHistoryResponse, ThreadHistoryOptions } from './types.ts';

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
