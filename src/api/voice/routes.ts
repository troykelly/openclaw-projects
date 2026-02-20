/**
 * Voice conversation REST API routes.
 * Registers all /api/voice/* endpoints and the /ws/conversation WebSocket endpoint.
 *
 * Issues #1432, #1433, #1434, #1437.
 * Epic #1431 — Voice agent backend.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

import { requireMinRole, RoleError } from '../auth/middleware.ts';
import { getAuthIdentity } from '../auth/middleware.ts';
import { isAuthDisabled, verifyAccessToken } from '../auth/jwt.ts';
import { VoiceConversationHub } from './hub.ts';
import { getConfig, upsertConfig } from './routing.ts';
import type {
  VoiceConversationRow,
  VoiceMessageRow,
  VoiceConfigUpdateBody,
} from './types.ts';

// ---------- types ----------

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

interface IdParams {
  id: string;
}

// ---------- constants ----------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// ---------- helpers ----------

function parsePagination(query: PaginationQuery): { limit: number; offset: number } {
  const rawLimit = Number.parseInt(query.limit ?? '', 10);
  const rawOffset = Number.parseInt(query.offset ?? '', 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

function isValidUUID(s: string): boolean {
  return UUID_REGEX.test(s);
}

function getNamespace(req: FastifyRequest, reply: FastifyReply): string | null {
  const ctx = req.namespaceContext;
  if (!ctx) {
    void reply.code(403).send({ error: 'Namespace access denied' });
    return null;
  }
  return ctx.storeNamespace;
}

function getQueryNamespaces(req: FastifyRequest): string[] | null {
  const ctx = req.namespaceContext;
  if (!ctx) return null;
  return ctx.queryNamespaces;
}

// ---------- plugin ----------

export interface VoiceRoutesOptions {
  pool: Pool;
}

/**
 * Fastify plugin that registers all voice-related routes.
 *
 * Usage:
 * ```ts
 * app.register(voiceRoutesPlugin, { pool });
 * ```
 */
export async function voiceRoutesPlugin(
  app: FastifyInstance,
  opts: VoiceRoutesOptions,
): Promise<void> {
  const { pool } = opts;

  // Create the voice conversation hub
  const hub = new VoiceConversationHub(pool);
  if (process.env.NODE_ENV !== 'test') {
    hub.start();
  }

  // ============================================================
  // WebSocket endpoint: /ws/conversation
  // Issue #1432
  // ============================================================

  app.get('/ws/conversation', { websocket: true }, async (socket, req) => {
    // Authenticate via JWT
    let user_email: string | null = null;
    let namespace = 'default';

    const identity = await getAuthIdentity(req);
    if (identity) {
      user_email = identity.email;
    } else if (!isAuthDisabled()) {
      // Try JWT from query string
      const query = req.query as { token?: string; namespace?: string };
      if (query.token) {
        try {
          const payload = await verifyAccessToken(query.token);
          user_email = payload.sub;
        } catch {
          socket.close(4001, 'Unauthorized');
          return;
        }
      } else {
        socket.close(4001, 'Unauthorized');
        return;
      }
    }

    // Resolve namespace from context, validating any user-supplied value
    if (req.namespaceContext) {
      const query = req.query as { namespace?: string };
      if (query.namespace) {
        // User requested a specific namespace — verify it's in their grants
        if (!req.namespaceContext.queryNamespaces.includes(query.namespace)) {
          socket.close(4003, 'Namespace access denied');
          return;
        }
        namespace = query.namespace;
      } else {
        namespace = req.namespaceContext.storeNamespace;
      }
    } else if (isAuthDisabled()) {
      // Auth disabled: still validate namespace from query, but don't blindly trust
      const query = req.query as { namespace?: string };
      if (query.namespace) {
        // Validate namespace format to prevent injection
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(query.namespace) || query.namespace.length > 63) {
          socket.close(4003, 'Invalid namespace');
          return;
        }
        namespace = query.namespace;
      }
    }

    hub.addClient(socket, namespace, user_email);
  });

  // ============================================================
  // Voice Config API
  // Issue #1433
  // ============================================================

  // GET /api/voice/config — get voice routing config for namespace
  app.get('/api/voice/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    const namespace = namespaces[0];
    const config = await getConfig(pool, namespace);

    if (!config) {
      return reply.send({ data: null });
    }

    return reply.send({ data: config });
  });

  // PUT /api/voice/config — update voice routing config
  app.put('/api/voice/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'admin');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const body = req.body as VoiceConfigUpdateBody | null;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    // Validate fields
    if (body.timeout_ms !== undefined) {
      if (typeof body.timeout_ms !== 'number' || body.timeout_ms <= 0 || body.timeout_ms > 120000) {
        return reply.code(400).send({ error: 'timeout_ms must be between 1 and 120000' });
      }
    }

    if (body.idle_timeout_s !== undefined) {
      if (typeof body.idle_timeout_s !== 'number' || body.idle_timeout_s <= 0 || body.idle_timeout_s > 86400) {
        return reply.code(400).send({ error: 'idle_timeout_s must be between 1 and 86400' });
      }
    }

    if (body.retention_days !== undefined) {
      if (typeof body.retention_days !== 'number' || body.retention_days <= 0 || body.retention_days > 365) {
        return reply.code(400).send({ error: 'retention_days must be between 1 and 365' });
      }
    }

    if (body.service_allowlist !== undefined) {
      if (!Array.isArray(body.service_allowlist) || !body.service_allowlist.every((s) => typeof s === 'string')) {
        return reply.code(400).send({ error: 'service_allowlist must be an array of strings' });
      }
    }

    const config = await upsertConfig(pool, namespace, body);
    return reply.send({ data: config });
  });

  // ============================================================
  // Conversation History API
  // Issue #1434
  // ============================================================

  // GET /api/voice/conversations — list recent conversations
  app.get('/api/voice/conversations', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    const query = req.query as PaginationQuery;
    const { limit, offset } = parsePagination(query);

    const [dataResult, countResult] = await Promise.all([
      pool.query<VoiceConversationRow>(
        `SELECT * FROM voice_conversation
         WHERE namespace = ANY($1)
         ORDER BY last_active_at DESC
         LIMIT $2 OFFSET $3`,
        [namespaces, limit, offset],
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM voice_conversation
         WHERE namespace = ANY($1)`,
        [namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // GET /api/voice/conversations/:id — get conversation with messages
  app.get('/api/voice/conversations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid conversation ID' });
    }

    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    const convResult = await pool.query<VoiceConversationRow>(
      'SELECT * FROM voice_conversation WHERE id = $1 AND namespace = ANY($2)',
      [id, namespaces],
    );

    if (convResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    const messagesResult = await pool.query<VoiceMessageRow>(
      'SELECT * FROM voice_message WHERE conversation_id = $1 ORDER BY timestamp',
      [id],
    );

    return reply.send({
      data: {
        ...convResult.rows[0],
        messages: messagesResult.rows,
      },
    });
  });

  // DELETE /api/voice/conversations/:id — delete conversation
  app.delete('/api/voice/conversations/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid conversation ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'member');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const result = await pool.query(
      'DELETE FROM voice_conversation WHERE id = $1 AND namespace = $2 RETURNING id',
      [id, namespace],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }

    return reply.code(204).send();
  });

  // ============================================================
  // Cleanup
  // ============================================================

  app.addHook('onClose', async () => {
    await hub.shutdown();
  });
}
