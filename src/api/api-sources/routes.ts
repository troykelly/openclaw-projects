/**
 * Fastify routes for api-sources CRUD and credentials.
 * Registers all /api/api-sources/* endpoints.
 * Part of API Onboarding feature (#1774).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

import {
  createApiSource,
  getApiSource,
  listApiSources,
  updateApiSource,
  softDeleteApiSource,
  restoreApiSource,
} from './service.ts';
import {
  createApiCredential,
  getApiCredential,
  listApiCredentials,
  updateApiCredential,
  deleteApiCredential,
} from './credential-service.ts';
import { onboardApiSource } from './onboard.ts';
import type {
  ApiSourceStatus,
  CreateApiSourceInput,
  UpdateApiSourceInput,
  CreateApiCredentialInput,
  UpdateApiCredentialInput,
  CredentialPurpose,
  CredentialResolveStrategy,
} from './types.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface IdParams {
  id: string;
}

interface CredentialParams {
  id: string;
  cred_id: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
  status?: string;
  decrypt?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const VALID_STATUSES = new Set(['active', 'error', 'disabled']);
const VALID_PURPOSES = new Set(['api_call', 'spec_fetch']);
const VALID_STRATEGIES = new Set(['literal', 'env', 'file', 'command']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidUUID(s: string): boolean {
  return UUID_REGEX.test(s);
}

function parsePagination(query: PaginationQuery): { limit: number; offset: number } {
  const rawLimit = Number.parseInt(query.limit ?? '', 10);
  const rawOffset = Number.parseInt(query.offset ?? '', 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
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

// ─── Plugin ──────────────────────────────────────────────────────────────────

export interface ApiSourceRoutesOptions {
  pool: Pool;
}

/**
 * Fastify plugin that registers all api-sources routes.
 *
 * Usage:
 * ```ts
 * app.register(apiSourceRoutesPlugin, { pool });
 * ```
 */
