/**
 * Home Assistant REST API routes for routines, anomalies, and observations.
 *
 * Exports a Fastify plugin that registers all /api/ha/* endpoints.
 * Namespace scoping via req.namespaceContext (from auth middleware).
 *
 * TODO: Register this plugin in server.ts when wiring HA integration routes.
 *
 * Issue #1460, Epic #1440.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

import { requireMinRole, RoleError } from './auth/middleware.ts';

// ---------- types ----------

/** Pagination query parameters. */
interface PaginationQuery {
  limit?: string;
  offset?: string;
}

/** Routine list query parameters. */
interface RoutineListQuery extends PaginationQuery {
  status?: string;
  min_confidence?: string;
}

/** Anomaly list query parameters. */
interface AnomalyListQuery extends PaginationQuery {
  resolved?: string;
  min_score?: string;
}

/** Observation list query parameters. */
interface ObservationListQuery extends PaginationQuery {
  entity_id?: string;
  domain?: string;
  min_score?: string;
  scene_label?: string;
  from?: string;
  to?: string;
}

/** Route params with an id field. */
interface IdParams {
  id: string;
}

/** Routine update body. */
interface RoutineUpdateBody {
  title?: string;
  description?: string;
}

/** Anomaly update body. */
interface AnomalyUpdateBody {
  resolved?: boolean;
  notes?: string;
}

// ---------- constants ----------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROUTINE_STATUSES = ['tentative', 'confirmed', 'rejected', 'archived'];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// ---------- helpers ----------

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

/**
 * Resolve the effective namespace from the request.
 * Returns null and sends 403 if no namespace context is available.
 */
function getNamespace(req: FastifyRequest, reply: FastifyReply): string | null {
  const ctx = req.namespaceContext;
  if (!ctx) {
    void reply.code(403).send({ error: 'Namespace access denied' });
    return null;
  }
  return ctx.storeNamespace;
}

/**
 * Resolve query namespaces for read operations.
 * Returns null if no namespace context is available (caller should 403).
 */
function getQueryNamespaces(req: FastifyRequest): string[] | null {
  const ctx = req.namespaceContext;
  if (!ctx) return null;
  return ctx.queryNamespaces;
}

// ---------- plugin ----------

export interface HaRoutesOptions {
  pool: Pool;
}

/**
 * Fastify plugin that registers all /api/ha/* routes.
 *
 * Usage:
 * ```ts
 * app.register(haRoutesPlugin, { pool });
 * ```
 */
