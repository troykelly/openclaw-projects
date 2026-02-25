/**
 * Onboard service for API sources.
 * Orchestrates spec fetching, parsing, and memory creation.
 * Part of API Onboarding feature (#1781).
 */

import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { validateSsrf } from '../webhooks/ssrf.ts';
import { parseOpenApiSpec } from './parser.ts';
import { generateOperationText, generateTagGroupText, generateOverviewText } from './embedding-text.ts';
import { resolveTagGroupKey } from './operation-key.ts';
import { createApiSource, getApiSource, updateApiSource } from './service.ts';
import { createApiCredential } from './credential-service.ts';
import type {
  ApiSource,
  CreateApiCredentialInput,
  CreateApiMemoryInput,
  OnboardResult,
  ApiMemoryKind,
} from './types.ts';

/** Maximum spec size in bytes (10 MB). */
const MAX_SPEC_SIZE = 10 * 1024 * 1024;

/** Fetch timeout in milliseconds. */
const FETCH_TIMEOUT_MS = 30_000;

/** Allowed content types for spec fetch. */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'text/plain',
  'application/vnd.oai.openapi+json',
  'application/vnd.oai.openapi',
]);

/**
 * Compute SHA-256 hash of spec content for deduplication and change detection.
 */
export function hashSpec(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Fetch an OpenAPI spec from a URL with safety limits.
 */
export async function fetchSpec(
  url: string,
  headers?: Record<string, string>,
): Promise<string> {
  // SSRF validation
  const ssrfError = validateSsrf(url);
  if (ssrfError) {
    throw new Error(`SSRF blocked: ${ssrfError}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: headers ?? {},
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch spec: HTTP ${response.status} ${response.statusText}`);
    }

    // Content-Type validation
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    // Size limit check via Content-Length header
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_SPEC_SIZE) {
      throw new Error(`Spec too large: ${contentLength} bytes exceeds ${MAX_SPEC_SIZE} limit`);
    }

    // Read body with size limit
    const body = await response.text();
    if (body.length > MAX_SPEC_SIZE) {
      throw new Error(`Spec too large: ${body.length} bytes exceeds ${MAX_SPEC_SIZE} limit`);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

/** Input for the onboard function. */
export interface OnboardInput {
  namespace: string;
  spec_url?: string;
  spec_content?: string;
  name?: string;
  description?: string;
  tags?: string[];
  created_by_agent?: string;
  credentials?: Array<Omit<CreateApiCredentialInput, 'api_source_id'>>;
  spec_auth_headers?: Record<string, string>;
}

/**
 * Onboard an API source from an OpenAPI spec.
 *
 * Orchestrates: fetch/parse spec -> create api_source -> create api_memory rows -> create credentials.
 * Memories are created with embedding_status: 'pending' for async embedding.
 */
export async function onboardApiSource(
  pool: Pool,
  input: OnboardInput,
): Promise<OnboardResult> {
  if (!input.spec_url && !input.spec_content) {
    throw new Error('Either spec_url or spec_content is required');
  }

  // Check for SSRF on spec_url
  if (input.spec_url) {
    const ssrfError = validateSsrf(input.spec_url);
    if (ssrfError) {
      throw new Error(`SSRF blocked: ${ssrfError}`);
    }
  }

  // Fetch or use inline content
  let specText: string;
  if (input.spec_content) {
    specText = input.spec_content;
  } else {
    specText = await fetchSpec(input.spec_url!, input.spec_auth_headers);
  }

  const specHash = hashSpec(specText);

  // Deduplication: check if an active source with same spec_url exists in this namespace
  if (input.spec_url) {
    const existing = await findExistingBySpecUrl(pool, input.namespace, input.spec_url);
    if (existing) {
      return {
        api_source: existing,
        memories_created: 0,
        memories_updated: 0,
        memories_deleted: 0,
      };
    }
  }

  // Parse the spec
  const parsed = await parseOpenApiSpec(specText);

  // Use a transaction for atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the api_source row
    const apiSource = await createApiSource(client, {
      namespace: input.namespace,
      name: input.name ?? parsed.overview.name,
      description: input.description ?? parsed.overview.description ?? undefined,
      spec_url: input.spec_url,
      servers: parsed.overview.servers as Array<Record<string, unknown>>,
      tags: input.tags ?? [],
      created_by_agent: input.created_by_agent,
    });

    // Update with spec metadata
    await updateApiSource(client, apiSource.id, input.namespace, {
      spec_hash: specHash,
      spec_version: parsed.overview.version,
      last_fetched_at: new Date(),
    });

    // Create credentials if provided
    if (input.credentials) {
      for (const cred of input.credentials) {
        await createApiCredential(client, {
          ...cred,
          api_source_id: apiSource.id,
        });
      }
    }

    // Generate memories
    const memoryInputs: CreateApiMemoryInput[] = [];
    const authSummary = parsed.overview.authSummary;
    const apiName = parsed.overview.name;

    // Per-operation memories
    for (const op of parsed.operations) {
      const text = generateOperationText(op, apiName, authSummary);
      memoryInputs.push({
        api_source_id: apiSource.id,
        namespace: input.namespace,
        memory_kind: 'operation' as ApiMemoryKind,
        operation_key: op.operationKey,
        title: text.title,
        content: text.content,
        metadata: {
          method: op.method,
          path: op.path,
          tags: op.tags,
          description_quality: text.descriptionQuality,
        },
        tags: op.tags,
      });
    }

    // Tag group memories
    for (const tg of parsed.tagGroups) {
      const text = generateTagGroupText(tg, apiName);
      memoryInputs.push({
        api_source_id: apiSource.id,
        namespace: input.namespace,
        memory_kind: 'tag_group' as ApiMemoryKind,
        operation_key: resolveTagGroupKey(tg.tag),
        title: text.title,
        content: text.content,
        metadata: {
          tag: tg.tag,
          operation_count: tg.operations.length,
        },
        tags: [tg.tag],
      });
    }

    // Overview memory
    const overviewText = generateOverviewText(parsed.overview);
    memoryInputs.push({
      api_source_id: apiSource.id,
      namespace: input.namespace,
      memory_kind: 'overview' as ApiMemoryKind,
      operation_key: 'overview',
      title: overviewText.title,
      content: overviewText.content,
      metadata: {
        total_operations: parsed.overview.totalOperations,
        tag_groups: parsed.overview.tagGroups,
      },
      tags: [],
    });

    // Bulk insert memories
    let memoriesCreated = 0;
    for (const mem of memoryInputs) {
      await client.query(
        `INSERT INTO api_memory (
          api_source_id, namespace, memory_kind, operation_key,
          title, content, metadata, tags, embedding_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [
          mem.api_source_id,
          mem.namespace,
          mem.memory_kind,
          mem.operation_key,
          mem.title,
          mem.content,
          JSON.stringify(mem.metadata ?? {}),
          mem.tags ?? [],
        ],
      );
      memoriesCreated++;
    }

    await client.query('COMMIT');

    // Refetch the updated source
    const updatedSource = await getApiSource(pool, apiSource.id, input.namespace);

    return {
      api_source: updatedSource ?? apiSource,
      memories_created: memoriesCreated,
      memories_updated: 0,
      memories_deleted: 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Find an existing active API source with the same spec_url in a namespace.
 */
async function findExistingBySpecUrl(
  pool: Pool,
  namespace: string,
  specUrl: string,
): Promise<ApiSource | null> {
  const result = await pool.query(
    `SELECT * FROM api_source
     WHERE namespace = $1 AND spec_url = $2 AND deleted_at IS NULL AND status = 'active'
     LIMIT 1`,
    [namespace, specUrl],
  );
  if (result.rows.length === 0) return null;

  // Map to ApiSource
  const row = result.rows[0];
  return {
    id: row.id,
    namespace: row.namespace,
    name: row.name,
    description: row.description,
    spec_url: row.spec_url,
    servers: row.servers,
    spec_version: row.spec_version,
    spec_hash: row.spec_hash,
    tags: row.tags,
    refresh_interval_seconds: row.refresh_interval_seconds,
    last_fetched_at: row.last_fetched_at,
    status: row.status,
    error_message: row.error_message,
    created_by_agent: row.created_by_agent,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
