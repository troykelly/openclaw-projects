/**
 * Graph-aware context retrieval service.
 * Part of Epic #486 - Issue #496
 *
 * Extends basic context retrieval to traverse the relationship graph,
 * collecting memories from the user, their contacts, groups, and relationships.
 * Results include source attribution and combined relevance ranking.
 */

import type { Pool } from 'pg';

// ── Types ──

/** Describes the type of scope a memory comes from */
export type ScopeType = 'personal' | 'contact' | 'group' | 'relationship';

/** Details about a single scope in the graph traversal */
export interface ScopeDetail {
  /** What kind of scope this is */
  scope_type: ScopeType;
  /** The ID for this scope (email, contact ID, relationship ID) */
  scope_id: string;
  /** Human-readable label for this scope */
  label: string;
}

/** Collected scopes from graph traversal */
export interface GraphScope {
  /** The user's email (personal scope, used for graph traversal lookup only) */
  user_email: string;
  /** Contact IDs from direct relationships and group memberships */
  contact_ids: string[];
  /** Relationship IDs linking the user to other contacts */
  relationship_ids: string[];
  /** Detailed scope descriptions for attribution */
  scope_details: ScopeDetail[];
}

/** Options for graph traversal */
export interface GraphTraversalOptions {
  /** Maximum relationship hops (default: 1, direct only) */
  max_depth?: number;
}

/** Input for graph-aware context retrieval */
export interface GraphAwareContextInput {
  /** User email for identifying the user */
  user_email: string;
  /** The user's prompt/query for semantic matching */
  prompt: string;
  /** Maximum number of memories to return (default: 10) */
  max_memories?: number;
  /** Minimum similarity threshold (default: 0.3) */
  min_similarity?: number;
  /** Maximum relationship traversal depth (default: 1) */
  max_depth?: number;
  /** Maximum context string length (default: 4000) */
  max_context_length?: number;
}

/** A memory result with scope attribution and combined relevance */
export interface ScopedMemoryResult {
  /** Memory ID */
  id: string;
  /** Memory title */
  title: string;
  /** Memory content */
  content: string;
  /** Memory type (preference, fact, etc.) */
  memory_type: string;
  /** Similarity score from semantic/text search (0-1) */
  similarity: number;
  /** Importance (1-10) */
  importance: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Combined relevance score: similarity * (importance/10) * confidence */
  combined_relevance: number;
  /** The type of scope this memory came from */
  scope_type: ScopeType;
  /** Human-readable label for the source scope */
  scope_label: string;
}

/** Result metadata */
export interface GraphContextMetadata {
  /** Total time for graph traversal and search */
  query_time_ms: number;
  /** Number of scopes searched */
  scope_count: number;
  /** Total memories found before filtering */
  total_memories_found: number;
  /** Search type used */
  search_type: 'semantic' | 'text';
  /** Graph traversal depth used */
  max_depth: number;
}

/** Full result of graph-aware context retrieval */
export interface GraphAwareContextResult {
  /** Formatted context string with scope attribution, or null */
  context: string | null;
  /** Individual memory results with scope attribution */
  memories: ScopedMemoryResult[];
  /** The scopes that were searched */
  scopes: GraphScope;
  /** Metadata about the retrieval */
  metadata: GraphContextMetadata;
}

// ── Implementation ──

/**
 * Finds the user's contact ID from their email address.
 * Looks up contact_endpoint records with kind='email' matching the user email.
 *
 * @returns The contact ID, or null if no matching contact found
 */
