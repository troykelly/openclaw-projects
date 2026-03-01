/**
 * Chat session and message REST API routes.
 *
 * Registers all /api/chat/* endpoints:
 * - Session CRUD (Issue #1942)
 * - Message send and retrieve (Issue #1943)
 * - WebSocket ticket + streaming (Issue #1944, #1945)
 *
 * Epic #1940 — Agent Chat.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { WebSocket } from 'ws';

import { getAuthIdentity } from '../auth/middleware.ts';
import { isAuthDisabled } from '../auth/jwt.ts';
import { isValidUUID } from '../utils/validation.ts';
import { enqueueWebhook } from '../webhooks/dispatcher.ts';
import {
  createTicket,
  consumeTicket,
  addConnection,
  removeConnection,
  cleanExpiredTickets,
} from './ws-ticket-store.ts';
import {
  getStreamManager,
  type StreamChunkPayload,
  type StreamCompletedPayload,
  type StreamFailedPayload,
} from './stream-manager.ts';
import { getRealtimeHub } from '../realtime/hub.ts';
import type { ChatEventType } from '../realtime/types.ts';
import {
  executeChatSendMessage,
  executeChatAttractAttention,
  type ChatSendMessageParams,
  type ChatAttractAttentionParams,
} from './tools.ts';
import {
  addPushSubscription,
  removePushSubscription,
  validatePushSubscription,
} from './push-subscription.ts';

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

      // Emit chat:session_created event (#1946)
      getRealtimeHub().emit(
        'chat:session_created' as ChatEventType,
        { session_id: session.id as string },
        userEmail,
      ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });

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
      // Validate cursor is a parseable timestamp before using in SQL
      const cursorDate = new Date(cursor);
      if (Number.isNaN(cursorDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid cursor format' });
      }
      params.push(cursorDate.toISOString());
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

    // Include user_email + namespace in WHERE for defense-in-depth (TOCTOU hardening)
    const result = await pool.query(
      `UPDATE chat_session
       SET title = $1,
           version = version + 1,
           last_activity_at = now()
       WHERE id = $2 AND version = $3 AND user_email = $4 AND namespace = ANY($5::text[])
       RETURNING id, thread_id, user_email, agent_id, namespace, status, title, version,
                 started_at, ended_at, last_activity_at, metadata`,
      [title === undefined ? session.title : (title === null ? null : (title as string).trim()), params.id, version, userEmail, namespaces],
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

      // Emit chat:session_ended event (#1946)
      getRealtimeHub().emit(
        'chat:session_ended' as ChatEventType,
        { session_id: params.id },
        userEmail,
      ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });

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

      // Insert message — race-safe idempotency via INSERT ON CONFLICT
      let message: Record<string, unknown>;

      if (idempotencyKey) {
        // Use ON CONFLICT to atomically handle duplicate idempotency keys
        const insertResult = await client.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, status, idempotency_key, content_type)
           VALUES ($1, $2, 'outbound', $3, 'delivered', $4, $5)
           ON CONFLICT (thread_id, idempotency_key) WHERE idempotency_key IS NOT NULL
           DO NOTHING
           RETURNING *`,
          [session.thread_id, messageKey, content, idempotencyKey, contentType],
        );

        if (insertResult.rows.length === 0) {
          // Idempotency key already exists — return the existing message
          const existing = await client.query(
            `SELECT * FROM external_message WHERE thread_id = $1 AND idempotency_key = $2`,
            [session.thread_id, idempotencyKey],
          );
          await client.query('ROLLBACK');
          return reply.code(200).send(existing.rows[0]);
        }

        message = insertResult.rows[0] as Record<string, unknown>;
      } else {
        const insertResult = await client.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, status, content_type)
           VALUES ($1, $2, 'outbound', $3, 'delivered', $4)
           RETURNING *`,
          [session.thread_id, messageKey, content, contentType],
        );
        message = insertResult.rows[0] as Record<string, unknown>;
      }

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

      // Emit chat:message_received event (#1946)
      getRealtimeHub().emit(
        'chat:message_received' as ChatEventType,
        { session_id: session.id as string, message_id: message.id as string },
        userEmail,
      ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });

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

  // ================================================================
  // Issue #1944 — Chat WebSocket with one-time ticket authentication
  // ================================================================

  // Periodic cleanup of expired tickets (every 60s)
  const ticketCleanupInterval = setInterval(cleanExpiredTickets, 60_000);
  app.addHook('onClose', () => clearInterval(ticketCleanupInterval));

  // POST /api/chat/ws/ticket — Generate a one-time WebSocket ticket
  app.post('/api/chat/ws/ticket', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const body = req.body as Record<string, unknown> | null | undefined;
    const sessionId = (body?.session_id as string | undefined)?.trim();

    if (!sessionId || !isValidUUID(sessionId)) {
      return reply.code(400).send({ error: 'session_id is required and must be a valid UUID' });
    }

    const namespaces = getEffectiveNamespaces(req);
    const session = await verifySessionAccess(pool, sessionId, userEmail, namespaces);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    if (session.status !== 'active') {
      return reply.code(409).send({ error: `Cannot connect to ${session.status} session` });
    }

    const ticket = createTicket(userEmail, sessionId);

    return reply.send({ ticket, expires_in: 30 });
  });

  // Per-session WS client tracking for streaming delivery
  const sessionClients = new Map<string, Set<WebSocket>>();

  /**
   * Get the session clients map (for stream manager delivery).
   */
  function getSessionClients(): Map<string, Set<WebSocket>> {
    return sessionClients;
  }

  // GET /api/chat/ws — WebSocket upgrade with ticket authentication
  app.get('/api/chat/ws', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
    const query = req.query as { ticket?: string; session_id?: string };
    const ticket = query.ticket;
    const sessionId = query.session_id;

    if (!ticket || !sessionId) {
      socket.close(4400, 'ticket and session_id query parameters required');
      return;
    }

    if (!isValidUUID(sessionId)) {
      socket.close(4400, 'Invalid session_id format');
      return;
    }

    // Origin validation (CSWSH protection)
    const origin = req.headers.origin;
    const allowedOrigins = process.env.ALLOWED_WS_ORIGINS?.split(',').map(o => o.trim());
    if (allowedOrigins && allowedOrigins.length > 0 && origin) {
      if (!allowedOrigins.includes(origin)) {
        socket.close(4403, 'Origin not allowed');
        return;
      }
    }

    // Consume the one-time ticket
    const ticketData = consumeTicket(ticket);
    if (!ticketData) {
      socket.close(4401, 'Invalid or expired ticket');
      return;
    }

    // Verify session_id matches the ticket
    if (ticketData.sessionId !== sessionId) {
      socket.close(4401, 'Session mismatch');
      return;
    }

    // Check connection limit
    const connectionId = addConnection(ticketData.userEmail);
    if (!connectionId) {
      socket.close(4429, 'Too many connections');
      return;
    }

    // Add to session clients for streaming delivery
    let clients = sessionClients.get(sessionId);
    if (!clients) {
      clients = new Set();
      sessionClients.set(sessionId, clients);
    }
    clients.add(socket);

    // Send connection established
    safeSend(socket, {
      type: 'connection:established',
      connection_id: connectionId,
      session_id: sessionId,
    });

    // Typing indicator rate limiting (2/sec per connection)
    let lastTypingAt = 0;
    const TYPING_RATE_LIMIT_MS = 500; // 2 per second

    // Handle incoming messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        const message = JSON.parse(raw) as Record<string, unknown>;

        switch (message.type) {
          case 'ping':
            safeSend(socket, { type: 'pong' });
            break;

          case 'typing': {
            const now = Date.now();
            if (now - lastTypingAt < TYPING_RATE_LIMIT_MS) {
              break; // Rate limited — drop silently
            }
            lastTypingAt = now;

            // Broadcast typing indicator via RealtimeHub (except to sender)
            const isTyping = message.is_typing === true;
            getRealtimeHub().emit(
              'chat:typing' as ChatEventType,
              {
                session_id: sessionId,
                agent_id: null,
                is_typing: isTyping,
                source_connection_id: connectionId,
              },
              ticketData.userEmail,
            ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });
            break;
          }

          case 'read_cursor': {
            const lastReadMessageId = message.last_read_message_id;
            if (typeof lastReadMessageId !== 'string' || !isValidUUID(lastReadMessageId)) {
              break; // Invalid — drop silently
            }

            // Update read cursor in DB (fire-and-forget)
            pool.query(
              `INSERT INTO chat_read_cursor (user_email, session_id, last_read_message_id, last_read_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (user_email, session_id)
               DO UPDATE SET last_read_message_id = $3, last_read_at = NOW()`,
              [ticketData.userEmail, sessionId, lastReadMessageId],
            ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });

            // Emit read cursor event
            getRealtimeHub().emit(
              'chat:read_cursor_updated' as ChatEventType,
              {
                session_id: sessionId,
                last_read_message_id: lastReadMessageId,
              },
              ticketData.userEmail,
            ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });
            break;
          }

          default:
            // Unknown message type — ignore
            break;
        }
      } catch {
        // Malformed JSON — ignore
      }
    });

    // Heartbeat: 30-second ping
    const heartbeatInterval = setInterval(() => {
      if (socket.readyState === 1) {
        safeSend(socket, { type: 'ping' });
      }
    }, 30_000);

    // Handle disconnect
    socket.on('close', () => {
      clearInterval(heartbeatInterval);
      removeConnection(ticketData.userEmail, connectionId);
      const sessClients = sessionClients.get(sessionId);
      if (sessClients) {
        sessClients.delete(socket);
        if (sessClients.size === 0) {
          sessionClients.delete(sessionId);
        }
      }
    });

    socket.on('error', () => {
      clearInterval(heartbeatInterval);
      removeConnection(ticketData.userEmail, connectionId);
      const sessClients = sessionClients.get(sessionId);
      if (sessClients) {
        sessClients.delete(socket);
        if (sessClients.size === 0) {
          sessionClients.delete(sessionId);
        }
      }
    });
  });

  // ================================================================
  // Issue #1945 — Agent streaming callback endpoint
  // ================================================================

  const streamManager = getStreamManager();

  // POST /api/chat/sessions/:id/stream — Agent streams response tokens
  app.post('/api/chat/sessions/:id/stream', async (req, reply) => {
    const params = req.params as { id: string };
    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    // M2M authentication: agent must provide Bearer token + X-Stream-Secret
    const identity = await getAuthIdentity(req);
    // In auth-disabled mode, allow; otherwise require M2M identity
    if (!isAuthDisabled() && (!identity || identity.type !== 'm2m')) {
      return reply.code(401).send({ error: 'M2M authentication required' });
    }

    const streamSecret = req.headers['x-stream-secret'];
    if (!streamSecret || typeof streamSecret !== 'string') {
      return reply.code(401).send({ error: 'X-Stream-Secret header required' });
    }

    // Look up session by ID (no user_email filter — this is M2M)
    const sessionResult = await pool.query(
      `SELECT id, thread_id, user_email, agent_id, stream_secret, status, namespace
       FROM chat_session WHERE id = $1`,
      [params.id],
    );
    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0] as {
      id: string;
      thread_id: string;
      user_email: string;
      agent_id: string;
      stream_secret: string;
      status: string;
      namespace: string;
    };

    // Validate stream_secret (timing-safe comparison)
    const expected = Buffer.from(session.stream_secret, 'utf8');
    const provided = Buffer.from(streamSecret, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return reply.code(403).send({ error: 'Invalid stream secret' });
    }

    // Validate session status
    if (session.status !== 'active') {
      return reply.code(409).send({ error: `Session is ${session.status}` });
    }

    // Validate agent_id if M2M identity provides it
    const requestAgentId = req.headers['x-agent-id'] as string | undefined;
    if (requestAgentId && requestAgentId !== session.agent_id) {
      return reply.code(403).send({ error: 'Agent ID mismatch' });
    }

    const body = req.body as Record<string, unknown> | null;
    if (!body || !body.type) {
      return reply.code(400).send({ error: 'Request body with type field is required' });
    }

    const messageType = body.type as string;

    switch (messageType) {
      case 'chunk': {
        const content = body.content as string | undefined;
        const seq = body.seq as number | undefined;

        if (typeof content !== 'string') {
          return reply.code(400).send({ error: 'content is required for chunk type' });
        }
        if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
          return reply.code(400).send({ error: 'seq must be a non-negative integer' });
        }
        if (Buffer.byteLength(content, 'utf8') > 4096) {
          return reply.code(400).send({ error: 'Chunk exceeds 4KB limit' });
        }

        const payload: StreamChunkPayload = {
          content,
          seq,
          message_id: body.message_id as string | undefined,
          agent_run_id: body.agent_run_id as string | undefined,
        };

        const result = streamManager.handleChunk(params.id, payload);
        if (!result.ok) {
          return reply.code(result.status).send({ error: result.error });
        }

        // Forward to connected WS clients
        const wsClients = sessionClients.get(params.id);
        if (wsClients) {
          const wsMessage = JSON.stringify({
            type: 'stream:chunk',
            session_id: params.id,
            message_id: result.messageId,
            chunk: content,
            seq,
          });
          for (const ws of wsClients) {
            if (ws.readyState === 1) {
              ws.send(wsMessage);
            }
          }
        }

        return reply.code(200).send({ ok: true, message_id: result.messageId });
      }

      case 'completed': {
        const fullContent = body.content as string | undefined;
        if (typeof fullContent !== 'string') {
          return reply.code(400).send({ error: 'content is required for completed type' });
        }

        if (Buffer.byteLength(fullContent, 'utf8') > 262144) {
          return reply.code(400).send({ error: 'Content exceeds 256KB limit' });
        }

        const payload: StreamCompletedPayload = {
          content: fullContent,
          message_id: body.message_id as string | undefined,
          agent_run_id: body.agent_run_id as string | undefined,
          content_type: (body.content_type as string | undefined) ?? 'text/plain',
        };

        const result = streamManager.handleCompleted(params.id, payload);
        if (!result.ok) {
          return reply.code(result.status).send({ error: result.error });
        }

        // Store final message as external_message
        const messageKey = `agent:${session.agent_id}:${Date.now()}`;
        const insertResult = await pool.query(
          `INSERT INTO external_message
           (thread_id, external_message_key, direction, body, status, agent_run_id, content_type)
           VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5)
           RETURNING id`,
          [session.thread_id, messageKey, fullContent, payload.agent_run_id ?? null, payload.content_type],
        );
        const messageId = (insertResult.rows[0] as { id: string }).id;

        // Update session activity
        await pool.query(
          `UPDATE chat_session SET last_activity_at = NOW() WHERE id = $1`,
          [params.id],
        );

        // Notify WS clients
        const wsClients2 = sessionClients.get(params.id);
        if (wsClients2) {
          const wsMessage = JSON.stringify({
            type: 'stream:completed',
            session_id: params.id,
            message_id: messageId,
            full_content: fullContent,
          });
          for (const ws of wsClients2) {
            if (ws.readyState === 1) {
              ws.send(wsMessage);
            }
          }
        }

        // Emit realtime event
        getRealtimeHub().emit(
          'chat:message_received' as ChatEventType,
          { session_id: params.id, message_id: messageId },
          session.user_email,
        ).catch((err: unknown) => { console.error('[Chat] Fire-and-forget error:', err instanceof Error ? err.message : err); });

        return reply.code(200).send({ ok: true, message_id: messageId });
      }

      case 'failed': {
        const error = (body.error as string | undefined) ?? 'Unknown error';

        const failPayload: StreamFailedPayload = {
          error,
          message_id: body.message_id as string | undefined,
        };

        const result = streamManager.handleFailed(params.id, failPayload);
        if (!result.ok) {
          return reply.code(result.status).send({ error: result.error });
        }

        // If there's a pending message, update its status to failed
        if (result.messageId) {
          await pool.query(
            `UPDATE external_message SET status = 'failed', updated_at = NOW()
             WHERE id = $1`,
            [result.messageId],
          ).catch((err: unknown) => { console.error('[Chat] Failed to update message status:', err instanceof Error ? err.message : err); });
        }

        // Notify WS clients — sanitize error text to avoid leaking internals
        const sanitisedError = typeof error === 'string' && error.length > 0
          ? error.slice(0, 200)
          : 'Agent error';
        const wsClients3 = sessionClients.get(params.id);
        if (wsClients3) {
          const wsMessage = JSON.stringify({
            type: 'stream:failed',
            session_id: params.id,
            message_id: result.messageId,
            error: sanitisedError,
          });
          for (const ws of wsClients3) {
            if (ws.readyState === 1) {
              ws.send(wsMessage);
            }
          }
        }

        return reply.code(200).send({ ok: true });
      }

      default:
        return reply.code(400).send({ error: `Unknown stream type: ${messageType}` });
    }
  });

  // ================================================================
  // Issue #1956 — Push subscription management
  // ================================================================

  // POST /api/push/subscribe — Store browser push subscription
  app.post('/api/push/subscribe', async (req, reply) => {
    const userEmail = await getUserEmail(req);
    if (!userEmail) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const body = req.body as { subscription?: unknown; action?: string; endpoint?: string };
    const action = body.action ?? 'subscribe';

    if (action === 'unsubscribe') {
      if (!body.endpoint || typeof body.endpoint !== 'string') {
        return reply.code(400).send({ error: 'endpoint is required for unsubscribe' });
      }
      await removePushSubscription(pool, userEmail, body.endpoint);
      return reply.code(200).send({ ok: true });
    }

    // Subscribe
    if (!validatePushSubscription(body.subscription)) {
      return reply.code(400).send({ error: 'Invalid push subscription: must include endpoint and keys (p256dh, auth)' });
    }

    const result = await addPushSubscription(pool, userEmail, body.subscription);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }

    return reply.code(200).send({ ok: true });
  });

  // ================================================================
  // Issue #1954 — Agent M2M endpoints
  // ================================================================
  registerAgentEndpoints(app, pool);
}

