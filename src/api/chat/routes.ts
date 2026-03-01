/**
 * Chat session and message REST API routes.
 *
 * Registers all /api/chat/* endpoints:
 * - Session CRUD (Issue #1942)
 * - Message send and retrieve (Issue #1943)
 *
 * Epic #1940 — Agent Chat.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

import { getAuthIdentity } from '../auth/middleware.ts';
import { isAuthDisabled } from '../auth/jwt.ts';
import { isValidUUID } from '../utils/validation.ts';
import { enqueueWebhook } from '../webhooks/dispatcher.ts';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_MESSAGE_BYTES = 65536; // 64KB
const STREAM_SECRET_BYTES = 32;

const VALID_SESSION_STATUSES = ['active', 'ended', 'expired'] as const;
const VALID_CONTENT_TYPES = ['text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'] as const;

// ── Plugin options ───────────────────────────────────────────────

export interface ChatRoutesOptions {
  pool: Pool;
}

// ── Helpers ──────────────────────────────────────────────────────

function getEffectiveNamespaces(req: FastifyRequest): string[] {
  const ns = req.namespaceContext?.queryNamespaces;
  if (ns && ns.length > 0) return ns;
  if (isAuthDisabled()) return ['default'];
  return [];
}

function getStoreNamespace(req: FastifyRequest): string {
  return req.namespaceContext?.storeNamespace ?? 'default';
}

/** Resolve the authenticated user email. Returns null if unauthenticated. */
async function getUserEmail(req: FastifyRequest): Promise<string | null> {
  if (isAuthDisabled()) {
    // In auth-disabled mode, check header or query
    const headerEmail = req.headers['x-user-email'];
    if (typeof headerEmail === 'string' && headerEmail.trim().length > 0) {
      return headerEmail.trim();
    }
    const q = req.query as Record<string, unknown> | undefined;
    if (q && typeof q.user_email === 'string' && q.user_email.trim().length > 0) {
      return q.user_email.trim();
    }
    return null;
  }

  const identity = await getAuthIdentity(req);
  if (!identity) return null;
  return identity.email;
}

/** Generate a cryptographic stream secret (32 bytes as hex = 64 chars). */
function generateStreamSecret(): string {
  return randomBytes(STREAM_SECRET_BYTES).toString('hex');
}

/** Parse pagination parameters with safe defaults. */
function parseCursorPagination(query: {
  limit?: string;
  cursor?: string;
}): { limit: number; cursor: string | null } {
  const rawLimit = Number.parseInt(query.limit ?? '', 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    cursor: query.cursor ?? null,
  };
}

/** Verify the caller can access a chat_session by ID and user_email + namespace. */
async function verifySessionAccess(
  pool: Pool,
  sessionId: string,
  userEmail: string,
  namespaces: string[],
): Promise<Record<string, unknown> | null> {
  if (namespaces.length === 0) return null;
  const result = await pool.query(
    `SELECT * FROM chat_session
     WHERE id = $1
       AND user_email = $2
       AND namespace = ANY($3::text[])`,
    [sessionId, userEmail, namespaces],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0] as Record<string, unknown>;
}

// ── Route Plugin ─────────────────────────────────────────────────

/**
 * Fastify plugin that registers all chat session and message API routes.
 */
