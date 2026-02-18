/**
 * Hybrid search combining BM25 (text) and vector similarity search.
 * Part of Epic #310, Issue #322.
 *
 * Addresses the weakness of pure vector search on "exact, high-signal tokens"
 * (IDs, error strings, specific names) while leveraging its strength on paraphrases.
 *
 * Default weights:
 * - Vector: 0.7 (semantic meaning)
 * - Text: 0.3 (exact tokens)
 */

import type { Pool } from 'pg';
import type { MemoryEntry, MemoryType } from '../memory/types.ts';

/** Options for hybrid search */
export interface HybridSearchOptions {
  /** @deprecated user_email column dropped from memory table in Phase 4 (Epic #1418) */
  user_email?: string;
  /** Work item ID to filter by */
  work_item_id?: string;
  /** Contact ID to filter by */
  contact_id?: string;
  /** Memory type to filter by */
  memory_type?: MemoryType;
  /** Maximum results to return (default: 10) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
  /** Minimum combined score threshold (0-1, default: 0.3) */
  min_score?: number;
  /** Weight for vector (semantic) search (default: 0.7) */
  vector_weight?: number;
  /** Weight for text (BM25) search (default: 0.3) */
  text_weight?: number;
}

/** A memory with search scores */
export interface HybridSearchMemory extends MemoryEntry {
  /** Vector similarity score (0-1) */
  vector_score?: number;
  /** Text search score (normalized 0-1) */
  text_score?: number;
  /** Combined weighted score */
  combined_score: number;
}

/** Result of hybrid search */
export interface HybridSearchResult {
  /** Matched memories with scores */
  results: HybridSearchMemory[];
  /** Type of search performed */
  search_type: 'hybrid' | 'vector' | 'text';
  /** Weights used for scoring */
  weights: {
    vector_weight: number;
    text_weight: number;
  };
  /** Embedding provider if vector search was used */
  query_embedding_provider?: string;
}

/**
 * Normalize a score to 0-1 range.
 *
 * @param score - Raw score value
 * @param min - Minimum expected value
 * @param max - Maximum expected value
 * @returns Normalized score (0-1)
 */
export function normalizeScore(score: number | null | undefined, min: number, max: number): number {
  if (score === null || score === undefined) return 0;

  if (max === min) return 1; // Avoid division by zero

  const normalized = (score - min) / (max - min);
  return Math.max(0, Math.min(1, normalized)); // Clamp to 0-1
}

/**
 * Combine vector and text scores using weighted average.
 *
 * @param vectorScore - Normalized vector similarity score (0-1)
 * @param text_score - Normalized text search score (0-1)
 * @param vectorWeight - Weight for vector score (default 0.7)
 * @param textWeight - Weight for text score (default 0.3)
 * @returns Combined score
 */
export function combineScores(vectorScore: number, text_score: number, vectorWeight: number = 0.7, textWeight: number = 0.3): number {
  return vectorScore * vectorWeight + text_score * textWeight;
}

/**
 * Maps a database row to a MemoryEntry.
 */
function mapRowToMemory(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    work_item_id: row.work_item_id as string | null,
    contact_id: row.contact_id as string | null,
    relationship_id: row.relationship_id as string | null,
    project_id: row.project_id as string | null,
    title: row.title as string,
    content: row.content as string,
    memory_type: row.memory_type as MemoryType,
    tags: (row.tags as string[]) ?? [],
    created_by_agent: row.created_by_agent as string | null,
    created_by_human: (row.created_by_human as boolean) ?? false,
    source_url: row.source_url as string | null,
    importance: row.importance as number,
    confidence: row.confidence as number,
    expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
    superseded_by: row.superseded_by as string | null,
    embedding_status: row.embedding_status as 'pending' | 'complete' | 'failed',
    lat: (row.lat as number) ?? null,
    lng: (row.lng as number) ?? null,
    address: (row.address as string) ?? null,
    place_label: (row.place_label as string) ?? null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * Build filter conditions for search queries.
 */
function buildFilterConditions(options: HybridSearchOptions, startIdx: number): { conditions: string[]; params: unknown[]; nextIdx: number } {
  const conditions: string[] = ['(expires_at IS NULL OR expires_at > NOW())', 'superseded_by IS NULL'];
  const params: unknown[] = [];
  let idx = startIdx;

  // Epic #1418 Phase 4: user_email column dropped from memory table.
  // Namespace scoping is handled at the route level.
  if (options.work_item_id !== undefined) {
    conditions.push(`work_item_id = $${idx}`);
    params.push(options.work_item_id);
    idx++;
  }
  if (options.contact_id !== undefined) {
    conditions.push(`contact_id = $${idx}`);
    params.push(options.contact_id);
    idx++;
  }
  if (options.memory_type !== undefined) {
    conditions.push(`memory_type = $${idx}::memory_type`);
    params.push(options.memory_type);
    idx++;
  }

  return { conditions, params, nextIdx: idx };
}

/**
 * Perform vector search for memories.
 */
async function vectorSearch(
  pool: Pool,
  queryEmbedding: number[],
  options: HybridSearchOptions,
  candidateLimit: number,
): Promise<Map<string, { memory: MemoryEntry; vectorScore: number }>> {
  const { conditions, params, nextIdx } = buildFilterConditions(options, 2);

  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const allParams = [embeddingStr, ...params, candidateLimit];

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
      id::text, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at,
      1 - (embedding <=> $1::vector) as similarity
    FROM memory
    WHERE embedding IS NOT NULL
      ${whereClause}
    ORDER BY similarity DESC
    LIMIT $${nextIdx}`,
    allParams,
  );

  const results = new Map<string, { memory: MemoryEntry; vectorScore: number }>();

  for (const row of result.rows) {
    const memory = mapRowToMemory(row as Record<string, unknown>);
    results.set(memory.id, {
      memory,
      vectorScore: Number.parseFloat(row.similarity as string),
    });
  }

  return results;
}

/**
 * Perform text search for memories using PostgreSQL full-text search.
 */
async function textSearch(
  pool: Pool,
  query: string,
  options: HybridSearchOptions,
  candidateLimit: number,
): Promise<Map<string, { memory: MemoryEntry; text_score: number }>> {
  const { conditions, params, nextIdx } = buildFilterConditions(options, 2);

  const allParams = [query, ...params, candidateLimit];

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
      id::text, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at,
      ts_rank(search_vector, websearch_to_tsquery('english', $1)) as ts_rank
    FROM memory
    WHERE search_vector @@ websearch_to_tsquery('english', $1)
      ${whereClause}
    ORDER BY ts_rank DESC
    LIMIT $${nextIdx}`,
    allParams,
  );

  const results = new Map<string, { memory: MemoryEntry; text_score: number }>();

  for (const row of result.rows) {
    const memory = mapRowToMemory(row as Record<string, unknown>);
    results.set(memory.id, {
      memory,
      text_score: Number.parseFloat(row.ts_rank as string),
    });
  }

  return results;
}