// ── M2M Agent Endpoints (Issue #1954) ─────────────────────────────

/**
 * Register M2M endpoints for agent-initiated actions.
 */
function registerAgentEndpoints(app: FastifyInstance, pool: Pool): void {
  // Rate limit state: session_id -> { count, windowStart }
  const sendMessageRateLimits = new Map<string, { count: number; windowStart: number }>();
  // Rate limit state: user_email -> { hourly: {count, windowStart}, daily: {count, windowStart} }
  const attractAttentionRateLimits = new Map<string, {
    hourly: { count: number; windowStart: number };
    daily: { count: number; windowStart: number };
  }>();

  /**
   * POST /api/chat/sessions/:id/agent-message
   * M2M endpoint: agent sends a message to a user in an active session.
   * Auth: Bearer M2M token + X-Stream-Secret header.
   * Rate limit: 10/min per session.
   */
  app.post('/api/chat/sessions/:id/agent-message', async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as ChatSendMessageParams & { agent_id?: string };

    if (!isValidUUID(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID' });
    }

    // Validate stream secret
    const streamSecret = req.headers['x-stream-secret'] as string | undefined;
    if (!streamSecret) {
      return reply.code(401).send({ error: 'Missing X-Stream-Secret header' });
    }

    // Look up session
    const sessionResult = await pool.query(
      `SELECT id, thread_id, user_email, agent_id, namespace, status, stream_secret
       FROM chat_session WHERE id = $1`,
      [params.id],
    );

    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0] as {
      id: string;
      thread_id: string;
      user_email: string;
      agent_id: string;
      namespace: string;
      status: string;
      stream_secret: string;
    };

    // Timing-safe secret comparison
    const expected = Buffer.from(session.stream_secret, 'utf8');
    const provided = Buffer.from(streamSecret, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return reply.code(403).send({ error: 'Invalid stream secret' });
    }

    if (session.status !== 'active') {
      return reply.code(409).send({ error: 'Session is not active' });
    }

    // Rate limit: 10/min per session
    const now = Date.now();
    const windowMs = 60_000;
    let rl = sendMessageRateLimits.get(params.id);
    if (!rl || now - rl.windowStart >= windowMs) {
      rl = { count: 0, windowStart: now };
      sendMessageRateLimits.set(params.id, rl);
    }
    if (rl.count >= 10) {
      return reply.code(429).send({ error: 'Rate limit: max 10 messages/min per session' });
    }
    rl.count++;

    // Validate content
    if (!body.content || typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'content is required' });
    }

    const result = await executeChatSendMessage(
      pool,
      { ...body, session_id: params.id },
      body.agent_id ?? session.agent_id,
      session.user_email,
      session.namespace,
    );

    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }

    return reply.code(201).send({ ok: true, message_id: result.message_id });
  });

  /**
   * POST /api/notifications/agent
   * M2M endpoint: agent sends a notification with urgency escalation.
   * Auth: Bearer M2M token (x-user-email identifies target user).
   * Rate limit: 3/hour, 10/day per user.
   */
  app.post('/api/notifications/agent', async (req, reply) => {
    const body = req.body as ChatAttractAttentionParams & { agent_id?: string; user_email?: string };

    // Get target user email
    const userEmail = (req.headers['x-user-email'] as string | undefined) ?? body.user_email;
    if (!userEmail) {
      return reply.code(400).send({ error: 'user_email is required' });
    }

    // Validate required fields
    if (!body.message || typeof body.message !== 'string') {
      return reply.code(400).send({ error: 'message is required' });
    }
    if (!body.urgency || !['low', 'normal', 'high', 'urgent'].includes(body.urgency)) {
      return reply.code(400).send({ error: 'urgency must be one of: low, normal, high, urgent' });
    }
    if (!body.reason_key || typeof body.reason_key !== 'string') {
      return reply.code(400).send({ error: 'reason_key is required' });
    }

    // Rate limit: 3/hour, 10/day per user
    const now = Date.now();
    let rl = attractAttentionRateLimits.get(userEmail);
    if (!rl) {
      rl = {
        hourly: { count: 0, windowStart: now },
        daily: { count: 0, windowStart: now },
      };
      attractAttentionRateLimits.set(userEmail, rl);
    }
    // Reset windows if expired
    if (now - rl.hourly.windowStart >= 3_600_000) {
      rl.hourly = { count: 0, windowStart: now };
    }
    if (now - rl.daily.windowStart >= 86_400_000) {
      rl.daily = { count: 0, windowStart: now };
    }
    if (rl.hourly.count >= 3) {
      return reply.code(429).send({ error: 'Rate limit: max 3 notifications/hour per user' });
    }
    if (rl.daily.count >= 10) {
      return reply.code(429).send({ error: 'Rate limit: max 10 notifications/day per user' });
    }
    rl.hourly.count++;
    rl.daily.count++;

    // Resolve namespace
    const nsResult = await pool.query(
      `SELECT namespace FROM user_setting
       JOIN namespace_member ON namespace_member.email = user_setting.email
       WHERE user_setting.email = $1 LIMIT 1`,
      [userEmail],
    );
    const namespace = nsResult.rows.length > 0
      ? (nsResult.rows[0] as { namespace: string }).namespace
      : 'default';

    const result = await executeChatAttractAttention(
      pool,
      body,
      body.agent_id ?? 'unknown',
      userEmail,
      namespace,
    );

    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }

    return reply.code(200).send({
      ok: true,
      notification_id: result.notification_id,
      deduplicated: result.deduplicated ?? false,
    });
  });
}

/** Safely send a JSON message to a WebSocket. */
function safeSend(socket: WebSocket, data: Record<string, unknown>): void {
  try {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(data));
    }
  } catch {
    // Socket error — ignore
  }
}
