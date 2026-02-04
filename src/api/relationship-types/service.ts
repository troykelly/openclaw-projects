/**
 * Service layer for relationship types.
 * Part of Epic #486, Issue #490
 *
 * Provides CRUD operations and semantic matching for relationship types.
 * Relationship types define how contacts relate to each other
 * (e.g., partner_of, parent_of/child_of).
 */

import type { Pool } from 'pg';
import type {
  RelationshipTypeEntry,
  RelationshipTypeWithInverse,
  CreateRelationshipTypeInput,
  UpdateRelationshipTypeInput,
  ListRelationshipTypesOptions,
  ListRelationshipTypesResult,
  SemanticMatchResult,
  RelationshipTypeEmbeddingStatus,
} from './types.ts';

/**
 * Maps a database row to a RelationshipTypeEntry.
 */
function mapRowToRelationshipType(row: Record<string, unknown>): RelationshipTypeEntry {
  return {
    id: row.id as string,
    name: row.name as string,
    label: row.label as string,
    isDirectional: row.is_directional as boolean,
    inverseTypeId: (row.inverse_type_id as string) ?? null,
    description: (row.description as string) ?? null,
    createdByAgent: (row.created_by_agent as string) ?? null,
    embeddingStatus: row.embedding_status as RelationshipTypeEmbeddingStatus,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Maps a database row to a RelationshipTypeWithInverse.
 */
function mapRowToRelationshipTypeWithInverse(row: Record<string, unknown>): RelationshipTypeWithInverse {
  const base = mapRowToRelationshipType(row);
  const inverseType = row.inverse_name
    ? {
        id: row.inverse_id as string,
        name: row.inverse_name as string,
        label: row.inverse_label as string,
      }
    : null;

  return { ...base, inverseType };
}

/** SQL fragment to select all relationship type columns with inverse join */
const SELECT_WITH_INVERSE = `
  SELECT
    rt.id::text as id,
    rt.name,
    rt.label,
    rt.is_directional,
    rt.inverse_type_id::text as inverse_type_id,
    rt.description,
    rt.created_by_agent,
    rt.embedding_status,
    rt.created_at,
    rt.updated_at,
    inv.id::text as inverse_id,
    inv.name as inverse_name,
    inv.label as inverse_label
  FROM relationship_type rt
  LEFT JOIN relationship_type inv ON rt.inverse_type_id = inv.id
`;

/** SQL fragment to select basic relationship type columns */
const SELECT_BASIC = `
  SELECT
    id::text as id,
    name,
    label,
    is_directional,
    inverse_type_id::text as inverse_type_id,
    description,
    created_by_agent,
    embedding_status,
    created_at,
    updated_at
  FROM relationship_type
`;

/**
 * Lists relationship types with optional filtering and pagination.
 */
export async function listRelationshipTypes(
  pool: Pool,
  options: ListRelationshipTypesOptions = {}
): Promise<ListRelationshipTypesResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options.isDirectional !== undefined) {
    conditions.push(`rt.is_directional = $${paramIndex}`);
    params.push(options.isDirectional);
    paramIndex++;
  }

  if (options.createdByAgent !== undefined) {
    conditions.push(`rt.created_by_agent = $${paramIndex}`);
    params.push(options.createdByAgent);
    paramIndex++;
  }

  if (options.preSeededOnly) {
    conditions.push('rt.created_by_agent IS NULL');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM relationship_type rt ${whereClause}`,
    params
  );
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get paginated results
  const limit = Math.min(options.limit ?? 100, 200);
  const offset = options.offset ?? 0;

  params.push(limit, offset);

  const result = await pool.query(
    `${SELECT_WITH_INVERSE}
    ${whereClause}
    ORDER BY rt.name ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    types: result.rows.map((row) => mapRowToRelationshipTypeWithInverse(row as Record<string, unknown>)),
    total,
  };
}

/**
 * Gets a relationship type by ID.
 */