/**
 * Search memories using hybrid search (combining vector and text).
 *
 * This function:
 * 1. Performs vector (semantic) search to find semantically similar memories
 * 2. Performs text (BM25) search to find keyword-matching memories
 * 3. Combines results with configurable weights (default 0.7 vector, 0.3 text)
 * 4. Returns deduplicated, sorted results
 *
 * @param pool - Database connection pool
 * @param query - Search query
 * @param options - Search options including weights
 * @returns Hybrid search results
 */
export async function searchMemoriesHybrid(pool: Pool, query: string, options: HybridSearchOptions = {}): Promise<HybridSearchResult> {
  const { limit = 10, min_score = 0.3, vector_weight = 0.7, text_weight = 0.3 } = options;

  // Get more candidates than needed to allow for deduplication and filtering
  const candidateLimit = Math.min(limit * 4, 100);

  let vectorResults: Map<string, { memory: MemoryEntry; vectorScore: number }> = new Map();
  let query_embedding_provider: string | undefined;
  let vectorSearchEnabled = false;

  // Try vector search
  try {
    const { embeddingService } = await import('../embeddings/index.ts');

    if (embeddingService.isConfigured()) {
      const embeddingResult = await embeddingService.embed(query);

      if (embeddingResult) {
        vectorSearchEnabled = true;
        query_embedding_provider = embeddingResult.provider;
        vectorResults = await vectorSearch(pool, embeddingResult.embedding, options, candidateLimit);
      }
    }
  } catch (error) {
    console.warn('[Hybrid Search] Vector search failed:', error);
  }

  // If vector search is not available, fall back to text-only
  if (!vectorSearchEnabled) {
    const textResults = await textSearch(pool, query, options, limit);

    // Find max ts_rank for normalization
    let maxTextScore = 0;
    for (const { text_score } of textResults.values()) {
      maxTextScore = Math.max(maxTextScore, text_score);
    }

    const results: HybridSearchMemory[] = [];
    for (const { memory, text_score } of textResults.values()) {
      const normalizedTextScore = maxTextScore > 0 ? text_score / maxTextScore : 0;
      results.push({
        ...memory,
        text_score: normalizedTextScore,
        combined_score: normalizedTextScore, // Only text score available
      });
    }

    results.sort((a, b) => b.combined_score - a.combined_score);

    return {
      results: results.slice(0, limit),
      search_type: 'text',
      weights: { vector_weight, text_weight },
    };
  }

  // Perform text search
  const textResults = await textSearch(pool, query, options, candidateLimit);

  // Find max ts_rank for normalization (ts_rank is not normalized like cosine similarity)
  let maxTextScore = 0;
  for (const { text_score } of textResults.values()) {
    maxTextScore = Math.max(maxTextScore, text_score);
  }

  // Combine results
  const combinedMap = new Map<string, HybridSearchMemory>();

  // Add vector results
  for (const [id, { memory, vectorScore }] of vectorResults) {
    const textResult = textResults.get(id);
    const rawTextScore = textResult?.text_score ?? 0;
    const normalizedTextScore = maxTextScore > 0 ? rawTextScore / maxTextScore : 0;

    combinedMap.set(id, {
      ...memory,
      vector_score: vectorScore,
      text_score: normalizedTextScore,
      combined_score: combineScores(vectorScore, normalizedTextScore, vector_weight, text_weight),
    });
  }

  // Add text-only results (not in vector results)
  for (const [id, { memory, text_score }] of textResults) {
    if (!combinedMap.has(id)) {
      const normalizedTextScore = maxTextScore > 0 ? text_score / maxTextScore : 0;

      combinedMap.set(id, {
        ...memory,
        vector_score: 0,
        text_score: normalizedTextScore,
        combined_score: combineScores(0, normalizedTextScore, vector_weight, text_weight),
      });
    }
  }

  // Convert to array, filter, and sort
  const results = Array.from(combinedMap.values())
    .filter((m) => m.combined_score >= min_score)
    .sort((a, b) => b.combined_score - a.combined_score)
    .slice(0, limit);

  return {
    results,
    search_type: 'hybrid',
    weights: { vector_weight, text_weight },
    query_embedding_provider: query_embedding_provider,
  };
}
