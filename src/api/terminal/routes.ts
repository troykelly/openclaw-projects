/**
 * Terminal management REST API routes.
 *
 * Registers all /api/terminal/* endpoints:
 * - Connection CRUD (Issue #1672)
 * - Credential CRUD with encryption (Issue #1673)
 * - Session lifecycle with gRPC bridge (Issue #1674)
 * - WebSocket terminal I/O streaming (Issue #1675)
 * - Command execution (Issue #1676)
 * - Window and pane management (Issue #1677)
 * - SSH tunnel management (Issue #1678)
 * - Known host verification (Issue #1679)
 * - Entry recording pipeline (Issue #1680)
 * - Semantic search (Issue #1681)
 * - Session recovery status (Issue #1682)
 * - Enrollment tokens (Issue #1683)
 * - Audit trail (Issue #1686)
 * - Entry retention policies (Issue #1687)
 *
 * Epic #1667 — TMux Session Management.
 */

import { generateKeyPairSync, randomBytes, randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { WebSocket } from 'ws';

import { getAuthIdentity } from '../auth/middleware.ts';
import { isAuthDisabled, verifyAccessToken } from '../auth/jwt.ts';
import {
  encryptCredential,
  parseEncryptionKey,
} from '../../tmux-worker/credentials/index.ts';
import { parseSSHConfig } from './ssh-config-parser.ts';
import * as grpcClient from './grpc-client.ts';
import { recordActivity } from './activity.ts';

// ── Constants ────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const VALID_AUTH_METHODS = ['key', 'password', 'agent', 'command'] as const;
const VALID_HOST_KEY_POLICIES = ['strict', 'tofu', 'skip'] as const;
const VALID_CREDENTIAL_KINDS = ['ssh_key', 'password', 'command'] as const;
const VALID_SESSION_STATUSES = [
  'starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification',
] as const;
const VALID_ENTRY_KINDS = ['command', 'output', 'scrollback', 'annotation', 'error'] as const;

// ── Plugin options ───────────────────────────────────────────

export interface TerminalRoutesOptions {
  pool: Pool;
}

// ── Helpers ──────────────────────────────────────────────────

function parsePagination(query: { limit?: string; offset?: string }): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number.parseInt(query.limit ?? '', 10);
  const rawOffset = Number.parseInt(query.offset ?? '', 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

function getEffectiveNamespaces(req: FastifyRequest): string[] {
  const ns = req.namespaceContext?.queryNamespaces;
  if (ns && ns.length > 0) return ns;
  if (isAuthDisabled()) return ['default'];
  return [];
}

function getStoreNamespace(req: FastifyRequest): string {
  return req.namespaceContext?.storeNamespace ?? 'default';
}

/**
 * Verify that an entity exists in a namespace the caller can access.
 */
async function verifyReadScope(
  pool: Pool,
  table: string,
  id: string,
  req: FastifyRequest,
  options?: { includeDeleted?: boolean },
): Promise<boolean> {
  const queryNamespaces = getEffectiveNamespaces(req);
  if (queryNamespaces.length === 0) return false;
  const deletedClause =
    options?.includeDeleted || !hasDeletedAt(table) ? '' : ' AND deleted_at IS NULL';
  const result = await pool.query(
    `SELECT 1 FROM "${table}" WHERE id = $1 AND namespace = ANY($2::text[])${deletedClause}`,
    [id, queryNamespaces],
  );
  return result.rows.length > 0;
}

async function verifyWriteScope(
  pool: Pool,
  table: string,
  id: string,
  req: FastifyRequest,
  options?: { includeDeleted?: boolean },
): Promise<boolean> {
  const queryNamespaces = getEffectiveNamespaces(req);
  if (queryNamespaces.length === 0) return false;
  const deletedClause =
    options?.includeDeleted || !hasDeletedAt(table) ? '' : ' AND deleted_at IS NULL';
  const result = await pool.query(
    `SELECT 1 FROM "${table}" WHERE id = $1 AND namespace = ANY($2::text[])${deletedClause}`,
    [id, queryNamespaces],
  );
  return result.rows.length > 0;
}

/** Tables that have a deleted_at column. */
function hasDeletedAt(table: string): boolean {
  return ['terminal_connection', 'terminal_credential'].includes(table);
}

/** Extract the actor identifier from the request for audit logging. */
async function getActor(req: FastifyRequest): Promise<string> {
  const identity = await getAuthIdentity(req);
  if (identity) {
    return identity.email ?? 'unknown';
  }
  return isAuthDisabled() ? 'system' : 'unknown';
}

/** Get the encryption key from environment. */
function getEncryptionKey(): Buffer {
  const hex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '';
  if (!hex) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY is required for credential operations');
  }
  return parseEncryptionKey(hex);
}

// ── Route Plugin ─────────────────────────────────────────────

/**
 * Fastify plugin that registers all terminal management API routes.
 *
 * @example
 * ```ts
 * app.register(terminalRoutesPlugin, { pool });
 * ```
 */
export async function terminalRoutesPlugin(
  app: FastifyInstance,
  opts: TerminalRoutesOptions,
): Promise<void> {
  const { pool } = opts;

  // ================================================================
  // Issue #1672 — Connection CRUD API
  // ================================================================

  // GET /api/terminal/connections — List connections
  app.get('/api/terminal/connections', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      search?: string;
      tags?: string;
      is_local?: string;
    };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    let idx = 1;

    // Namespace scoping
    conditions.push(`namespace = ANY($${idx}::text[])`);
    params.push(namespaces);
    idx++;

    // Search by name or host
    if (query.search?.trim()) {
      conditions.push(`(name ILIKE $${idx} OR host ILIKE $${idx})`);
      params.push(`%${query.search.trim()}%`);
      idx++;
    }

    // Filter by tags
    if (query.tags?.trim()) {
      const tags = query.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        conditions.push(`tags && $${idx}::text[]`);
        params.push(tags);
        idx++;
      }
    }

    // Filter by is_local
    if (query.is_local === 'true' || query.is_local === 'false') {
      conditions.push(`is_local = $${idx}`);
      params.push(query.is_local === 'true');
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM terminal_connection ${where}`,
      params,
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const result = await pool.query(
      `SELECT id, namespace, name, host, port, username, auth_method,
              credential_id, proxy_jump_id, is_local, env, connect_timeout_s,
              keepalive_interval, idle_timeout_s, max_sessions, host_key_policy,
              tags, notes, last_connected_at, last_error, created_at, updated_at
       FROM terminal_connection
       ${where}
       ORDER BY name ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    return reply.send({ connections: result.rows, total });
  });

  // POST /api/terminal/connections — Create connection
  app.post('/api/terminal/connections', async (req, reply) => {
    const body = req.body as {
      name?: string;
      host?: string | null;
      port?: number;
      username?: string | null;
      auth_method?: string;
      credential_id?: string | null;
      proxy_jump_id?: string | null;
      is_local?: boolean;
      env?: Record<string, string> | null;
      connect_timeout_s?: number;
      keepalive_interval?: number;
      idle_timeout_s?: number | null;
      max_sessions?: number | null;
      host_key_policy?: string;
      tags?: string[];
      notes?: string | null;
    };

    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }

    if (body.auth_method && !VALID_AUTH_METHODS.includes(body.auth_method as typeof VALID_AUTH_METHODS[number])) {
      return reply.code(400).send({
        error: `Invalid auth_method. Must be one of: ${VALID_AUTH_METHODS.join(', ')}`,
      });
    }

    if (body.host_key_policy && !VALID_HOST_KEY_POLICIES.includes(body.host_key_policy as typeof VALID_HOST_KEY_POLICIES[number])) {
      return reply.code(400).send({
        error: `Invalid host_key_policy. Must be one of: ${VALID_HOST_KEY_POLICIES.join(', ')}`,
      });
    }

    if (body.credential_id && !UUID_REGEX.test(body.credential_id)) {
      return reply.code(400).send({ error: 'Invalid credential_id format' });
    }

    if (body.proxy_jump_id && !UUID_REGEX.test(body.proxy_jump_id)) {
      return reply.code(400).send({ error: 'Invalid proxy_jump_id format' });
    }

    const namespace = getStoreNamespace(req);
    const id = randomUUID();

    await pool.query(
      `INSERT INTO terminal_connection (
        id, namespace, name, host, port, username, auth_method,
        credential_id, proxy_jump_id, is_local, env, connect_timeout_s,
        keepalive_interval, idle_timeout_s, max_sessions, host_key_policy,
        tags, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )`,
      [
        id,
        namespace,
        body.name.trim(),
        body.host ?? null,
        body.port ?? 22,
        body.username ?? null,
        body.auth_method ?? null,
        body.credential_id ?? null,
        body.proxy_jump_id ?? null,
        body.is_local ?? false,
        body.env ? JSON.stringify(body.env) : null,
        body.connect_timeout_s ?? 30,
        body.keepalive_interval ?? 60,
        body.idle_timeout_s ?? null,
        body.max_sessions ?? null,
        body.host_key_policy ?? 'strict',
        body.tags ?? [],
        body.notes ?? null,
      ],
    );

    const row = await pool.query(
      `SELECT id, namespace, name, host, port, username, auth_method,
              credential_id, proxy_jump_id, is_local, env, connect_timeout_s,
              keepalive_interval, idle_timeout_s, max_sessions, host_key_policy,
              tags, notes, last_connected_at, last_error, created_at, updated_at
       FROM terminal_connection WHERE id = $1`,
      [id],
    );

    return reply.code(201).send(row.rows[0]);
  });

  // GET /api/terminal/connections/:id — Get connection details
  app.get('/api/terminal/connections/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid connection ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_connection', params.id, req))) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const result = await pool.query(
      `SELECT id, namespace, name, host, port, username, auth_method,
              credential_id, proxy_jump_id, is_local, env, connect_timeout_s,
              keepalive_interval, idle_timeout_s, max_sessions, host_key_policy,
              tags, notes, last_connected_at, last_error, created_at, updated_at
       FROM terminal_connection WHERE id = $1 AND deleted_at IS NULL`,
      [params.id],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /api/terminal/connections/:id — Update connection
  app.patch('/api/terminal/connections/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid connection ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_connection', params.id, req))) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const body = req.body as Record<string, unknown>;
    const allowedFields = [
      'name', 'host', 'port', 'username', 'auth_method', 'credential_id',
      'proxy_jump_id', 'is_local', 'env', 'connect_timeout_s', 'keepalive_interval',
      'idle_timeout_s', 'max_sessions', 'host_key_policy', 'tags', 'notes',
    ];

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (field in body) {
        const value = body[field];
        if (field === 'env' && value !== null) {
          setClauses.push(`${field} = $${idx}`);
          values.push(JSON.stringify(value));
        } else {
          setClauses.push(`${field} = $${idx}`);
          values.push(value);
        }
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);

    await pool.query(
      `UPDATE terminal_connection SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      [...values, params.id],
    );

    const result = await pool.query(
      `SELECT id, namespace, name, host, port, username, auth_method,
              credential_id, proxy_jump_id, is_local, env, connect_timeout_s,
              keepalive_interval, idle_timeout_s, max_sessions, host_key_policy,
              tags, notes, last_connected_at, last_error, created_at, updated_at
       FROM terminal_connection WHERE id = $1`,
      [params.id],
    );

    return reply.send(result.rows[0]);
  });

  // DELETE /api/terminal/connections/:id — Soft delete
  app.delete('/api/terminal/connections/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid connection ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_connection', params.id, req))) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    await pool.query(
      `UPDATE terminal_connection SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [params.id],
    );

    return reply.code(204).send();
  });

  // POST /api/terminal/connections/:id/test — Test connectivity
  app.post('/api/terminal/connections/:id/test', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid connection ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_connection', params.id, req))) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    try {
      const result = await grpcClient.testConnection({ connection_id: params.id });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Worker unavailable', details: message });
    }
  });

  // POST /api/terminal/connections/import-ssh-config — Import from SSH config
  app.post('/api/terminal/connections/import-ssh-config', async (req, reply) => {
    const body = req.body as { config_text?: string };
    if (!body?.config_text?.trim()) {
      return reply.code(400).send({ error: 'config_text is required' });
    }

    const parsed = parseSSHConfig(body.config_text);
    if (parsed.length === 0) {
      return reply.send({ imported: [], count: 0 });
    }

    const namespace = getStoreNamespace(req);
    const imported: Array<{ id: string; name: string }> = [];

    for (const entry of parsed) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO terminal_connection (
          id, namespace, name, host, port, username, is_local, tags
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          namespace,
          entry.name,
          entry.host ?? entry.name,
          entry.port,
          entry.username,
          false,
          ['imported-ssh-config'],
        ],
      );
      imported.push({ id, name: entry.name });
    }

    return reply.code(201).send({ imported, count: imported.length });
  });

  // ================================================================
  // Issue #1673 — Credential CRUD API
  // ================================================================

  // GET /api/terminal/credentials — List credentials (metadata only)
  app.get('/api/terminal/credentials', async (req, reply) => {
    const query = req.query as { limit?: string; offset?: string };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM terminal_credential
       WHERE namespace = ANY($1::text[]) AND deleted_at IS NULL`,
      [namespaces],
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    // SECURITY: Never return encrypted_value
    const result = await pool.query(
      `SELECT id, namespace, name, kind, command, command_timeout_s,
              cache_ttl_s, fingerprint, public_key, created_at, updated_at
       FROM terminal_credential
       WHERE namespace = ANY($1::text[]) AND deleted_at IS NULL
       ORDER BY name ASC
       LIMIT $2 OFFSET $3`,
      [namespaces, limit, offset],
    );

    return reply.send({ credentials: result.rows, total });
  });

  // POST /api/terminal/credentials — Create credential
  app.post('/api/terminal/credentials', async (req, reply) => {
    const body = req.body as {
      name?: string;
      kind?: string;
      value?: string;
      command?: string;
      command_timeout_s?: number;
      cache_ttl_s?: number;
      fingerprint?: string | null;
      public_key?: string | null;
    };

    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!body.kind || !VALID_CREDENTIAL_KINDS.includes(body.kind as typeof VALID_CREDENTIAL_KINDS[number])) {
      return reply.code(400).send({
        error: `kind is required and must be one of: ${VALID_CREDENTIAL_KINDS.join(', ')}`,
      });
    }

    if ((body.kind === 'ssh_key' || body.kind === 'password') && !body.value) {
      return reply.code(400).send({ error: 'value is required for ssh_key and password credentials' });
    }

    if (body.kind === 'command' && !body.command) {
      return reply.code(400).send({ error: 'command is required for command credentials' });
    }

    const namespace = getStoreNamespace(req);
    const id = randomUUID();

    let encryptedValue: Buffer | null = null;
    if (body.value && (body.kind === 'ssh_key' || body.kind === 'password')) {
      const masterKey = getEncryptionKey();
      encryptedValue = encryptCredential(body.value, masterKey, id);
    }

    await pool.query(
      `INSERT INTO terminal_credential (
        id, namespace, name, kind, encrypted_value, command,
        command_timeout_s, cache_ttl_s, fingerprint, public_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        namespace,
        body.name.trim(),
        body.kind,
        encryptedValue,
        body.command ?? null,
        body.command_timeout_s ?? 10,
        body.cache_ttl_s ?? 0,
        body.fingerprint ?? null,
        body.public_key ?? null,
      ],
    );

    // SECURITY: Return metadata only, never encrypted_value
    const row = await pool.query(
      `SELECT id, namespace, name, kind, command, command_timeout_s,
              cache_ttl_s, fingerprint, public_key, created_at, updated_at
       FROM terminal_credential WHERE id = $1`,
      [id],
    );

    return reply.code(201).send(row.rows[0]);
  });

  // GET /api/terminal/credentials/:id — Get credential metadata
  app.get('/api/terminal/credentials/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid credential ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_credential', params.id, req))) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    // SECURITY: Never return encrypted_value
    const result = await pool.query(
      `SELECT id, namespace, name, kind, command, command_timeout_s,
              cache_ttl_s, fingerprint, public_key, created_at, updated_at
       FROM terminal_credential WHERE id = $1 AND deleted_at IS NULL`,
      [params.id],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /api/terminal/credentials/:id — Update credential (metadata only)
  app.patch('/api/terminal/credentials/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid credential ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_credential', params.id, req))) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    const body = req.body as Record<string, unknown>;
    // Only allow safe fields to be updated — never encrypted_value directly
    const allowedFields = ['name', 'command', 'command_timeout_s', 'cache_ttl_s'];

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (field in body) {
        setClauses.push(`${field} = $${idx}`);
        values.push(body[field]);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);

    await pool.query(
      `UPDATE terminal_credential SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      [...values, params.id],
    );

    // SECURITY: Never return encrypted_value
    const result = await pool.query(
      `SELECT id, namespace, name, kind, command, command_timeout_s,
              cache_ttl_s, fingerprint, public_key, created_at, updated_at
       FROM terminal_credential WHERE id = $1`,
      [params.id],
    );

    return reply.send(result.rows[0]);
  });

  // DELETE /api/terminal/credentials/:id — Soft delete
  app.delete('/api/terminal/credentials/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid credential ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_credential', params.id, req))) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    await pool.query(
      `UPDATE terminal_credential SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [params.id],
    );

    return reply.code(204).send();
  });

  // POST /api/terminal/credentials/generate — Generate SSH key pair
  app.post('/api/terminal/credentials/generate', async (req, reply) => {
    const body = req.body as {
      name?: string;
      type?: string;
    };

    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }

    const keyType = body.type ?? 'ed25519';
    let publicKey: string;
    let privateKey: string;

    if (keyType === 'ed25519') {
      const pair = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      publicKey = pair.publicKey;
      privateKey = pair.privateKey;
    } else if (keyType === 'rsa') {
      const pair = generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      publicKey = pair.publicKey;
      privateKey = pair.privateKey;
    } else {
      return reply.code(400).send({ error: 'type must be "ed25519" or "rsa"' });
    }

    const namespace = getStoreNamespace(req);
    const id = randomUUID();
    const masterKey = getEncryptionKey();
    const encryptedValue = encryptCredential(privateKey, masterKey, id);

    await pool.query(
      `INSERT INTO terminal_credential (
        id, namespace, name, kind, encrypted_value, public_key
      ) VALUES ($1, $2, $3, 'ssh_key', $4, $5)`,
      [id, namespace, body.name.trim(), encryptedValue, publicKey],
    );

    // Return public key (safe) but NEVER the private key after creation
    const row = await pool.query(
      `SELECT id, namespace, name, kind, fingerprint, public_key, created_at, updated_at
       FROM terminal_credential WHERE id = $1`,
      [id],
    );

    return reply.code(201).send({
      ...row.rows[0],
      // Return public key in response so user can copy it
      public_key: publicKey,
    });
  });

  // ================================================================
  // Issue #1674 — Session Lifecycle API (gRPC → REST bridge)
  // ================================================================

  // GET /api/terminal/sessions — List sessions
  app.get('/api/terminal/sessions', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      connection_id?: string;
      status?: string;
    };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    conditions.push(`namespace = ANY($${idx}::text[])`);
    params.push(namespaces);
    idx++;

    if (query.connection_id && UUID_REGEX.test(query.connection_id)) {
      conditions.push(`connection_id = $${idx}`);
      params.push(query.connection_id);
      idx++;
    }

    if (query.status && VALID_SESSION_STATUSES.includes(query.status as typeof VALID_SESSION_STATUSES[number])) {
      conditions.push(`status = $${idx}`);
      params.push(query.status);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM terminal_session ${where}`,
      params,
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const result = await pool.query(
      `SELECT id, namespace, connection_id, tmux_session_name, worker_id, status,
              cols, rows, capture_interval_s, capture_on_command, embed_commands,
              embed_scrollback, started_at, last_activity_at, terminated_at,
              exit_code, error_message, tags, notes, created_at, updated_at
       FROM terminal_session
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    return reply.send({ sessions: result.rows, total });
  });

  // POST /api/terminal/sessions — Create session via gRPC
  app.post('/api/terminal/sessions', async (req, reply) => {
    const body = req.body as {
      connection_id?: string;
      tmux_session_name?: string;
      cols?: number;
      rows?: number;
      capture_on_command?: boolean;
      embed_commands?: boolean;
      embed_scrollback?: boolean;
      capture_interval_s?: number;
      tags?: string[];
      notes?: string;
    };

    if (!body?.connection_id || !UUID_REGEX.test(body.connection_id)) {
      return reply.code(400).send({ error: 'Valid connection_id is required' });
    }

    // Verify connection access
    if (!(await verifyReadScope(pool, 'terminal_connection', body.connection_id, req))) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const namespace = getStoreNamespace(req);
    const sessionName = body.tmux_session_name ?? `session-${Date.now()}`;

    try {
      const session = await grpcClient.createSession({
        connection_id: body.connection_id,
        namespace,
        tmux_session_name: sessionName,
        cols: body.cols ?? 120,
        rows: body.rows ?? 40,
        capture_on_command: body.capture_on_command ?? true,
        embed_commands: body.embed_commands ?? true,
        embed_scrollback: body.embed_scrollback ?? false,
        capture_interval_s: body.capture_interval_s ?? 30,
        tags: body.tags ?? [],
        notes: body.notes ?? '',
      });
      return reply.code(201).send(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to create session', details: message });
    }
  });

  // GET /api/terminal/sessions/:id — Get session details
  app.get('/api/terminal/sessions/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    // Get session from DB
    const result = await pool.query(
      `SELECT s.id, s.namespace, s.connection_id, s.tmux_session_name, s.worker_id,
              s.status, s.cols, s.rows, s.capture_interval_s, s.capture_on_command,
              s.embed_commands, s.embed_scrollback, s.started_at, s.last_activity_at,
              s.terminated_at, s.exit_code, s.error_message, s.tags, s.notes,
              s.created_at, s.updated_at
       FROM terminal_session s
       WHERE s.id = $1`,
      [params.id],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    // Get windows and panes
    const windows = await pool.query(
      `SELECT w.id, w.window_index, w.window_name, w.is_active
       FROM terminal_session_window w
       WHERE w.session_id = $1
       ORDER BY w.window_index`,
      [params.id],
    );

    const panes = await pool.query(
      `SELECT p.id, p.window_id, p.pane_index, p.is_active, p.pid, p.current_command
       FROM terminal_session_pane p
       WHERE p.window_id = ANY($1::uuid[])
       ORDER BY p.pane_index`,
      [windows.rows.map((w: { id: string }) => w.id)],
    );

    // Nest panes under windows
    const windowsWithPanes = windows.rows.map((w: Record<string, unknown>) => ({
      ...w,
      panes: panes.rows.filter((p: { window_id: string }) => p.window_id === w.id),
    }));

    return reply.send({
      ...result.rows[0],
      windows: windowsWithPanes,
    });
  });

  // PATCH /api/terminal/sessions/:id — Update notes/tags (DB only)
  app.patch('/api/terminal/sessions/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = req.body as Record<string, unknown>;
    const allowedFields = ['notes', 'tags'];

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (field in body) {
        setClauses.push(`${field} = $${idx}`);
        values.push(body[field]);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);

    await pool.query(
      `UPDATE terminal_session SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      [...values, params.id],
    );

    const result = await pool.query(
      `SELECT id, namespace, connection_id, tmux_session_name, worker_id, status,
              cols, rows, tags, notes, created_at, updated_at
       FROM terminal_session WHERE id = $1`,
      [params.id],
    );

    return reply.send(result.rows[0]);
  });

  // DELETE /api/terminal/sessions/:id — Terminate session via gRPC
  app.delete('/api/terminal/sessions/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    try {
      await grpcClient.terminateSession({ session_id: params.id });
      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to terminate session', details: message });
    }
  });

  // POST /api/terminal/sessions/:id/resize — Resize terminal via gRPC
  app.post('/api/terminal/sessions/:id/resize', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = req.body as { cols?: number; rows?: number };
    if (!body?.cols || !body?.rows) {
      return reply.code(400).send({ error: 'cols and rows are required' });
    }

    try {
      await grpcClient.resizeSession({
        session_id: params.id,
        cols: body.cols,
        rows: body.rows,
      });

      // Update DB as well
      await pool.query(
        `UPDATE terminal_session SET cols = $1, rows = $2, updated_at = NOW() WHERE id = $3`,
        [body.cols, body.rows, params.id],
      );

      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to resize session', details: message });
    }
  });

  // POST /api/terminal/sessions/:id/annotate — Add annotation entry
  app.post('/api/terminal/sessions/:id/annotate', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = req.body as { content?: string; metadata?: Record<string, unknown> };
    if (!body?.content?.trim()) {
      return reply.code(400).send({ error: 'content is required' });
    }

    // Get namespace from session
    const sessionResult = await pool.query(
      `SELECT namespace FROM terminal_session WHERE id = $1`,
      [params.id],
    );
    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    const namespace = (sessionResult.rows[0] as { namespace: string }).namespace;

    const entryId = randomUUID();
    await pool.query(
      `INSERT INTO terminal_session_entry (
        id, session_id, namespace, kind, content, metadata
      ) VALUES ($1, $2, $3, 'annotation', $4, $5)`,
      [entryId, params.id, namespace, body.content.trim(), body.metadata ? JSON.stringify(body.metadata) : null],
    );

    const result = await pool.query(
      `SELECT id, session_id, namespace, kind, content, metadata, sequence, captured_at, created_at
       FROM terminal_session_entry WHERE id = $1`,
      [entryId],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // ================================================================
  // Issue #1675 — WebSocket Terminal I/O Streaming
  // ================================================================

  // WS /api/terminal/sessions/:id/attach — WebSocket terminal attach
  app.get('/api/terminal/sessions/:id/attach', { websocket: true }, async (socket: WebSocket, req: FastifyRequest) => {
    const params = req.params as { id: string };
    const query = req.query as { token?: string };

    if (!UUID_REGEX.test(params.id)) {
      socket.close(4400, 'Invalid session ID');
      return;
    }

    // Authenticate via JWT from query param or header
    let authenticated = false;
    if (isAuthDisabled()) {
      authenticated = true;
    } else if (query.token) {
      try {
        await verifyAccessToken(query.token);
        authenticated = true;
      } catch {
        // Token verification failed
      }
    } else {
      // Try from auth header
      const identity = await getAuthIdentity(req);
      if (identity) authenticated = true;
    }

    if (!authenticated) {
      socket.close(4401, 'Authentication required');
      return;
    }

    // Verify session access
    if (!(await verifyReadScope(pool, 'terminal_session', params.id, req))) {
      socket.close(4404, 'Session not found');
      return;
    }

    // Open gRPC bidirectional stream
    let grpcStream: ReturnType<typeof grpcClient.attachSession>;
    try {
      grpcStream = grpcClient.attachSession();
    } catch (err) {
      socket.close(4502, 'Worker unavailable');
      return;
    }

    // Send initial session_id to identify which session to attach to
    grpcStream.write({ session_id: params.id });

    // Bridge WebSocket → gRPC
    socket.on('message', (data: Buffer | string) => {
      const rawData = typeof data === 'string' ? Buffer.from(data) : data;

      // Try to parse as JSON for resize messages
      try {
        const parsed = JSON.parse(rawData.toString()) as { type?: string; cols?: number; rows?: number };
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          grpcStream.write({
            session_id: params.id,
            resize: { cols: parsed.cols, rows: parsed.rows },
          });
          return;
        }
      } catch {
        // Not JSON — treat as raw terminal input
      }

      grpcStream.write({
        session_id: params.id,
        data: rawData,
      });
    });

    // Bridge gRPC → WebSocket
    grpcStream.on('data', (output: { data?: Buffer; event?: { type: string; message: string } }) => {
      if (socket.readyState !== 1 /* OPEN */) return;

      if (output.data) {
        socket.send(output.data);
      } else if (output.event) {
        socket.send(JSON.stringify({
          type: 'event',
          event: output.event,
        }));
      }
    });

    // Handle gRPC stream end/error
    grpcStream.on('end', () => {
      if (socket.readyState === 1) {
        socket.close(1000, 'Session ended');
      }
    });

    grpcStream.on('error', (err: Error) => {
      if (socket.readyState === 1) {
        socket.close(4500, `gRPC error: ${err.message}`);
      }
    });

    // Handle WebSocket close
    socket.on('close', () => {
      grpcStream.end();
    });

    socket.on('error', () => {
      grpcStream.end();
    });
  });

  // ================================================================
  // Issue #1676 — Command Execution
  // ================================================================

  // POST /api/terminal/sessions/:id/send-command — Send command and wait for output
  app.post('/api/terminal/sessions/:id/send-command', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = req.body as {
      command?: string;
      timeout_s?: number;
      pane_id?: string;
    };

    if (!body?.command?.trim()) {
      return reply.code(400).send({ error: 'command is required' });
    }

    const timeoutS = Math.min(body.timeout_s ?? 30, 300); // Max 5 minutes

    try {
      const result = await grpcClient.sendCommand(
        {
          session_id: params.id,
          command: body.command.trim(),
          timeout_s: timeoutS,
          pane_id: body.pane_id ?? '',
        },
        (timeoutS + 5) * 1000, // gRPC deadline slightly longer than command timeout
      );

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to send command', details: message });
    }
  });

  // POST /api/terminal/sessions/:id/send-keys — Send raw keystrokes
  app.post('/api/terminal/sessions/:id/send-keys', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = req.body as { keys?: string; pane_id?: string };
    if (!body?.keys) {
      return reply.code(400).send({ error: 'keys is required' });
    }

    try {
      await grpcClient.sendKeys({
        session_id: params.id,
        keys: body.keys,
        pane_id: body.pane_id ?? '',
      });

      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to send keys', details: message });
    }
  });

  // GET /api/terminal/sessions/:id/capture — Capture pane content
  app.get('/api/terminal/sessions/:id/capture', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { pane_id?: string; lines?: string };

    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const lines = parseInt(query.lines ?? '100', 10);

    try {
      const result = await grpcClient.capturePane({
        session_id: params.id,
        pane_id: query.pane_id ?? '',
        lines: Math.min(Math.max(lines, 1), 10000),
      });

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to capture pane', details: message });
    }
  });

  // ================================================================
  // Issue #1683 — Enrollment Token System
  // ================================================================

  // GET /api/terminal/enrollment-tokens — List tokens (metadata only)
  app.get('/api/terminal/enrollment-tokens', async (req, reply) => {
    const query = req.query as { limit?: string; offset?: string };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const countResult = await pool.query(
      `SELECT count(*)::int AS total FROM terminal_enrollment_token WHERE namespace = ANY($1::text[])`,
      [namespaces],
    );
    const total = countResult.rows[0]?.total ?? 0;

    const result = await pool.query(
      `SELECT id, namespace, label, max_uses, uses, expires_at, connection_defaults, allowed_tags, created_at
       FROM terminal_enrollment_token
       WHERE namespace = ANY($1::text[])
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [namespaces, limit, offset],
    );

    return reply.send({ tokens: result.rows, total, limit, offset });
  });

  // POST /api/terminal/enrollment-tokens — Create token
  app.post('/api/terminal/enrollment-tokens', async (req, reply) => {
    const namespace = getStoreNamespace(req);
    const body = req.body as {
      label?: string;
      max_uses?: number;
      expires_at?: string;
      connection_defaults?: Record<string, unknown>;
      allowed_tags?: string[];
    } | null;

    if (!body?.label || !body.label.trim()) {
      return reply.code(400).send({ error: 'label is required' });
    }

    // Generate a cryptographically random token (32 bytes, base64url)
    const plaintextToken = randomBytes(32).toString('base64url');

    // Hash the token with SHA-256 for storage
    // Using SHA-256 because enrollment tokens are high-entropy random values,
    // not user-chosen passwords — preimage resistance is sufficient.
    const tokenHash = createHash('sha256').update(plaintextToken).digest('hex');

    const maxUses = body.max_uses != null ? Math.max(1, Math.floor(body.max_uses)) : null;
    const expiresAt = body.expires_at ?? null;
    const connectionDefaults = body.connection_defaults ?? null;
    const allowedTags = body.allowed_tags ?? null;

    const result = await pool.query(
      `INSERT INTO terminal_enrollment_token
         (namespace, token_hash, label, max_uses, expires_at, connection_defaults, allowed_tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, namespace, label, max_uses, uses, expires_at, connection_defaults, allowed_tags, created_at`,
      [
        namespace,
        tokenHash,
        body.label.trim(),
        maxUses,
        expiresAt,
        connectionDefaults ? JSON.stringify(connectionDefaults) : null,
        allowedTags,
      ],
    );

    const token = result.rows[0];
    const actor = await getActor(req);

    recordActivity(pool, {
      namespace,
      actor,
      action: 'enrollment_token.create',
      detail: { label: body.label.trim(), token_id: token.id },
    });

    // Return plaintext token ONCE — it will never be retrievable again
    return reply.code(201).send({
      ...token,
      token: plaintextToken,
      enrollment_script: `curl -sSL "$API_BASE_URL/api/terminal/enroll" -H "Content-Type: application/json" -d '{"token":"${plaintextToken}","hostname":"$(hostname)"}'`,
    });
  });

  // DELETE /api/terminal/enrollment-tokens/:id — Revoke token
  app.delete('/api/terminal/enrollment-tokens/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid token ID format' });
    }

    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const result = await pool.query(
      `DELETE FROM terminal_enrollment_token WHERE id = $1 AND namespace = ANY($2::text[]) RETURNING id`,
      [params.id, namespaces],
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Enrollment token not found' });
    }

    const actor = await getActor(req);
    recordActivity(pool, {
      namespace: getStoreNamespace(req),
      actor,
      action: 'enrollment_token.revoke',
      detail: { token_id: params.id },
    });

    return reply.code(204).send();
  });

  // POST /api/terminal/enroll — Remote self-registration
  app.post('/api/terminal/enroll', async (req, reply) => {
    const body = req.body as {
      token?: string;
      hostname?: string;
      ssh_port?: number;
      public_key?: string;
      tags?: string[];
      notes?: string;
    } | null;

    if (!body?.token) {
      return reply.code(400).send({ error: 'token is required' });
    }
    if (!body.hostname?.trim()) {
      return reply.code(400).send({ error: 'hostname is required' });
    }

    // Hash the provided token and look it up
    const tokenHash = createHash('sha256').update(body.token).digest('hex');

    const tokenResult = await pool.query(
      `SELECT id, namespace, label, max_uses, uses, expires_at, connection_defaults, allowed_tags
       FROM terminal_enrollment_token
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (tokenResult.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid enrollment token' });
    }

    const enrollmentToken = tokenResult.rows[0] as {
      id: string;
      namespace: string;
      label: string;
      max_uses: number | null;
      uses: number;
      expires_at: string | null;
      connection_defaults: Record<string, unknown> | null;
      allowed_tags: string[] | null;
    };

    // Check expiry
    if (enrollmentToken.expires_at && new Date(enrollmentToken.expires_at) < new Date()) {
      return reply.code(401).send({ error: 'Enrollment token has expired' });
    }

    // Check max_uses
    if (enrollmentToken.max_uses !== null && enrollmentToken.uses >= enrollmentToken.max_uses) {
      return reply.code(401).send({ error: 'Enrollment token has reached maximum uses' });
    }

    // Increment uses
    await pool.query(
      `UPDATE terminal_enrollment_token SET uses = uses + 1 WHERE id = $1`,
      [enrollmentToken.id],
    );

    // Merge connection defaults
    const defaults = enrollmentToken.connection_defaults ?? {};
    const tags = [
      ...(enrollmentToken.allowed_tags ?? []),
      ...(body.tags ?? []),
    ];

    // Create terminal_connection
    const connResult = await pool.query(
      `INSERT INTO terminal_connection
         (namespace, name, host, port, username, tags, notes, env)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        enrollmentToken.namespace,
        body.hostname.trim(),
        body.hostname.trim(),
        body.ssh_port ?? 22,
        (defaults.username as string) ?? null,
        tags.length > 0 ? tags : null,
        body.notes ?? (defaults.notes as string) ?? null,
        defaults.env ? JSON.stringify(defaults.env) : null,
      ],
    );

    const connection = connResult.rows[0];

    // If public_key provided, create credential
    let credential = null;
    if (body.public_key) {
      const credResult = await pool.query(
        `INSERT INTO terminal_credential (namespace, name, kind, public_key)
         VALUES ($1, $2, 'ssh_key', $3)
         RETURNING id, namespace, name, kind, public_key, created_at`,
        [enrollmentToken.namespace, `${body.hostname}-key`, body.public_key],
      );
      credential = credResult.rows[0];

      // Link credential to connection
      await pool.query(
        `UPDATE terminal_connection SET credential_id = $1, auth_method = 'key' WHERE id = $2`,
        [credential.id, connection.id],
      );
    }

    recordActivity(pool, {
      namespace: enrollmentToken.namespace,
      connection_id: connection.id,
      actor: 'system',
      action: 'enrollment.register',
      detail: { token_label: enrollmentToken.label, remote_host: body.hostname },
    });

    return reply.code(201).send({
      connection,
      credential,
      enrollment_token_label: enrollmentToken.label,
    });
  });

  // ================================================================
  // Issue #1686 — Audit Trail (Activity)
  // ================================================================

  // GET /api/terminal/activity — Query audit trail
  app.get('/api/terminal/activity', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      session_id?: string;
      connection_id?: string;
      actor?: string;
      action?: string;
      from?: string;
      to?: string;
    };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    // Build dynamic WHERE clauses
    const conditions: string[] = ['namespace = ANY($1::text[])'];
    const params: unknown[] = [namespaces];
    let paramIndex = 2;

    if (query.session_id) {
      if (!UUID_REGEX.test(query.session_id)) {
        return reply.code(400).send({ error: 'Invalid session_id format' });
      }
      conditions.push(`session_id = $${paramIndex}`);
      params.push(query.session_id);
      paramIndex++;
    }

    if (query.connection_id) {
      if (!UUID_REGEX.test(query.connection_id)) {
        return reply.code(400).send({ error: 'Invalid connection_id format' });
      }
      conditions.push(`connection_id = $${paramIndex}`);
      params.push(query.connection_id);
      paramIndex++;
    }

    if (query.actor) {
      conditions.push(`actor = $${paramIndex}`);
      params.push(query.actor);
      paramIndex++;
    }

    if (query.action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(query.action);
      paramIndex++;
    }

    if (query.from) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(query.from);
      paramIndex++;
    }

    if (query.to) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(query.to);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT count(*)::int AS total FROM terminal_activity WHERE ${whereClause}`,
      params,
    );
    const total = countResult.rows[0]?.total ?? 0;

    const result = await pool.query(
      `SELECT id, namespace, session_id, connection_id, actor, action, detail, created_at
       FROM terminal_activity
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    );

    return reply.send({ items: result.rows, total, limit, offset });
  });

  // ================================================================
  // Issue #1687 — Entry Retention Policies
  // ================================================================

  // PATCH /api/terminal/settings — Update terminal settings (retention)
  app.patch('/api/terminal/settings', async (req, reply) => {
    const namespace = getStoreNamespace(req);
    const body = req.body as {
      entry_retention_days?: number;
    } | null;

    if (!body || body.entry_retention_days === undefined) {
      return reply.code(400).send({ error: 'entry_retention_days is required' });
    }

    const days = Math.floor(body.entry_retention_days);
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return reply.code(400).send({ error: 'entry_retention_days must be between 1 and 3650' });
    }

    // Upsert the setting
    await pool.query(
      `INSERT INTO terminal_setting (namespace, key, value)
       VALUES ($1, 'terminal_retention', $2::jsonb)
       ON CONFLICT (namespace, key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [namespace, JSON.stringify({ terminal_entry_retention_days: days })],
    );

    const actor = await getActor(req);
    recordActivity(pool, {
      namespace,
      actor,
      action: 'settings.update',
      detail: { entry_retention_days: days },
    });

    return reply.send({ entry_retention_days: days });
  });

  // GET /api/terminal/settings — Get terminal settings
  app.get('/api/terminal/settings', async (req, reply) => {
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const result = await pool.query(
      `SELECT value FROM terminal_setting WHERE namespace = ANY($1::text[]) AND key = 'terminal_retention' LIMIT 1`,
      [namespaces],
    );

    const value = result.rows[0]?.value as { terminal_entry_retention_days?: number } | undefined;
    return reply.send({ entry_retention_days: value?.terminal_entry_retention_days ?? 90 });
  });

  // ================================================================
  // Issue #1677 — Window and Pane Management
  // ================================================================

  // POST /api/terminal/sessions/:id/windows — Create window
  app.post('/api/terminal/sessions/:id/windows', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = req.body as { name?: string } | null;

    try {
      const result = await grpcClient.createWindow({
        session_id: params.id,
        window_name: body?.name ?? '',
      });

      return reply.code(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to create window', details: message });
    }
  });

  // DELETE /api/terminal/sessions/:sid/windows/:wid — Close window
  app.delete('/api/terminal/sessions/:sid/windows/:wid', async (req, reply) => {
    const params = req.params as { sid: string; wid: string };
    if (!UUID_REGEX.test(params.sid)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.sid, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const windowIndex = parseInt(params.wid, 10);
    if (!Number.isFinite(windowIndex) || windowIndex < 0) {
      return reply.code(400).send({ error: 'Invalid window index' });
    }

    try {
      await grpcClient.closeWindow({
        session_id: params.sid,
        window_index: windowIndex,
      });

      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to close window', details: message });
    }
  });

  // POST /api/terminal/sessions/:sid/windows/:wid/split — Split pane
  app.post('/api/terminal/sessions/:sid/windows/:wid/split', async (req, reply) => {
    const params = req.params as { sid: string; wid: string };
    if (!UUID_REGEX.test(params.sid)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.sid, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const windowIndex = parseInt(params.wid, 10);
    if (!Number.isFinite(windowIndex) || windowIndex < 0) {
      return reply.code(400).send({ error: 'Invalid window index' });
    }

    const body = req.body as { direction?: string } | null;
    const horizontal = body?.direction === 'horizontal';

    try {
      const result = await grpcClient.splitPane({
        session_id: params.sid,
        window_index: windowIndex,
        horizontal,
      });

      return reply.code(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to split pane', details: message });
    }
  });

  // DELETE /api/terminal/sessions/:sid/panes/:pid — Close pane
  app.delete('/api/terminal/sessions/:sid/panes/:pid', async (req, reply) => {
    const params = req.params as { sid: string; pid: string };
    if (!UUID_REGEX.test(params.sid)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', params.sid, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const paneIndex = parseInt(params.pid, 10);
    if (!Number.isFinite(paneIndex) || paneIndex < 0) {
      return reply.code(400).send({ error: 'Invalid pane index' });
    }

    try {
      await grpcClient.closePane({
        session_id: params.sid,
        window_index: 0,
        pane_index: paneIndex,
      });

      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to close pane', details: message });
    }
  });

  // ================================================================
  // Issue #1678 — SSH Tunnel Management
  // ================================================================

  const VALID_TUNNEL_DIRECTIONS = ['local', 'remote', 'dynamic'] as const;
  const VALID_TUNNEL_STATUSES = ['active', 'failed', 'closed'] as const;

  // GET /api/terminal/tunnels — List tunnels
  app.get('/api/terminal/tunnels', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      connection_id?: string;
      direction?: string;
      status?: string;
    };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    conditions.push(`t.namespace = ANY($${idx}::text[])`);
    params.push(namespaces);
    idx++;

    if (query.connection_id && UUID_REGEX.test(query.connection_id)) {
      conditions.push(`t.connection_id = $${idx}`);
      params.push(query.connection_id);
      idx++;
    }

    if (query.direction && VALID_TUNNEL_DIRECTIONS.includes(query.direction as typeof VALID_TUNNEL_DIRECTIONS[number])) {
      conditions.push(`t.direction = $${idx}`);
      params.push(query.direction);
      idx++;
    }

    if (query.status && VALID_TUNNEL_STATUSES.includes(query.status as typeof VALID_TUNNEL_STATUSES[number])) {
      conditions.push(`t.status = $${idx}`);
      params.push(query.status);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM terminal_tunnel t ${where}`,
      params,
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const result = await pool.query(
      `SELECT t.id, t.namespace, t.connection_id, t.session_id, t.direction,
              t.bind_host, t.bind_port, t.target_host, t.target_port,
              t.status, t.error_message, t.created_at, t.updated_at
       FROM terminal_tunnel t
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    return reply.send({ tunnels: result.rows, total });
  });

  // POST /api/terminal/tunnels — Create tunnel
  app.post('/api/terminal/tunnels', async (req, reply) => {
    const body = req.body as {
      connection_id?: string;
      session_id?: string;
      direction?: string;
      bind_host?: string;
      bind_port?: number;
      target_host?: string;
      target_port?: number;
    };

    if (!body?.connection_id || !UUID_REGEX.test(body.connection_id)) {
      return reply.code(400).send({ error: 'Valid connection_id is required' });
    }

    if (!body.direction || !VALID_TUNNEL_DIRECTIONS.includes(body.direction as typeof VALID_TUNNEL_DIRECTIONS[number])) {
      return reply.code(400).send({
        error: `direction is required and must be one of: ${VALID_TUNNEL_DIRECTIONS.join(', ')}`,
      });
    }

    if (typeof body.bind_port !== 'number' || body.bind_port < 1 || body.bind_port > 65535) {
      return reply.code(400).send({ error: 'bind_port is required and must be 1-65535' });
    }

    if (body.direction !== 'dynamic') {
      if (!body.target_host?.trim()) {
        return reply.code(400).send({ error: 'target_host is required for local and remote tunnels' });
      }
      if (typeof body.target_port !== 'number' || body.target_port < 1 || body.target_port > 65535) {
        return reply.code(400).send({ error: 'target_port is required for local and remote tunnels (1-65535)' });
      }
    }

    if (!(await verifyReadScope(pool, 'terminal_connection', body.connection_id, req))) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    if (body.session_id) {
      if (!UUID_REGEX.test(body.session_id)) {
        return reply.code(400).send({ error: 'Invalid session_id format' });
      }
      if (!(await verifyReadScope(pool, 'terminal_session', body.session_id, req))) {
        return reply.code(404).send({ error: 'Session not found' });
      }
    }

    const namespace = getStoreNamespace(req);

    try {
      const result = await grpcClient.createTunnel({
        connection_id: body.connection_id,
        namespace,
        session_id: body.session_id ?? '',
        direction: body.direction,
        bind_host: body.bind_host ?? '127.0.0.1',
        bind_port: body.bind_port,
        target_host: body.target_host ?? '',
        target_port: body.target_port ?? 0,
      });

      return reply.code(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to create tunnel', details: message });
    }
  });

  // DELETE /api/terminal/tunnels/:id — Close tunnel
  app.delete('/api/terminal/tunnels/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid tunnel ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_tunnel', params.id, req))) {
      return reply.code(404).send({ error: 'Tunnel not found' });
    }

    try {
      await grpcClient.closeTunnel({ tunnel_id: params.id });
      return reply.code(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to close tunnel', details: message });
    }
  });

  // ================================================================
  // Issue #1679 — Known Host Verification
  // ================================================================

  // GET /api/terminal/known-hosts — List trusted hosts
  app.get('/api/terminal/known-hosts', async (req, reply) => {
    const query = req.query as {
      limit?: string;
      offset?: string;
      host?: string;
      connection_id?: string;
    };
    const { limit, offset } = parsePagination(query);
    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    conditions.push(`namespace = ANY($${idx}::text[])`);
    params.push(namespaces);
    idx++;

    if (query.host?.trim()) {
      conditions.push(`host ILIKE $${idx}`);
      params.push(`%${query.host.trim()}%`);
      idx++;
    }

    if (query.connection_id && UUID_REGEX.test(query.connection_id)) {
      conditions.push(`connection_id = $${idx}`);
      params.push(query.connection_id);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM terminal_known_host ${where}`,
      params,
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const result = await pool.query(
      `SELECT id, namespace, connection_id, host, port, key_type,
              key_fingerprint, public_key, trusted_at, trusted_by, created_at
       FROM terminal_known_host
       ${where}
       ORDER BY trusted_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    return reply.send({ known_hosts: result.rows, total });
  });

  // POST /api/terminal/known-hosts — Manually trust a host key
  app.post('/api/terminal/known-hosts', async (req, reply) => {
    const body = req.body as {
      connection_id?: string;
      host?: string;
      port?: number;
      key_type?: string;
      key_fingerprint?: string;
      public_key?: string;
      trusted_by?: string;
    };

    if (!body?.host?.trim()) {
      return reply.code(400).send({ error: 'host is required' });
    }
    if (!body.key_type?.trim()) {
      return reply.code(400).send({ error: 'key_type is required' });
    }
    if (!body.key_fingerprint?.trim()) {
      return reply.code(400).send({ error: 'key_fingerprint is required' });
    }
    if (!body.public_key?.trim()) {
      return reply.code(400).send({ error: 'public_key is required' });
    }

    if (body.connection_id && !UUID_REGEX.test(body.connection_id)) {
      return reply.code(400).send({ error: 'Invalid connection_id format' });
    }

    const namespace = getStoreNamespace(req);
    const id = randomUUID();
    const port = body.port ?? 22;

    await pool.query(
      `INSERT INTO terminal_known_host (
        id, namespace, connection_id, host, port, key_type,
        key_fingerprint, public_key, trusted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (namespace, host, port, key_type)
      DO UPDATE SET key_fingerprint = EXCLUDED.key_fingerprint,
                    public_key = EXCLUDED.public_key,
                    trusted_at = NOW(),
                    trusted_by = EXCLUDED.trusted_by`,
      [
        id,
        namespace,
        body.connection_id ?? null,
        body.host.trim(),
        port,
        body.key_type.trim(),
        body.key_fingerprint.trim(),
        body.public_key.trim(),
        body.trusted_by ?? 'user',
      ],
    );

    const result = await pool.query(
      `SELECT id, namespace, connection_id, host, port, key_type,
              key_fingerprint, public_key, trusted_at, trusted_by, created_at
       FROM terminal_known_host
       WHERE namespace = $1 AND host = $2 AND port = $3 AND key_type = $4`,
      [namespace, body.host.trim(), port, body.key_type.trim()],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // POST /api/terminal/known-hosts/approve — Approve pending host verification
  app.post('/api/terminal/known-hosts/approve', async (req, reply) => {
    const body = req.body as {
      session_id?: string;
      host?: string;
      port?: number;
      key_type?: string;
      fingerprint?: string;
      public_key?: string;
    };

    if (!body?.session_id || !UUID_REGEX.test(body.session_id)) {
      return reply.code(400).send({ error: 'Valid session_id is required' });
    }

    if (!body.host?.trim() || !body.key_type?.trim() || !body.fingerprint?.trim() || !body.public_key?.trim()) {
      return reply.code(400).send({ error: 'host, key_type, fingerprint, and public_key are required' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_session', body.session_id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const namespace = getStoreNamespace(req);
    const id = randomUUID();
    const port = body.port ?? 22;

    await pool.query(
      `INSERT INTO terminal_known_host (
        id, namespace, host, port, key_type, key_fingerprint, public_key, trusted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'user')
      ON CONFLICT (namespace, host, port, key_type)
      DO UPDATE SET key_fingerprint = EXCLUDED.key_fingerprint,
                    public_key = EXCLUDED.public_key,
                    trusted_at = NOW(),
                    trusted_by = 'user'`,
      [id, namespace, body.host.trim(), port, body.key_type.trim(), body.fingerprint.trim(), body.public_key.trim()],
    );

    try {
      await grpcClient.approveHostKey({
        session_id: body.session_id,
        host: body.host.trim(),
        port,
        key_type: body.key_type.trim(),
        fingerprint: body.fingerprint.trim(),
        public_key: body.public_key.trim(),
      });

      return reply.send({ approved: true, session_id: body.session_id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown gRPC error';
      return reply.code(502).send({ error: 'Failed to notify worker', details: message });
    }
  });

  // DELETE /api/terminal/known-hosts/:id — Revoke trust
  app.delete('/api/terminal/known-hosts/:id', async (req, reply) => {
    const params = req.params as { id: string };
    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid known host ID format' });
    }

    if (!(await verifyWriteScope(pool, 'terminal_known_host', params.id, req))) {
      return reply.code(404).send({ error: 'Known host not found' });
    }

    await pool.query(`DELETE FROM terminal_known_host WHERE id = $1`, [params.id]);

    return reply.code(204).send();
  });

  // ================================================================
  // Issue #1680 — Entry Recording and Embedding Pipeline
  // ================================================================

  // GET /api/terminal/sessions/:id/entries — List entries (paginated)
  app.get('/api/terminal/sessions/:id/entries', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as {
      limit?: string;
      offset?: string;
      kind?: string;
      from?: string;
      to?: string;
    };

    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const { limit, offset } = parsePagination(query);

    const conditions: string[] = ['session_id = $1'];
    const qParams: unknown[] = [params.id];
    let idx = 2;

    if (query.kind?.trim()) {
      const kinds = query.kind.split(',').map((k) => k.trim()).filter(Boolean);
      const validKinds = kinds.filter((k) => VALID_ENTRY_KINDS.includes(k as typeof VALID_ENTRY_KINDS[number]));
      if (validKinds.length > 0) {
        conditions.push(`kind = ANY($${idx}::text[])`);
        qParams.push(validKinds);
        idx++;
      }
    }

    if (query.from?.trim()) {
      conditions.push(`captured_at >= $${idx}::timestamptz`);
      qParams.push(query.from.trim());
      idx++;
    }
    if (query.to?.trim()) {
      conditions.push(`captured_at <= $${idx}::timestamptz`);
      qParams.push(query.to.trim());
      idx++;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM terminal_session_entry ${where}`,
      qParams,
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const result = await pool.query(
      `SELECT id, session_id, pane_id, namespace, kind, content,
              sequence, captured_at, metadata, created_at,
              CASE WHEN embedded_at IS NOT NULL THEN true ELSE false END as is_embedded
       FROM terminal_session_entry
       ${where}
       ORDER BY sequence ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...qParams, limit, offset],
    );

    return reply.send({ entries: result.rows, total });
  });

  // GET /api/terminal/sessions/:id/entries/export — Export entries
  app.get('/api/terminal/sessions/:id/entries/export', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { format?: string };

    if (!UUID_REGEX.test(params.id)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    if (!(await verifyReadScope(pool, 'terminal_session', params.id, req))) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const sessionResult = await pool.query(
      `SELECT s.tmux_session_name, c.name as connection_name, c.host,
              s.started_at, s.terminated_at
       FROM terminal_session s
       JOIN terminal_connection c ON s.connection_id = c.id
       WHERE s.id = $1`,
      [params.id],
    );

    const session = sessionResult.rows[0] as {
      tmux_session_name: string;
      connection_name: string;
      host: string;
      started_at: string | null;
      terminated_at: string | null;
    } | undefined;

    const entriesResult = await pool.query(
      `SELECT kind, content, captured_at, metadata
       FROM terminal_session_entry
       WHERE session_id = $1
       ORDER BY sequence ASC`,
      [params.id],
    );

    const entries = entriesResult.rows as Array<{
      kind: string;
      content: string;
      captured_at: string;
      metadata: Record<string, unknown> | null;
    }>;

    const format = query.format === 'markdown' ? 'markdown' : 'text';

    if (format === 'markdown') {
      let md = `# Terminal Session: ${session?.tmux_session_name ?? 'unknown'}\n\n`;
      md += `**Connection:** ${session?.connection_name ?? 'unknown'} (${session?.host ?? 'unknown'})\n`;
      md += `**Started:** ${session?.started_at ?? 'unknown'}\n`;
      if (session?.terminated_at) md += `**Ended:** ${session.terminated_at}\n`;
      md += `\n---\n\n`;

      for (const entry of entries) {
        if (entry.kind === 'command') {
          md += `\`\`\`bash\n$ ${entry.content}\n\`\`\`\n\n`;
        } else if (entry.kind === 'output') {
          md += `\`\`\`\n${entry.content}\n\`\`\`\n\n`;
        } else if (entry.kind === 'annotation') {
          md += `> **Note:** ${entry.content}\n\n`;
        } else if (entry.kind === 'error') {
          md += `> **Error:** ${entry.content}\n\n`;
        } else {
          md += `${entry.content}\n\n`;
        }
      }

      return reply.type('text/markdown').send(md);
    }

    let text = `Session: ${session?.tmux_session_name ?? 'unknown'}\n`;
    text += `Connection: ${session?.connection_name ?? 'unknown'} (${session?.host ?? 'unknown'})\n`;
    text += `Started: ${session?.started_at ?? 'unknown'}\n`;
    if (session?.terminated_at) text += `Ended: ${session.terminated_at}\n`;
    text += `\n`;

    for (const entry of entries) {
      if (entry.kind === 'command') {
        text += `$ ${entry.content}\n`;
      } else if (entry.kind === 'annotation') {
        text += `[NOTE] ${entry.content}\n`;
      } else if (entry.kind === 'error') {
        text += `[ERROR] ${entry.content}\n`;
      } else {
        text += `${entry.content}\n`;
      }
    }

    return reply.type('text/plain').send(text);
  });

  // ================================================================
  // Issue #1681 — Semantic Search
  // ================================================================

  // POST /api/terminal/search — Semantic search across entries
  app.post('/api/terminal/search', async (req, reply) => {
    const body = req.body as {
      query?: string;
      connection_id?: string;
      session_id?: string;
      kind?: string[];
      tags?: string[];
      host?: string;
      session_name?: string;
      date_from?: string;
      date_to?: string;
      limit?: number;
      offset?: number;
    };

    if (!body?.query?.trim()) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const namespaces = getEffectiveNamespaces(req);
    if (namespaces.length === 0) {
      return reply.code(403).send({ error: 'No namespace access' });
    }

    const limit = Math.min(Math.max(body.limit ?? 20, 1), MAX_LIMIT);
    const offset = Math.max(body.offset ?? 0, 0);

    const conditions: string[] = [
      'e.namespace = ANY($1::text[])',
      'e.embedded_at IS NOT NULL',
    ];
    const qParams: unknown[] = [namespaces];
    let idx = 2;

    if (body.connection_id && UUID_REGEX.test(body.connection_id)) {
      conditions.push(`s.connection_id = $${idx}`);
      qParams.push(body.connection_id);
      idx++;
    }

    if (body.session_id && UUID_REGEX.test(body.session_id)) {
      conditions.push(`e.session_id = $${idx}`);
      qParams.push(body.session_id);
      idx++;
    }

    if (body.kind && Array.isArray(body.kind) && body.kind.length > 0) {
      const validKinds = body.kind.filter((k) => VALID_ENTRY_KINDS.includes(k as typeof VALID_ENTRY_KINDS[number]));
      if (validKinds.length > 0) {
        conditions.push(`e.kind = ANY($${idx}::text[])`);
        qParams.push(validKinds);
        idx++;
      }
    }

    if (body.tags && Array.isArray(body.tags) && body.tags.length > 0) {
      conditions.push(`s.tags && $${idx}::text[]`);
      qParams.push(body.tags);
      idx++;
    }

    if (body.host?.trim()) {
      conditions.push(`c.host ILIKE $${idx}`);
      qParams.push(`%${body.host.trim()}%`);
      idx++;
    }

    if (body.session_name?.trim()) {
      conditions.push(`s.tmux_session_name ILIKE $${idx}`);
      qParams.push(`%${body.session_name.trim()}%`);
      idx++;
    }

    if (body.date_from?.trim()) {
      conditions.push(`e.captured_at >= $${idx}::timestamptz`);
      qParams.push(body.date_from.trim());
      idx++;
    }

    if (body.date_to?.trim()) {
      conditions.push(`e.captured_at <= $${idx}::timestamptz`);
      qParams.push(body.date_to.trim());
      idx++;
    }

    const where = conditions.join(' AND ');

    const searchResult = await pool.query(
      `SELECT e.id, e.session_id, e.pane_id, e.kind, e.content,
              e.captured_at, e.metadata, e.sequence,
              s.tmux_session_name as session_name,
              c.name as connection_name, c.host as connection_host
       FROM terminal_session_entry e
       JOIN terminal_session s ON e.session_id = s.id
       JOIN terminal_connection c ON s.connection_id = c.id
       WHERE ${where}
         AND e.content ILIKE $${idx}
       ORDER BY e.captured_at DESC
       LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...qParams, `%${body.query.trim()}%`, limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total
       FROM terminal_session_entry e
       JOIN terminal_session s ON e.session_id = s.id
       JOIN terminal_connection c ON s.connection_id = c.id
       WHERE ${where}
         AND e.content ILIKE $${idx}`,
      [...qParams, `%${body.query.trim()}%`],
    );
    const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

    const items = [];
    for (const row of searchResult.rows as Array<Record<string, unknown>>) {
      const sequence = row.sequence as number;
      const sessionId = row.session_id as string;

      const contextResult = await pool.query(
        `(SELECT kind, content, sequence FROM terminal_session_entry
          WHERE session_id = $1 AND sequence < $2
          ORDER BY sequence DESC LIMIT 2)
         UNION ALL
         (SELECT kind, content, sequence FROM terminal_session_entry
          WHERE session_id = $1 AND sequence > $2
          ORDER BY sequence ASC LIMIT 2)
         ORDER BY sequence ASC`,
        [sessionId, sequence],
      );

      const contextRows = contextResult.rows as Array<{
        kind: string;
        content: string;
        sequence: number;
      }>;

      const before = contextRows
        .filter((c) => c.sequence < sequence)
        .map(({ kind, content }) => ({ kind, content }));
      const after = contextRows
        .filter((c) => c.sequence > sequence)
        .map(({ kind, content }) => ({ kind, content }));

      items.push({
        id: row.id,
        session_id: row.session_id,
        session_name: row.session_name,
        connection_name: row.connection_name,
        connection_host: row.connection_host,
        kind: row.kind,
        content: row.content,
        captured_at: row.captured_at,
        similarity: 1.0,
        context: { before, after },
        metadata: row.metadata,
      });
    }

    return reply.send({ items, total, limit, offset });
  });

  // ================================================================
  // Issue #1682 — Session Recovery (API endpoint for worker status)
  // ================================================================

  // GET /api/terminal/worker/status — Get worker status and health
  app.get('/api/terminal/worker/status', async (_req, reply) => {
    try {
      const client = grpcClient.getGrpcClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic gRPC method access
      const fn = (client as unknown as Record<string, (...args: unknown[]) => void>).GetWorkerStatus;
      if (typeof fn !== 'function') {
        return reply.code(502).send({ error: 'Worker status RPC not available' });
      }

      return new Promise<void>((resolve) => {
        fn.call(
          client,
          {},
          { deadline: new Date(Date.now() + 5000) },
          (err: Error | null, response: unknown) => {
            if (err) {
              reply.code(502).send({ error: 'Worker unreachable', details: err.message });
            } else {
              reply.send(response);
            }
            resolve();
          },
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(502).send({ error: 'Worker unavailable', details: message });
    }
  });
}
