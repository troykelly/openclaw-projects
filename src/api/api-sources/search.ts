/**
 * API memory hybrid search service.
 * Combines semantic (pgvector cosine similarity) and text (tsvector ranking)
 * for searching onboarded API memories.
 * Part of API Onboarding feature (#1782).
 */

import type { Pool } from 'pg';
import type {
  ApiMemorySearchOptions,
  ApiMemorySearchResult,
  ApiMemoryKind,
  ApiCredential,
} from './types.ts';
import { listApiCredentials } from './credential-service.ts';

/** Internal row shape from the database */
interface SearchRow {
  id: string;
  api_source_id: string;
  memory_kind: string;
  operation_key: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  similarity?: number;
  ts_rank?: number;
}

/**
 * Build WHERE conditions for API memory search.
 * Ensures namespace scoping, excludes soft-deleted/disabled sources,
 * and applies optional filters.
 */
function buildSearchConditions(
  opts: ApiMemorySearchOptions,
  startIdx: number,
): { conditions: string[]; params: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = startIdx;

  // Namespace scoping
  conditions.push(`m.namespace = $${idx}`);
  params.push(opts.namespace);
  idx++;

  // Exclude soft-deleted and disabled sources via join
  conditions.push('s.deleted_at IS NULL');
  conditions.push("s.status = 'active'");

  // Optional: filter by api_source_id
  if (opts.api_source_id) {
    conditions.push(`m.api_source_id = $${idx}`);
    params.push(opts.api_source_id);
    idx++;
  }

  // Optional: filter by memory_kind
  if (opts.memory_kind) {
    conditions.push(`m.memory_kind = $${idx}`);
    params.push(opts.memory_kind);
    idx++;
  }

  // Optional: filter by tags (array containment — all requested tags must be present)
  if (opts.tags && opts.tags.length > 0) {
    conditions.push(`m.tags @> $${idx}`);
    params.push(opts.tags);
    idx++;
  }

  return { conditions, params, nextIdx: idx };
}

/**
 * Perform vector (semantic) search against api_memory embeddings.
 */
async function vectorSearch(
  pool: Pool,
  queryEmbedding: number[],
  opts: ApiMemorySearchOptions,
  candidateLimit: number,
): Promise<Map<string, { row: SearchRow; vectorScore: number }>> {
  const { conditions, params, nextIdx } = buildSearchConditions(opts, 2);

  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const allParams = [embeddingStr, ...params, candidateLimit];

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
      m.id::text, m.api_source_id::text, m.memory_kind, m.operation_key,
      m.title, m.content, m.metadata, m.tags,
      1 - (m.embedding <=> $1::vector) as similarity
    FROM api_memory m
    JOIN api_source s ON s.id = m.api_source_id
    WHERE m.embedding IS NOT NULL
      AND ${whereClause}
    ORDER BY similarity DESC
    LIMIT $${nextIdx}`,
    allParams,
  );

  const results = new Map<string, { row: SearchRow; vectorScore: number }>();
  for (const row of result.rows) {
    results.set(row.id as string, {
      row: row as SearchRow,
      vectorScore: Number.parseFloat(String(row.similarity)),
    });
  }

  return results;
}

/**
 * Perform text (tsvector) search against api_memory search_vector.
 */
async function textSearch(
  pool: Pool,
  query: string,
  opts: ApiMemorySearchOptions,
  candidateLimit: number,
): Promise<Map<string, { row: SearchRow; textScore: number }>> {
  const { conditions, params, nextIdx } = buildSearchConditions(opts, 2);

  const allParams = [query, ...params, candidateLimit];
  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
      m.id::text, m.api_source_id::text, m.memory_kind, m.operation_key,
      m.title, m.content, m.metadata, m.tags,
      ts_rank(m.search_vector, websearch_to_tsquery('english', $1)) as ts_rank
    FROM api_memory m
    JOIN api_source s ON s.id = m.api_source_id
    WHERE m.search_vector @@ websearch_to_tsquery('english', $1)
      AND ${whereClause}
    ORDER BY ts_rank DESC
    LIMIT $${nextIdx}`,
    allParams,
  );

  const results = new Map<string, { row: SearchRow; textScore: number }>();
  for (const row of result.rows) {
    results.set(row.id as string, {
      row: row as SearchRow,
      textScore: Number.parseFloat(String(row.ts_rank)),
    });
  }

  return results;
}

/**
 * Convert a SearchRow to an ApiMemorySearchResult with a given score.
 */
function toSearchResult(row: SearchRow, score: number): ApiMemorySearchResult {
  return {
    id: row.id,
    api_source_id: row.api_source_id,
    memory_kind: row.memory_kind as ApiMemoryKind,
    operation_key: row.operation_key,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    tags: row.tags ?? [],
    score,
  };
}

/** Search result with optional attached credentials per source */
export interface ApiMemorySearchResultWithCredentials extends ApiMemorySearchResult {
  credentials?: ApiCredential[];
}

/**
 * Search API memories using hybrid search.
 *
 * 1. Generate query embedding via embedding service
 * 2. Run semantic search (cosine similarity on api_memory.embedding)
 * 3. Run text search (tsvector on api_memory.search_vector)
 * 4. Combine results (configurable weighting, default 50/50)
 * 5. For each unique api_source_id in results, fetch credentials (masked)
 * 6. Attach masked credentials to each result
 * 7. Return ranked results
 */
