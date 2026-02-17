/**
 * Memory service for the unified memory system.
 * Part of Epic #199, Issue #209
 * Tags support added in Issue #492
 * Relationship scope added in Issue #493
 * Geolocation fields added in Epic #1204
 * Project scope added in Issue #1273
 */

import type { Pool } from 'pg';
import type {
  CreateMemoryInput,
  ListMemoriesOptions,
  ListMemoriesResult,
  MemoryEntry,
  MemorySearchResult,
  MemoryType,
  SearchMemoriesOptions,
  UpdateMemoryInput,
} from './types.ts';

/** Valid memory types for validation */
const VALID_MEMORY_TYPES: MemoryType[] = ['preference', 'fact', 'note', 'decision', 'context', 'reference'];

/**
 * Maps database row to MemoryEntry
 */
function mapRowToMemory(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    user_email: row.user_email as string | null,
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
 * Validates a memory type.
 */
export function isValidMemoryType(type: string): type is MemoryType {
  return VALID_MEMORY_TYPES.includes(type as MemoryType);
}

/**
 * Generate a title from memory content when none is provided.
 * Extracts the first sentence, truncates at word boundary if needed.
 */
export function generateTitleFromContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 'Untitled memory';

  // Try to extract first sentence (split on sentence-ending punctuation or newline)
  const sentenceMatch = trimmed.match(/^(.+?)[.!?\n]/);
  if (sentenceMatch) {
    const sentence = sentenceMatch[1].trim();
    if (sentence.length <= 120) return sentence;
    // Truncate at word boundary
    const truncated = sentence.slice(0, 120).replace(/\s+\S*$/, '');
    return truncated.length > 0 ? `${truncated}...` : `${sentence.slice(0, 117)}...`;
  }

  // No sentence boundary — try first clause
  const clauseMatch = trimmed.match(/^(.+?)[,;:\u2014]/);
  if (clauseMatch) {
    const clause = clauseMatch[1].trim();
    if (clause.length <= 120) return clause;
  }

  // Fallback: truncate at word boundary
  if (trimmed.length <= 120) return trimmed;
  const truncated = trimmed.slice(0, 120).replace(/\s+\S*$/, '');
  return truncated.length > 0 ? `${truncated}...` : `${trimmed.slice(0, 117)}...`;
}

/**
 * Normalize importance to 1-10 integer scale.
 * Accepts both 0-1 float (OpenClaw standard) and 1-10 integer.
 * Values <= 1.0 are treated as 0-1 float scale and converted.
 * Values > 1.0 are treated as already on the 1-10 scale.
 */
function normalizeImportance(value: number | undefined): number {
  if (value === undefined) return 5;

  if (value < 0 || value > 10) {
    throw new Error('Importance must be between 0 and 10');
  }

  // 0-1 float range → convert to 1-10 integer
  if (value <= 1) {
    return Math.round(value * 9) + 1;
  }

  // Already 1-10 range → round to integer
  return Math.round(value);
}

/**
 * Creates a new memory with deduplication.
 * If identical content already exists for the same scope, updates the existing memory's timestamp instead.
 * Issue #1143
 */
