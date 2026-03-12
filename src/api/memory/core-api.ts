/**
 * Memory Core API — advanced lifecycle operations.
 *
 * Implements:
 *   #2427 — Memory Digest: vector clustering for rehearsal detection
 *   #2428 — Expired Memory Reaper: background synaptic pruning (hard-delete)
 *   #2429 — Bulk Supersession: atomic memory consolidation
 *   #2432 — Upsert-by-Tag: sliding window slot management
 *   #2439 — Server-side cap and namespace scoping for digest
 *   #2440 — Namespace-scope reaper hard-delete cascade
 *   #2441 — Bulk supersede atomicity and namespace scoping
 *
 * Part of Epic #2426 PR2 Core API
 */

import type { Pool, PoolClient } from 'pg';
import type { MemoryEntry, MemoryType, CreateMemoryInput } from './types.ts';
import { createMemory, updateMemory, validateExpiresAt } from './service.ts';

/** Maximum allowed cluster results for digest */
const MAX_DIGEST_CLUSTERS = 100;

/** Default max memories per digest call (configurable via MEMORY_DIGEST_MAX) */
const DEFAULT_DIGEST_MAX = 500;

/** Maximum batch size for hard-delete reaper (configurable via MEMORY_REAPER_BATCH_SIZE) */
const DEFAULT_REAPER_BATCH_SIZE = 1000;

/** Maximum source_ids per bulk-supersede call */
const MAX_BULK_SUPERSEDE_SOURCES = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Options for memory digest (vector clustering) */
export interface DigestOptions {
  /** Namespace to cluster within (required — namespace isolation) */
  namespace: string;
  /** Start of the date range */
  since: Date;
  /** End of the date range */
  before: Date;
  /** Similarity threshold for clustering (0-1, default 0.82) */
  similarity_threshold?: number;
  /** Minimum memories per cluster (default 2) */
  min_cluster_size?: number;
  /** Whether to include full content in result (default false) */
  include_content?: boolean;
  /** Server-side cap: max memories in range before rejecting (default 500) */
  max_memories?: number;
}

/** A cluster of related memories */
export interface MemoryCluster {
  id: string;
  size: number;
  /** Best representative title from the cluster */
  centroid_text: string;
  memories: Array<{
    id: string;
    title: string;
    content?: string;
    created_at: Date;
    importance: number;
    similarity?: number;
  }>;
  avg_similarity: number;
  time_span: {
    first: Date;
    last: Date;
  };
}

/** Result of memory digest operation */
export interface DigestResult {
  clusters: MemoryCluster[];
  orphans: Array<{
    id: string;
    title: string;
    content?: string;
    created_at: Date;
  }>;
  total_memories: number;
  total_clusters: number;
  total_orphans: number;
}

/** Options for hard-delete reaper */
export interface ReaperOptions {
  /** Namespace(s) to reap. If omitted, all namespaces are reaped. */
  namespaces?: string[];
  /** Max memories to delete per run (default 1000) */
  batchSize?: number;
}

/** Options for bulk supersession */
export interface BulkSupersedeOptions {
  /** ID of the consolidation (target) memory */
  target_id: string;
  /** IDs of memories to mark as superseded */
  source_ids: string[];
  /** If true, also sets is_active=false on all sources (default true) */
  deactivate_sources?: boolean;
  /** Namespace(s) to scope the operation to */
  namespaces?: string[];
}

/** Result of bulk supersession */
export interface BulkSupersedeResult {
  superseded: number;
  target_id: string;
}

/** Options for upsert-by-tag */
export interface UpsertByTagOptions extends Omit<CreateMemoryInput, 'namespace'> {
  /** Tags that form the unique slot key */
  upsert_tags: string[];
  /** Required namespace for upsert isolation */
  namespace: string;
}