export async function apiSourceRoutesPlugin(
  app: FastifyInstance,
  opts: ApiSourceRoutesOptions,
): Promise<void> {
  const { pool } = opts;

  // ============================================================
  // API Source CRUD
  // ============================================================

  // POST /api/api-sources — create a new API source (with optional onboarding)
  // Rate limited: onboarding parses specs + generates embeddings (expensive).
  // 10 requests per hour covers both simple create and onboard.
  app.post('/api/api-sources', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 hour',
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    const body = req.body as Record<string, unknown> | null;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    // If spec_url or spec_content is provided, use the onboard flow
    if (body.spec_url || body.spec_content) {
      if (body.spec_url && typeof body.spec_url !== 'string') {
        return reply.code(400).send({ error: 'spec_url must be a string' });
      }
      if (body.spec_content && typeof body.spec_content !== 'string') {
        return reply.code(400).send({ error: 'spec_content must be a string' });
      }

      try {
        const result = await onboardApiSource(pool, {
          namespace,
          spec_url: body.spec_url as string | undefined,
          spec_content: body.spec_content as string | undefined,
          name: body.name as string | undefined,
          description: body.description as string | undefined,
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          created_by_agent: body.created_by_agent as string | undefined,
          credentials: body.credentials as Array<Omit<CreateApiCredentialInput, 'api_source_id'>> | undefined,
          spec_auth_headers: body.spec_auth_headers as Record<string, string> | undefined,
        });

        return reply.code(201).send({ data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Onboard failed';
        if (message.startsWith('SSRF blocked:')) {
          return reply.code(422).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
    }

    // Simple create flow (no spec)
    if (!body.name || typeof body.name !== 'string') {
      return reply.code(400).send({ error: 'name is required' });
    }

    if (body.tags && !Array.isArray(body.tags)) {
      return reply.code(400).send({ error: 'tags must be an array of strings' });
    }

    const source = await createApiSource(pool, {
      ...(body as Partial<CreateApiSourceInput>),
      name: body.name as string,
      namespace,
    });

    return reply.code(201).send({ data: source });
  });

  // GET /api/api-sources — list API sources
  app.get('/api/api-sources', async (req: FastifyRequest, reply: FastifyReply) => {
    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    const query = req.query as PaginationQuery;
    const { limit, offset } = parsePagination(query);

    const status = query.status && VALID_STATUSES.has(query.status)
      ? (query.status as ApiSourceStatus)
      : undefined;

    // Use the first namespace for list queries
    const namespace = namespaces[0];
    const sources = await listApiSources(pool, namespace, { status, limit, offset });

    return reply.send({ data: sources, limit, offset });
  });

  // GET /api/api-sources/:id — get a single API source
  app.get('/api/api-sources/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid API source ID' });
    }

    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    const namespace = namespaces[0];
    const source = await getApiSource(pool, id, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    return reply.send({ data: source });
  });

  // PATCH /api/api-sources/:id — update an API source
  app.patch('/api/api-sources/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid API source ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    const body = req.body as UpdateApiSourceInput | null;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    if (body.status && !VALID_STATUSES.has(body.status)) {
      return reply.code(400).send({ error: `Invalid status: ${body.status}` });
    }

    const source = await updateApiSource(pool, id, namespace, body);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    return reply.send({ data: source });
  });

  // DELETE /api/api-sources/:id — soft delete an API source
  app.delete('/api/api-sources/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid API source ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    const deleted = await softDeleteApiSource(pool, id, namespace);
    if (!deleted) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    return reply.code(204).send();
  });

  // POST /api/api-sources/:id/restore — restore a soft-deleted API source
  app.post('/api/api-sources/:id/restore', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as IdParams;
    if (!isValidUUID(id)) {
      return reply.code(400).send({ error: 'Invalid API source ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    const source = await restoreApiSource(pool, id, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found or not deleted' });
    }

    return reply.send({ data: source });
  });

  // ============================================================
  // Credential CRUD
  // ============================================================

  // POST /api/api-sources/:id/credentials — add credential
  app.post('/api/api-sources/:id/credentials', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: apiSourceId } = req.params as IdParams;
    if (!isValidUUID(apiSourceId)) {
      return reply.code(400).send({ error: 'Invalid API source ID' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    // Verify the API source exists and is accessible
    const source = await getApiSource(pool, apiSourceId, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    const body = req.body as Partial<CreateApiCredentialInput> | null;
    if (!body || !body.header_name || !body.resolve_strategy || !body.resolve_reference) {
      return reply.code(400).send({
        error: 'header_name, resolve_strategy, and resolve_reference are required',
      });
    }

    if (!VALID_STRATEGIES.has(body.resolve_strategy)) {
      return reply.code(400).send({ error: `Invalid resolve_strategy: ${body.resolve_strategy}` });
    }

    if (body.purpose && !VALID_PURPOSES.has(body.purpose)) {
      return reply.code(400).send({ error: `Invalid purpose: ${body.purpose}` });
    }

    const cred = await createApiCredential(pool, {
      api_source_id: apiSourceId,
      purpose: body.purpose as CredentialPurpose | undefined,
      header_name: body.header_name,
      header_prefix: body.header_prefix,
      resolve_strategy: body.resolve_strategy as CredentialResolveStrategy,
      resolve_reference: body.resolve_reference,
    });

    return reply.code(201).send({ data: cred });
  });

  // GET /api/api-sources/:id/credentials — list credentials
  app.get('/api/api-sources/:id/credentials', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: apiSourceId } = req.params as IdParams;
    if (!isValidUUID(apiSourceId)) {
      return reply.code(400).send({ error: 'Invalid API source ID' });
    }

    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    // Verify the API source exists and is accessible
    const namespace = namespaces[0];
    const source = await getApiSource(pool, apiSourceId, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    const query = req.query as PaginationQuery;
    const decrypt = query.decrypt === 'true';

    const credentials = await listApiCredentials(pool, apiSourceId, decrypt);

    return reply.send({ data: credentials });
  });

  // GET /api/api-sources/:id/credentials/:cred_id — get a single credential
  app.get('/api/api-sources/:id/credentials/:cred_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: apiSourceId, cred_id: credId } = req.params as CredentialParams;
    if (!isValidUUID(apiSourceId) || !isValidUUID(credId)) {
      return reply.code(400).send({ error: 'Invalid ID format' });
    }

    const namespaces = getQueryNamespaces(req);
    if (!namespaces) return reply.code(403).send({ error: 'Namespace access denied' });

    const namespace = namespaces[0];
    const source = await getApiSource(pool, apiSourceId, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    const query = req.query as PaginationQuery;
    const decrypt = query.decrypt === 'true';

    const cred = await getApiCredential(pool, credId, apiSourceId, decrypt);
    if (!cred) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    return reply.send({ data: cred });
  });

  // PATCH /api/api-sources/:id/credentials/:cred_id — update credential
  app.patch('/api/api-sources/:id/credentials/:cred_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: apiSourceId, cred_id: credId } = req.params as CredentialParams;
    if (!isValidUUID(apiSourceId) || !isValidUUID(credId)) {
      return reply.code(400).send({ error: 'Invalid ID format' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    const source = await getApiSource(pool, apiSourceId, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    const body = req.body as UpdateApiCredentialInput | null;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    if (body.resolve_strategy && !VALID_STRATEGIES.has(body.resolve_strategy)) {
      return reply.code(400).send({ error: `Invalid resolve_strategy: ${body.resolve_strategy}` });
    }

    if (body.purpose && !VALID_PURPOSES.has(body.purpose)) {
      return reply.code(400).send({ error: `Invalid purpose: ${body.purpose}` });
    }

    const cred = await updateApiCredential(pool, credId, apiSourceId, body);
    if (!cred) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    return reply.send({ data: cred });
  });

  // DELETE /api/api-sources/:id/credentials/:cred_id — delete credential
  app.delete('/api/api-sources/:id/credentials/:cred_id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id: apiSourceId, cred_id: credId } = req.params as CredentialParams;
    if (!isValidUUID(apiSourceId) || !isValidUUID(credId)) {
      return reply.code(400).send({ error: 'Invalid ID format' });
    }

    const namespace = getNamespace(req, reply);
    if (!namespace) return;

    const source = await getApiSource(pool, apiSourceId, namespace);
    if (!source) {
      return reply.code(404).send({ error: 'API source not found' });
    }

    const deleted = await deleteApiCredential(pool, credId, apiSourceId);
    if (!deleted) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    return reply.code(204).send();
  });
}
