/**
 * Skill Store search service.
 *
 * Provides full-text search (tsvector), semantic search (vector similarity),
 * and hybrid search (Reciprocal Rank Fusion) for skill_store_item records.
 *
 * Part of Epic #794, Issue #798.
 */

import type { Pool } from 'pg';
import { embeddingService } from '../embeddings/service.ts';
import { EmbeddingError } from '../embeddings/errors.ts';

/**
 * Escape ILIKE wildcard characters (% and _) in user input.
 * Prevents users from injecting wildcards that match unintended patterns.
 */
function escapeIlikeWildcards(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Shape of a search result item. */
export interface SkillStoreSearchResult {
  id: string;
  skill_id: string;
  collection: string;
  key: string | null;
  title: string | null;
  summary: string | null;
  content: string | null;
  data: Record<string, unknown>;
  tags: string[];
  status: string;
  priority: number;
  user_email: string | null;
  created_at: string;
  updated_at: string;
}

/** Full-text search result with relevance score. */
export interface FullTextSearchResult extends SkillStoreSearchResult {
  relevance: number;
}

/** Semantic search result with similarity score. */
export interface SemanticSearchResult extends SkillStoreSearchResult {
  similarity: number;
}

/** Hybrid search result with combined score. */
export interface HybridSearchResult extends SkillStoreSearchResult {
  score: number;
  fulltext_rank: number | null;
  semantic_rank: number | null;
}

/** Common search parameters. */
export interface SkillStoreSearchParams {
  skill_id: string;
  query: string;
  collection?: string;
  tags?: string[];
  status?: string;
  user_email?: string;
  limit?: number;
  offset?: number;
}

/** Semantic search-specific parameters. */
export interface SemanticSearchParams extends SkillStoreSearchParams {
  min_similarity?: number;
}

/** Hybrid search-specific parameters. */
export interface HybridSearchParams extends SkillStoreSearchParams {
  semantic_weight?: number;
  min_similarity?: number;
}

/** Full-text search response. */
export interface FullTextSearchResponse {
  results: FullTextSearchResult[];
  total: number;
}

/** Semantic search response. */
export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  searchType: 'semantic' | 'text';
  queryEmbeddingProvider?: string;
}

/** Hybrid search response. */
export interface HybridSearchResponse {
  results: HybridSearchResult[];
  searchType: 'hybrid' | 'text';
  semantic_weight: number;
}

/**
 * Validate required search parameters.
 */
function validateSearchParams(params: SkillStoreSearchParams): void {
  if (!params.skill_id || params.skill_id.trim().length === 0) {
    throw new Error('skill_id is required');
  }
  if (!params.query || params.query.trim().length === 0) {
    throw new Error('query is required');
  }
}

/**
 * Build WHERE conditions and params for common filters.
 * Always includes: skill_id filter and soft-delete exclusion.
 */
function buildFilterConditions(
  params: SkillStoreSearchParams,
  tableAlias: string = 's',
): { conditions: string[]; values: (string | string[] | number)[]; paramIndex: number } {
  const conditions: string[] = [`${tableAlias}.skill_id = $1`, `${tableAlias}.deleted_at IS NULL`];
  const values: (string | string[] | number)[] = [params.skill_id];
  let paramIndex = 2;

  if (params.collection) {
    conditions.push(`${tableAlias}.collection = $${paramIndex}`);
    values.push(params.collection);
    paramIndex++;
  }

  if (params.tags && params.tags.length > 0) {
    conditions.push(`${tableAlias}.tags @> $${paramIndex}`);
    values.push(params.tags);
    paramIndex++;
  }

  if (params.status) {
    conditions.push(`${tableAlias}.status::text = $${paramIndex}`);
    values.push(params.status);
    paramIndex++;
  }

  if (params.user_email) {
    conditions.push(`${tableAlias}.user_email = $${paramIndex}`);
    values.push(params.user_email);
    paramIndex++;
  }

  return { conditions, values, paramIndex };
}

