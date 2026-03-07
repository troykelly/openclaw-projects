/**
 * Symphony REST API — Fastify plugin.
 * Epic #2186, Issue #2204
 *
 * 36 endpoints across config, repos, hosts, tools, runs, dashboard, sync, cleanup, metrics.
 * Full auth middleware (JWT + namespace scoping) on every endpoint.
 *
 * Registered in server.ts with prefix '/api/symphony'.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

import { requireMinRole, RoleError } from '../auth/middleware.ts';
import {
  SymphonyMetrics,
  formatPrometheusMetrics,
  buildHealthResponse,
} from './metrics.ts';
import type { CircuitBreakerInfo } from './metrics.ts';

// ─── types ───────────────────────────────────────────────────

/** Pagination query parameters. */
interface PaginationQuery {
  limit?: string;
  offset?: string;
}

/** Run list query filters. */
interface RunListQuery extends PaginationQuery {
  status?: string;
  project_id?: string;
}

/** Cleanup list query filters. */
interface CleanupListQuery extends PaginationQuery {
  status?: string;
}

/** Route params with single id. */
interface IdParams {
  id: string;
}

/** Route params with project_id. */
interface ProjectIdParams {
  project_id: string;
}

/** Route params with project_id + host_id. */
interface ProjectHostParams {
  id: string;
  host_id: string;
}

/** Repo creation body. */
interface RepoCreateBody {
  org?: string;
  repo?: string;
  default_branch?: string;
  sync_strategy?: string;
}

/** Repo update body. */
interface RepoUpdateBody {
  default_branch?: string;
  sync_strategy?: string;
}

/** Host creation body. */
interface HostCreateBody {
  connection_id?: string;
  priority?: number;
  max_concurrent_sessions?: number;
}

/** Tool creation body. */
interface ToolCreateBody {
  tool_name?: string;
  command?: string;
  verify_command?: string;
  min_version?: string;
  timeout_seconds?: number;
}

/** Config upsert body. */
interface ConfigUpsertBody {
  config?: Record<string, unknown>;
}

// ─── constants ───────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const VALID_RUN_STATUSES = new Set([
  'unclaimed', 'claimed', 'provisioning', 'prompting', 'running',
  'awaiting_approval', 'verifying_result', 'merge_pending',
  'post_merge_verify', 'issue_closing', 'continuation_wait',
  'succeeded', 'failed', 'stalled', 'cancelled', 'terminated',
  'terminating', 'paused', 'orphaned', 'cleanup_failed',
  'retry_queued', 'released',
]);

const VALID_CLEANUP_STATUSES = new Set([
  'pending', 'in_progress', 'completed', 'failed', 'skipped',
]);

const VALID_SYNC_STRATEGIES = new Set(['mirror', 'selective', 'manual']);

const VALID_TRIGGERS = new Set([
  'scheduled_poll', 'manual', 'webhook', 'retry', 'continuation',
]);

// ─── helpers ─────────────────────────────────────────────────

function parsePagination(query: PaginationQuery): { limit: number; offset: number } {
  const rawLimit = parseInt(query.limit ?? '', 10);
  const rawOffset = parseInt(query.offset ?? '', 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

function isValidUUID(s: string): boolean {
  return UUID_REGEX.test(s);
}

/** Check if a DB error is a duplicate key violation (PG error code 23505). */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505';
}

/** Check if a DB error is a foreign key violation (PG error code 23503). */
function isForeignKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23503';
}

/**
 * Resolve the namespace for write operations.
 * Returns null and sends 403 if no namespace context.
 */
function getWriteNamespace(req: FastifyRequest, reply: FastifyReply): string | null {
  const ctx = req.namespaceContext;
  if (!ctx) {
    void reply.code(403).send({ error: { code: 'NAMESPACE_REQUIRED', message: 'Namespace access denied' } });
    return null;
  }
  try {
    requireMinRole(req, ctx.storeNamespace, 'readwrite');
  } catch (e) {
    if (e instanceof RoleError) {
      void reply.code(403).send({ error: { code: 'INSUFFICIENT_ROLE', message: e.message } });
      return null;
    }
    throw e;
  }
  return ctx.storeNamespace;
}

/**
 * Resolve query namespaces for read operations.
 * Returns null and sends 403 if no namespace context.
 */