export async function createMemory(pool: Pool, input: CreateMemoryInput): Promise<MemoryEntry> {
  const memory_type = input.memory_type ?? 'note';

  if (!isValidMemoryType(memory_type)) {
    throw new Error(`Invalid memory type: ${memory_type}. Valid types are: ${VALID_MEMORY_TYPES.join(', ')}`);
  }

  // At least one scope should be set
  if (!input.user_email && !input.work_item_id && !input.contact_id && !input.relationship_id && !input.project_id) {
    // Default to requiring at least some scope for organization
    // For now, allow completely unscoped memories but log a warning
    console.warn('[Memory] Creating memory without scope - consider adding user_email, work_item_id, contact_id, relationship_id, or project_id');
  }

  const tags = input.tags ?? [];

  // Deduplication: Check for existing memory with identical content
  // Normalize content: trim whitespace for comparison
  const normalizedContent = input.content.trim();

  // Build scope conditions for deduplication check
  const scopeConditions: string[] = [];
  const scopeParams: unknown[] = [normalizedContent];
  let paramIndex = 2;

  // Only check within the same scope (same user_email, work_item_id, contact_id, relationship_id)
  if (input.user_email !== undefined) {
    scopeConditions.push(`user_email = $${paramIndex}`);
    scopeParams.push(input.user_email);
    paramIndex++;
  } else {
    scopeConditions.push('user_email IS NULL');
  }

  if (input.work_item_id !== undefined) {
    scopeConditions.push(`work_item_id = $${paramIndex}`);
    scopeParams.push(input.work_item_id);
    paramIndex++;
  } else {
    scopeConditions.push('work_item_id IS NULL');
  }

  if (input.contact_id !== undefined) {
    scopeConditions.push(`contact_id = $${paramIndex}`);
    scopeParams.push(input.contact_id);
    paramIndex++;
  } else {
    scopeConditions.push('contact_id IS NULL');
  }

  if (input.relationship_id !== undefined) {
    scopeConditions.push(`relationship_id = $${paramIndex}`);
    scopeParams.push(input.relationship_id);
    paramIndex++;
  } else {
    scopeConditions.push('relationship_id IS NULL');
  }

  if (input.project_id !== undefined) {
    scopeConditions.push(`project_id = $${paramIndex}`);
    scopeParams.push(input.project_id);
    paramIndex++;
  } else {
    scopeConditions.push('project_id IS NULL');
  }

  const scopeWhere = scopeConditions.join(' AND ');

  // Check for duplicate using normalized content comparison
  const duplicateCheck = await pool.query(
    `SELECT id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at
    FROM memory
    WHERE TRIM(content) = $1 AND ${scopeWhere}
    LIMIT 1`,
    scopeParams,
  );

  if (duplicateCheck.rows.length > 0) {
    // Duplicate found - update timestamp and return existing memory
    const existingId = duplicateCheck.rows[0].id;
    const updateResult = await pool.query(
      `UPDATE memory SET updated_at = NOW()
      WHERE id = $1
      RETURNING
        id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
        title, content, memory_type::text, tags,
        created_by_agent, created_by_human, source_url,
        importance, confidence, expires_at, superseded_by::text,
        embedding_status, lat, lng, address, place_label, created_at, updated_at`,
      [existingId],
    );

    return mapRowToMemory(updateResult.rows[0] as Record<string, unknown>);
  }

  // No duplicate - create new memory
  const result = await pool.query(
    `INSERT INTO memory (
      user_email, work_item_id, contact_id, relationship_id, project_id,
      title, content, memory_type,
      tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at,
      lat, lng, address, place_label
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::memory_type, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at`,
    [
      input.user_email ?? null,
      input.work_item_id ?? null,
      input.contact_id ?? null,
      input.relationship_id ?? null,
      input.project_id ?? null,
      input.title,
      input.content,
      memory_type,
      tags,
      input.created_by_agent ?? null,
      input.created_by_human ?? false,
      input.source_url ?? null,
      normalizeImportance(input.importance),
      input.confidence ?? 1.0,
      input.expires_at ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.address ?? null,
      input.place_label ?? null,
    ],
  );

  return mapRowToMemory(result.rows[0] as Record<string, unknown>);
}

/**
 * Gets a memory by ID.
 */
export async function getMemory(pool: Pool, id: string): Promise<MemoryEntry | null> {
  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at
    FROM memory
    WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToMemory(result.rows[0] as Record<string, unknown>);
}

/**
 * Updates a memory.
 */
export async function updateMemory(pool: Pool, id: string, input: UpdateMemoryInput): Promise<MemoryEntry | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex}`);
    params.push(input.title);
    paramIndex++;
  }

  if (input.content !== undefined) {
    updates.push(`content = $${paramIndex}`);
    params.push(input.content);
    paramIndex++;
    // Reset embedding status when content changes
    updates.push(`embedding_status = 'pending'`);
  }

  if (input.memory_type !== undefined) {
    if (!isValidMemoryType(input.memory_type)) {
      throw new Error(`Invalid memory type: ${input.memory_type}`);
    }
    updates.push(`memory_type = $${paramIndex}::memory_type`);
    params.push(input.memory_type);
    paramIndex++;
  }

  if (input.tags !== undefined) {
    updates.push(`tags = $${paramIndex}`);
    params.push(input.tags);
    paramIndex++;
  }

  if (input.importance !== undefined) {
    if (input.importance < 1 || input.importance > 10) {
      throw new Error('Importance must be between 1 and 10');
    }
    updates.push(`importance = $${paramIndex}`);
    params.push(input.importance);
    paramIndex++;
  }

  if (input.confidence !== undefined) {
    if (input.confidence < 0 || input.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    updates.push(`confidence = $${paramIndex}`);
    params.push(input.confidence);
    paramIndex++;
  }

  if (input.expires_at !== undefined) {
    updates.push(`expires_at = $${paramIndex}`);
    params.push(input.expires_at);
    paramIndex++;
  }

  if (input.superseded_by !== undefined) {
    updates.push(`superseded_by = $${paramIndex}`);
    params.push(input.superseded_by);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getMemory(pool, id);
  }

  params.push(id);

  const result = await pool.query(
    `UPDATE memory SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex}
    RETURNING
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToMemory(result.rows[0] as Record<string, unknown>);
}

