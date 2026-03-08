/**
 * Spec refresh and diff logic for API sources.
 * Re-fetches OpenAPI specs, compares with stored hashes,
 * and diffs operations (add/update/remove memories).
 * Part of API Onboarding feature (#1787).
 */

import type { Pool, PoolClient } from 'pg';
import { fetchSpec, hashSpec } from './onboard.ts';
import { parseOpenApiSpec } from './parser.ts';
import { generateOperationText, generateTagGroupText, generateOverviewText } from './embedding-text.ts';
import { resolveTagGroupKey } from './operation-key.ts';
import { getApiSource, updateApiSource } from './service.ts';
import type { ApiSource, RefreshResult, ApiMemoryKind, CreateApiMemoryInput } from './types.ts';

/** Queryable database connection. */
type Queryable = Pool | PoolClient;

/** Existing memory row from DB. */
interface ExistingMemory {
  id: string;
  operation_key: string;
  memory_kind: string;
  content: string;
  metadata: string | Record<string, unknown>;
}

/** Optional input for refresh, allowing inline spec_content updates. */
export interface RefreshInput {
  /** Updated inline spec content. If provided, replaces stored spec_content. */
  spec_content?: string;
}

/**
 * Refresh an API source by re-fetching (or re-reading) and diffing its spec.
 *
 * 1. Resolve spec text: fetch from spec_url, use provided spec_content, or use stored spec_content
 * 2. Hash and compare with stored spec_hash
 * 3. If unchanged, update last_fetched_at and return early
 * 4. If changed, parse new spec, diff operations, update memories
 * 5. Returns diff summary
 */