export async function getRelationshipType(
  pool: Pool,
  id: string
): Promise<RelationshipTypeEntry | null> {
  const result = await pool.query(
    `${SELECT_BASIC} WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToRelationshipType(result.rows[0] as Record<string, unknown>);
}

/**
 * Gets a relationship type by its canonical name.
 */
export async function getRelationshipTypeByName(
  pool: Pool,
  name: string
): Promise<RelationshipTypeEntry | null> {
  const result = await pool.query(
    `${SELECT_BASIC} WHERE name = $1`,
    [name]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToRelationshipType(result.rows[0] as Record<string, unknown>);
}

/**
 * Creates a new relationship type.
 *
 * If inverseTypeName is provided:
 * 1. Looks up the inverse type by name
 * 2. Sets inverse_type_id on the new type
 * 3. Updates the inverse type to point back to the new type
 *
 * @throws Error if name or label is empty
 * @throws Error if inverse type name doesn't exist
 */
export async function createRelationshipType(
  pool: Pool,
  input: CreateRelationshipTypeInput
): Promise<RelationshipTypeEntry> {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error('Name is required');
  }

  if (!input.label || input.label.trim().length === 0) {
    throw new Error('Label is required');
  }

  let inverseTypeId: string | null = null;

  // Look up inverse type if specified
  if (input.inverseTypeName) {
    const inverseType = await getRelationshipTypeByName(pool, input.inverseTypeName);
    if (!inverseType) {
      throw new Error(`Inverse type '${input.inverseTypeName}' not found`);
    }
    inverseTypeId = inverseType.id;
  }

  const result = await pool.query(
    `INSERT INTO relationship_type (
      name, label, is_directional, inverse_type_id,
      description, created_by_agent
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id::text as id, name, label, is_directional,
      inverse_type_id::text as inverse_type_id, description,
      created_by_agent, embedding_status, created_at, updated_at`,
    [
      input.name.trim(),
      input.label.trim(),
      input.isDirectional ?? false,
      inverseTypeId,
      input.description ?? null,
      input.createdByAgent ?? null,
    ]
  );

  const newType = mapRowToRelationshipType(result.rows[0] as Record<string, unknown>);

  // If we have an inverse type, update it to point back to us
  if (inverseTypeId) {
    await pool.query(
      'UPDATE relationship_type SET inverse_type_id = $1 WHERE id = $2',
      [newType.id, inverseTypeId]
    );
  }

  // Trigger embedding asynchronously
  triggerRelationshipTypeEmbedding(pool, newType.id);

  return newType;
}

/**
 * Updates a relationship type's label and/or description.
 */
export async function updateRelationshipType(
  pool: Pool,
  id: string,
  input: UpdateRelationshipTypeInput
): Promise<RelationshipTypeEntry | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.label !== undefined) {
    updates.push(`label = $${paramIndex}`);
    params.push(input.label);
    paramIndex++;
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    params.push(input.description);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getRelationshipType(pool, id);
  }

  params.push(id);

  const result = await pool.query(
    `UPDATE relationship_type SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING
      id::text as id, name, label, is_directional,
      inverse_type_id::text as inverse_type_id, description,
      created_by_agent, embedding_status, created_at, updated_at`,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToRelationshipType(result.rows[0] as Record<string, unknown>);
}

/**
 * Deletes a relationship type.
 *
 * If the type has an inverse, clears the inverse's inverse_type_id reference.
 */
export async function deleteRelationshipType(
  pool: Pool,
  id: string
): Promise<boolean> {
  // First, clear any inverse references to this type
  await pool.query(
    'UPDATE relationship_type SET inverse_type_id = NULL WHERE inverse_type_id = $1',
    [id]
  );

  const result = await pool.query(
    'DELETE FROM relationship_type WHERE id = $1 RETURNING id',
    [id]
  );

  return result.rows.length > 0;
}

/**
 * Performs a text-based search against the search_vector tsvector column.
 * Used as fallback when semantic search is unavailable or yields no results.
 */
async function textSearch(
  pool: Pool,
  query: string,
  limit: number
): Promise<SemanticMatchResult[]> {
  const result = await pool.query(
    `SELECT
      id::text as id, name, label, is_directional,
      inverse_type_id::text as inverse_type_id, description,
      created_by_agent, embedding_status, created_at, updated_at,
      ts_rank(search_vector, websearch_to_tsquery('english', $1)) as similarity
    FROM relationship_type
    WHERE search_vector @@ websearch_to_tsquery('english', $1)
    ORDER BY similarity DESC
    LIMIT $2`,
    [query, limit]
  );

  return result.rows.map((row) => ({
    type: mapRowToRelationshipType(row as Record<string, unknown>),
    similarity: parseFloat((row as Record<string, unknown>).similarity as string),
  }));
}

/**
 * Finds relationship types that semantically match a query string.
 *
 * Uses embedding similarity when available, falls back to full-text search.
 * If semantic search returns no results (e.g., no embeddings generated yet),
 * it automatically falls back to text search.
 *
 * This is used to prevent duplicate types (e.g., "spouse_of" when "partner_of" exists).
 */
export async function findSemanticMatch(
  pool: Pool,
  query: string,
  options: { limit?: number; minSimilarity?: number } = {}
): Promise<SemanticMatchResult[]> {
  const limit = Math.min(options.limit ?? 10, 50);
  const minSimilarity = options.minSimilarity ?? 0.1;

  // Try semantic search first if embeddings service is available
  try {
    const { embeddingService } = await import('../embeddings/index.ts');

    if (embeddingService.isConfigured()) {
      const embeddingResult = await embeddingService.embed(query);

      if (embeddingResult) {
        const embeddingStr = `[${embeddingResult.embedding.join(',')}]`;

        const result = await pool.query(
          `SELECT
            id::text as id, name, label, is_directional,
            inverse_type_id::text as inverse_type_id, description,
            created_by_agent, embedding_status, created_at, updated_at,
            1 - (embedding <=> $1::vector) as similarity
          FROM relationship_type
          WHERE embedding IS NOT NULL
            AND 1 - (embedding <=> $1::vector) >= $2
          ORDER BY similarity DESC
          LIMIT $3`,
          [embeddingStr, minSimilarity, limit]
        );

        // If semantic search found results, return them
        if (result.rows.length > 0) {
          return result.rows.map((row) => ({
            type: mapRowToRelationshipType(row as Record<string, unknown>),
            similarity: parseFloat((row as Record<string, unknown>).similarity as string),
          }));
        }

        // No semantic results (possibly no embeddings yet) - fall through to text search
      }
    }
  } catch {
    // Embedding service not available, fall back to text search
  }

  // Fall back to full-text search
  return textSearch(pool, query, limit);
}

/**
 * Triggers embedding generation for a relationship type asynchronously.
 * Non-blocking: errors are logged but do not propagate.
 */
function triggerRelationshipTypeEmbedding(pool: Pool, typeId: string): void {
  embedRelationshipType(pool, typeId).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot use a pool after calling end')) return;
    console.error(`[Embeddings] Background embedding failed for relationship type ${typeId}:`, msg);
  });
}

/**
 * Generates and stores an embedding for a relationship type.
 *
 * The embedding text includes the name, label, and description to enable
 * semantic matching (e.g., searching for "spouse" finds "partner_of").
 */
export async function embedRelationshipType(
  pool: Pool,
  typeId: string
): Promise<RelationshipTypeEmbeddingStatus> {
  // Fetch the type
  const result = await pool.query(
    `SELECT id::text as id, name, label, description
     FROM relationship_type WHERE id = $1`,
    [typeId]
  );

  if (result.rows.length === 0) {
    return 'failed';
  }

  const row = result.rows[0] as { id: string; name: string; label: string; description: string | null };

  try {
    const { embeddingService } = await import('../embeddings/index.ts');

    if (!embeddingService.isConfigured()) {
      return 'pending';
    }

    // Build embedding text: name + label + description
    const text = [
      row.name.replace(/_/g, ' '),
      row.label,
      row.description ?? '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 8000);

    const embeddingResult = await embeddingService.embed(text);

    if (!embeddingResult) {
      return 'pending';
    }

    await pool.query(
      `UPDATE relationship_type
       SET embedding = $1::vector,
           embedding_status = 'complete'
       WHERE id = $2`,
      [`[${embeddingResult.embedding.join(',')}]`, typeId]
    );

    return 'complete';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Cannot use a pool after calling end')) return 'failed';

    console.error(`[Embeddings] Failed to embed relationship type ${typeId}:`, msg);

    await pool.query(
      `UPDATE relationship_type SET embedding_status = 'failed' WHERE id = $1`,
      [typeId]
    ).catch(() => {});

    return 'failed';
  }
}
