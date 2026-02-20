/**
 * Unified search service.
 * Combines full-text and semantic search across all entity types.
 * Part of Issue #216.
 */

import type { Pool } from 'pg';
import { embeddingService } from '../embeddings/service.ts';
import type { SearchOptions, SearchResponse, SearchResult, SearchEntityType, SearchType, EntitySearchResult } from './types.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_SEMANTIC_WEIGHT = 0.5;
const SNIPPET_LENGTH = 200;

/**
 * Generate a snippet from text around matched terms.
 */
function generateSnippet(text: string, maxLength: number = SNIPPET_LENGTH): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Search work items using full-text search.
 */
async function searchWorkItemsText(
  pool: Pool,
  query: string,
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date; queryNamespaces?: string[] },
): Promise<EntitySearchResult[]> {
  const conditions: string[] = ["search_vector @@ plainto_tsquery('english', $1)"];
  const params: (string | number | Date | string[])[] = [query];
  let paramIndex = 2;

  // Epic #1418 Phase 4: namespace scoping
  const nsScope = options.queryNamespaces ?? ['default'];
  conditions.push(`namespace = ANY($${paramIndex}::text[])`);
  params.push(nsScope);
  paramIndex++;

  if (options.date_from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       id::text as id,
       title,
       description,
       kind::text as kind,
       status::text as status,
       ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
     FROM work_item
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: generateSnippet(row.description || ''),
    text_score: parseFloat(row.rank) || 0,
    metadata: { kind: row.kind, status: row.status },
  }));
}

/**
 * Search work items using semantic search (Issue #1216).
 */
async function searchWorkItemsSemantic(
  pool: Pool,
  queryEmbedding: number[],
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date; queryNamespaces?: string[] },
): Promise<EntitySearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const conditions: string[] = ['embedding IS NOT NULL', "embedding_status = 'complete'", 'deleted_at IS NULL'];
  const params: (string | number | Date | string[])[] = [embeddingStr];
  let paramIndex = 2;

  // Epic #1418 Phase 4: namespace scoping
  const nsScope = options.queryNamespaces ?? ['default'];
  conditions.push(`namespace = ANY($${paramIndex}::text[])`);
  params.push(nsScope);
  paramIndex++;

  if (options.date_from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       id::text as id,
       title,
       description,
       kind::text as kind,
       status::text as status,
       1 - (embedding <=> $1::vector) as similarity
     FROM work_item
     WHERE ${conditions.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: generateSnippet(row.description || ''),
    text_score: 0,
    semantic_score: Number.parseFloat(row.similarity) || 0,
    metadata: { kind: row.kind, status: row.status },
  }));
}

/**
 * Search contacts using full-text search.
 */
async function searchContactsText(
  pool: Pool,
  query: string,
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date; queryNamespaces?: string[] },
): Promise<EntitySearchResult[]> {
  const conditions: string[] = ["search_vector @@ plainto_tsquery('english', $1)"];
  const params: (string | number | Date | string[])[] = [query];
  let paramIndex = 2;

  // Epic #1418: namespace scoping
  const nsScope = options.queryNamespaces ?? ['default'];
  conditions.push(`namespace = ANY($${paramIndex}::text[])`);
  params.push(nsScope);
  paramIndex++;

  if (options.date_from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       id::text as id,
       display_name,
       notes,
       ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
     FROM contact
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.display_name,
    snippet: generateSnippet(row.notes || ''),
    text_score: parseFloat(row.rank) || 0,
  }));
}

/**
 * Search memories using full-text search.
 */
async function searchMemoriesText(
  pool: Pool,
  query: string,
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date; queryNamespaces?: string[] },
): Promise<EntitySearchResult[]> {
  const conditions: string[] = ["search_vector @@ plainto_tsquery('english', $1)"];
  const params: (string | number | Date | string[])[] = [query];
  let paramIndex = 2;

  // Epic #1418: namespace scoping
  const nsScope = options.queryNamespaces ?? ['default'];
  conditions.push(`namespace = ANY($${paramIndex}::text[])`);
  params.push(nsScope);
  paramIndex++;

  if (options.date_from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       id::text as id,
       title,
       content,
       memory_type::text as memory_type,
       work_item_id::text as work_item_id,
       ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
     FROM memory
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: generateSnippet(row.content || ''),
    text_score: parseFloat(row.rank) || 0,
    metadata: { memory_type: row.memory_type, work_item_id: row.work_item_id },
  }));
}

