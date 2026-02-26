/**
 * Service layer for relationships between contacts.
 * Part of Epic #486, Issue #491
 *
 * Provides CRUD operations, graph traversal, group membership queries,
 * and smart relationship creation (resolving contacts/types by name).
 */

import type { Pool } from 'pg';
import type {
  RelationshipEntry,
  RelationshipWithDetails,
  CreateRelationshipInput,
  UpdateRelationshipInput,
  ListRelationshipsOptions,
  ListRelationshipsResult,
  RelatedContact,
  GraphTraversalResult,
  GroupMembership,
  RelationshipSetInput,
  RelationshipSetResult,
} from './types.ts';

/**
 * Maps a database row to a RelationshipEntry.
 */
function mapRowToRelationship(row: Record<string, unknown>): RelationshipEntry {
  return {
    id: row.id as string,
    contact_a_id: row.contact_a_id as string,
    contact_b_id: row.contact_b_id as string,
    relationship_type_id: row.relationship_type_id as string,
    notes: (row.notes as string) ?? null,
    created_by_agent: (row.created_by_agent as string) ?? null,
    embedding_status: row.embedding_status as 'pending' | 'complete' | 'failed',
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * Maps a database row to a RelationshipWithDetails.
 */
function mapRowToRelationshipWithDetails(row: Record<string, unknown>): RelationshipWithDetails {
  return {
    ...mapRowToRelationship(row),
    contact_a_name: row.contact_a_name as string,
    contact_b_name: row.contact_b_name as string,
    relationship_type: {
      id: row.rt_id as string,
      name: row.rt_name as string,
      label: row.rt_label as string,
      is_directional: row.rt_is_directional as boolean,
    },
  };
}

/** SQL fragment for selecting relationships with details */
const SELECT_WITH_DETAILS = `
  SELECT
    r.id::text as id,
    r.contact_a_id::text as contact_a_id,
    r.contact_b_id::text as contact_b_id,
    r.relationship_type_id::text as relationship_type_id,
    r.notes,
    r.created_by_agent,
    r.embedding_status,
    r.created_at,
    r.updated_at,
    ca.display_name as contact_a_name,
    cb.display_name as contact_b_name,
    rt.id::text as rt_id,
    rt.name as rt_name,
    rt.label as rt_label,
    rt.is_directional as rt_is_directional
  FROM relationship r
  JOIN contact ca ON r.contact_a_id = ca.id
  JOIN contact cb ON r.contact_b_id = cb.id
  JOIN relationship_type rt ON r.relationship_type_id = rt.id
`;

/** SQL fragment for selecting basic relationship columns */
const SELECT_BASIC = `
  SELECT
    id::text as id,
    contact_a_id::text as contact_a_id,
    contact_b_id::text as contact_b_id,
    relationship_type_id::text as relationship_type_id,
    notes,
    created_by_agent,
    embedding_status,
    created_at,
    updated_at
  FROM relationship
`;

/**
 * Creates a new relationship between two contacts.
 *
 * @throws Error if contacts are the same (self-relationship)
 * @throws Error if duplicate relationship exists
 */
export async function createRelationship(pool: Pool, input: CreateRelationshipInput): Promise<RelationshipEntry> {
  if (input.contact_a_id === input.contact_b_id) {
    throw new Error('Cannot create a self-relationship');
  }

  const result = await pool.query(
    `INSERT INTO relationship (
      contact_a_id, contact_b_id, relationship_type_id,
      notes, created_by_agent, namespace
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id::text as id,
      contact_a_id::text as contact_a_id,
      contact_b_id::text as contact_b_id,
      relationship_type_id::text as relationship_type_id,
      notes, created_by_agent, embedding_status,
      created_at, updated_at`,
    [input.contact_a_id, input.contact_b_id, input.relationship_type_id, input.notes ?? null, input.created_by_agent ?? null, input.namespace ?? 'default'],
  );

  return mapRowToRelationship(result.rows[0] as Record<string, unknown>);
}

/**
 * Gets a relationship by ID with expanded contact and type details.
 */
export async function getRelationship(pool: Pool, id: string): Promise<RelationshipWithDetails | null> {
  const result = await pool.query(`${SELECT_WITH_DETAILS} WHERE r.id = $1`, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToRelationshipWithDetails(result.rows[0] as Record<string, unknown>);
}

/**
 * Updates an existing relationship.
 */
export async function updateRelationship(pool: Pool, id: string, input: UpdateRelationshipInput): Promise<RelationshipEntry | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.relationship_type_id !== undefined) {
    updates.push(`relationship_type_id = $${paramIndex}`);
    params.push(input.relationship_type_id);
    paramIndex++;
  }

  if (input.notes !== undefined) {
    updates.push(`notes = $${paramIndex}`);
    params.push(input.notes);
    paramIndex++;
  }

  if (updates.length === 0) {
    // No updates, just return existing
    const result = await pool.query(`${SELECT_BASIC} WHERE id = $1`, [id]);
    if (result.rows.length === 0) return null;
    return mapRowToRelationship(result.rows[0] as Record<string, unknown>);
  }

  params.push(id);

  const result = await pool.query(
    `UPDATE relationship SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING
      id::text as id,
      contact_a_id::text as contact_a_id,
      contact_b_id::text as contact_b_id,
      relationship_type_id::text as relationship_type_id,
      notes, created_by_agent, embedding_status,
      created_at, updated_at`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToRelationship(result.rows[0] as Record<string, unknown>);
}

/**
 * Deletes a relationship.
 */
export async function deleteRelationship(pool: Pool, id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM relationship WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

/**
 * Lists relationships with optional filtering and pagination.
 */
export async function listRelationships(pool: Pool, options: ListRelationshipsOptions = {}): Promise<ListRelationshipsResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options.contact_id !== undefined) {
    conditions.push(`(r.contact_a_id = $${paramIndex} OR r.contact_b_id = $${paramIndex})`);
    params.push(options.contact_id);
    paramIndex++;
  }

  if (options.relationship_type_id !== undefined) {
    conditions.push(`r.relationship_type_id = $${paramIndex}`);
    params.push(options.relationship_type_id);
    paramIndex++;
  }

  if (options.created_by_agent !== undefined) {
    conditions.push(`r.created_by_agent = $${paramIndex}`);
    params.push(options.created_by_agent);
    paramIndex++;
  }

  // Epic #1418 Phase 4: namespace-based scoping (user_email column dropped from relationship table)
  if (options.queryNamespaces && options.queryNamespaces.length > 0) {
    conditions.push(`r.namespace = ANY($${paramIndex}::text[])`);
    params.push(options.queryNamespaces as unknown as string);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) as total FROM relationship r ${whereClause}`, params);
  const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

  // Get paginated results
  const limit = Math.min(options.limit ?? 100, 200);
  const offset = options.offset ?? 0;

  params.push(limit, offset);

  const result = await pool.query(
    `${SELECT_WITH_DETAILS}
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params,
  );

  return {
    relationships: result.rows.map((row) => mapRowToRelationshipWithDetails(row as Record<string, unknown>)),
    total,
  };
}