/** Columns selected for search results. */
const RESULT_COLUMNS = `
  s.id::text as id,
  s.skill_id,
  s.collection,
  s.key,
  s.title,
  s.summary,
  s.content,
  s.data,
  s.tags,
  s.status::text as status,
  s.priority,
  s.user_email,
  s.created_at,
  s.updated_at
`;

/**
 * Full-text search using tsvector.
 *
 * Uses PostgreSQL ts_rank for relevance scoring against the pre-built
 * search_vector column (title:A, summary:B, content:C weights).
 */
export async function searchSkillStoreFullText(pool: Pool, params: SkillStoreSearchParams): Promise<FullTextSearchResponse> {
  validateSearchParams(params);

  const { limit = 20, offset = 0 } = params;
  const { conditions, values, paramIndex } = buildFilterConditions(params);

  // Add full-text search condition using plainto_tsquery
  values.push(params.query);
  const queryParamIndex = paramIndex;
  let nextParam = paramIndex + 1;

  conditions.push(`s.search_vector @@ plainto_tsquery('english', $${queryParamIndex})`);

  values.push(limit);
  const limitParamIndex = nextParam++;
  values.push(offset);
  const offsetParamIndex = nextParam++;

  const whereClause = conditions.join(' AND ');

  // Count query (without limit/offset)
  const countResult = await pool.query(
    `SELECT COUNT(*) as total
     FROM skill_store_item s
     WHERE ${whereClause}`,
    values.slice(0, queryParamIndex), // Only base filter + search params
  );

  const total = parseInt(countResult.rows[0].total, 10);

  // Main query with ranking
  const result = await pool.query(
    `SELECT
       ${RESULT_COLUMNS},
       ts_rank(s.search_vector, plainto_tsquery('english', $${queryParamIndex})) as relevance
     FROM skill_store_item s
     WHERE ${whereClause}
     ORDER BY relevance DESC, s.updated_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    values,
  );

  return {
    results: result.rows.map((row) => ({
      ...row,
      relevance: parseFloat(row.relevance),
    })) as FullTextSearchResult[],
    total,
  };
}

/**
 * Semantic search using vector similarity.
 *
 * If embedding fails for the query, falls back to text search.
 */
export async function searchSkillStoreSemantic(pool: Pool, params: SemanticSearchParams): Promise<SemanticSearchResponse> {
  validateSearchParams(params);

  const { limit = 20, offset = 0, min_similarity = 0.3 } = params;

  // Try to generate embedding for query
  let queryEmbedding: number[] | null = null;
  let queryProvider: string | undefined;

  if (embeddingService.isConfigured()) {
    try {
      const result = await embeddingService.embed(params.query);
      if (result) {
        queryEmbedding = result.embedding;
        queryProvider = result.provider;
      }
    } catch (error) {
      console.warn(
        '[SkillStoreSearch] Query embedding failed, falling back to text search:',
        error instanceof EmbeddingError ? error.toSafeString() : (error as Error).message,
      );
    }
  }

  const { conditions, values, paramIndex } = buildFilterConditions(params);
  let nextParam = paramIndex;

  // Semantic search with embedding
  if (queryEmbedding) {
    conditions.push(`s.embedding IS NOT NULL`);
    conditions.push(`s.embedding_status = 'complete'`);

    const embeddingParam = `[${queryEmbedding.join(',')}]`;
    values.push(embeddingParam);
    const embeddingParamIndex = nextParam++;

    // min_similarity filter
    values.push(min_similarity);
    const simThresholdParamIndex = nextParam++;

    values.push(limit);
    const limitParamIndex = nextParam++;
    values.push(offset);
    const offsetParamIndex = nextParam++;

    const whereClause = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT
         ${RESULT_COLUMNS},
         1 - (s.embedding <=> $${embeddingParamIndex}::vector) as similarity
       FROM skill_store_item s
       WHERE ${whereClause}
         AND 1 - (s.embedding <=> $${embeddingParamIndex}::vector) >= $${simThresholdParamIndex}
       ORDER BY s.embedding <=> $${embeddingParamIndex}::vector
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      values,
    );

    return {
      results: result.rows.map((row) => ({
        ...row,
        similarity: parseFloat(row.similarity),
      })) as SemanticSearchResult[],
      searchType: 'semantic',
      queryEmbeddingProvider: queryProvider,
    };
  }

  // Fall back to text search using ILIKE (escape wildcards to prevent injection)
  values.push(`%${escapeIlikeWildcards(params.query)}%`);
  const searchParamIndex = nextParam++;

  conditions.push(`(s.title ILIKE $${searchParamIndex} OR s.summary ILIKE $${searchParamIndex} OR s.content ILIKE $${searchParamIndex})`);

  values.push(limit);
  const limitParamIndex = nextParam++;
  values.push(offset);
  const offsetParamIndex = nextParam++;

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
       ${RESULT_COLUMNS},
       0.5 as similarity
     FROM skill_store_item s
     WHERE ${whereClause}
     ORDER BY s.updated_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    values,
  );

  return {
    results: result.rows.map((row) => ({
      ...row,
      similarity: parseFloat(row.similarity),
    })) as SemanticSearchResult[],
    searchType: 'text',
  };
}

/**
 * Hybrid search combining full-text and semantic results using
 * Reciprocal Rank Fusion (RRF).
 *
 * Default weights: 0.7 semantic + 0.3 full-text, configurable via semantic_weight.
 * Falls back to full-text only if semantic search is unavailable.
 */
export async function searchSkillStoreHybrid(pool: Pool, params: HybridSearchParams): Promise<HybridSearchResponse> {
  validateSearchParams(params);

  const { limit = 20, semantic_weight = 0.7, min_similarity = 0.3 } = params;
  const fulltextWeight = 1 - semantic_weight;

  // RRF constant (standard value from literature)
  const K = 60;

  // Fetch more results from each source for fusion
  const fusionLimit = Math.max(limit * 3, 50);

  // Get full-text results
  let fulltextResults: FullTextSearchResult[] = [];
  try {
    const ftResponse = await searchSkillStoreFullText(pool, {
      ...params,
      limit: fusionLimit,
      offset: 0,
    });
    fulltextResults = ftResponse.results;
  } catch {
    // Full-text may return no results, that's ok
  }

  // Get semantic results
  let semanticResults: SemanticSearchResult[] = [];
  let searchType: 'hybrid' | 'text' = 'text';

  try {
    const semResponse = await searchSkillStoreSemantic(pool, {
      ...params,
      limit: fusionLimit,
      offset: 0,
      min_similarity,
    });
    semanticResults = semResponse.results;

    if (semResponse.searchType === 'semantic') {
      searchType = 'hybrid';
    }
  } catch {
    // Semantic may fail, that's ok — we'll just use full-text
  }

  // Build RRF scores
  // Map: item_id -> { item, fulltext_rank, semantic_rank, score }
  const fusionMap = new Map<
    string,
    {
      item: SkillStoreSearchResult;
      fulltext_rank: number | null;
      semantic_rank: number | null;
      score: number;
    }
  >();

  // Add full-text results with RRF scores
  for (let i = 0; i < fulltextResults.length; i++) {
    const item = fulltextResults[i];
    const rrfScore = fulltextWeight / (K + i + 1);

    fusionMap.set(item.id, {
      item,
      fulltext_rank: i + 1,
      semantic_rank: null,
      score: rrfScore,
    });
  }

  // Add semantic results with RRF scores
  for (let i = 0; i < semanticResults.length; i++) {
    const item = semanticResults[i];
    const rrfScore = semantic_weight / (K + i + 1);

    const existing = fusionMap.get(item.id);
    if (existing) {
      // Item appears in both — combine scores
      existing.semantic_rank = i + 1;
      existing.score += rrfScore;
    } else {
      fusionMap.set(item.id, {
        item,
        fulltext_rank: null,
        semantic_rank: i + 1,
        score: rrfScore,
      });
    }
  }

  // Sort by combined RRF score descending
  const sorted = Array.from(fusionMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    results: sorted.map((entry) => ({
      ...entry.item,
      score: entry.score,
      fulltext_rank: entry.fulltext_rank,
      semantic_rank: entry.semantic_rank,
    })) as HybridSearchResult[],
    searchType,
    semantic_weight,
  };
}