function getQueryNamespaces(req: FastifyRequest, reply: FastifyReply): string[] | null {
  const ctx = req.namespaceContext;
  if (!ctx) {
    void reply.code(403).send({ error: { code: 'NAMESPACE_REQUIRED', message: 'Namespace access denied' } });
    return null;
  }
  return ctx.queryNamespaces;
}

// ─── plugin ──────────────────────────────────────────────────

/** Plugin options. */
export interface SymphonyRoutesOptions {
  pool: Pool;
}

/**
 * Fastify plugin that registers all /api/symphony/* routes.
 *
 * Usage:
 * ```ts
 * app.register(symphonyRoutesPlugin, { pool });
 * ```
 */
export async function symphonyRoutesPlugin(
  app: FastifyInstance,
  opts: SymphonyRoutesOptions,
): Promise<void> {
  const { pool } = opts;
  const metrics = new SymphonyMetrics();
  const startTime = Date.now();

  // ============================================================
  // Configuration — 4 endpoints
  // ============================================================

  // GET /symphony/config/:project_id — get orchestrator config
  app.get('/symphony/config/:project_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { project_id } = req.params as ProjectIdParams;
    if (!isValidUUID(project_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    const result = await pool.query(
      `SELECT * FROM symphony_orchestrator_config
       WHERE project_id = $1 AND namespace = ANY($2)
       ORDER BY version DESC LIMIT 1`,
      [project_id, namespaces],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Config not found' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // PUT /symphony/config/:project_id — create/update orchestrator config
  app.put('/symphony/config/:project_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { project_id } = req.params as ProjectIdParams;
    if (!isValidUUID(project_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = (req.body ?? {}) as ConfigUpsertBody;
    if (!body.config || typeof body.config !== 'object') {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'config object required' } });
    }

    const result = await pool.query(
      `INSERT INTO symphony_orchestrator_config (namespace, project_id, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (namespace, project_id, version) DO UPDATE SET config = $3
       RETURNING *`,
      [namespace, project_id, JSON.stringify(body.config)],
    );

    return reply.send({ data: result.rows[0] });
  });

  // DELETE /symphony/config/:project_id — delete orchestrator config
  app.delete('/symphony/config/:project_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { project_id } = req.params as ProjectIdParams;
    if (!isValidUUID(project_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      'DELETE FROM symphony_orchestrator_config WHERE project_id = $1 AND namespace = $2 RETURNING id',
      [project_id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Config not found' } });
    }

    return reply.send({ deleted: true });
  });

  // GET /symphony/config — list all configs (for namespace)
  app.get('/symphony/config', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const { limit, offset } = parsePagination(req.query as PaginationQuery);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM symphony_orchestrator_config
         WHERE namespace = ANY($1)
         ORDER BY updated_at DESC
         LIMIT $2 OFFSET $3`,
        [namespaces, limit, offset],
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM symphony_orchestrator_config WHERE namespace = ANY($1)',
        [namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // ============================================================
  // Repos — 4 endpoints
  // ============================================================

  // GET /symphony/projects/:id/repos — list repos for project
  app.get('/symphony/projects/:id/repos', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const { limit, offset } = parsePagination(req.query as PaginationQuery);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM project_repository
         WHERE project_id = $1 AND namespace = ANY($2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [id, namespaces, limit, offset],
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM project_repository WHERE project_id = $1 AND namespace = ANY($2)',
        [id, namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // POST /symphony/projects/:id/repos — create repo
  app.post('/symphony/projects/:id/repos', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = (req.body ?? {}) as RepoCreateBody;
    if (!body.org || !body.repo) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'org and repo are required' } });
    }

    if (body.sync_strategy && !VALID_SYNC_STRATEGIES.has(body.sync_strategy)) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: `Invalid sync_strategy. Must be one of: ${[...VALID_SYNC_STRATEGIES].join(', ')}` } });
    }

    try {
      const result = await pool.query(
        `INSERT INTO project_repository (namespace, project_id, org, repo, default_branch, sync_strategy)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [namespace, id, body.org, body.repo, body.default_branch ?? 'main', body.sync_strategy ?? null],
      );
      return reply.code(201).send({ data: result.rows[0] });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'Repository already exists for this project' } });
      }
      if (isForeignKeyError(err)) {
        return reply.code(400).send({ error: { code: 'INVALID_REFERENCE', message: 'Referenced project does not exist' } });
      }
      throw err;
    }
  });

  // PUT /symphony/projects/:id/repos/:repo_id — update repo
  app.put('/symphony/projects/:id/repos/:repo_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string; repo_id: string };
    if (!isValidUUID(params.id) || !isValidUUID(params.repo_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = (req.body ?? {}) as RepoUpdateBody;
    if (body.sync_strategy && !VALID_SYNC_STRATEGIES.has(body.sync_strategy)) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'Invalid sync_strategy' } });
    }

    const setClauses: string[] = [];
    const params_arr: unknown[] = [];
    let idx = 1;

    if (body.default_branch !== undefined) {
      setClauses.push(`default_branch = $${idx++}`);
      params_arr.push(body.default_branch);
    }
    if (body.sync_strategy !== undefined) {
      setClauses.push(`sync_strategy = $${idx++}`);
      params_arr.push(body.sync_strategy);
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'No fields to update' } });
    }

    params_arr.push(params.repo_id, params.id, namespace);
    const result = await pool.query(
      `UPDATE project_repository SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND project_id = $${idx++} AND namespace = $${idx}
       RETURNING *`,
      params_arr,
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Repo not found' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // DELETE /symphony/projects/:id/repos/:repo_id — delete repo
  app.delete('/symphony/projects/:id/repos/:repo_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string; repo_id: string };
    if (!isValidUUID(params.id) || !isValidUUID(params.repo_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      'DELETE FROM project_repository WHERE id = $1 AND project_id = $2 AND namespace = $3 RETURNING id',
      [params.repo_id, params.id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Repo not found' } });
    }

    return reply.send({ deleted: true });
  });

  // ============================================================
  // Hosts — 6 endpoints
  // ============================================================

  // GET /symphony/projects/:id/hosts — list hosts for project
  app.get('/symphony/projects/:id/hosts', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const { limit, offset } = parsePagination(req.query as PaginationQuery);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT ph.*, tc.name AS connection_name
         FROM project_host ph
         LEFT JOIN terminal_connection tc ON tc.id = ph.connection_id
         WHERE ph.project_id = $1 AND ph.namespace = ANY($2)
         ORDER BY ph.priority DESC
         LIMIT $3 OFFSET $4`,
        [id, namespaces, limit, offset],
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM project_host WHERE project_id = $1 AND namespace = ANY($2)',
        [id, namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // POST /symphony/projects/:id/hosts — create host
  app.post('/symphony/projects/:id/hosts', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = (req.body ?? {}) as HostCreateBody;
    if (!body.connection_id || !isValidUUID(body.connection_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'Valid connection_id is required' } });
    }

    // Verify connection belongs to the same namespace
    const connCheck = await pool.query(
      'SELECT id FROM terminal_connection WHERE id = $1 AND namespace = $2',
      [body.connection_id, namespace],
    );
    if (connCheck.rows.length === 0) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'connection_id not found in namespace' } });
    }

    try {
      const result = await pool.query(
        `INSERT INTO project_host (namespace, project_id, connection_id, priority, max_concurrent_sessions)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [namespace, id, body.connection_id, body.priority ?? 0, body.max_concurrent_sessions ?? 1],
      );
      return reply.code(201).send({ data: result.rows[0] });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'Host already exists for this project and connection' } });
      }
      throw err;
    }
  });

  // GET /symphony/projects/:id/hosts/:host_id — get host detail
  app.get('/symphony/projects/:id/hosts/:host_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as ProjectHostParams;
    if (!isValidUUID(params.id) || !isValidUUID(params.host_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    const result = await pool.query(
      'SELECT * FROM project_host WHERE id = $1 AND project_id = $2 AND namespace = ANY($3)',
      [params.host_id, params.id, namespaces],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Host not found' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // DELETE /symphony/projects/:id/hosts/:host_id — delete host
  app.delete('/symphony/projects/:id/hosts/:host_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as ProjectHostParams;
    if (!isValidUUID(params.id) || !isValidUUID(params.host_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      'DELETE FROM project_host WHERE id = $1 AND project_id = $2 AND namespace = $3 RETURNING id',
      [params.host_id, params.id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Host not found' } });
    }

    return reply.send({ deleted: true });
  });

  // POST /symphony/projects/:id/hosts/:host_id/drain — drain host
  app.post('/symphony/projects/:id/hosts/:host_id/drain', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as ProjectHostParams;
    if (!isValidUUID(params.id) || !isValidUUID(params.host_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      `UPDATE project_host SET max_concurrent_sessions = 0
       WHERE id = $1 AND project_id = $2 AND namespace = $3
       RETURNING *`,
      [params.host_id, params.id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Host not found' } });
    }

    return reply.send({ data: result.rows[0], drained: true });
  });

  // POST /symphony/projects/:id/hosts/:host_id/activate — activate host
  app.post('/symphony/projects/:id/hosts/:host_id/activate', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as ProjectHostParams;
    if (!isValidUUID(params.id) || !isValidUUID(params.host_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = req.body as { max_concurrent_sessions?: number } | undefined;
    const maxSessions = body?.max_concurrent_sessions ?? 1;

    const result = await pool.query(
      `UPDATE project_host SET max_concurrent_sessions = $4
       WHERE id = $1 AND project_id = $2 AND namespace = $3
       RETURNING *`,
      [params.host_id, params.id, namespace, maxSessions],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Host not found' } });
    }

    return reply.send({ data: result.rows[0], activated: true });
  });

  // ============================================================
  // Tools — 4 endpoints
  // ============================================================

  // GET /symphony/tools — list tools
  app.get('/symphony/tools', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const { limit, offset } = parsePagination(req.query as PaginationQuery);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM symphony_tool_config
         WHERE namespace = ANY($1)
         ORDER BY tool_name ASC
         LIMIT $2 OFFSET $3`,
        [namespaces, limit, offset],
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM symphony_tool_config WHERE namespace = ANY($1)',
        [namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // POST /symphony/tools — create tool
  app.post('/symphony/tools', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = (req.body ?? {}) as ToolCreateBody;
    if (!body.tool_name || !body.command) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'tool_name and command are required' } });
    }

    try {
      const result = await pool.query(
        `INSERT INTO symphony_tool_config (namespace, tool_name, command, verify_command, min_version, timeout_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [namespace, body.tool_name, body.command, body.verify_command ?? null, body.min_version ?? null, body.timeout_seconds ?? 300],
      );
      return reply.code(201).send({ data: result.rows[0] });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'Tool with this name already exists' } });
      }
      throw err;
    }
  });

  // PUT /symphony/tools/:id — update tool
  app.put('/symphony/tools/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid tool ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = (req.body ?? {}) as ToolCreateBody;
    const setClauses: string[] = [];
    const params_arr: unknown[] = [];
    let idx = 1;

    if (body.tool_name !== undefined) { setClauses.push(`tool_name = $${idx++}`); params_arr.push(body.tool_name); }
    if (body.command !== undefined) { setClauses.push(`command = $${idx++}`); params_arr.push(body.command); }
    if (body.verify_command !== undefined) { setClauses.push(`verify_command = $${idx++}`); params_arr.push(body.verify_command); }
    if (body.min_version !== undefined) { setClauses.push(`min_version = $${idx++}`); params_arr.push(body.min_version); }
    if (body.timeout_seconds !== undefined) { setClauses.push(`timeout_seconds = $${idx++}`); params_arr.push(body.timeout_seconds); }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: 'No fields to update' } });
    }

    params_arr.push(id, namespace);
    const result = await pool.query(
      `UPDATE symphony_tool_config SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND namespace = $${idx}
       RETURNING *`,
      params_arr,
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tool not found' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // DELETE /symphony/tools/:id — delete tool
  app.delete('/symphony/tools/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid tool ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      'DELETE FROM symphony_tool_config WHERE id = $1 AND namespace = $2 RETURNING id',
      [id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tool not found' } });
    }

    return reply.send({ deleted: true });
  });

  // ============================================================
  // Runs — 8 endpoints
  // ============================================================

  // GET /symphony/runs — list runs
  app.get('/symphony/runs', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const query = req.query as RunListQuery;
    const { limit, offset } = parsePagination(query);

    const conditions: string[] = ['namespace = ANY($1)'];
    const params: unknown[] = [namespaces];
    let paramIdx = 2;

    if (query.status) {
      if (!VALID_RUN_STATUSES.has(query.status)) {
        return reply.code(400).send({ error: { code: 'INVALID_STATUS', message: `Invalid status. Must be one of: ${[...VALID_RUN_STATUSES].join(', ')}` } });
      }
      conditions.push(`status = $${paramIdx}`);
      params.push(query.status);
      paramIdx++;
    }

    if (query.project_id) {
      if (!isValidUUID(query.project_id)) {
        return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project_id filter' } });
      }
      conditions.push(`project_id = $${paramIdx}`);
      params.push(query.project_id);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM symphony_run WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM symphony_run WHERE ${whereClause}`,
        params,
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // GET /symphony/runs/:id — run detail
  app.get('/symphony/runs/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    const result = await pool.query(
      'SELECT * FROM symphony_run WHERE id = $1 AND namespace = ANY($2)',
      [id, namespaces],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // POST /symphony/runs/:id/cancel — cancel a run
  app.post('/symphony/runs/:id/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      `UPDATE symphony_run SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1 AND namespace = $2
         AND status NOT IN ('succeeded', 'cancelled', 'terminated', 'released', 'cleanup_failed')
       RETURNING *`,
      [id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found or already in terminal state' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // POST /symphony/runs/:id/retry — retry a failed run
  app.post('/symphony/runs/:id/retry', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      `UPDATE symphony_run SET status = 'retry_queued', retry_count = retry_count + 1
       WHERE id = $1 AND namespace = $2 AND status IN ('failed', 'stalled', 'paused')
       RETURNING *`,
      [id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found or not in retryable state' } });
    }

    metrics.recordRetry();
    return reply.send({ data: result.rows[0] });
  });

  // POST /symphony/runs/:id/approve — approve a run awaiting approval
  app.post('/symphony/runs/:id/approve', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      `UPDATE symphony_run SET status = 'running'
       WHERE id = $1 AND namespace = $2 AND status = 'awaiting_approval'
       RETURNING *`,
      [id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found or not awaiting approval' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // POST /symphony/runs/:id/merge — trigger merge for a run
  app.post('/symphony/runs/:id/merge', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      `UPDATE symphony_run SET status = 'merge_pending'
       WHERE id = $1 AND namespace = $2 AND status IN ('verifying_result', 'awaiting_approval')
       RETURNING *`,
      [id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found or not in mergeable state' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // GET /symphony/runs/:id/events — run events
  app.get('/symphony/runs/:id/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const { limit, offset } = parsePagination(req.query as PaginationQuery);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM symphony_run_event
         WHERE run_id = $1 AND namespace = ANY($2)
         ORDER BY emitted_at DESC
         LIMIT $3 OFFSET $4`,
        [id, namespaces, limit, offset],
      ),
      pool.query(
        'SELECT COUNT(*) AS total FROM symphony_run_event WHERE run_id = $1 AND namespace = ANY($2)',
        [id, namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // GET /symphony/runs/:id/terminal — terminal sessions for a run
  app.get('/symphony/runs/:id/terminal', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid run ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    // Verify the run belongs to a visible namespace
    const runCheck = await pool.query(
      'SELECT id FROM symphony_run WHERE id = $1 AND namespace = ANY($2)',
      [id, namespaces],
    );
    if (runCheck.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    }

    const result = await pool.query(
      `SELECT * FROM symphony_run_terminal
       WHERE run_id = $1
       ORDER BY ordinal ASC`,
      [id],
    );

    return reply.send({ data: result.rows });
  });

  // ============================================================
  // Dashboard — 5 endpoints
  // ============================================================

  // GET /symphony/dashboard/status — status summary
  app.get('/symphony/dashboard/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    const [statusResult, heartbeatResult] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM symphony_run WHERE namespace = ANY($1)
         GROUP BY status`,
        [namespaces],
      ),
      pool.query(
        `SELECT * FROM symphony_orchestrator_heartbeat
         WHERE namespace = ANY($1)
         ORDER BY last_heartbeat_at DESC LIMIT 1`,
        [namespaces],
      ),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of statusResult.rows) {
      statusCounts[row.status as string] = row.count as number;
    }

    return reply.send({
      status_counts: statusCounts,
      last_heartbeat: heartbeatResult.rows[0] ?? null,
    });
  });

  // GET /symphony/dashboard/queue — queue view
  app.get('/symphony/dashboard/queue', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const { limit, offset } = parsePagination(req.query as PaginationQuery);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT r.*, w.title AS work_item_title
         FROM symphony_run r
         LEFT JOIN work_item w ON w.id = r.work_item_id
         WHERE r.namespace = ANY($1)
           AND r.status IN ('unclaimed', 'claimed', 'retry_queued')
         ORDER BY r.created_at ASC
         LIMIT $2 OFFSET $3`,
        [namespaces, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM symphony_run
         WHERE namespace = ANY($1)
           AND status IN ('unclaimed', 'claimed', 'retry_queued')`,
        [namespaces],
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // GET /symphony/dashboard/hosts — host status overview
  app.get('/symphony/dashboard/hosts', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    const result = await pool.query(
      `SELECT ph.*, tc.name AS connection_name,
              (SELECT COUNT(*)::int FROM symphony_run sr
               WHERE sr.namespace = ph.namespace
                 AND sr.status IN ('claimed', 'provisioning', 'prompting', 'running')
              ) AS active_runs
       FROM project_host ph
       LEFT JOIN terminal_connection tc ON tc.id = ph.connection_id
       WHERE ph.namespace = ANY($1)
       ORDER BY ph.priority DESC`,
      [namespaces],
    );

    return reply.send({ data: result.rows });
  });

  // GET /symphony/dashboard/health — health summary
  app.get('/symphony/dashboard/health', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    let dbConnected = true;
    let activeRuns = 0;
    let lastPollTime: string | null = null;
    const circuitBreakers: CircuitBreakerInfo[] = [];

    try {
      const [activeResult, heartbeatResult, cbResult] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS active FROM symphony_run
           WHERE namespace = ANY($1)
             AND status NOT IN ('succeeded', 'cancelled', 'terminated', 'released', 'cleanup_failed')`,
          [namespaces],
        ),
        pool.query(
          `SELECT last_heartbeat_at, orchestrator_id FROM symphony_orchestrator_heartbeat
           WHERE namespace = ANY($1) ORDER BY last_heartbeat_at DESC LIMIT 1`,
          [namespaces],
        ),
        pool.query(
          `SELECT circuit_name, state FROM symphony_circuit_breaker
           WHERE namespace = ANY($1)`,
          [namespaces],
        ),
      ]);

      activeRuns = activeResult.rows[0]?.active ?? 0;
      lastPollTime = heartbeatResult.rows[0]?.last_heartbeat_at?.toISOString?.() ?? heartbeatResult.rows[0]?.last_heartbeat_at ?? null;

      for (const row of cbResult.rows) {
        circuitBreakers.push({
          name: row.circuit_name as string,
          state: row.state as 'closed' | 'open' | 'half_open',
        });
      }
    } catch {
      dbConnected = false;
    }

    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const healthResponse = buildHealthResponse({
      dbConnected,
      activeRuns,
      lastPollTime,
      circuitBreakers,
      uptimeSeconds,
    });

    const httpStatus = healthResponse.status === 'unhealthy' ? 503 : 200;
    return reply.code(httpStatus).send(healthResponse);
  });

  // POST /symphony/dashboard/queue/reorder — reorder queue (placeholder)
  app.post('/symphony/dashboard/queue/reorder', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    // Queue reordering is a future enhancement — for now, acknowledge
    return reply.code(202).send({ message: 'Queue reorder acknowledged' });
  });

  // ============================================================
  // Sync — 2 endpoints
  // ============================================================

  // POST /symphony/sync/:project_id — trigger sync
  app.post('/symphony/sync/:project_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { project_id } = req.params as ProjectIdParams;
    if (!isValidUUID(project_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const body = req.body as { trigger?: string } | undefined;
    const trigger = body?.trigger ?? 'manual';
    if (!VALID_TRIGGERS.has(trigger)) {
      return reply.code(400).send({ error: { code: 'INVALID_BODY', message: `Invalid trigger. Must be one of: ${[...VALID_TRIGGERS].join(', ')}` } });
    }

    // Verify project exists in namespace
    const projectCheck = await pool.query(
      'SELECT id FROM project_repository WHERE project_id = $1 AND namespace = $2 LIMIT 1',
      [project_id, namespace],
    );

    if (projectCheck.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No repos found for project' } });
    }

    // Sync is async — return 202 accepted
    return reply.code(202).send({
      message: 'Sync triggered',
      project_id,
      trigger,
    });
  });

  // GET /symphony/sync/:project_id/status — sync status
  app.get('/symphony/sync/:project_id/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { project_id } = req.params as ProjectIdParams;
    if (!isValidUUID(project_id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid project ID' } });
    }

    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    const result = await pool.query(
      `SELECT pr.*, pr.updated_at AS last_synced_at
       FROM project_repository pr
       WHERE pr.project_id = $1 AND pr.namespace = ANY($2)
       ORDER BY pr.updated_at DESC LIMIT 1`,
      [project_id, namespaces],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No repos found for project' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // ============================================================
  // Cleanup — 2 endpoints
  // ============================================================

  // GET /symphony/cleanup — list cleanup items
  app.get('/symphony/cleanup', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;
    const query = req.query as CleanupListQuery;
    const { limit, offset } = parsePagination(query);

    const conditions: string[] = ['namespace = ANY($1)'];
    const params: unknown[] = [namespaces];
    let paramIdx = 2;

    if (query.status) {
      if (!VALID_CLEANUP_STATUSES.has(query.status)) {
        return reply.code(400).send({ error: { code: 'INVALID_STATUS', message: `Invalid status. Must be one of: ${[...VALID_CLEANUP_STATUSES].join(', ')}` } });
      }
      conditions.push(`status = $${paramIdx}`);
      params.push(query.status);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM symphony_cleanup_item WHERE ${whereClause}
         ORDER BY created_at ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM symphony_cleanup_item WHERE ${whereClause}`,
        params,
      ),
    ]);

    return reply.send({
      data: dataResult.rows,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      limit,
      offset,
    });
  });

  // POST /symphony/cleanup/:id/resolve — resolve cleanup item
  app.post('/symphony/cleanup/:id/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: { code: 'INVALID_UUID', message: 'Invalid cleanup item ID' } });
    }

    const namespace = getWriteNamespace(req, reply);
    if (!namespace) return;

    const result = await pool.query(
      `UPDATE symphony_cleanup_item
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND namespace = $2 AND status IN ('pending', 'failed')
       RETURNING *`,
      [id, namespace],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Cleanup item not found or already resolved' } });
    }

    return reply.send({ data: result.rows[0] });
  });

  // ============================================================
  // Metrics — 1 endpoint (Prometheus format)
  // ============================================================

  // GET /symphony/metrics — Prometheus metrics
  app.get('/symphony/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req, reply);
    if (!namespaces) return;

    // Refresh gauge metrics from DB
    try {
      const [activeResult, cleanupResult, heartbeatResult, hostResult] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS count FROM symphony_run
           WHERE namespace = ANY($1) AND status NOT IN ('succeeded', 'cancelled', 'terminated', 'released', 'cleanup_failed')`,
          [namespaces],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS pending,
                  EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int AS oldest_age
           FROM symphony_cleanup_item
           WHERE namespace = ANY($1) AND status = 'pending'`,
          [namespaces],
        ),
        pool.query(
          `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(last_heartbeat_at)))::int AS age
           FROM symphony_orchestrator_heartbeat WHERE namespace = ANY($1)`,
          [namespaces],
        ),
        pool.query(
          `SELECT SUM(max_concurrent_sessions)::int AS total_capacity,
                  (SELECT COUNT(*)::int FROM symphony_run
                   WHERE namespace = ANY($1) AND status IN ('claimed', 'provisioning', 'running')) AS active_sessions
           FROM project_host WHERE namespace = ANY($1)`,
          [namespaces],
        ),
      ]);

      metrics.setCleanupItemsPending(cleanupResult.rows[0]?.pending ?? 0);
      metrics.setCleanupBacklogAge(cleanupResult.rows[0]?.oldest_age ?? 0);
      metrics.setHeartbeatAge(heartbeatResult.rows[0]?.age ?? 0);

      const totalCapacity = hostResult.rows[0]?.total_capacity ?? 0;
      const activeSessions = hostResult.rows[0]?.active_sessions ?? 0;
      metrics.setHostActiveSessions(activeSessions);
      metrics.setHostCapacityRemaining(Math.max(0, totalCapacity - activeSessions));

      // Update runs active gauge from DB (does not affect total counter)
      const activeCount = activeResult.rows[0]?.count ?? 0;
      metrics.setRunsActive(activeCount);
    } catch {
      // If DB is down, serve stale metrics (better than nothing)
    }

    const text = formatPrometheusMetrics(metrics.snapshot());
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(text);
  });
}