export async function chatRoutesPlugin(
  app: FastifyInstance,
  opts: ChatRoutesOptions,
): Promise<void> {
  const { pool } = opts;

  // ================================================================
  // Issue #1942 — Chat Session CRUD API
  // ================================================================

  // POST /api/chat/sessions — Create a new chat session
  app.post('/api/chat/sessions', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const namespace = getStoreNamespace(req);
    const body = req.body as Record<string, unknown> | null | undefined;
    const agentId = (body?.agent_id as string | undefined)?.trim();
    const title = (body?.title as string | undefined)?.trim() || null;

    if (!agentId || agentId.length === 0) {
      return reply.code(400).send({ error: 'agent_id is required' });
    }

    if (title !== null && title.length > 200) {
      return reply.code(400).send({ error: 'title must not exceed 200 characters' });
    }

    // Ensure user_setting exists
    await pool.query(
      `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [userEmail],
    );

    const streamSecret = generateStreamSecret();

    // Create contact + endpoint + thread for the chat session
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create a system contact for this chat agent (reuse if exists)
      const contactResult = await client.query(
        `INSERT INTO contact (display_name, namespace)
         VALUES ($1, $2)
         RETURNING id`,
        [`Agent: ${agentId}`, namespace],
      );
      const contactId = (contactResult.rows[0] as { id: string }).id;

      // Create an endpoint for the agent_chat channel
      const endpointResult = await client.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'agent_chat', $2)
         RETURNING id`,
        [contactId, `agent:${agentId}:${userEmail}`],
      );
      const endpointId = (endpointResult.rows[0] as { id: string }).id;

      // Create the external_thread
      const threadKey = `chat:${agentId}:${userEmail}:${Date.now()}`;
      const threadResult = await client.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, metadata)
         VALUES ($1, 'agent_chat', $2, $3::jsonb)
         RETURNING id`,
        [endpointId, threadKey, JSON.stringify({ agent_id: agentId, user_email: userEmail })],
      );
      const threadId = (threadResult.rows[0] as { id: string }).id;

      // Create the chat_session
      const sessionResult = await client.query(
        `INSERT INTO chat_session (thread_id, user_email, agent_id, namespace, stream_secret, title)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [threadId, userEmail, agentId, namespace, streamSecret, title],
      );
      const session = sessionResult.rows[0] as Record<string, unknown>;

      await client.query('COMMIT');

      return reply.code(201).send({
        id: session.id,
        thread_id: session.thread_id,
        user_email: session.user_email,
        agent_id: session.agent_id,
        namespace: session.namespace,
        status: session.status,
        title: session.title,
        version: session.version,
        started_at: session.started_at,
        ended_at: session.ended_at,
        last_activity_at: session.last_activity_at,
        metadata: session.metadata,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/chat/sessions — List sessions (cursor-paginated)
  app.get('/api/chat/sessions', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.send({ sessions: [], next_cursor: null });
    }

    const query = req.query as {
      limit?: string;
      cursor?: string;
      status?: string;
    };
    const { limit, cursor } = parseCursorPagination(query);

    const statusFilter = query.status;
    if (statusFilter && !(VALID_SESSION_STATUSES as readonly string[]).includes(statusFilter)) {
      return reply.code(400).send({ error: `Invalid status filter. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}` });
    }

    const params: unknown[] = [userEmail, namespaces, limit + 1];
    let where = `user_email = $1 AND namespace = ANY($2::text[])`;

    if (statusFilter) {
      params.push(statusFilter);
      where += ` AND status = $${params.length}::chat_session_status`;
    }

    if (cursor) {
      // Cursor is the last_activity_at timestamp of the last item
      params.push(cursor);
      where += ` AND last_activity_at < $${params.length}::timestamptz`;
    }

    const result = await pool.query(
      `SELECT id, thread_id, user_email, agent_id, namespace, status, title, version,
              started_at, ended_at, last_activity_at, metadata
       FROM chat_session
       WHERE ${where}
       ORDER BY last_activity_at DESC
       LIMIT $3`,
      params,
    );

    const rows = result.rows as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const sessions = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? (sessions[sessions.length - 1] as { last_activity_at: string }).last_activity_at
      : null;

    return reply.send({ sessions, next_cursor: nextCursor });
  });

  // GET /api/chat/sessions/:id — Get session details
  app.get('/api/chat/sessions/:id', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const namespaces = getEffectiveNamespaces(req);
    const session = await verifySessionAccess(pool, params.id, userEmail, namespaces);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    return reply.send({
      id: session.id,
      thread_id: session.thread_id,
      user_email: session.user_email,
      agent_id: session.agent_id,
      namespace: session.namespace,
      status: session.status,
      title: session.title,
      version: session.version,
      started_at: session.started_at,
      ended_at: session.ended_at,
      last_activity_at: session.last_activity_at,
      metadata: session.metadata,
    });
  });

  // PATCH /api/chat/sessions/:id — Update session title (optimistic locking)
  app.patch('/api/chat/sessions/:id', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const body = req.body as Record<string, unknown> | null | undefined;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const title = body.title as string | null | undefined;
    const version = body.version as number | undefined;

    if (title !== undefined && title !== null) {
      const trimmed = (title as string).trim();
      if (trimmed.length === 0) {
        return reply.code(400).send({ error: 'title must not be empty' });
      }
      if (trimmed.length > 200) {
        return reply.code(400).send({ error: 'title must not exceed 200 characters' });
      }
    }

    if (version === undefined || typeof version !== 'number') {
      return reply.code(400).send({ error: 'version is required for optimistic locking' });
    }

    const namespaces = getEffectiveNamespaces(req);
    const session = await verifySessionAccess(pool, params.id, userEmail, namespaces);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const result = await pool.query(
      `UPDATE chat_session
       SET title = $1,
           version = version + 1,
           last_activity_at = now()
       WHERE id = $2 AND version = $3
       RETURNING id, thread_id, user_email, agent_id, namespace, status, title, version,
                 started_at, ended_at, last_activity_at, metadata`,
      [title === undefined ? session.title : (title === null ? null : (title as string).trim()), params.id, version],
    );

    if (result.rows.length === 0) {
      return reply.code(409).send({ error: 'Version conflict. Session was modified by another request.' });
    }

    return reply.send(result.rows[0]);
  });

  // POST /api/chat/sessions/:id/end — End a session
  app.post('/api/chat/sessions/:id/end', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    // Use SELECT FOR UPDATE for race safety
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lockResult = await client.query(
        `SELECT id, status FROM chat_session
         WHERE id = $1
           AND user_email = $2
           AND namespace = ANY($3::text[])
         FOR UPDATE`,
        [params.id, userEmail, namespaces],
      );

      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Session not found' });
      }

      const current = lockResult.rows[0] as { id: string; status: string };
      if (current.status !== 'active') {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: `Session is already ${current.status}` });
      }

      const result = await client.query(
        `UPDATE chat_session
         SET status = 'ended',
             last_activity_at = now(),
             version = version + 1
         WHERE id = $1
         RETURNING id, thread_id, user_email, agent_id, namespace, status, title, version,
                   started_at, ended_at, last_activity_at, metadata`,
        [params.id],
      );

      await client.query('COMMIT');

      return reply.send(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // ================================================================
  // Issue #1943 — Chat Message Send and Retrieve API
  // ================================================================

  // POST /api/chat/sessions/:id/messages — Send a message
  app.post('/api/chat/sessions/:id/messages', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const body = req.body as Record<string, unknown> | null | undefined;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const content = body.content as string | undefined;
    const idempotencyKey = body.idempotency_key as string | undefined;
    const contentType = (body.content_type as string | undefined) ?? 'text/plain';

    if (!content || content.length === 0) {
      return reply.code(400).send({ error: 'content is required' });
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_MESSAGE_BYTES) {
      return reply.code(400).send({ error: 'content exceeds maximum size of 64KB' });
    }

    if (!(VALID_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      return reply.code(400).send({
        error: `Invalid content_type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`,
      });
    }

    if (idempotencyKey && !isValidUUID(idempotencyKey)) {
      return reply.code(400).send({ error: 'idempotency_key must be a valid UUID' });
    }

    const namespaces = getEffectiveNamespaces(req);
    const session = await verifySessionAccess(pool, params.id, userEmail, namespaces);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    if (session.status !== 'active') {
      return reply.code(409).send({ error: `Cannot send messages to ${session.status} session` });
    }

    const messageKey = `user:${userEmail}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert message (idempotent via ON CONFLICT for idempotency_key)
      let messageResult;
      if (idempotencyKey) {
        // Check for existing message with this idempotency key
        const existing = await client.query(
          `SELECT * FROM external_message
           WHERE thread_id = $1 AND idempotency_key = $2`,
          [session.thread_id, idempotencyKey],
        );

        if (existing.rows.length > 0) {
          await client.query('ROLLBACK');
          return reply.code(200).send(existing.rows[0]);
        }
      }

      messageResult = await client.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, status, idempotency_key, content_type)
         VALUES ($1, $2, 'outbound', $3, 'delivered', $4, $5)
         RETURNING *`,
        [session.thread_id, messageKey, content, idempotencyKey ?? null, contentType],
      );

      const message = messageResult.rows[0] as Record<string, unknown>;

      // Update session last_activity_at
      await client.query(
        `UPDATE chat_session SET last_activity_at = now() WHERE id = $1`,
        [params.id],
      );

      await client.query('COMMIT');

      // Dispatch webhook to OpenClaw gateway (fire-and-forget, outside transaction)
      const webhookDestination = process.env.OPENCLAW_GATEWAY_URL || process.env.WEBHOOK_DESTINATION_URL;
      if (webhookDestination) {
        const sessionKey = `agent:${session.agent_id}:agent_chat:${session.thread_id}`;
        await enqueueWebhook(pool, 'chat_message_received', webhookDestination, {
          kind: 'chat_message_received',
          session_key: sessionKey,
          payload: {
            session_id: session.id,
            message_id: message.id,
            content,
            content_type: contentType,
            user_email: userEmail,
            streaming_callback_url: `/api/chat/sessions/${session.id}/stream`,
            stream_secret: session.stream_secret,
          },
        }).catch((err: unknown) => {
          console.error('[Chat] Failed to enqueue webhook:', err instanceof Error ? err.message : err);
        });
      }

      return reply.code(201).send(message);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /api/chat/sessions/:id/messages — List messages (cursor-paginated)
  app.get('/api/chat/sessions/:id/messages', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    const namespaces = getEffectiveNamespaces(req);
    const session = await verifySessionAccess(pool, params.id, userEmail, namespaces);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const query = req.query as {
      limit?: string;
      cursor?: string;
    };
    const { limit, cursor } = parseCursorPagination(query);

    const sqlParams: unknown[] = [session.thread_id, limit + 1];
    let where = `thread_id = $1`;

    if (cursor) {
      // Cursor is a base64-encoded JSON object with received_at and id
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
          received_at: string;
          id: string;
        };
        if (decoded.received_at && decoded.id && isValidUUID(decoded.id)) {
          sqlParams.push(decoded.received_at, decoded.id);
          where += ` AND (received_at, id) < ($${sqlParams.length - 1}::timestamptz, $${sqlParams.length}::uuid)`;
        }
      } catch {
        // Invalid cursor — ignore and return from beginning
      }
    }

    const result = await pool.query(
      `SELECT id, thread_id, external_message_key, direction, body, status,
              idempotency_key, agent_run_id, content_type, received_at, created_at, updated_at
       FROM external_message
       WHERE ${where}
       ORDER BY received_at DESC, id DESC
       LIMIT $2`,
      sqlParams,
    );

    const rows = result.rows as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    const lastMsg = messages[messages.length - 1] as Record<string, unknown> | undefined;
    const nextCursor = hasMore && lastMsg
      ? Buffer.from(JSON.stringify({
          received_at: lastMsg.received_at,
          id: lastMsg.id,
        })).toString('base64url')
      : null;

    return reply.send({ messages, next_cursor: nextCursor });
  });
}
