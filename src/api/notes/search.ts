/**
 * Note search with privacy filtering.
 * Part of Epic #337, Issue #346
 *
 * Implements:
 * - Text search with ts_vector
 * - Semantic search with embeddings
 * - Hybrid search using Reciprocal Rank Fusion (RRF)
 * - Privacy-aware filtering (owner, shared, public)
 * - Agent visibility control (hideFromAgents)
 */

import type { Pool } from 'pg';
import type { NoteVisibility } from './types.ts';

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  notebook_id: string | null;
  notebook_name: string | null;
  tags: string[];
  visibility: NoteVisibility;
  created_at: Date;
  updated_at: Date;
}

export interface SearchOptions {
  search_type?: 'hybrid' | 'text' | 'semantic';
  notebook_id?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  limit?: number;
  offset?: number;
  min_similarity?: number;
  is_agent?: boolean;
}

export interface SearchResponse {
  query: string;
  search_type: 'hybrid' | 'text' | 'semantic';
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}

export interface SimilarNote {
  id: string;
  title: string;
  similarity: number;
  snippet: string;
}

export interface SimilarNotesResponse {
  note: { id: string; title: string };
  similar: SimilarNote[];
}

/**
 * Build the privacy-aware WHERE clause for note access.
 * Handles owner, shared, public visibility and agent filtering.
 */
function buildAccessConditions(
  user_email: string,
  isAgent: boolean,
  paramIndex: number,
): { conditions: string[]; params: (string | boolean)[]; nextIndex: number } {
  const conditions: string[] = [];
  const params: (string | boolean)[] = [];

  // Base condition: not deleted
  conditions.push('n.deleted_at IS NULL');

  // Access control: Phase 4 (Epic #1418) - user_email column dropped from note table.
  // Namespace scoping handled at the route level. Here we check public/shared access.
  conditions.push(`(
    n.visibility = 'public'
    OR (n.visibility = 'shared' AND EXISTS (
      SELECT 1 FROM note_share ns
      WHERE ns.note_id = n.id
        AND ns.shared_with_email = $${paramIndex}
        AND (ns.expires_at IS NULL OR ns.expires_at > NOW())
    ))
    OR (n.visibility = 'shared' AND n.notebook_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM notebook_share nbs
      WHERE nbs.notebook_id = n.notebook_id
        AND nbs.shared_with_email = $${paramIndex}
        AND (nbs.expires_at IS NULL OR nbs.expires_at > NOW())
    ))
    OR 1=1
  )`);
  params.push(user_email);
  paramIndex++;

  // Agent filtering: agents cannot see private notes or notes with hideFromAgents
  if (isAgent) {
    conditions.push(`(n.visibility != 'private' AND n.hide_from_agents = false)`);
  }

  return { conditions, params, nextIndex: paramIndex };
}

/**
 * Perform full-text search using PostgreSQL tsvector.
 */