/**
 * Graph traversal: given a contact, returns all related contacts with
 * effective relationship types. Handles inverse resolution for directional types.
 *
 * Logic:
 * 1. Find rows where contact_a_id = X -> return type as-is
 * 2. Find rows where contact_b_id = X:
 *    - If type is symmetric (is_directional = false) -> return type as-is
 *    - If type is directional (is_directional = true) -> return inverse type
 * 3. Combine results
 */
export async function getRelatedContacts(pool: Pool, contact_id: string): Promise<GraphTraversalResult> {
  // Get the contact's name first
  const contactResult = await pool.query(`SELECT display_name FROM contact WHERE id = $1`, [contact_id]);
  const contact_name = contactResult.rows.length > 0 ? (contactResult.rows[0] as { display_name: string }).display_name : 'Unknown';

  // Check if contact_kind column exists (added in separate migration 044_contact_kind)
  const kindColCheck = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'contact' AND column_name = 'contact_kind'`,
  );
  const hasContactKind = kindColCheck.rows.length > 0;
  const contactKindSelect = hasContactKind ? `c_ref.contact_kind::text as contact_kind` : `'person' as contact_kind`;

  const graphParams: string[] = [contact_id];

  // Query 1: Contact is on the A side -> type as-is, related contact is B
  const aSideResult = await pool.query(
    `SELECT
      cb.id::text as contact_id,
      cb.display_name as contact_name,
      ${contactKindSelect.replace('c_ref', 'cb')},
      r.id::text as relationship_id,
      rt.name as relationship_type_name,
      rt.label as relationship_type_label,
      rt.is_directional,
      r.notes
    FROM relationship r
    JOIN contact cb ON r.contact_b_id = cb.id
    JOIN relationship_type rt ON r.relationship_type_id = rt.id
    WHERE r.contact_a_id = $1`,
    graphParams,
  );

  // Query 2: Contact is on the B side
  // For symmetric types: use the type as-is
  // For directional types: use the inverse type
  const bSideResult = await pool.query(
    `SELECT
      ca.id::text as contact_id,
      ca.display_name as contact_name,
      ${contactKindSelect.replace('c_ref', 'ca')},
      r.id::text as relationship_id,
      CASE
        WHEN rt.is_directional = false THEN rt.name
        WHEN rt.is_directional = true AND inv.name IS NOT NULL THEN inv.name
        ELSE rt.name
      END as relationship_type_name,
      CASE
        WHEN rt.is_directional = false THEN rt.label
        WHEN rt.is_directional = true AND inv.label IS NOT NULL THEN inv.label
        ELSE rt.label
      END as relationship_type_label,
      rt.is_directional,
      r.notes
    FROM relationship r
    JOIN contact ca ON r.contact_a_id = ca.id
    JOIN relationship_type rt ON r.relationship_type_id = rt.id
    LEFT JOIN relationship_type inv ON rt.inverse_type_id = inv.id
    WHERE r.contact_b_id = $1`,
    graphParams,
  );

  const related_contacts: RelatedContact[] = [];

  for (const row of aSideResult.rows) {
    const r = row as Record<string, unknown>;
    related_contacts.push({
      contact_id: r.contact_id as string,
      contact_name: r.contact_name as string,
      contact_kind: r.contact_kind as string,
      relationship_id: r.relationship_id as string,
      relationship_type_name: r.relationship_type_name as string,
      relationship_type_label: r.relationship_type_label as string,
      is_directional: r.is_directional as boolean,
      notes: (r.notes as string) ?? null,
    });
  }

  for (const row of bSideResult.rows) {
    const r = row as Record<string, unknown>;
    related_contacts.push({
      contact_id: r.contact_id as string,
      contact_name: r.contact_name as string,
      contact_kind: r.contact_kind as string,
      relationship_id: r.relationship_id as string,
      relationship_type_name: r.relationship_type_name as string,
      relationship_type_label: r.relationship_type_label as string,
      is_directional: r.is_directional as boolean,
      notes: (r.notes as string) ?? null,
    });
  }

  return {
    contact_id,
    contact_name,
    related_contacts,
  };
}

/**
 * Gets all members of a group contact.
 * Uses the has_member/member_of directional relationship type.
 */
export async function getGroupMembers(pool: Pool, groupContactId: string): Promise<GroupMembership[]> {
  const result = await pool.query(
    `SELECT
      r.id::text as relationship_id,
      cg.id::text as group_id,
      cg.display_name as group_name,
      cm.id::text as member_id,
      cm.display_name as member_name
    FROM relationship r
    JOIN contact cg ON r.contact_a_id = cg.id
    JOIN contact cm ON r.contact_b_id = cm.id
    JOIN relationship_type rt ON r.relationship_type_id = rt.id
    WHERE r.contact_a_id = $1
      AND rt.name = 'has_member'
    ORDER BY cm.display_name ASC`,
    [groupContactId],
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      group_id: r.group_id as string,
      group_name: r.group_name as string,
      member_id: r.member_id as string,
      member_name: r.member_name as string,
      relationship_id: r.relationship_id as string,
    };
  });
}

/**
 * Gets all groups a contact belongs to.
 * Uses the has_member/member_of directional relationship type.
 */
export async function getContactGroups(pool: Pool, contact_id: string): Promise<GroupMembership[]> {
  const result = await pool.query(
    `SELECT
      r.id::text as relationship_id,
      cg.id::text as group_id,
      cg.display_name as group_name,
      cm.id::text as member_id,
      cm.display_name as member_name
    FROM relationship r
    JOIN contact cg ON r.contact_a_id = cg.id
    JOIN contact cm ON r.contact_b_id = cm.id
    JOIN relationship_type rt ON r.relationship_type_id = rt.id
    WHERE r.contact_b_id = $1
      AND rt.name = 'has_member'
    ORDER BY cg.display_name ASC`,
    [contact_id],
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      group_id: r.group_id as string,
      group_name: r.group_name as string,
      member_id: r.member_id as string,
      member_name: r.member_name as string,
      relationship_id: r.relationship_id as string,
    };
  });
}

/**
 * Resolves a contact identifier (UUID or display name) to a contact ID and name.
 * Returns null if the contact cannot be found.
 *
 * UUID lookups: namespace-scoped when namespaces provided (Issue #1653)
 * Name lookups: namespace-scoped when namespaces provided (Issue #1646)
 */
async function resolveContact(
  pool: Pool,
  identifier: string,
  queryNamespaces?: string[],
): Promise<{ id: string; display_name: string } | null> {
  // Try as UUID first — namespace-scoped when namespaces provided (Issue #1653)
  // Design decision (#1830): Falls back to un-scoped lookup when namespace-scoped
  // search misses. M2M tokens are globally namespace-capable by design; this allows
  // agents to link contacts across namespaces (e.g., contacts created in 'default'
  // found by agent operating in 'troy'). Namespace-scoped match is preferred.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidPattern.test(identifier)) {
    // Try namespace-scoped first
    if (queryNamespaces?.length) {
      const result = await pool.query(
        `SELECT id::text as id, display_name FROM contact WHERE id = $1 AND namespace = ANY($2::text[])`,
        [identifier, queryNamespaces],
      );
      if (result.rows.length > 0) {
        const row = result.rows[0] as { id: string; display_name: string };
        return { id: row.id, display_name: row.display_name };
      }
    }
    // Fallback: un-scoped UUID lookup (#1830)
    const fallback = await pool.query(
      `SELECT id::text as id, display_name FROM contact WHERE id = $1`,
      [identifier],
    );
    if (fallback.rows.length > 0) {
      const row = fallback.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  }

  // Name lookup: match display_name OR constructed given+family name (Issue #1830)
  // Contacts created with given_name/family_name may have NULL display_name.
  const nameMatchClause = `(
    lower(display_name) = lower($1)
    OR lower(TRIM(COALESCE(given_name, '') || ' ' || COALESCE(family_name, ''))) = lower($1)
  ) AND deleted_at IS NULL`;

  // Try namespace-scoped name lookup first
  if (queryNamespaces && queryNamespaces.length > 0) {
    const nameResult = await pool.query(
      `SELECT id::text as id, COALESCE(display_name, TRIM(COALESCE(given_name, '') || ' ' || COALESCE(family_name, ''))) as display_name
       FROM contact
       WHERE ${nameMatchClause} AND namespace = ANY($2::text[])
       ORDER BY created_at ASC
       LIMIT 1`,
      [identifier, queryNamespaces],
    );
    if (nameResult.rows.length > 0) {
      const row = nameResult.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  }

  // Fallback: un-scoped name lookup (#1830)
  const nameResult = await pool.query(
    `SELECT id::text as id, COALESCE(display_name, TRIM(COALESCE(given_name, '') || ' ' || COALESCE(family_name, ''))) as display_name
     FROM contact
     WHERE ${nameMatchClause}
     ORDER BY created_at ASC
     LIMIT 1`,
    [identifier],
  );
  if (nameResult.rows.length > 0) {
    const row = nameResult.rows[0] as { id: string; display_name: string };
    return { id: row.id, display_name: row.display_name };
  }

  return null;
}

/**
 * Resolves a relationship type by exact name match or semantic/text search.
 * Returns the best matching type or null.
 */
async function resolveRelationshipType(pool: Pool, typeIdentifier: string): Promise<{ id: string; name: string; label: string } | null> {
  // Try exact name match first
  const exactResult = await pool.query(`SELECT id::text as id, name, label FROM relationship_type WHERE name = $1`, [typeIdentifier]);

  if (exactResult.rows.length > 0) {
    const row = exactResult.rows[0] as { id: string; name: string; label: string };
    return { id: row.id, name: row.name, label: row.label };
  }

  // Try semantic/text match
  const { findSemanticMatch } = await import('../relationship-types/index.ts');
  const matches = await findSemanticMatch(pool, typeIdentifier, { limit: 1, min_similarity: 0.1 });

  if (matches.length > 0) {
    const match = matches[0];
    return { id: match.type.id, name: match.type.name, label: match.type.label };
  }

  return null;
}

/**
 * Smart relationship creation: resolves contacts and type by name/semantic match,
 * creates the relationship in one call.
 *
 * relationship_set("Troy", "Alex", "partner"):
 * 1. Resolve "Troy" -> contact ID
 * 2. Resolve "Alex" -> contact ID
 * 3. Semantic-match "partner" against relationship_type embeddings
 * 4. If existing relationship found, return it
 * 5. Create relationship row
 * 6. Return structured confirmation
 *
 * @throws Error if either contact cannot be resolved
 * @throws Error if relationship type cannot be resolved
 */
export async function relationshipSet(pool: Pool, input: RelationshipSetInput): Promise<RelationshipSetResult> {
  // Step 1 & 2: Resolve contacts (with namespace scoping for name lookups, Issue #1646)
  const contact_a = await resolveContact(pool, input.contact_a, input.queryNamespaces);
  if (!contact_a) {
    throw new Error(`Contact "${input.contact_a}" cannot be resolved. No matching contact found.`);
  }

  const contact_b = await resolveContact(pool, input.contact_b, input.queryNamespaces);
  if (!contact_b) {
    throw new Error(`Contact "${input.contact_b}" cannot be resolved. No matching contact found.`);
  }

  // Step 3: Resolve relationship type
  const relType = await resolveRelationshipType(pool, input.relationship_type);
  if (!relType) {
    throw new Error(`Relationship type "${input.relationship_type}" cannot be resolved. No matching type found.`);
  }

  // Step 4: Check for existing relationship (with namespace scoping, Issue #1646)
  const existingQuery = input.queryNamespaces?.length
    ? `SELECT id::text as id, contact_a_id::text as contact_a_id,
              contact_b_id::text as contact_b_id,
              relationship_type_id::text as relationship_type_id,
              notes, created_by_agent, embedding_status,
              created_at, updated_at
       FROM relationship
       WHERE contact_a_id = $1 AND contact_b_id = $2 AND relationship_type_id = $3
         AND namespace = ANY($4::text[])`
    : `SELECT id::text as id, contact_a_id::text as contact_a_id,
              contact_b_id::text as contact_b_id,
              relationship_type_id::text as relationship_type_id,
              notes, created_by_agent, embedding_status,
              created_at, updated_at
       FROM relationship
       WHERE contact_a_id = $1 AND contact_b_id = $2 AND relationship_type_id = $3`;

  const existingParams = input.queryNamespaces?.length
    ? [contact_a.id, contact_b.id, relType.id, input.queryNamespaces]
    : [contact_a.id, contact_b.id, relType.id];

  const existingResult = await pool.query(existingQuery, existingParams);

  if (existingResult.rows.length > 0) {
    return {
      relationship: mapRowToRelationship(existingResult.rows[0] as Record<string, unknown>),
      contact_a: { id: contact_a.id, display_name: contact_a.display_name },
      contact_b: { id: contact_b.id, display_name: contact_b.display_name },
      relationship_type: relType,
      created: false,
    };
  }

  // Step 5: Create the relationship
  const relationship = await createRelationship(pool, {
    contact_a_id: contact_a.id,
    contact_b_id: contact_b.id,
    relationship_type_id: relType.id,
    notes: input.notes,
    created_by_agent: input.created_by_agent,
    namespace: input.namespace,
  });

  return {
    relationship,
    contact_a: { id: contact_a.id, display_name: contact_a.display_name },
    contact_b: { id: contact_b.id, display_name: contact_b.display_name },
    relationship_type: relType,
    created: true,
  };
}