/**
 * Search messages using full-text search.
 */
async function searchMessagesText(
  pool: Pool,
  query: string,
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date },
): Promise<EntitySearchResult[]> {
  const conditions: string[] = ["m.search_vector @@ plainto_tsquery('english', $1)"];
  const params: (string | number | Date)[] = [query];
  let paramIndex = 2;

  if (options.date_from) {
    conditions.push(`m.received_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`m.received_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       m.id::text as id,
       m.body,
       m.direction::text as direction,
       m.received_at,
       t.channel::text as channel,
       ts_rank(m.search_vector, plainto_tsquery('english', $1)) as rank
     FROM external_message m
     JOIN external_thread t ON t.id = m.thread_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: `${row.channel} message (${row.direction})`,
    snippet: generateSnippet(row.body || ''),
    text_score: parseFloat(row.rank) || 0,
    metadata: { channel: row.channel, direction: row.direction, received_at: row.received_at },
  }));
}

/**
 * Search messages using semantic search.
 */
async function searchMessagesSemantic(
  pool: Pool,
  queryEmbedding: number[],
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date },
): Promise<EntitySearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const conditions: string[] = ['m.embedding IS NOT NULL', "m.embedding_status = 'complete'"];
  const params: (string | number | Date)[] = [embeddingStr];
  let paramIndex = 2;

  if (options.date_from) {
    conditions.push(`m.received_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`m.received_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       m.id::text as id,
       m.body,
       m.subject,
       m.direction::text as direction,
       m.received_at,
       t.channel::text as channel,
       1 - (m.embedding <=> $1::vector) as similarity
     FROM external_message m
     JOIN external_thread t ON t.id = m.thread_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY m.embedding <=> $1::vector
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.subject || `${row.channel} message (${row.direction})`,
    snippet: generateSnippet(row.body || ''),
    text_score: 0,
    semantic_score: parseFloat(row.similarity) || 0,
    metadata: { channel: row.channel, direction: row.direction, received_at: row.received_at },
  }));
}

/**
 * Search memories using semantic search.
 */
