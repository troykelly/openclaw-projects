/**
 * Memory service for the unified memory system.
 * Part of Epic #199, Issue #209
 * Tags support added in Issue #492
 * Relationship scope added in Issue #493
 */

import type { Pool } from 'pg';
import type {
  MemoryEntry,
  CreateMemoryInput,
  UpdateMemoryInput,
  ListMemoriesOptions,
  ListMemoriesResult,
  SearchMemoriesOptions,
  MemorySearchResult,
  MemoryType,
} from './types.ts';

/** Valid memory types for validation */
const VALID_MEMORY_TYPES: MemoryType[] = ['preference', 'fact', 'note', 'decision', 'context', 'reference'];

/**
 * Maps database row to MemoryEntry
 */
function mapRowToMemory(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    userEmail: row.user_email as string | null,
    workItemId: row.work_item_id as string | null,
    contactId: row.contact_id as string | null,
    relationshipId: row.relationship_id as string | null,
    title: row.title as string,
    content: row.content as string,
    memoryType: row.memory_type as MemoryType,
    tags: (row.tags as string[]) ?? [],
    createdByAgent: row.created_by_agent as string | null,
    createdByHuman: (row.created_by_human as boolean) ?? false,
    sourceUrl: row.source_url as string | null,
    importance: row.importance as number,
    confidence: row.confidence as number,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    supersededBy: row.superseded_by as string | null,
    embeddingStatus: row.embedding_status as 'pending' | 'complete' | 'failed',
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
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
 * Creates a new memory.
 */
export async function createMemory(pool: Pool, input: CreateMemoryInput): Promise<MemoryEntry> {
  const memoryType = input.memoryType ?? 'note';

  if (!isValidMemoryType(memoryType)) {
    throw new Error(`Invalid memory type: ${memoryType}. Valid types are: ${VALID_MEMORY_TYPES.join(', ')}`);
  }

  // At least one scope should be set
  if (!input.userEmail && !input.workItemId && !input.contactId && !input.relationshipId) {
    // Default to requiring at least some scope for organization
    // For now, allow completely unscoped memories but log a warning
    console.warn('[Memory] Creating memory without scope - consider adding userEmail, workItemId, contactId, or relationshipId');
  }

  const tags = input.tags ?? [];

  const result = await pool.query(
    `INSERT INTO memory (
      user_email, work_item_id, contact_id, relationship_id,
      title, content, memory_type,
      tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::memory_type, $8, $9, $10, $11, $12, $13, $14)
    RETURNING
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, created_at, updated_at`,
    [
      input.userEmail ?? null,
      input.workItemId ?? null,
      input.contactId ?? null,
      input.relationshipId ?? null,
      input.title,
      input.content,
      memoryType,
      tags,
      input.createdByAgent ?? null,
      input.createdByHuman ?? false,
      input.sourceUrl ?? null,
      input.importance ?? 5,
      input.confidence ?? 1.0,
      input.expiresAt ?? null,
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
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, created_at, updated_at
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

  if (input.memoryType !== undefined) {
    if (!isValidMemoryType(input.memoryType)) {
      throw new Error(`Invalid memory type: ${input.memoryType}`);
    }
    updates.push(`memory_type = $${paramIndex}::memory_type`);
    params.push(input.memoryType);
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

  if (input.expiresAt !== undefined) {
    updates.push(`expires_at = $${paramIndex}`);
    params.push(input.expiresAt);
    paramIndex++;
  }

  if (input.supersededBy !== undefined) {
    updates.push(`superseded_by = $${paramIndex}`);
    params.push(input.supersededBy);
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
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, created_at, updated_at`,
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
  if (options.userEmail !== undefined) {
    conditions.push(`user_email = $${paramIndex}`);
    params.push(options.userEmail);
    paramIndex++;
  }

  if (options.workItemId !== undefined) {
    conditions.push(`work_item_id = $${paramIndex}`);
    params.push(options.workItemId);
    paramIndex++;
  }

  if (options.contactId !== undefined) {
    conditions.push(`contact_id = $${paramIndex}`);
    params.push(options.contactId);
    paramIndex++;
  }

  if (options.relationshipId !== undefined) {
    conditions.push(`relationship_id = $${paramIndex}`);
    params.push(options.relationshipId);
    paramIndex++;
  }

  // Type filter
  if (options.memoryType !== undefined) {
    conditions.push(`memory_type = $${paramIndex}::memory_type`);
    params.push(options.memoryType);
    paramIndex++;
  }

  // Tag filter (array containment: memory must have ALL specified tags)
  if (options.tags !== undefined && options.tags.length > 0) {
    conditions.push(`tags @> $${paramIndex}`);
    params.push(options.tags);
    paramIndex++;
  }

  // Exclude expired unless requested
  if (!options.includeExpired) {
    conditions.push(`(expires_at IS NULL OR expires_at > NOW())`);
  }

  // Exclude superseded unless requested
  if (!options.includeSuperseded) {
    conditions.push(`superseded_by IS NULL`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM memory ${whereClause}`, params);
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get paginated results
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, created_at, updated_at
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
  userEmail: string,
  options: { memoryType?: MemoryType; limit?: number; offset?: number } = {},
): Promise<ListMemoriesResult> {
  const conditions: string[] = [
    'user_email = $1',
    'work_item_id IS NULL',
    'contact_id IS NULL',
    'relationship_id IS NULL',
    '(expires_at IS NULL OR expires_at > NOW())',
    'superseded_by IS NULL',
  ];
  const params: unknown[] = [userEmail];
  let paramIndex = 2;

  if (options.memoryType !== undefined) {
    conditions.push(`memory_type = $${paramIndex}::memory_type`);
    params.push(options.memoryType);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM memory ${whereClause}`, params);
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get paginated results
  const limit = Math.min(options.limit ?? 50, 100);
  const offset = options.offset ?? 0;

  params.push(limit, offset);

  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, created_at, updated_at
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
 * Searches memories semantically using embeddings or falls back to text search.
 */
export async function searchMemories(pool: Pool, query: string, options: SearchMemoriesOptions = {}): Promise<MemorySearchResult> {
  const limit = Math.min(options.limit ?? 20, 100);
  const offset = options.offset ?? 0;
  const minSimilarity = options.minSimilarity ?? 0.3;

  // Try semantic search first
  try {
    const { embeddingService } = await import('../embeddings/index.ts');

    if (embeddingService.isConfigured()) {
      const embeddingResult = await embeddingService.embed(query);

      if (embeddingResult) {
        const queryEmbedding = embeddingResult.embedding;
        // Build semantic search conditions with proper indexing
        // $1 = embedding, $2 = minSimilarity, then filter params, then limit/offset
        const semanticConditions: string[] = ['(expires_at IS NULL OR expires_at > NOW())', 'superseded_by IS NULL'];
        const semanticParams: unknown[] = [];
        let semanticIdx = 3; // Start after embedding and minSimilarity

        if (options.userEmail !== undefined) {
          semanticConditions.push(`user_email = $${semanticIdx}`);
          semanticParams.push(options.userEmail);
          semanticIdx++;
        }
        if (options.workItemId !== undefined) {
          semanticConditions.push(`work_item_id = $${semanticIdx}`);
          semanticParams.push(options.workItemId);
          semanticIdx++;
        }
        if (options.contactId !== undefined) {
          semanticConditions.push(`contact_id = $${semanticIdx}`);
          semanticParams.push(options.contactId);
          semanticIdx++;
        }
        if (options.relationshipId !== undefined) {
          semanticConditions.push(`relationship_id = $${semanticIdx}`);
          semanticParams.push(options.relationshipId);
          semanticIdx++;
        }
        if (options.memoryType !== undefined) {
          semanticConditions.push(`memory_type = $${semanticIdx}::memory_type`);
          semanticParams.push(options.memoryType);
          semanticIdx++;
        }
        if (options.tags !== undefined && options.tags.length > 0) {
          semanticConditions.push(`tags @> $${semanticIdx}`);
          semanticParams.push(options.tags);
          semanticIdx++;
        }

        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const allParams = [embeddingStr, minSimilarity, ...semanticParams, limit, offset];
        const whereClause = semanticConditions.length > 0 ? `AND ${semanticConditions.join(' AND ')}` : '';

        const result = await pool.query(
          `SELECT
            id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
            title, content, memory_type::text, tags,
            created_by_agent, created_by_human, source_url,
            importance, confidence, expires_at, superseded_by::text,
            embedding_status, created_at, updated_at,
            1 - (embedding <=> $1::vector) as similarity
          FROM memory
          WHERE embedding IS NOT NULL
            AND 1 - (embedding <=> $1::vector) >= $2
            ${whereClause}
          ORDER BY similarity DESC, importance DESC
          LIMIT $${semanticIdx} OFFSET $${semanticIdx + 1}`,
          allParams,
        );

        return {
          results: result.rows.map((row) => ({
            ...mapRowToMemory(row as Record<string, unknown>),
            similarity: parseFloat(row.similarity as string),
          })),
          searchType: 'semantic',
          queryEmbeddingProvider: embeddingResult.provider,
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

  if (options.userEmail !== undefined) {
    textConditions.push(`user_email = $${textIdx}`);
    textParams.push(options.userEmail);
    textIdx++;
  }
  if (options.workItemId !== undefined) {
    textConditions.push(`work_item_id = $${textIdx}`);
    textParams.push(options.workItemId);
    textIdx++;
  }
  if (options.contactId !== undefined) {
    textConditions.push(`contact_id = $${textIdx}`);
    textParams.push(options.contactId);
    textIdx++;
  }
  if (options.relationshipId !== undefined) {
    textConditions.push(`relationship_id = $${textIdx}`);
    textParams.push(options.relationshipId);
    textIdx++;
  }
  if (options.memoryType !== undefined) {
    textConditions.push(`memory_type = $${textIdx}::memory_type`);
    textParams.push(options.memoryType);
    textIdx++;
  }
  if (options.tags !== undefined && options.tags.length > 0) {
    textConditions.push(`tags @> $${textIdx}`);
    textParams.push(options.tags);
    textIdx++;
  }

  textParams.push(limit, offset);
  const whereClause = textConditions.length > 0 ? `AND ${textConditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
      id::text, user_email, work_item_id::text, contact_id::text, relationship_id::text,
      title, content, memory_type::text, tags,
      created_by_agent, created_by_human, source_url,
      importance, confidence, expires_at, superseded_by::text,
      embedding_status, created_at, updated_at,
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
      similarity: parseFloat(row.similarity as string),
    })),
    searchType: 'text',
  };
}