/**
 * Deletes a memory.
 */
export async function deleteMemory(pool: Pool, id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM memory WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

/**
 * Lists memories with flexible filtering.
 */
export async function listMemories(pool: Pool, options: ListMemoriesOptions = {}): Promise<ListMemoriesResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Scope filters
  if (options.user_email !== undefined) {
    conditions.push(`user_email = $${paramIndex}`);
    params.push(options.user_email);
    paramIndex++;
  }

  if (options.work_item_id !== undefined) {
    conditions.push(`work_item_id = $${paramIndex}`);
    params.push(options.work_item_id);
    paramIndex++;
  }

  if (options.contact_id !== undefined) {
    conditions.push(`contact_id = $${paramIndex}`);
    params.push(options.contact_id);
    paramIndex++;
  }

  if (options.relationship_id !== undefined) {
    conditions.push(`relationship_id = $${paramIndex}`);
    params.push(options.relationship_id);
    paramIndex++;
  }

  if (options.project_id !== undefined) {
    conditions.push(`project_id = $${paramIndex}`);
    params.push(options.project_id);
    paramIndex++;
  }

  // Type filter
  if (options.memory_type !== undefined) {
    conditions.push(`memory_type = $${paramIndex}::memory_type`);
    params.push(options.memory_type);
    paramIndex++;
  }

  // Tag filter (array containment: memory must have ALL specified tags)
  if (options.tags !== undefined && options.tags.length > 0) {
    conditions.push(`tags @> $${paramIndex}`);
    params.push(options.tags);
    paramIndex++;
  }

  // Exclude expired unless requested
  if (!options.include_expired) {
    conditions.push('(expires_at IS NULL OR expires_at > NOW())');
  }

  // Exclude superseded unless requested
  if (!options.include_superseded) {
    conditions.push('superseded_by IS NULL');
  }

  // Temporal filters (issue #1272)
  if (options.created_after !== undefined) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(options.created_after.toISOString());
    paramIndex++;
  }
  if (options.created_before !== undefined) {
    conditions.push(`created_at < $${paramIndex}`);
    params.push(options.created_before.toISOString());
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM memory ${whereClause}`, params);
  const total = Number.parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get paginated results
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at
    FROM memory
    ${whereClause}
    ORDER BY importance DESC, created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return {
    memories: result.rows.map((row) => mapRowToMemory(row as Record<string, unknown>)),
    total,
  };
}

/**
 * Gets global memories for a user (no work_item_id, contact_id, or relationship_id).
 */
export async function getGlobalMemories(
  pool: Pool,
  user_email: string,
  options: { memory_type?: MemoryType; limit?: number; offset?: number } = {},
): Promise<ListMemoriesResult> {
  const conditions: string[] = [
    'user_email = $1',
    'work_item_id IS NULL',
    'contact_id IS NULL',
    'relationship_id IS NULL',
    'project_id IS NULL',
    '(expires_at IS NULL OR expires_at > NOW())',
    'superseded_by IS NULL',
  ];
  const params: unknown[] = [user_email];
  let paramIndex = 2;

  if (options.memory_type !== undefined) {
    conditions.push(`memory_type = $${paramIndex}::memory_type`);
    params.push(options.memory_type);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM memory ${whereClause}`, params);
  const total = Number.parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get paginated results
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at
    FROM memory
    ${whereClause}
    ORDER BY importance DESC, created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return {
    memories: result.rows.map((row) => mapRowToMemory(row as Record<string, unknown>)),
    total,
  };
}

/**
 * Supersedes a memory with a new one.
 */