export async function searchApiMemories(
  pool: Pool,
  opts: ApiMemorySearchOptions,
): Promise<ApiMemorySearchResultWithCredentials[]> {
  const limit = opts.limit ?? 10;
  const semanticWeight = opts.semantic_weight ?? 0.5;
  const keywordWeight = opts.keyword_weight ?? 0.5;
  const candidateLimit = Math.min(limit * 4, 100);

  let vectorResults = new Map<string, { row: SearchRow; vectorScore: number }>();
  let vectorSearchEnabled = false;

  // Try vector search
  try {
    const { embeddingService } = await import('../embeddings/index.ts');

    if (embeddingService.isConfigured()) {
      const embeddingResult = await embeddingService.embed(opts.query);

      if (embeddingResult) {
        vectorSearchEnabled = true;
        vectorResults = await vectorSearch(pool, embeddingResult.embedding, opts, candidateLimit);
      }
    }
  } catch {
    // Vector search not available — fall back to text-only
  }

  // If vector search is not available, use text-only
  if (!vectorSearchEnabled) {
    const textResults = await textSearch(pool, opts.query, opts, limit);

    let maxTextScore = 0;
    for (const { textScore } of textResults.values()) {
      maxTextScore = Math.max(maxTextScore, textScore);
    }

    const results: ApiMemorySearchResultWithCredentials[] = [];
    for (const { row, textScore } of textResults.values()) {
      const normalizedScore = maxTextScore > 0 ? textScore / maxTextScore : 0;
      results.push(toSearchResult(row, normalizedScore));
    }

    results.sort((a, b) => b.score - a.score);
    const sliced = results.slice(0, limit);

    return attachCredentials(pool, sliced);
  }

  // Perform text search
  const textResults = await textSearch(pool, opts.query, opts, candidateLimit);

  // Normalize text scores
  let maxTextScore = 0;
  for (const { textScore } of textResults.values()) {
    maxTextScore = Math.max(maxTextScore, textScore);
  }

  // Combine results with configurable weights
  const combinedMap = new Map<string, ApiMemorySearchResultWithCredentials>();

  // Add vector results
  for (const [id, { row, vectorScore }] of vectorResults) {
    const textResult = textResults.get(id);
    const rawTextScore = textResult?.textScore ?? 0;
    const normalizedTextScore = maxTextScore > 0 ? rawTextScore / maxTextScore : 0;
    const combined = vectorScore * semanticWeight + normalizedTextScore * keywordWeight;

    combinedMap.set(id, toSearchResult(row, combined));
  }

  // Add text-only results (not in vector results)
  for (const [id, { row, textScore }] of textResults) {
    if (!combinedMap.has(id)) {
      const normalizedTextScore = maxTextScore > 0 ? textScore / maxTextScore : 0;
      const combined = normalizedTextScore * keywordWeight;

      combinedMap.set(id, toSearchResult(row, combined));
    }
  }

  // Sort and limit
  const results = Array.from(combinedMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return attachCredentials(pool, results);
}

/**
 * Attach masked credentials to search results, grouped by api_source_id.
 * Credentials are always masked in search results — agents must use the
 * credential endpoint with decrypt=true (write scope) for plaintext access.
 */
async function attachCredentials(
  pool: Pool,
  results: ApiMemorySearchResultWithCredentials[],
): Promise<ApiMemorySearchResultWithCredentials[]> {
  if (results.length === 0) return results;

  // Collect unique api_source_ids
  const sourceIds = new Set<string>();
  for (const r of results) {
    sourceIds.add(r.api_source_id);
  }

  // Fetch credentials for each source in parallel
  const credMap = new Map<string, ApiCredential[]>();
  await Promise.all(
    Array.from(sourceIds).map(async (sourceId) => {
      const creds = await listApiCredentials(pool, sourceId, false);
      credMap.set(sourceId, creds);
    }),
  );

  // Attach credentials
  for (const r of results) {
    const creds = credMap.get(r.api_source_id);
    if (creds && creds.length > 0) {
      r.credentials = creds;
    }
  }

  return results;
}

/**
 * List all memories for a specific API source.
 */
export async function listApiMemories(
  pool: Pool,
  apiSourceId: string,
  namespace: string,
  options: { memory_kind?: ApiMemoryKind; limit?: number; offset?: number } = {},
): Promise<ApiMemorySearchResult[]> {
  const limit = Math.min(options.limit ?? 50, 500);
  const offset = options.offset ?? 0;

  const conditions: string[] = [
    'm.api_source_id = $1',
    'm.namespace = $2',
    's.deleted_at IS NULL',
  ];
  const params: unknown[] = [apiSourceId, namespace];
  let paramIdx = 3;

  if (options.memory_kind) {
    conditions.push(`m.memory_kind = $${paramIdx}`);
    params.push(options.memory_kind);
    paramIdx++;
  }

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
      m.id::text, m.api_source_id::text, m.memory_kind, m.operation_key,
      m.title, m.content, m.metadata, m.tags
    FROM api_memory m
    JOIN api_source s ON s.id = m.api_source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    params,
  );

  return result.rows.map((row) =>
    toSearchResult(row as SearchRow, 0),
  );
}
