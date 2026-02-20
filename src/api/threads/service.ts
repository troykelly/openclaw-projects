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
async function fetchThreadInfo(pool: Pool, thread_id: string): Promise<ThreadInfo | null> {
  const result = await pool.query(
    `SELECT
       et.id::text as id,
       et.channel::text as channel,
       et.external_thread_key as "external_thread_key",
       et.created_at as "created_at",
       et.updated_at as "updated_at",
       c.id::text as "contact_id",
       c.display_name as "display_name",
       c.notes
     FROM external_thread et
     JOIN contact_endpoint ce ON ce.id = et.endpoint_id
     JOIN contact c ON c.id = ce.contact_id
     WHERE et.id = $1`,
    [thread_id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0] as {
    id: string;
    channel: string;
    external_thread_key: string;
    created_at: string;
    updated_at: string;
    contact_id: string;
    display_name: string;
    notes: string | null;
  };

  return {
    id: row.id,
    channel: row.channel,
    external_thread_key: row.external_thread_key,
    contact: {
      id: row.contact_id,
      display_name: row.display_name,
      notes: row.notes || undefined,
    },
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Fetch messages for a thread with pagination.
 */
async function fetchMessages(pool: Pool, thread_id: string, options: ThreadHistoryOptions): Promise<{ messages: ThreadMessage[]; has_more: boolean }> {
  const limit = Math.min(options.limit || DEFAULT_LIMIT, MAX_LIMIT);
  const params: (string | number | Date)[] = [thread_id, limit + 1];
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
       em.from_address as "from_address",
       em.received_at as "received_at",
       em.created_at as "created_at"
     FROM external_message em
     WHERE ${whereClause}
     ORDER BY em.received_at DESC
     LIMIT $2`,
    params,
  );

  const has_more = result.rows.length > limit;
  const messages = result.rows.slice(0, limit).map((row) => {
    const r = row as {
      id: string;
      direction: string;
      body: string | null;
      subject: string | null;
      from_address: string | null;
      received_at: string;
      created_at: string;
    };
    return {
      id: r.id,
      direction: r.direction as 'inbound' | 'outbound',
      body: r.body,
      subject: r.subject || undefined,
      from_address: r.from_address || undefined,
      received_at: new Date(r.received_at),
      created_at: new Date(r.created_at),
    };
  });

  // Reverse to get chronological order (oldest first)
  messages.reverse();

  return { messages, has_more: has_more };
}

/**
 * Fetch work items related to a thread.
 */
async function fetchRelatedWorkItems(pool: Pool, thread_id: string): Promise<RelatedWorkItem[]> {
  const result = await pool.query(
    `SELECT
       wi.id::text as id,
       wi.title,
       wi.status,
       wi.work_item_kind::text as "work_item_kind",
       wi.not_before as "not_before",
       wi.not_after as "not_after"
     FROM work_item wi
     JOIN work_item_communication wic ON wic.work_item_id = wi.id
     WHERE wic.thread_id = $1
     ORDER BY wi.updated_at DESC
     LIMIT 20`,
    [thread_id],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      title: string;
      status: string;
      work_item_kind: string;
      not_before: string | null;
      not_after: string | null;
    };
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      work_item_kind: r.work_item_kind,
      not_before: r.not_before ? new Date(r.not_before) : undefined,
      not_after: r.not_after ? new Date(r.not_after) : undefined,
    };
  });
}

/**
 * Fetch memories related to the contact.
 */
async function fetchContactMemories(pool: Pool, contact_id: string): Promise<ContactMemory[]> {
  const result = await pool.query(
    `SELECT
       m.id::text as id,
       m.memory_type as "memory_type",
       m.title,
       m.content,
       m.importance
     FROM memory m
     WHERE m.contact_id = $1
       AND (m.expires_at IS NULL OR m.expires_at > NOW())
       AND m.superseded_by IS NULL
     ORDER BY m.importance DESC, m.created_at DESC
     LIMIT 10`,
    [contact_id],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      memory_type: string;
      title: string;
      content: string;
      importance: number;
    };
    return {
      id: r.id,
      memory_type: r.memory_type,
      title: r.title,
      content: r.content,
      importance: r.importance,
    };
  });
}

/**
 * Get thread history with messages, related work items, and contact memories.
 */
export async function getThreadHistory(pool: Pool, thread_id: string, options: ThreadHistoryOptions = {}): Promise<ThreadHistoryResponse | null> {
  // Fetch thread info first
  const thread = await fetchThreadInfo(pool, thread_id);

  if (!thread) {
    return null;
  }

  // Fetch messages
  const { messages, has_more: has_more } = await fetchMessages(pool, thread_id, options);

  // Fetch related work items (default: include)
  const relatedWorkItems = options.includeWorkItems !== false ? await fetchRelatedWorkItems(pool, thread_id) : [];

  // Fetch contact memories (default: include)
  const contactMemories = options.includeMemories !== false ? await fetchContactMemories(pool, thread.contact.id) : [];

  // Build pagination info
  const pagination: ThreadHistoryResponse['pagination'] = {
    has_more: has_more,
  };

  if (messages.length > 0) {
    pagination.oldest_timestamp = messages[0].received_at.toISOString();
    pagination.newest_timestamp = messages[messages.length - 1].received_at.toISOString();
  }

  return {
    thread,
    messages,
    related_work_items: relatedWorkItems,
    contact_memories: contactMemories,
    pagination,
  };
}

/**
 * Check if a thread exists.
 */
export async function threadExists(pool: Pool, thread_id: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM external_thread WHERE id = $1`, [thread_id]);
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
  if (options.contact_id) {
    whereClauses.push(`ce.contact_id = $${paramIndex}`);
    params.push(options.contact_id);
    paramIndex++;
  }

  if (options.queryNamespaces && options.queryNamespaces.length > 0) {
    whereClauses.push(`et.namespace = ANY($${paramIndex}::text[])`);
    params.push(options.queryNamespaces as unknown as string);
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
  params.push(limit + 1); // Fetch one extra to determine has_more
  const limitParam = paramIndex;
  paramIndex++;

  params.push(offset);
  const offsetParam = paramIndex;

  const result = await pool.query(
    `SELECT
       et.id::text as id,
       et.channel::text as channel,
       et.external_thread_key as "external_thread_key",
       et.created_at as "created_at",
       et.updated_at as "updated_at",
       c.id::text as "contact_id",
       c.display_name as "display_name",
       c.notes,
       (SELECT COUNT(*)::int FROM external_message WHERE thread_id = et.id) as "message_count",
       lm.id::text as "last_message_id",
       lm.direction::text as "last_message_direction",
       lm.body as "last_message_body",
       lm.subject as "last_message_subject",
       lm.received_at as "last_message_received_at"
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

  const has_more = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);

  const threads: ThreadListItem[] = rows.map((row) => {
    const r = row as {
      id: string;
      channel: string;
      external_thread_key: string;
      created_at: string;
      updated_at: string;
      contact_id: string;
      display_name: string;
      notes: string | null;
      message_count: number;
      last_message_id: string | null;
      last_message_direction: string | null;
      last_message_body: string | null;
      last_message_subject: string | null;
      last_message_received_at: string | null;
    };

    const thread: ThreadListItem = {
      id: r.id,
      channel: r.channel,
      external_thread_key: r.external_thread_key,
      contact: {
        id: r.contact_id,
        display_name: r.display_name,
        notes: r.notes || undefined,
      },
      created_at: new Date(r.created_at),
      updated_at: new Date(r.updated_at),
      message_count: r.message_count,
    };

    if (r.last_message_id) {
      thread.last_message = {
        id: r.last_message_id,
        direction: r.last_message_direction as 'inbound' | 'outbound',
        body: r.last_message_body,
        subject: r.last_message_subject || undefined,
        received_at: new Date(r.last_message_received_at!),
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
      has_more: has_more,
    },
  };
}