export async function haRoutesPlugin(
  app: FastifyInstance,
  opts: HaRoutesOptions,
): Promise<void> {
  const { pool } = opts;

  // ============================================================
  // Routines
  // ============================================================

  // GET /api/ha/routines — list routines
  app.get('/api/ha/routines', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as RoutineListQuery;
    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });
    const { limit, offset } = parsePagination(query);

    const conditions: string[] = ['namespace = ANY($1)'];
    const params: unknown[] = [namespaces];
    let paramIdx = 2;

    if (query.status) {
      if (!VALID_ROUTINE_STATUSES.includes(query.status)) {
        return reply.code(400).send({ error: `Invalid status. Must be one of: ${VALID_ROUTINE_STATUSES.join(', ')}` });
      }
      conditions.push(`status = $${paramIdx}`);
      params.push(query.status);
      paramIdx++;
    }

    if (query.min_confidence) {
      const minConf = parseFloat(query.min_confidence);
      if (!Number.isFinite(minConf) || minConf < 0 || minConf > 1) {
        return reply.code(400).send({ error: 'min_confidence must be between 0 and 1' });
      }
      conditions.push(`confidence >= $${paramIdx}`);
      params.push(minConf);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM ha_routines WHERE ${whereClause}
         ORDER BY confidence DESC, updated_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM ha_routines WHERE ${whereClause}`,
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

  // GET /api/ha/routines/:id — get routine detail
  app.get('/api/ha/routines/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid routine ID' });
    }

    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });
    const result = await pool.query(
      'SELECT * FROM ha_routines WHERE id = $1 AND namespace = ANY($2)',
      [id, namespaces],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Routine not found' });
    }

    return reply.send({ data: result.rows[0] });
  });

  // PATCH /api/ha/routines/:id — update routine
  app.patch('/api/ha/routines/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid routine ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'readwrite');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const body = req.body as RoutineUpdateBody | null;
    if (!body || (body.title === undefined && body.description === undefined)) {
      return reply.code(400).send({ error: 'Must provide title or description' });
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id, namespace];
    let paramIdx = 3;

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return reply.code(400).send({ error: 'Title must be a non-empty string' });
      }
      sets.push(`title = $${paramIdx}`);
      params.push(body.title.trim());
      paramIdx++;
    }

    if (body.description !== undefined) {
      if (typeof body.description !== 'string') {
        return reply.code(400).send({ error: 'Description must be a string' });
      }
      sets.push(`description = $${paramIdx}`);
      params.push(body.description);
      paramIdx++;
    }

    const result = await pool.query(
      `UPDATE ha_routines SET ${sets.join(', ')}
       WHERE id = $1 AND namespace = $2
       RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Routine not found' });
    }

    return reply.send({ data: result.rows[0] });
  });

  // DELETE /api/ha/routines/:id — soft delete (status → archived)
  app.delete('/api/ha/routines/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid routine ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'readwrite');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const result = await pool.query(
      `UPDATE ha_routines SET status = 'archived', updated_at = NOW()
       WHERE id = $1 AND namespace = $2
       RETURNING id`,
      [id, namespace],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Routine not found' });
    }

    return reply.code(204).send();
  });

  // POST /api/ha/routines/:id/confirm — confirm routine
  app.post('/api/ha/routines/:id/confirm', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid routine ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'readwrite');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const result = await pool.query(
      `UPDATE ha_routines SET status = 'confirmed', updated_at = NOW()
       WHERE id = $1 AND namespace = $2 AND status != 'archived'
       RETURNING *`,
      [id, namespace],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Routine not found or already archived' });
    }

    return reply.send({ data: result.rows[0] });
  });

  // POST /api/ha/routines/:id/reject — reject routine
  app.post('/api/ha/routines/:id/reject', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid routine ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'readwrite');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const result = await pool.query(
      `UPDATE ha_routines SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND namespace = $2 AND status != 'archived'
       RETURNING *`,
      [id, namespace],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Routine not found or already archived' });
    }

    return reply.send({ data: result.rows[0] });
  });

  // GET /api/ha/routines/:id/observations — observations matching routine
  app.get('/api/ha/routines/:id/observations', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid routine ID' });
    }

    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });
    const query = req.query as PaginationQuery;
    const { limit, offset } = parsePagination(query);

    // First, get the routine to extract entity IDs
    const routineResult = await pool.query(
      'SELECT * FROM ha_routines WHERE id = $1 AND namespace = ANY($2)',
      [id, namespaces],
    );

    if (routineResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Routine not found' });
    }

    const routine = routineResult.rows[0];
    const routineNamespace = routine.namespace as string;
    const sequence = routine.sequence as Array<{ entity_id: string }>;
    const entityIds = sequence.map((s) => s.entity_id);

    if (entityIds.length === 0) {
      return reply.send({ data: [], total: 0, limit, offset });
    }

    // Use the routine's own namespace for observation filtering (namespace isolation)
    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM ha_observations
         WHERE namespace = $1 AND entity_id = ANY($2)
         ORDER BY timestamp DESC
         LIMIT $3 OFFSET $4`,
        [routineNamespace, entityIds, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM ha_observations
         WHERE namespace = $1 AND entity_id = ANY($2)`,
        [routineNamespace, entityIds],
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
  // Anomalies
  // ============================================================

  // GET /api/ha/anomalies — list anomalies
  app.get('/api/ha/anomalies', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as AnomalyListQuery;
    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });
    const { limit, offset } = parsePagination(query);

    const conditions: string[] = ['namespace = ANY($1)'];
    const params: unknown[] = [namespaces];
    let paramIdx = 2;

    if (query.resolved !== undefined) {
      if (query.resolved !== 'true' && query.resolved !== 'false') {
        return reply.code(400).send({ error: "resolved must be 'true' or 'false'" });
      }
      const resolved = query.resolved === 'true';
      conditions.push(`resolved = $${paramIdx}`);
      params.push(resolved);
      paramIdx++;
    }

    if (query.min_score) {
      const minScore = parseInt(query.min_score, 10);
      if (!Number.isFinite(minScore) || minScore < 0 || minScore > 10) {
        return reply.code(400).send({ error: 'min_score must be between 0 and 10' });
      }
      conditions.push(`score >= $${paramIdx}`);
      params.push(minScore);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM ha_anomalies WHERE ${whereClause}
         ORDER BY timestamp DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM ha_anomalies WHERE ${whereClause}`,
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

  // PATCH /api/ha/anomalies/:id — update anomaly (resolve, notes)
  app.patch('/api/ha/anomalies/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid anomaly ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    try {
      requireMinRole(req, namespace, 'readwrite');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const body = req.body as AnomalyUpdateBody | null;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const sets: string[] = [];
    const params: unknown[] = [id, namespace];
    let paramIdx = 3;

    if (body.resolved !== undefined) {
      if (typeof body.resolved !== 'boolean') {
        return reply.code(400).send({ error: 'resolved must be a boolean' });
      }
      sets.push(`resolved = $${paramIdx}`);
      params.push(body.resolved);
      paramIdx++;
    }

    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string') {
        return reply.code(400).send({ error: 'notes must be a string' });
      }
      // Store notes in the context JSONB field
      sets.push(`context = context || jsonb_build_object('notes', $${paramIdx}::text)`);
      params.push(body.notes);
      paramIdx++;
    }

    if (sets.length === 0) {
      return reply.code(400).send({ error: 'Must provide resolved or notes' });
    }

    const result = await pool.query(
      `UPDATE ha_anomalies SET ${sets.join(', ')}
       WHERE id = $1 AND namespace = $2
       RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Anomaly not found' });
    }

    return reply.send({ data: result.rows[0] });
  });

  // ============================================================
  // Observations
  // ============================================================

  // GET /api/ha/observations — query observations
  app.get('/api/ha/observations', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as ObservationListQuery;
    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });
    const { limit, offset } = parsePagination(query);

    const conditions: string[] = ['namespace = ANY($1)'];
    const params: unknown[] = [namespaces];
    let paramIdx = 2;

    if (query.entity_id) {
      conditions.push(`entity_id = $${paramIdx}`);
      params.push(query.entity_id);
      paramIdx++;
    }

    if (query.domain) {
      conditions.push(`domain = $${paramIdx}`);
      params.push(query.domain);
      paramIdx++;
    }

    if (query.min_score) {
      const minScore = parseInt(query.min_score, 10);
      if (!Number.isFinite(minScore) || minScore < 0 || minScore > 10) {
        return reply.code(400).send({ error: 'min_score must be between 0 and 10' });
      }
      conditions.push(`score >= $${paramIdx}`);
      params.push(minScore);
      paramIdx++;
    }

    if (query.scene_label) {
      conditions.push(`scene_label = $${paramIdx}`);
      params.push(query.scene_label);
      paramIdx++;
    }

    if (query.from) {
      const fromDate = new Date(query.from);
      if (isNaN(fromDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid from date' });
      }
      conditions.push(`timestamp >= $${paramIdx}`);
      params.push(fromDate);
      paramIdx++;
    }

    if (query.to) {
      const toDate = new Date(query.to);
      if (isNaN(toDate.getTime())) {
        return reply.code(400).send({ error: 'Invalid to date' });
      }
      conditions.push(`timestamp <= $${paramIdx}`);
      params.push(toDate);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM ha_observations WHERE ${whereClause}
         ORDER BY timestamp DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM ha_observations WHERE ${whereClause}`,
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
}
