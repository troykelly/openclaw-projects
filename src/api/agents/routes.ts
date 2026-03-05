/**
 * Agent sync routes (#2151).
 *
 * Provides POST /agents/sync to cache the gateway agent list
 * for chat agent discovery.
 */

import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { getAuthIdentity } from '../auth/middleware.ts';

const MAX_AGENTS = 500;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const ALLOWED_URL_SCHEMES = /^https?:\/\//i;

/** A validated agent entry ready for DB insert. */
export interface ValidatedAgent {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_default: boolean;
}

/** Result of validateAgentSyncBody. */
export interface ValidatedSyncPayload {
  agents: ValidatedAgent[];
  default_id: string | null;
}

/**
 * Validate and normalize the agent sync request body.
 *
 * Gateway agent entries have shape:
 * { id, name?, identity?: { name?, avatarUrl?, emoji?, theme? } }
 *
 * Maps identity.name → display_name, identity.avatarUrl → avatar_url.
 * Falls back to top-level name if identity.name is absent.
 * Filters out entries with empty/whitespace-only id.
 */
export function validateAgentSyncBody(body: unknown): ValidatedSyncPayload {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be an object');
  }

  const obj = body as Record<string, unknown>;
  if (!Array.isArray(obj.agents)) {
    throw new Error('agents must be an array');
  }

  const defaultId = typeof obj.default_id === 'string' && obj.default_id.trim().length > 0
    ? obj.default_id.trim()
    : null;

  if (obj.agents.length > MAX_AGENTS) {
    throw new Error(`agents array exceeds maximum of ${MAX_AGENTS}`);
  }

  const agents: ValidatedAgent[] = [];
  for (const entry of obj.agents) {
    if (!entry || typeof entry !== 'object') continue;

    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id.trim().slice(0, MAX_ID_LENGTH) : '';
    if (id.length === 0) continue;

    const identity = (e.identity && typeof e.identity === 'object')
      ? e.identity as Record<string, unknown>
      : null;

    const rawName = (identity && typeof identity.name === 'string' && identity.name.trim().length > 0)
      ? identity.name.trim()
      : (typeof e.name === 'string' && e.name.trim().length > 0 ? e.name.trim() : null);
    const displayName = rawName ? rawName.slice(0, MAX_NAME_LENGTH) : null;

    const rawUrl = (identity && typeof identity.avatarUrl === 'string' && identity.avatarUrl.trim().length > 0)
      ? identity.avatarUrl.trim()
      : null;
    // Only allow http/https URLs to prevent javascript:/data: XSS vectors
    const avatarUrl = (rawUrl && rawUrl.length <= MAX_URL_LENGTH && ALLOWED_URL_SCHEMES.test(rawUrl))
      ? rawUrl
      : null;

    agents.push({
      id,
      display_name: displayName,
      avatar_url: avatarUrl,
      is_default: defaultId === id,
    });
  }

  return { agents, default_id: defaultId };
}

export interface AgentRoutesOptions {
  pool: Pool;
}

/**
 * Fastify plugin: POST /agents/sync
 *
 * Replaces the gateway_agent_cache for the given namespace
 * with the submitted agent list.
 */
export async function agentRoutesPlugin(
  app: FastifyInstance,
  opts: AgentRoutesOptions,
): Promise<void> {
  const { pool } = opts;

  app.post('/agents/sync', async (req, reply) => {
    const identity = await getAuthIdentity(req);
    if (!identity?.email) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const namespace = req.namespaceContext?.storeNamespace ?? 'default';

    let payload: ValidatedSyncPayload;
    try {
      payload = validateAgentSyncBody(req.body);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Invalid request body',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM gateway_agent_cache WHERE namespace = $1',
        [namespace],
      );

      for (const agent of payload.agents) {
        await client.query(
          `INSERT INTO gateway_agent_cache (namespace, agent_id, display_name, avatar_url, is_default)
           VALUES ($1, $2, $3, $4, $5)`,
          [namespace, agent.id, agent.display_name, agent.avatar_url, agent.is_default],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      req.log.error(err, 'Failed to sync agents');
      return reply.code(500).send({ error: 'Failed to sync agents' });
    } finally {
      client.release();
    }

    return reply.send({ synced: payload.agents.length });
  });
}