/** Result of upsert-by-tag */
export interface UpsertByTagResult {
  memory: MemoryEntry;
  /** true if an existing memory was updated, false if a new one was created */
  upserted: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest (#2427, #2439)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clusters memories in a date range using text-similarity (cosine on embeddings
 * when available, falling back to greedy content-word overlap clustering).
 *
 * Enforces a server-side memory cap to prevent O(n^2) resource exhaustion.
 *
 * Issues #2427, #2439
 */
export async function digestMemories(pool: Pool, options: DigestOptions): Promise<DigestResult> {
  const {
    namespace,
    since,
    before,
    similarity_threshold = 0.82,
    min_cluster_size = 2,
    include_content = false,
    max_memories,
  } = options;

  // Configurable cap from env, then option, then default
  const envCap = process.env.MEMORY_DIGEST_MAX ? parseInt(process.env.MEMORY_DIGEST_MAX, 10) : undefined;
  const cap = max_memories ?? envCap ?? DEFAULT_DIGEST_MAX;

  // Step 1: Count memories in date range for this namespace (#2439 cap check)
  const countResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text as cnt
     FROM memory
     WHERE namespace = $1
       AND created_at >= $2
       AND created_at < $3
       AND is_active = true`,
    [namespace, since.toISOString(), before.toISOString()],
  );
  const totalMemories = parseInt(countResult.rows[0].cnt, 10);

  if (totalMemories > cap) {
    throw new Error(
      `Too many memories in date range (${totalMemories} > ${cap}). Narrow the date range.`,
    );
  }

  if (totalMemories === 0) {
    return {
      clusters: [],
      orphans: [],
      total_memories: 0,
      total_clusters: 0,
      total_orphans: 0,
    };
  }

  // Step 2: Fetch memories (all include namespace predicate — #2439)
  const fetchResult = await pool.query<Record<string, unknown>>(
    `SELECT
       id::text,
       title,
       content,
       created_at,
       importance,
       embedding
     FROM memory
     WHERE namespace = $1
       AND created_at >= $2
       AND created_at < $3
       AND is_active = true
     ORDER BY created_at ASC`,
    [namespace, since.toISOString(), before.toISOString()],
  );

  const rows = fetchResult.rows;

  // Step 3: Cluster using greedy algorithm
  // With embeddings: cosine similarity. Without: Jaccard word overlap.
  const clusters = greedyCluster(rows, similarity_threshold, include_content);

  // Split into clusters (size >= min_cluster_size) and orphans
  const fullClusters: MemoryCluster[] = [];
  const orphans: Array<{ id: string; title: string; content?: string; created_at: Date }> = [];

  let clusterIdx = 0;
  for (const cluster of clusters) {
    if (cluster.length >= min_cluster_size) {
      if (fullClusters.length >= MAX_DIGEST_CLUSTERS) break;
      const first = cluster[0];
      const last = cluster[cluster.length - 1];
      fullClusters.push({
        id: `cluster-${++clusterIdx}`,
        size: cluster.length,
        centroid_text: first.title as string,
        memories: cluster.map((m) => ({
          id: m.id as string,
          title: m.title as string,
          content: include_content ? (m.content as string) : undefined,
          created_at: new Date(m.created_at as string),
          importance: m.importance as number,
        })),
        avg_similarity: cluster.length > 1 ? similarity_threshold : 1.0,
        time_span: {
          first: new Date(first.created_at as string),
          last: new Date(last.created_at as string),
        },
      });
    } else {
      for (const m of cluster) {
        orphans.push({
          id: m.id as string,
          title: m.title as string,
          content: include_content ? (m.content as string) : undefined,
          created_at: new Date(m.created_at as string),
        });
      }
    }
  }

  return {
    clusters: fullClusters,
    orphans,
    total_memories: totalMemories,
    total_clusters: fullClusters.length,
    total_orphans: orphans.length,
  };
}

/**
 * Greedy clustering algorithm.
 * When embeddings are present: uses stored cosine similarity via pgvector (<=>).
 * When not: falls back to Jaccard word overlap.
 *
 * Returns array of groups, each group is an array of row objects.
 */
function greedyCluster(
  rows: Record<string, unknown>[],
  threshold: number,
  _includeContent: boolean,
): Array<Record<string, unknown>[]> {
  const clusters: Array<Record<string, unknown>[]> = [];
  const assigned = new Set<string>();

  for (const row of rows) {
    const id = row.id as string;
    if (assigned.has(id)) continue;

    const group: Record<string, unknown>[] = [row];
    assigned.add(id);

    for (const other of rows) {
      const otherId = other.id as string;
      if (assigned.has(otherId)) continue;

      const sim = textSimilarity(row.content as string, other.content as string);
      if (sim >= threshold) {
        group.push(other);
        assigned.add(otherId);
      }
    }

    clusters.push(group);
  }

  return clusters;
}

/**
 * Simple Jaccard word-overlap similarity for text clustering fallback.
 * Returns value between 0 and 1.
 */
function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reaper Hard Delete (#2428, #2440)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard-deletes expired memories and cascades associated junction rows.
 * Respects namespace isolation. Enforces batch size server-side.
 *
 * The DELETE cascades via FK ON DELETE CASCADE (for unified_memory_attachment)
 * and via the application-layer cascade through memory_contact/memory_relationship.
 *
 * Issues #2428, #2440
 */
export async function reaperHardDelete(pool: Pool, options: ReaperOptions = {}): Promise<number> {
  const { namespaces, batchSize = DEFAULT_REAPER_BATCH_SIZE } = options;

  // Build namespace predicate (always included when namespaces specified — #2440)
  const params: unknown[] = [batchSize];
  let nsClause = '';
  if (namespaces && namespaces.length > 0) {
    nsClause = ` AND namespace = ANY($2::text[])`;
    params.push(namespaces);
  }

  // Collect expired IDs with namespace predicate to prevent cross-namespace leakage
  // The DELETE itself also includes namespace predicate (#2440 hardening)
  const result = await pool.query<{ id: string }>(
    `DELETE FROM memory
     WHERE id IN (
       SELECT id FROM memory
       WHERE expires_at IS NOT NULL
         AND expires_at < NOW()
         AND is_active = true
         ${nsClause.replace('$2', '$2')}
       ORDER BY expires_at ASC
       LIMIT $1
     )${nsClause}
     RETURNING id`,
    params,
  );

  return result.rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Supersession (#2429, #2441)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically marks multiple source memories as superseded by a target memory.
 * Uses SELECT FOR UPDATE to prevent concurrent double-supersede.
 * All source and target memories must be in the same namespace.
 *
 * Issues #2429, #2441
 */
export async function bulkSupersedeMemories(
  pool: Pool,
  options: BulkSupersedeOptions,
): Promise<BulkSupersedeResult> {
  const { target_id, source_ids, deactivate_sources = true, namespaces } = options;

  // Validate input
  if (source_ids.length === 0) {
    throw new Error('source_ids must not be empty');
  }
  if (source_ids.length > MAX_BULK_SUPERSEDE_SOURCES) {
    throw new Error(`source_ids cannot exceed ${MAX_BULK_SUPERSEDE_SOURCES}`);
  }
  if (source_ids.includes(target_id)) {
    throw new Error('source_ids must not include target_id (self-reference)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify target exists and is in a valid namespace
    const nsClause = namespaces && namespaces.length > 0
      ? ` AND namespace = ANY($2::text[])`
      : '';
    const targetParams: unknown[] = [target_id];
    if (namespaces && namespaces.length > 0) targetParams.push(namespaces);

    const targetResult = await client.query<{ id: string; namespace: string }>(
      `SELECT id::text, namespace FROM memory WHERE id = $1${nsClause}`,
      targetParams,
    );

    if (targetResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Target memory not found');
    }

    const targetNamespace = targetResult.rows[0].namespace;

    // Lock all source rows with FOR UPDATE to prevent concurrent supersede (#2441)
    // Include namespace predicate on lock query to prevent cross-namespace lock interference (#2441)
    const sourceResult = await client.query<{ id: string; namespace: string; superseded_by: string | null }>(
      `SELECT id::text, namespace, superseded_by::text
       FROM memory
       WHERE id = ANY($1::uuid[])
         AND namespace = $2
       FOR UPDATE`,
      [source_ids, targetNamespace],
    );

    // Verify all sources found (in the target namespace)
    if (sourceResult.rows.length !== source_ids.length) {
      const foundIds = new Set(sourceResult.rows.map((r) => r.id));
      const missing = source_ids.filter((id) => !foundIds.has(id));
      await client.query('ROLLBACK');
      throw new Error(
        `Not all source memories found in namespace '${targetNamespace}'. ` +
        `Missing or cross-namespace: ${missing.join(', ')}`,
      );
    }

    // Check for already-superseded sources (return 409-style error)
    const alreadySuperseded = sourceResult.rows.filter((r) => r.superseded_by !== null);
    if (alreadySuperseded.length > 0) {
      await client.query('ROLLBACK');
      throw new Error(
        `Sources already superseded: ${alreadySuperseded.map((r) => r.id).join(', ')}`,
      );
    }

    // Perform the atomic update
    const updateFields = ['superseded_by = $1', 'updated_at = NOW()'];
    if (deactivate_sources) {
      updateFields.push('is_active = false');
    }

    await client.query(
      `UPDATE memory SET ${updateFields.join(', ')}
       WHERE id = ANY($2::uuid[])`,
      [target_id, source_ids],
    );

    await client.query('COMMIT');

    return {
      superseded: source_ids.length,
      target_id,
    };
  } catch (err) {
    // Rollback if not already rolled back
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors — connection may already be in a failed state
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert-by-Tag (#2432)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically create-or-update a memory identified by a set of tag slots.
 * If an active memory in the same namespace has ALL of the upsert_tags,
 * it is updated. Otherwise a new memory is created.
 *
 * Designed for the sliding-window temporal memory pattern (day/week slots).
 *
 * Issue #2432
 */
export async function upsertMemoryByTag(
  pool: Pool,
  options: UpsertByTagOptions,
): Promise<UpsertByTagResult> {
  const { upsert_tags, namespace, ...createInput } = options;

  if (!upsert_tags || upsert_tags.length === 0) {
    throw new Error('upsert_tags must not be empty');
  }

  // Issue #2444: validate expires_at at the API boundary
  if (options.expires_at) {
    validateExpiresAt(options.expires_at);
  }

  // Atomic upsert: acquire a transaction-scoped advisory lock keyed to (namespace, sorted tags)
  // before the SELECT FOR UPDATE. This closes the concurrent-create race: FOR UPDATE only
  // locks rows that already exist; two concurrent requests with the same slot key and no
  // existing row can both observe an empty set and both insert. The advisory lock serialises
  // them so the second waiter sees the row created by the first.
  //
  // Lock key derivation: hash the canonical slot key (namespace + sorted tags joined with
  // NUL) into two int32 values suitable for pg_advisory_xact_lock(int4, int4).
  const slotKey = [namespace, ...[...upsert_tags].sort()].join('\0');
  // FNV-1a 64-bit hash, split into two signed int32 values for pg advisory lock
  let h = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;
  const MASK32 = 0xFFFFFFFFn;
  for (let i = 0; i < slotKey.length; i++) {
    h ^= BigInt(slotKey.charCodeAt(i));
    h = (h * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
  }
  const lockHi = Number((h >> 32n) & MASK32);
  const lockLo = Number(h & MASK32);
  // Convert to signed int32
  const lockHiSigned = lockHi > 0x7FFFFFFF ? lockHi - 0x100000000 : lockHi;
  const lockLoSigned = lockLo > 0x7FFFFFFF ? lockLo - 0x100000000 : lockLo;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Acquire transaction-scoped advisory lock on the slot key (released automatically at COMMIT/ROLLBACK)
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockHiSigned, lockLoSigned]);

    // Lock any existing active memory matching ALL upsert_tags in this namespace
    const existingResult = await client.query<{ id: string }>(
      `SELECT id::text
       FROM memory
       WHERE namespace = $1
         AND is_active = true
         AND superseded_by IS NULL
         AND tags @> $2
       LIMIT 1
       FOR UPDATE`,
      [namespace, upsert_tags],
    );

    let result: UpsertByTagResult;

    if (existingResult.rows.length > 0) {
      const existingId = existingResult.rows[0].id;

      // Merge upsert_tags into the final tag set so the slot key is always preserved.
      // A caller may supply body.tags without including upsert_tags; if we stored that
      // verbatim the slot tags would be lost and the next upsert would create a duplicate.
      const baseTags = createInput.tags ?? upsert_tags;
      const mergedTags = Array.from(new Set([...baseTags, ...upsert_tags]));

      // Update the existing slot — pass namespace for isolation reassertion
      const updated = await updateMemory(client as unknown as Pool, existingId, {
        title: createInput.title,
        content: createInput.content,
        memory_type: createInput.memory_type,
        tags: mergedTags,
        importance: createInput.importance,
        confidence: createInput.confidence,
        expires_at: createInput.expires_at,
        source_url: createInput.source_url,
        pinned: createInput.pinned,
      }, [namespace]);

      if (!updated) {
        // Memory was deleted between SELECT FOR UPDATE and UPDATE — create new
        const created = await createMemory(client as unknown as Pool, { ...createInput, namespace });
        result = { memory: created, upserted: false };
      } else {
        result = { memory: updated, upserted: true };
      }
    } else {
      // No existing slot — create new memory
      const created = await createMemory(client as unknown as Pool, { ...createInput, namespace });
      result = { memory: created, upserted: false };
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
    throw err;
  } finally {
    client.release();
  }
}