export async function refreshApiSource(
  pool: Pool,
  apiSourceId: string,
  namespace: string,
  input?: RefreshInput,
): Promise<RefreshResult> {
  // Get the existing source
  const source = await getApiSource(pool, apiSourceId, namespace);
  if (!source) {
    throw new Error('API source not found');
  }

  // Resolve the spec text from one of three sources:
  // 1. Provided spec_content in refresh input (updates inline spec)
  // 2. Fetch from spec_url if available
  // 3. Use stored spec_content from the api_source row
  let specText: string;
  let updatedSpecContent: string | undefined;

  if (input?.spec_content) {
    // Caller provided new inline spec content
    specText = input.spec_content;
    updatedSpecContent = input.spec_content;
  } else if (source.spec_url) {
    // Fetch from URL
    try {
      specText = await fetchSpec(source.spec_url);
    } catch (err) {
      await updateApiSource(pool, apiSourceId, namespace, {
        status: 'error',
        error_message: err instanceof Error ? err.message : 'Failed to fetch spec',
      });
      throw err;
    }
  } else if (source.spec_content) {
    // Use stored inline spec
    specText = source.spec_content;
  } else {
    throw new Error('Cannot refresh: API source has no spec_url or spec_content');
  }

  const newHash = hashSpec(specText);

  // If hash is the same, no changes — update last_fetched_at and return
  if (newHash === source.spec_hash) {
    await updateApiSource(pool, apiSourceId, namespace, {
      last_fetched_at: new Date(),
    });

    return {
      api_source: (await getApiSource(pool, apiSourceId, namespace)) ?? source,
      memories_created: 0,
      memories_updated: 0,
      memories_deleted: 0,
      spec_changed: false,
    };
  }

  // Parse the new spec
  const parsed = await parseOpenApiSpec(specText);

  // Use a transaction for atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load existing memories keyed by operation_key
    const existingResult = await client.query(
      `SELECT id, operation_key, memory_kind, content, metadata::text
       FROM api_memory
       WHERE api_source_id = $1`,
      [apiSourceId],
    );
    const existingMemories: ExistingMemory[] = existingResult.rows;

    // Build a map of existing operation memories by key
    const existingOpMap = new Map<string, ExistingMemory>();
    for (const mem of existingMemories) {
      if (mem.memory_kind === 'operation') {
        existingOpMap.set(mem.operation_key, mem);
      }
    }

    // Build new operations map
    const newOpMap = new Map<string, CreateApiMemoryInput>();
    const authSummary = parsed.overview.authSummary;
    const apiName = parsed.overview.name;

    for (const op of parsed.operations) {
      const text = generateOperationText(op, apiName, authSummary);
      newOpMap.set(op.operationKey, {
        api_source_id: apiSourceId,
        namespace,
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

    let memoriesCreated = 0;
    let memoriesUpdated = 0;
    let memoriesDeleted = 0;

    // Diff operations: update existing, insert new
    for (const [key, newMem] of newOpMap) {
      const existing = existingOpMap.get(key);
      if (existing) {
        // Update content + metadata if changed
        await client.query(
          `UPDATE api_memory
           SET title = $1, content = $2, metadata = $3, tags = $4,
               embedding_status = 'pending', updated_at = now()
           WHERE id = $5`,
          [newMem.title, newMem.content, JSON.stringify(newMem.metadata ?? {}), newMem.tags ?? [], existing.id],
        );
        memoriesUpdated++;
      } else {
        // Insert new
        await client.query(
          `INSERT INTO api_memory (
            api_source_id, namespace, memory_kind, operation_key,
            title, content, metadata, tags, embedding_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
          [
            newMem.api_source_id, newMem.namespace, newMem.memory_kind,
            newMem.operation_key, newMem.title, newMem.content,
            JSON.stringify(newMem.metadata ?? {}), newMem.tags ?? [],
          ],
        );
        memoriesCreated++;
      }
    }

    // Delete operations no longer in the spec
    for (const [key, existing] of existingOpMap) {
      if (!newOpMap.has(key)) {
        await client.query('DELETE FROM api_memory WHERE id = $1', [existing.id]);
        memoriesDeleted++;
      }
    }

    // Regenerate tag groups: delete all old, insert new
    await client.query(
      `DELETE FROM api_memory WHERE api_source_id = $1 AND memory_kind = 'tag_group'`,
      [apiSourceId],
    );

    for (const tg of parsed.tagGroups) {
      const text = generateTagGroupText(tg, apiName);
      await client.query(
        `INSERT INTO api_memory (
          api_source_id, namespace, memory_kind, operation_key,
          title, content, metadata, tags, embedding_status
        ) VALUES ($1, $2, 'tag_group', $3, $4, $5, $6, $7, 'pending')`,
        [
          apiSourceId, namespace, resolveTagGroupKey(tg.tag),
          text.title, text.content,
          JSON.stringify({ tag: tg.tag, operation_count: tg.operations.length }),
          [tg.tag],
        ],
      );
    }

    // Regenerate overview: delete old, insert new
    await client.query(
      `DELETE FROM api_memory WHERE api_source_id = $1 AND memory_kind = 'overview'`,
      [apiSourceId],
    );

    const overviewText = generateOverviewText(parsed.overview);
    await client.query(
      `INSERT INTO api_memory (
        api_source_id, namespace, memory_kind, operation_key,
        title, content, metadata, tags, embedding_status
      ) VALUES ($1, $2, 'overview', 'overview', $3, $4, $5, $6, 'pending')`,
      [
        apiSourceId, namespace,
        overviewText.title, overviewText.content,
        JSON.stringify({
          total_operations: parsed.overview.totalOperations,
          tag_groups: parsed.overview.tagGroups,
        }),
        [],
      ],
    );

    // Update api_source metadata (and spec_content if provided)
    if (updatedSpecContent !== undefined) {
      await client.query(
        `UPDATE api_source
         SET spec_hash = $1, spec_version = $2, last_fetched_at = now(),
             servers = $3, spec_content = $4, status = 'active', error_message = NULL,
             updated_at = now()
         WHERE id = $5`,
        [
          newHash,
          parsed.overview.version,
          JSON.stringify(parsed.overview.servers),
          updatedSpecContent,
          apiSourceId,
        ],
      );
    } else {
      await client.query(
        `UPDATE api_source
         SET spec_hash = $1, spec_version = $2, last_fetched_at = now(),
             servers = $3, status = 'active', error_message = NULL,
             updated_at = now()
         WHERE id = $4`,
        [
          newHash,
          parsed.overview.version,
          JSON.stringify(parsed.overview.servers),
          apiSourceId,
        ],
      );
    }

    await client.query('COMMIT');

    // Re-fetch the updated source
    const updatedSource = await getApiSource(pool, apiSourceId, namespace);

    return {
      api_source: updatedSource ?? source,
      memories_created: memoriesCreated,
      memories_updated: memoriesUpdated,
      memories_deleted: memoriesDeleted,
      spec_changed: true,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