async function searchMemoriesSemantic(
  pool: Pool,
  queryEmbedding: number[],
  options: { limit: number; offset: number; date_from?: Date; date_to?: Date; queryNamespaces?: string[] },
): Promise<EntitySearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const conditions: string[] = ['embedding IS NOT NULL', "embedding_status = 'complete'"];
  const params: (string | number | Date | string[])[] = [embeddingStr];
  let paramIndex = 2;

  // Epic #1418: namespace scoping
  const nsScope = options.queryNamespaces ?? ['default'];
  conditions.push(`namespace = ANY($${paramIndex}::text[])`);
  params.push(nsScope);
  paramIndex++;

  if (options.date_from) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  params.push(options.limit, options.offset);

  const result = await pool.query(
    `SELECT
       id::text as id,
       title,
       content,
       memory_type::text as memory_type,
       work_item_id::text as work_item_id,
       1 - (embedding <=> $1::vector) as similarity
     FROM memory
     WHERE ${conditions.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: generateSnippet(row.content || ''),
    text_score: 0,
    semantic_score: parseFloat(row.similarity) || 0,
    metadata: { memory_type: row.memory_type, work_item_id: row.work_item_id },
  }));
}

/**
 * Combine and rank text and semantic results.
 */
function combineResults(textResults: EntitySearchResult[], semanticResults: EntitySearchResult[], semantic_weight: number): EntitySearchResult[] {
  const combined = new Map<string, EntitySearchResult>();
  const textWeight = 1 - semantic_weight;

  // Add text results
  for (const result of textResults) {
    combined.set(result.id, {
      ...result,
      text_score: result.text_score * textWeight,
    });
  }

  // Merge semantic results
  for (const result of semanticResults) {
    const existing = combined.get(result.id);
    if (existing) {
      existing.semantic_score = (result.semantic_score || 0) * semantic_weight;
    } else {
      combined.set(result.id, {
        ...result,
        text_score: 0,
        semantic_score: (result.semantic_score || 0) * semantic_weight,
      });
    }
  }

  // Sort by combined score
  return Array.from(combined.values()).sort((a, b) => {
    const scoreA = a.text_score + (a.semantic_score || 0);
    const scoreB = b.text_score + (b.semantic_score || 0);
    return scoreB - scoreA;
  });
}

/**
 * Perform unified search across all entity types.
 */
export async function unifiedSearch(pool: Pool, options: SearchOptions): Promise<SearchResponse> {
  const {
    query,
    types = ['work_item', 'contact', 'memory', 'message'],
    limit = DEFAULT_LIMIT,
    offset = 0,
    semantic = true,
    date_from,
    date_to,
    semantic_weight = DEFAULT_SEMANTIC_WEIGHT,
    queryNamespaces,
  } = options;

  const effectiveLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const searchOpts = { limit: effectiveLimit, offset, date_from, date_to, queryNamespaces };

  // Determine search type based on capabilities
  let search_type: SearchType = 'text';
  let queryEmbedding: number[] | null = null;
  let embeddingProvider: string | undefined;

  if (semantic && embeddingService.isConfigured()) {
    try {
      const embeddingResult = await embeddingService.embed(query);
      if (embeddingResult) {
        queryEmbedding = embeddingResult.embedding;
        embeddingProvider = embeddingResult.provider;
        search_type = 'hybrid';
      }
    } catch (error) {
      console.warn('[Search] Embedding failed, falling back to text search:', (error as Error).message);
    }
  }

  // If only semantic search is possible (no text search configured), use semantic only
  if (search_type === 'hybrid' && types.every((t) => t === 'memory')) {
    search_type = 'hybrid';
  }

  // Collect results from each entity type
  const allResults: SearchResult[] = [];
  const facets: Record<SearchEntityType, number> = {
    work_item: 0,
    contact: 0,
    memory: 0,
    message: 0,
  };

  // Search work items (hybrid if available, Issue #1216)
  if (types.includes('work_item')) {
    const textResults = await searchWorkItemsText(pool, query, searchOpts);
    let workItemResults: EntitySearchResult[];

    if (search_type === 'hybrid' && queryEmbedding) {
      const semanticResults = await searchWorkItemsSemantic(pool, queryEmbedding, searchOpts);
      workItemResults = combineResults(textResults, semanticResults, semantic_weight);
    } else {
      workItemResults = textResults;
    }

    facets.work_item = workItemResults.length;
    for (const result of workItemResults) {
      const combinedScore = result.text_score + (result.semantic_score || 0);
      allResults.push({
        type: 'work_item',
        id: result.id,
        title: result.title,
        snippet: result.snippet,
        score: combinedScore,
        url: `/app/work-items/${result.id}`,
        metadata: result.metadata,
      });
    }
  }

  // Search contacts
  if (types.includes('contact')) {
    const textResults = await searchContactsText(pool, query, searchOpts);
    facets.contact = textResults.length;
    for (const result of textResults) {
      allResults.push({
        type: 'contact',
        id: result.id,
        title: result.title,
        snippet: result.snippet,
        score: result.text_score,
        url: `/app/contacts/${result.id}`,
        metadata: result.metadata,
      });
    }
  }

  // Search memories (hybrid if available)
  if (types.includes('memory')) {
    const textResults = await searchMemoriesText(pool, query, searchOpts);
    let memoryResults: EntitySearchResult[];

    if (search_type === 'hybrid' && queryEmbedding) {
      const semanticResults = await searchMemoriesSemantic(pool, queryEmbedding, searchOpts);
      memoryResults = combineResults(textResults, semanticResults, semantic_weight);
    } else {
      memoryResults = textResults;
    }

    facets.memory = memoryResults.length;
    for (const result of memoryResults) {
      const combinedScore = result.text_score + (result.semantic_score || 0);
      allResults.push({
        type: 'memory',
        id: result.id,
        title: result.title,
        snippet: result.snippet,
        score: combinedScore,
        metadata: result.metadata,
      });
    }
  }

  // Search messages (hybrid if available)
  if (types.includes('message')) {
    const textResults = await searchMessagesText(pool, query, searchOpts);
    let messageResults: EntitySearchResult[];

    if (search_type === 'hybrid' && queryEmbedding) {
      const semanticResults = await searchMessagesSemantic(pool, queryEmbedding, searchOpts);
      messageResults = combineResults(textResults, semanticResults, semantic_weight);
    } else {
      messageResults = textResults;
    }

    facets.message = messageResults.length;
    for (const result of messageResults) {
      const combinedScore = result.text_score + (result.semantic_score || 0);
      allResults.push({
        type: 'message',
        id: result.id,
        title: result.title,
        snippet: result.snippet,
        score: combinedScore,
        metadata: result.metadata,
      });
    }
  }

  // Sort all results by score
  allResults.sort((a, b) => b.score - a.score);

  // Apply overall limit after merging
  const limitedResults = allResults.slice(0, effectiveLimit);

  return {
    query,
    search_type: search_type,
    embedding_provider: embeddingProvider,
    results: limitedResults,
    facets,
    total: allResults.length,
  };
}

/**
 * Count results for each entity type (for faceting without fetching all results).
 */
export async function countSearchResults(
  pool: Pool,
  query: string,
  options: { date_from?: Date; date_to?: Date } = {},
): Promise<Record<SearchEntityType, number>> {
  const counts: Record<SearchEntityType, number> = {
    work_item: 0,
    contact: 0,
    memory: 0,
    message: 0,
  };

  const dateConditions: string[] = [];
  const workItemDateConditions: string[] = [];
  const params: (string | Date)[] = [query];
  let paramIndex = 2;

  if (options.date_from) {
    dateConditions.push(`received_at >= $${paramIndex}`);
    workItemDateConditions.push(`created_at >= $${paramIndex}`);
    params.push(options.date_from);
    paramIndex++;
  }

  if (options.date_to) {
    dateConditions.push(`received_at <= $${paramIndex}`);
    workItemDateConditions.push(`created_at <= $${paramIndex}`);
    params.push(options.date_to);
    paramIndex++;
  }

  const workItemWhere = workItemDateConditions.length > 0 ? `AND ${workItemDateConditions.join(' AND ')}` : '';
  const messageWhere = dateConditions.length > 0 ? `AND ${dateConditions.join(' AND ')}` : '';

  // Count work items
  const workItemCount = await pool.query(
    `SELECT COUNT(*) FROM work_item
     WHERE search_vector @@ plainto_tsquery('english', $1) ${workItemWhere}`,
    params,
  );
  counts.work_item = parseInt((workItemCount.rows[0] as { count: string }).count, 10);

  // Count contacts
  const contactCount = await pool.query(
    `SELECT COUNT(*) FROM contact
     WHERE search_vector @@ plainto_tsquery('english', $1) ${workItemWhere}`,
    params,
  );
  counts.contact = parseInt((contactCount.rows[0] as { count: string }).count, 10);

  // Count memories
  const memoryCount = await pool.query(
    `SELECT COUNT(*) FROM memory
     WHERE search_vector @@ plainto_tsquery('english', $1) ${workItemWhere}`,
    params,
  );
  counts.memory = parseInt((memoryCount.rows[0] as { count: string }).count, 10);

  // Count messages
  const message_count = await pool.query(
    `SELECT COUNT(*) FROM external_message
     WHERE search_vector @@ plainto_tsquery('english', $1) ${messageWhere}`,
    params,
  );
  counts.message = parseInt((message_count.rows[0] as { count: string }).count, 10);

  return counts;
}