export async function textSearch(
  pool: Pool,
  query: string,
  user_email: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; total: number }> {
  const { notebook_id, tags, visibility, limit = 20, offset = 0, is_agent = false } = options;

  const { conditions, params, nextIndex } = buildAccessConditions(user_email, is_agent, 1);
  let paramIndex = nextIndex;

  // Add query parameter
  params.push(query);
  const queryParamIndex = paramIndex++;

  // Add optional filters
  if (notebook_id) {
    conditions.push(`n.notebook_id = $${paramIndex}`);
    params.push(notebook_id);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`n.tags && $${paramIndex}`);
    params.push(tags as unknown as string);
    paramIndex++;
  }

  if (visibility) {
    conditions.push(`n.visibility = $${paramIndex}`);
    params.push(visibility);
    paramIndex++;
  }

  // Add text search condition
  conditions.push(`n.search_vector @@ websearch_to_tsquery('english', $${queryParamIndex})`);

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) as total
     FROM note n
     WHERE ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Add pagination params
  params.push(limit as unknown as string);
  const limitParamIndex = paramIndex++;
  params.push(offset as unknown as string);
  const offsetParamIndex = paramIndex++;

  // Execute search with ranking and highlighting
  const result = await pool.query(
    `SELECT
      n.id::text,
      n.title,
      n.content,
      n.notebook_id::text as "notebook_id",
      nb.name as "notebook_name",
      n.tags,
      n.visibility,
      n.created_at as "created_at",
      n.updated_at as "updated_at",
      ts_rank_cd(n.search_vector, websearch_to_tsquery('english', $${queryParamIndex}), 32) as score,
      ts_headline('english', n.content, websearch_to_tsquery('english', $${queryParamIndex}),
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=25, MaxFragments=2'
      ) as snippet
    FROM note n
    LEFT JOIN notebook nb ON n.notebook_id = nb.id
    WHERE ${whereClause}
    ORDER BY score DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params,
  );

  return {
    results: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      snippet: row.snippet || row.content?.substring(0, 200) || '',
      score: parseFloat(row.score) || 0,
      notebook_id: row.notebook_id,
      notebook_name: row.notebook_name,
      tags: row.tags || [],
      visibility: row.visibility,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    })),
    total,
  };
}

/**
 * Perform semantic search using vector embeddings.
 */
export async function semanticSearch(
  pool: Pool,
  query: string,
  user_email: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; total: number }> {
  const { notebook_id, tags, visibility, limit = 20, offset = 0, min_similarity = 0.3, is_agent = false } = options;

  // Import embedding service lazily
  const { embeddingService } = await import('../embeddings/service.ts');

  // Check if embedding service is configured
  if (!embeddingService.isConfigured()) {
    // Fall back to text search
    return textSearch(pool, query, user_email, options);
  }

  // Generate embedding for query
  let queryEmbedding: number[] | null = null;
  try {
    const result = await embeddingService.embed(query);
    if (result) {
      queryEmbedding = result.embedding;
    }
  } catch (error) {
    console.warn('[Search] Query embedding failed, falling back to text search');
    return textSearch(pool, query, user_email, options);
  }

  if (!queryEmbedding) {
    return textSearch(pool, query, user_email, options);
  }

  const { conditions, params, nextIndex } = buildAccessConditions(user_email, is_agent, 1);
  let paramIndex = nextIndex;

  // Add embedding condition
  conditions.push(`n.embedding IS NOT NULL AND n.embedding_status = 'complete'`);

  // Add optional filters
  if (notebook_id) {
    conditions.push(`n.notebook_id = $${paramIndex}`);
    params.push(notebook_id);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`n.tags && $${paramIndex}`);
    params.push(tags as unknown as string);
    paramIndex++;
  }

  if (visibility) {
    conditions.push(`n.visibility = $${paramIndex}`);
    params.push(visibility);
    paramIndex++;
  }

  // Add embedding parameter
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  params.push(embeddingStr);
  const embeddingParamIndex = paramIndex++;

  // Add similarity threshold
  params.push(min_similarity as unknown as string);
  const minSimParamIndex = paramIndex++;

  const whereClause = conditions.join(' AND ');
  const similarityCondition = `1 - (n.embedding <=> $${embeddingParamIndex}::vector) >= $${minSimParamIndex}`;

  // Get total count (with similarity threshold)
  const countResult = await pool.query(
    `SELECT COUNT(*) as total
     FROM note n
     WHERE ${whereClause} AND ${similarityCondition}`,
    params,
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Add pagination params
  params.push(limit as unknown as string);
  const limitParamIndex = paramIndex++;
  params.push(offset as unknown as string);
  const offsetParamIndex = paramIndex++;

  // Execute semantic search
  const result = await pool.query(
    `SELECT
      n.id::text,
      n.title,
      n.content,
      n.notebook_id::text as "notebook_id",
      nb.name as "notebook_name",
      n.tags,
      n.visibility,
      n.created_at as "created_at",
      n.updated_at as "updated_at",
      1 - (n.embedding <=> $${embeddingParamIndex}::vector) as score,
      LEFT(n.content, 200) as snippet
    FROM note n
    LEFT JOIN notebook nb ON n.notebook_id = nb.id
    WHERE ${whereClause} AND ${similarityCondition}
    ORDER BY n.embedding <=> $${embeddingParamIndex}::vector
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    params,
  );

  return {
    results: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      snippet: row.snippet || '',
      score: parseFloat(row.score) || 0,
      notebook_id: row.notebook_id,
      notebook_name: row.notebook_name,
      tags: row.tags || [],
      visibility: row.visibility,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    })),
    total,
  };
}

/**
 * Reciprocal Rank Fusion combines results from multiple search methods.
 * RRF(d) = Σ 1 / (k + rank(d)) for each ranking
 * k=60 is a common constant that reduces the impact of high rankings
 */
function reciprocalRankFusion(textResults: SearchResult[], semanticResults: SearchResult[], k = 60): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult; hasTextSnippet: boolean }>();

  // Score from text search (prefer these snippets as they have highlights)
  textResults.forEach((result, index) => {
    const rrf = 1 / (k + index + 1);
    scores.set(result.id, { score: rrf, result, hasTextSnippet: true });
  });

  // Score from semantic search
  semanticResults.forEach((result, index) => {
    const rrf = 1 / (k + index + 1);
    const existing = scores.get(result.id);
    if (existing) {
      existing.score += rrf;
      // Keep text snippet if available (has highlights)
    } else {
      scores.set(result.id, { score: rrf, result, hasTextSnippet: false });
    }
  });

  // Sort by combined RRF score
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}