async function findUserContactId(pool: Pool, user_email: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT ce.contact_id::text as contact_id
     FROM contact_endpoint ce
     WHERE ce.endpoint_type = 'email'
       AND lower(ce.endpoint_value) = lower($1)
     LIMIT 1`,
    [user_email],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return (result.rows[0] as { contact_id: string }).contact_id;
}

/**
 * Traverses the relationship graph from a contact to collect all related scopes.
 *
 * At depth 1 (default):
 * 1. Direct relationships (partner, parent, child, friend, etc.)
 * 2. Group memberships (households, teams, mobs) -- detected via has_member type
 * 3. Other group members (for groups the user belongs to)
 *
 * Uses relationship type names to infer group vs person scope rather
 * than querying information_schema (which can deadlock with TRUNCATE).
 */
async function traverseRelationships(
  pool: Pool,
  contact_id: string,
  options: GraphTraversalOptions = {},
): Promise<{
  contactIds: string[];
  relationshipIds: string[];
  scopeDetails: ScopeDetail[];
}> {
  const maxDepth = options.max_depth ?? 1;

  if (maxDepth < 1) {
    return { contactIds: [], relationshipIds: [], scopeDetails: [] };
  }

  const contactIds: string[] = [];
  const relationshipIds: string[] = [];
  const scopeDetails: ScopeDetail[] = [];
  const seen = new Set<string>();

  // Single query: all relationships where this contact is on either side.
  // Includes the relationship type name to detect group membership.
  const result = await pool.query(
    `SELECT
      CASE
        WHEN r.contact_a_id = $1 THEN r.contact_b_id::text
        ELSE r.contact_a_id::text
      END as other_contact_id,
      CASE
        WHEN r.contact_a_id = $1 THEN cb.display_name
        ELSE ca.display_name
      END as other_contact_name,
      r.id::text as relationship_id,
      rt.name as relationship_type_name,
      rt.label as relationship_type_label,
      rt.is_directional,
      r.contact_a_id::text as raw_contact_a_id
    FROM relationship r
    JOIN contact ca ON r.contact_a_id = ca.id
    JOIN contact cb ON r.contact_b_id = cb.id
    JOIN relationship_type rt ON r.relationship_type_id = rt.id
    WHERE r.contact_a_id = $1 OR r.contact_b_id = $1`,
    [contact_id],
  );

  // Track group contact IDs for member expansion
  const groupContactIds: string[] = [];

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const otherContactId = r.other_contact_id as string;
    const otherContactName = r.other_contact_name as string;
    const relId = r.relationship_id as string;
    const relTypeName = r.relationship_type_name as string;
    const relTypeLabel = r.relationship_type_label as string;
    const rawContactAId = r.raw_contact_a_id as string;

    // Determine if this is a group membership relationship.
    // has_member: contact_a (group) -> contact_b (member)
    // member_of: contact_b -> contact_a (inverse)
    // If the other contact is on the A side of a has_member relationship,
    // then the other contact is a group.
    const isGroupRelationship = relTypeName === 'has_member' && rawContactAId !== contact_id;

    if (!seen.has(otherContactId)) {
      seen.add(otherContactId);
      contactIds.push(otherContactId);

      const scopeType: ScopeType = isGroupRelationship ? 'group' : 'contact';

      scopeDetails.push({
        scope_type: scopeType,
        scope_id: otherContactId,
        label: `${relTypeLabel}: ${otherContactName}`,
      });

      if (isGroupRelationship) {
        groupContactIds.push(otherContactId);
      }
    }

    if (!seen.has(`rel:${relId}`)) {
      seen.add(`rel:${relId}`);
      relationshipIds.push(relId);

      scopeDetails.push({
        scope_type: 'relationship',
        scope_id: relId,
        label: `Relationship (${relTypeLabel})`,
      });
    }
  }

  // For each group the user belongs to, also collect other members
  if (groupContactIds.length > 0) {
    const groupMemberResult = await pool.query(
      `SELECT
        cg.id::text as group_id,
        cg.display_name as group_name,
        cm.id::text as member_id,
        cm.display_name as member_name
      FROM relationship r_member
      JOIN relationship_type rt_member ON r_member.relationship_type_id = rt_member.id
      JOIN contact cg ON r_member.contact_a_id = cg.id
      JOIN contact cm ON r_member.contact_b_id = cm.id
      WHERE r_member.contact_a_id = ANY($1::uuid[])
        AND rt_member.name = 'has_member'
        AND cm.id != $2`,
      [groupContactIds, contact_id],
    );

    for (const row of groupMemberResult.rows) {
      const r = row as Record<string, unknown>;
      const member_id = r.member_id as string;
      const member_name = r.member_name as string;

      if (!seen.has(member_id)) {
        seen.add(member_id);
        contactIds.push(member_id);

        scopeDetails.push({
          scope_type: 'contact',
          scope_id: member_id,
          label: `Group member: ${member_name}`,
        });
      }
    }
  }

  return { contactIds, relationshipIds, scopeDetails };
}

/**
 * Collects all scope IDs by traversing the user's relationship graph.
 *
 * Flow:
 * 1. User email -> find contact_id from contact_endpoint
 * 2. Contact -> traverse relationships (1 hop by default)
 * 3. Collect: user_email (personal), contact_ids, relationship_ids
 * 4. Build scope details for attribution
 */
export async function collectGraphScopes(pool: Pool, user_email: string, options: GraphTraversalOptions = {}): Promise<GraphScope> {
  const scope: GraphScope = {
    user_email: user_email,
    contact_ids: [],
    relationship_ids: [],
    scope_details: [{ scope_type: 'personal', scope_id: user_email, label: 'Personal' }],
  };

  const maxDepth = options.max_depth ?? 1;

  if (maxDepth < 1) {
    return scope;
  }

  // Find the user's contact ID from their email
  const userContactId = await findUserContactId(pool, user_email);

  if (!userContactId) {
    // No contact record found - return personal scope only
    return scope;
  }

  // Traverse relationships from this contact
  const traversal = await traverseRelationships(pool, userContactId, { max_depth: maxDepth });

  scope.contact_ids = traversal.contactIds;
  scope.relationship_ids = traversal.relationshipIds;
  scope.scope_details.push(...traversal.scopeDetails);

  return scope;
}

/**
 * Determines which scope type a memory belongs to based on its field values.
 */
function classifyScopeType(
  memory: {
    contact_id: string | null;
    relationship_id: string | null;
  },
  scopes: GraphScope,
): { scopeType: ScopeType; scopeLabel: string } {
  // Check relationship scope first (most specific)
  if (memory.relationship_id && scopes.relationship_ids.includes(memory.relationship_id)) {
    const detail = scopes.scope_details.find((s) => s.scope_type === 'relationship' && s.scope_id === memory.relationship_id);
    return {
      scopeType: 'relationship',
      scopeLabel: detail?.label ?? 'Relationship',
    };
  }

  // Check contact scope
  if (memory.contact_id && scopes.contact_ids.includes(memory.contact_id)) {
    const detail = scopes.scope_details.find((s) => (s.scope_type === 'contact' || s.scope_type === 'group') && s.scope_id === memory.contact_id);
    return {
      scopeType: detail?.scope_type ?? 'contact',
      scopeLabel: detail?.label ?? 'Related contact',
    };
  }

  // Default to personal
  return {
    scopeType: 'personal',
    scopeLabel: 'Personal',
  };
}

/**
 * Performs a multi-scope semantic search across all collected scopes.
 *
 * Uses a single query with OR conditions for each scope type:
 *   WHERE (contact_id = ANY($contactIds)
 *      OR relationship_id = ANY($relationshipIds))
 *   AND (expires_at IS NULL OR expires_at > now())
 *   AND superseded_by IS NULL
 */
async function multiScopeMemorySearch(
  pool: Pool,
  prompt: string,
  scopes: GraphScope,
  options: {
    limit: number;
    min_similarity: number;
  },
): Promise<{
  results: Array<{
    id: string;
    title: string;
    content: string;
    memory_type: string;
    contact_id: string | null;
    relationship_id: string | null;
    importance: number;
    confidence: number;
    similarity: number;
  }>;
  search_type: 'semantic' | 'text';
}> {
  const { limit, min_similarity } = options;

  // Build scope conditions
  // Epic #1418 Phase 4: user_email column dropped from memory table.
  // Only use contact_id and relationship_id for scope filtering.
  const scopeConditions: string[] = [];
  const params: (string | string[] | number)[] = [];
  let paramIndex = 1;

  // Include contact scopes if any
  if (scopes.contact_ids.length > 0) {
    scopeConditions.push(`m.contact_id = ANY($${paramIndex}::uuid[])`);
    params.push(scopes.contact_ids);
    paramIndex++;
  }

  // Include relationship scopes if any
  if (scopes.relationship_ids.length > 0) {
    scopeConditions.push(`m.relationship_id = ANY($${paramIndex}::uuid[])`);
    params.push(scopes.relationship_ids);
    paramIndex++;
  }

  // Include unscoped personal memories (no contact_id and no relationship_id)
  // Epic #1418: replaces old user_email filter for personal memory discovery
  scopeConditions.push('(m.contact_id IS NULL AND m.relationship_id IS NULL)');

  const scopeWhere = `(${scopeConditions.join(' OR ')})`;

  // Try semantic search first using embedding service
  let queryEmbedding: number[] | null = null;

  try {
    const { embeddingService } = await import('../embeddings/service.ts');

    if (embeddingService.isConfigured()) {
      const embResult = await embeddingService.embed(prompt);
      if (embResult) {
        queryEmbedding = embResult.embedding;
      }
    }
  } catch (err) {
    console.warn('[GraphContext] Semantic search failed, falling back to text search:', err);
  }

  if (queryEmbedding) {
    // Semantic search path — only searches memories with completed embeddings
    const semanticParams = [...params];
    let semanticParamIndex = paramIndex;

    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    semanticParams.push(embeddingStr);
    const embParamIdx = semanticParamIndex++;

    semanticParams.push(limit);
    const semanticLimitIdx = semanticParamIndex++;

    const semanticResult = await pool.query(
      `SELECT
        m.id::text as id,
        m.title,
        m.content,
        m.memory_type::text as memory_type,
        m.contact_id::text as contact_id,
        m.relationship_id::text as relationship_id,
        m.importance,
        m.confidence,
        1 - (m.embedding <=> $${embParamIdx}::vector) as similarity
      FROM memory m
      WHERE ${scopeWhere}
        AND m.embedding IS NOT NULL
        AND m.embedding_status = 'complete'
        AND (m.expires_at IS NULL OR m.expires_at > NOW())
        AND m.superseded_by IS NULL
      ORDER BY m.embedding <=> $${embParamIdx}::vector ASC
      LIMIT $${semanticLimitIdx}`,
      semanticParams,
    );

    // If semantic search found results, return them
    if (semanticResult.rows.length > 0) {
      return {
        results: semanticResult.rows as Array<{
          id: string;
          title: string;
          content: string;
          memory_type: string;
          contact_id: string | null;
          relationship_id: string | null;
          importance: number;
          confidence: number;
          similarity: number;
        }>,
        search_type: 'semantic',
      };
    }
    // Fall through to text search if no embedded memories found
  }

  // Text search fallback using PostgreSQL full-text search (websearch_to_tsquery)
  // This is more forgiving than ILIKE and handles word boundaries properly.
  params.push(prompt);
  const searchParamIdx = paramIndex++;

  params.push(limit);
  const limitParamIdx = paramIndex++;

  const result = await pool.query(
    `SELECT
      m.id::text as id,
      m.title,
      m.content,
      m.memory_type::text as memory_type,
      m.contact_id::text as contact_id,
      m.relationship_id::text as relationship_id,
      m.importance,
      m.confidence,
      COALESCE(ts_rank(m.search_vector, websearch_to_tsquery('english', $${searchParamIdx})), 0.3) as similarity
    FROM memory m
    WHERE ${scopeWhere}
      AND (m.expires_at IS NULL OR m.expires_at > NOW())
      AND m.superseded_by IS NULL
      AND (
        m.search_vector @@ websearch_to_tsquery('english', $${searchParamIdx})
        OR m.title ILIKE '%' || $${searchParamIdx} || '%'
        OR m.content ILIKE '%' || $${searchParamIdx} || '%'
      )
    ORDER BY
      COALESCE(ts_rank(m.search_vector, websearch_to_tsquery('english', $${searchParamIdx})), 0) DESC,
      m.importance DESC,
      m.updated_at DESC
    LIMIT $${limitParamIdx}`,
    params,
  );

  return {
    results: result.rows as Array<{
      id: string;
      title: string;
      content: string;
      memory_type: string;
      contact_id: string | null;
      relationship_id: string | null;
      importance: number;
      confidence: number;
      similarity: number;
    }>,
    search_type: 'text',
  };
}

/**
 * Builds a formatted context string with scope attribution.
 *
 * Groups memories by scope type and formats them for agent consumption.
 */
function buildGraphContextString(memories: ScopedMemoryResult[], maxLength: number): string {
  if (memories.length === 0) {
    return '';
  }

  const parts: string[] = [];

  // Group by scope type
  const personal = memories.filter((m) => m.scope_type === 'personal');
  const contact = memories.filter((m) => m.scope_type === 'contact');
  const group = memories.filter((m) => m.scope_type === 'group');
  const relationship = memories.filter((m) => m.scope_type === 'relationship');

  if (personal.length > 0) {
    parts.push('## Personal Preferences & Memories\n');
    for (const mem of personal) {
      parts.push(`- **${mem.title}**: ${mem.content}\n`);
    }
    parts.push('\n');
  }

  if (group.length > 0) {
    parts.push('## Household / Group Context\n');
    for (const mem of group) {
      parts.push(`- **${mem.title}** _(${mem.scope_label})_: ${mem.content}\n`);
    }
    parts.push('\n');
  }

  if (contact.length > 0) {
    parts.push('## Related People Context\n');
    for (const mem of contact) {
      parts.push(`- **${mem.title}** _(${mem.scope_label})_: ${mem.content}\n`);
    }
    parts.push('\n');
  }

  if (relationship.length > 0) {
    parts.push('## Relationship Context\n');
    for (const mem of relationship) {
      parts.push(`- **${mem.title}** _(${mem.scope_label})_: ${mem.content}\n`);
    }
    parts.push('\n');
  }

  let fullContext = parts.join('').trim();

  // Truncate if needed
  if (fullContext.length > maxLength) {
    const lastSpace = fullContext.lastIndexOf(' ', maxLength - 3);
    if (lastSpace > maxLength * 0.8) {
      fullContext = fullContext.substring(0, lastSpace) + '...';
    } else {
      fullContext = fullContext.substring(0, maxLength - 3) + '...';
    }
  }

  return fullContext;
}

/**
 * Retrieves context by traversing the user's relationship graph and
 * performing multi-scope semantic search.
 *
 * Flow:
 * 1. Identify user -> collect graph scopes (email, contacts, groups, relationships)
 * 2. Run semantic search across ALL collected scopes
 * 3. Filter: expired excluded, superseded excluded, similarity threshold applied
 * 4. Rank by combined relevance (similarity * importance/10 * confidence)
 * 5. Format with source attribution
 */
export async function retrieveGraphAwareContext(pool: Pool, input: GraphAwareContextInput): Promise<GraphAwareContextResult> {
  const startTime = Date.now();

  const { user_email: user_email, prompt, max_memories: maxMemories = 10, min_similarity: min_similarity = 0.3, max_depth: maxDepth = 1, max_context_length: maxContextLength = 4000 } = input;

  // Step 1: Collect scopes via graph traversal
  const scopes = await collectGraphScopes(pool, user_email, { max_depth: maxDepth });

  // Step 2: Multi-scope semantic search
  const searchResult = await multiScopeMemorySearch(pool, prompt, scopes, {
    limit: maxMemories * 2, // Fetch extra to allow filtering
    min_similarity,
  });

  // Step 3: Filter by similarity threshold and classify scopes
  const scoredMemories: ScopedMemoryResult[] = searchResult.results
    .filter((m) => m.similarity >= min_similarity)
    .map((m) => {
      const { scopeType, scopeLabel } = classifyScopeType(
        {
          contact_id: m.contact_id,
          relationship_id: m.relationship_id,
        },
        scopes,
      );

      // Combined relevance: similarity * (importance/10) * confidence
      const normalizedImportance = (m.importance ?? 5) / 10;
      const confidence = m.confidence ?? 1.0;
      const combinedRelevance = m.similarity * normalizedImportance * confidence;

      return {
        id: m.id,
        title: m.title,
        content: m.content,
        memory_type: m.memory_type,
        similarity: m.similarity,
        importance: m.importance,
        confidence: m.confidence ?? 1.0,
        combined_relevance: combinedRelevance,
        scope_type: scopeType,
        scope_label: scopeLabel,
      };
    });

  // Step 4: Rank by combined relevance
  scoredMemories.sort((a, b) => b.combined_relevance - a.combined_relevance);

  // Apply maxMemories limit
  const limitedMemories = scoredMemories.slice(0, maxMemories);

  // Step 5: Build context string with attribution
  const context = buildGraphContextString(limitedMemories, maxContextLength);

  const queryTimeMs = Date.now() - startTime;

  return {
    context: context || null,
    memories: limitedMemories,
    scopes,
    metadata: {
      query_time_ms: queryTimeMs,
      scope_count: scopes.scope_details.length,
      total_memories_found: searchResult.results.length,
      search_type: searchResult.search_type,
      max_depth: maxDepth,
    },
  };
}