export async function supersedeMemory(pool: Pool, oldMemoryId: string, newMemoryInput: CreateMemoryInput): Promise<MemoryEntry> {
  // Create the new memory
  const newMemory = await createMemory(pool, newMemoryInput);

  // Mark the old memory as superseded
  await pool.query('UPDATE memory SET superseded_by = $1, updated_at = NOW() WHERE id = $2', [newMemory.id, oldMemoryId]);

  return newMemory;
}

/**
 * Cleans up expired memories.
 */
export async function cleanupExpiredMemories(pool: Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM memory
     WHERE expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`,
  );
  return result.rows.length;
}

/**
 * Extract significant words from query for keyword boosting.
 * Removes common stop words and short words.
 * Issue #1146
 */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'he',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'that',
    'the',
    'to',
    'was',
    'will',
    'with',
  ]);

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate keyword match ratio for boosting semantic search results.
 * Returns ratio of query keywords found in content (0-1).
 * Issue #1146
 */
function calculateKeywordRatio(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const contentLower = content.toLowerCase();
  const matchCount = keywords.filter((keyword) => contentLower.includes(keyword)).length;

  return matchCount / keywords.length;
}

/**
 * Apply keyword boosting to search results.
 * Combines vector similarity (70%) with keyword ratio (30%).
 * Issue #1146
 */
function applyKeywordBoost<T extends { similarity: number; content: string }>(results: T[], query: string): T[] {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    // No keywords to boost with, return as-is
    return results;
  }

  // Calculate combined scores
  const scoredResults = results.map((result) => {
    const vectorSimilarity = result.similarity;
    const keywordRatio = calculateKeywordRatio(result.content, keywords);

    // Combine: 70% vector similarity + 30% keyword matching
    const finalScore = vectorSimilarity * 0.7 + keywordRatio * 0.3;

    return {
      ...result,
      similarity: finalScore,
    };
  });

  // Re-sort by final score
  return scoredResults.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Searches memories semantically using embeddings or falls back to text search.
 * Applies keyword boosting to semantic results to improve ranking.
 * Issue #1146
 */
export async function searchMemories(pool: Pool, query: string, options: SearchMemoriesOptions = {}): Promise<MemorySearchResult> {
  const limit = Math.min(options.limit ?? 20, 100);
  const offset = options.offset ?? 0;
  const min_similarity = options.min_similarity ?? 0.3;

  // Try semantic search first
  try {
    const { embeddingService } = await import('../embeddings/index.ts');

    if (embeddingService.isConfigured()) {
      const embeddingResult = await embeddingService.embed(query);

      if (embeddingResult) {
        const queryEmbedding = embeddingResult.embedding;
        // Build semantic search conditions with proper indexing
        // $1 = embedding, $2 = min_similarity, then filter params, then limit/offset
        const semanticConditions: string[] = ['(expires_at IS NULL OR expires_at > NOW())', 'superseded_by IS NULL'];
        const semanticParams: unknown[] = [];
        let semanticIdx = 3; // Start after embedding and min_similarity

        if (options.user_email !== undefined) {
          semanticConditions.push(`user_email = $${semanticIdx}`);
          semanticParams.push(options.user_email);
          semanticIdx++;
        }
        if (options.work_item_id !== undefined) {
          semanticConditions.push(`work_item_id = $${semanticIdx}`);
          semanticParams.push(options.work_item_id);
          semanticIdx++;
        }
        if (options.contact_id !== undefined) {
          semanticConditions.push(`contact_id = $${semanticIdx}`);
          semanticParams.push(options.contact_id);
          semanticIdx++;
        }
        if (options.relationship_id !== undefined) {
          semanticConditions.push(`relationship_id = $${semanticIdx}`);
          semanticParams.push(options.relationship_id);
          semanticIdx++;
        }
        if (options.project_id !== undefined) {
          semanticConditions.push(`project_id = $${semanticIdx}`);
          semanticParams.push(options.project_id);
          semanticIdx++;
        }
        if (options.memory_type !== undefined) {
          semanticConditions.push(`memory_type = $${semanticIdx}::memory_type`);
          semanticParams.push(options.memory_type);
          semanticIdx++;
        }
        if (options.tags !== undefined && options.tags.length > 0) {
          semanticConditions.push(`tags @> $${semanticIdx}`);
          semanticParams.push(options.tags);
          semanticIdx++;
        }
        // Temporal filters (issue #1272)
        if (options.created_after !== undefined) {
          semanticConditions.push(`created_at >= $${semanticIdx}`);
          semanticParams.push(options.created_after.toISOString());
          semanticIdx++;
        }
        if (options.created_before !== undefined) {
          semanticConditions.push(`created_at < $${semanticIdx}`);
          semanticParams.push(options.created_before.toISOString());
          semanticIdx++;
        }

        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const allParams = [embeddingStr, min_similarity, ...semanticParams, limit, offset];
        const whereClause = semanticConditions.length > 0 ? `AND ${semanticConditions.join(' AND ')}` : '';

        const result = await pool.query(
          `SELECT
            id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
            title, content, memory_type::text, tags,
            created_by_agent, created_by_human, source_url,
            importance, confidence, expires_at, superseded_by::text,
            embedding_status, lat, lng, address, place_label, created_at, updated_at,
            1 - (embedding <=> $1::vector) as similarity
          FROM memory
          WHERE embedding IS NOT NULL
            AND 1 - (embedding <=> $1::vector) >= $2
            ${whereClause}
          ORDER BY similarity DESC, importance DESC
          LIMIT $${semanticIdx} OFFSET $${semanticIdx + 1}`,
          allParams,
        );

        // Map results with similarity scores
        const rawResults = result.rows.map((row) => ({
          ...mapRowToMemory(row as Record<string, unknown>),
          similarity: Number.parseFloat(row.similarity as string),
        }));

        // Apply keyword boosting to improve ranking
        const boostedResults = applyKeywordBoost(rawResults, query);

        return {
          results: boostedResults,
          search_type: 'semantic',
          query_embedding_provider: embeddingResult.provider,
        };
      }
    }
  } catch (error) {
    console.warn('[Memory] Semantic search failed, falling back to text search:', error);
  }

  // Fall back to text search
  // Build text search conditions with proper indexing
  // $1 = query text, then filter params, then limit/offset
  const textConditions: string[] = ['(expires_at IS NULL OR expires_at > NOW())', 'superseded_by IS NULL'];
  const textParams: unknown[] = [query];
  let textIdx = 2; // Start after query

  if (options.user_email !== undefined) {
    textConditions.push(`user_email = $${textIdx}`);
    textParams.push(options.user_email);
    textIdx++;
  }
  if (options.work_item_id !== undefined) {
    textConditions.push(`work_item_id = $${textIdx}`);
    textParams.push(options.work_item_id);
    textIdx++;
  }
  if (options.contact_id !== undefined) {
    textConditions.push(`contact_id = $${textIdx}`);
    textParams.push(options.contact_id);
    textIdx++;
  }
  if (options.relationship_id !== undefined) {
    textConditions.push(`relationship_id = $${textIdx}`);
    textParams.push(options.relationship_id);
    textIdx++;
  }
  if (options.project_id !== undefined) {
    textConditions.push(`project_id = $${textIdx}`);
    textParams.push(options.project_id);
    textIdx++;
  }
  if (options.memory_type !== undefined) {
    textConditions.push(`memory_type = $${textIdx}::memory_type`);
    textParams.push(options.memory_type);
    textIdx++;
  }
  if (options.tags !== undefined && options.tags.length > 0) {
    textConditions.push(`tags @> $${textIdx}`);
    textParams.push(options.tags);
    textIdx++;
  }
  // Temporal filters (issue #1272)
  if (options.created_after !== undefined) {
    textConditions.push(`created_at >= $${textIdx}`);
    textParams.push(options.created_after.toISOString());
    textIdx++;
  }
  if (options.created_before !== undefined) {
    textConditions.push(`created_at < $${textIdx}`);
    textParams.push(options.created_before.toISOString());
    textIdx++;
  }

  textParams.push(limit, offset);
  const whereClause = textConditions.length > 0 ? `AND ${textConditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text, project_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, lat, lng, address, place_label, created_at, updated_at,
      ts_rank(search_vector, websearch_to_tsquery('english', $1)) as similarity
    FROM memory
    WHERE search_vector @@ websearch_to_tsquery('english', $1)
      ${whereClause}
    ORDER BY similarity DESC, importance DESC
    LIMIT $${textIdx} OFFSET $${textIdx + 1}`,
    textParams,
  );

  return {
    results: result.rows.map((row) => ({
      ...mapRowToMemory(row as Record<string, unknown>),
      similarity: Number.parseFloat(row.similarity as string),
    })),
    search_type: 'text',
  };
}