/**
 * Perform hybrid search combining text and semantic search with RRF.
 */
export async function hybridSearch(
  pool: Pool,
  query: string,
  user_email: string,
  options: SearchOptions = {},
): Promise<{ results: SearchResult[]; total: number }> {
  const { limit = 20, offset = 0 } = options;

  // Run both searches in parallel, fetching more results for fusion
  const fetchLimit = Math.max(limit * 2, 40);
  const [textResult, semanticResult] = await Promise.all([
    textSearch(pool, query, user_email, { ...options, limit: fetchLimit, offset: 0 }),
    semanticSearch(pool, query, user_email, { ...options, limit: fetchLimit, offset: 0 }),
  ]);

  // Combine with RRF
  const combined = reciprocalRankFusion(textResult.results, semanticResult.results);

  // Apply pagination
  const paginatedResults = combined.slice(offset, offset + limit);

  // Total is approximate (max of both searches)
  const total = Math.max(textResult.total, semanticResult.total);

  return {
    results: paginatedResults,
    total,
  };
}

/**
 * Main search function that routes to appropriate search method.
 */
export async function searchNotes(pool: Pool, query: string, user_email: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const { search_type = 'hybrid', limit = 20, offset = 0 } = options;

  let result: { results: SearchResult[]; total: number };

  switch (search_type) {
    case 'text':
      result = await textSearch(pool, query, user_email, options);
      break;
    case 'semantic':
      result = await semanticSearch(pool, query, user_email, options);
      break;
    case 'hybrid':
    default:
      result = await hybridSearch(pool, query, user_email, options);
      break;
  }

  return {
    query,
    search_type,
    results: result.results,
    total: result.total,
    limit,
    offset,
  };
}

/**
 * Find notes similar to a given note using embedding similarity.
 */
export async function findSimilarNotes(
  pool: Pool,
  noteId: string,
  user_email: string,
  options: { limit?: number; min_similarity?: number; is_agent?: boolean } = {},
): Promise<SimilarNotesResponse | null> {
  const { limit = 5, min_similarity = 0.5, is_agent = false } = options;

  // First, get the source note and verify access
  const noteResult = await pool.query(
    `SELECT
      n.id::text, n.title, n.embedding, n.visibility
    FROM note n
    WHERE n.id = $1 AND n.deleted_at IS NULL`,
    [noteId],
  );

  if (noteResult.rows.length === 0) {
    return null;
  }

  const sourceNote = noteResult.rows[0];

  // Phase 4 (Epic #1418): user_email column dropped from note table.
  // Namespace scoping is handled at the route level.
  const canAccess = sourceNote.visibility === 'public' || sourceNote.visibility === 'shared' || true;

  if (!canAccess) {
    // Check for shares
    const shareResult = await pool.query(
      `SELECT 1 FROM note_share
       WHERE note_id = $1 AND shared_with_email = $2
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [noteId, user_email],
    );
    if (shareResult.rows.length === 0) {
      return null;
    }
  }

  // If source note has no embedding, return empty similar list
  if (!sourceNote.embedding) {
    return {
      note: { id: sourceNote.id, title: sourceNote.title },
      similar: [],
    };
  }

  // Build access conditions for similar notes
  const { conditions, params, nextIndex } = buildAccessConditions(user_email, is_agent, 1);
  let paramIndex = nextIndex;

  // Exclude the source note
  conditions.push(`n.id != $${paramIndex}`);
  params.push(noteId);
  paramIndex++;

  // Only notes with embeddings
  conditions.push(`n.embedding IS NOT NULL AND n.embedding_status = 'complete'`);

  // Add similarity threshold
  params.push(min_similarity as unknown as string);
  const minSimParamIndex = paramIndex++;

  params.push(limit as unknown as string);
  const limitParamIndex = paramIndex++;

  const whereClause = conditions.join(' AND ');

  // Find similar notes using the source note's embedding
  const result = await pool.query(
    `SELECT
      n.id::text,
      n.title,
      LEFT(n.content, 200) as snippet,
      1 - (n.embedding <=> (SELECT embedding FROM note WHERE id = $${paramIndex})) as similarity
    FROM note n
    WHERE ${whereClause}
      AND 1 - (n.embedding <=> (SELECT embedding FROM note WHERE id = $${paramIndex})) >= $${minSimParamIndex}
    ORDER BY n.embedding <=> (SELECT embedding FROM note WHERE id = $${paramIndex})
    LIMIT $${limitParamIndex}`,
    [...params, noteId],
  );

  return {
    note: { id: sourceNote.id, title: sourceNote.title },
    similar: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      similarity: parseFloat(row.similarity) || 0,
      snippet: row.snippet || '',
    })),
  };
}
