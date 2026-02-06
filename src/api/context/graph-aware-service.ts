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
  scopeType: ScopeType;
  /** The ID for this scope (email, contact ID, relationship ID) */
  scopeId: string;
  /** Human-readable label for this scope */
  label: string;
}

/** Collected scopes from graph traversal */
export interface GraphScope {
  /** The user's email (personal scope) */
  userEmail: string;
  /** Contact IDs from direct relationships and group memberships */
  contactIds: string[];
  /** Relationship IDs linking the user to other contacts */
  relationshipIds: string[];
  /** Detailed scope descriptions for attribution */
  scopeDetails: ScopeDetail[];
}

/** Options for graph traversal */
export interface GraphTraversalOptions {
  /** Maximum relationship hops (default: 1, direct only) */
  maxDepth?: number;
}

/** Input for graph-aware context retrieval */
export interface GraphAwareContextInput {
  /** User email for identifying the user */
  userEmail: string;
  /** The user's prompt/query for semantic matching */
  prompt: string;
  /** Maximum number of memories to return (default: 10) */
  maxMemories?: number;
  /** Minimum similarity threshold (default: 0.3) */
  minSimilarity?: number;
  /** Maximum relationship traversal depth (default: 1) */
  maxDepth?: number;
  /** Maximum context string length (default: 4000) */
  maxContextLength?: number;
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
  memoryType: string;
  /** Similarity score from semantic/text search (0-1) */
  similarity: number;
  /** Importance (1-10) */
  importance: number;
  /** Confidence (0-1) */
  confidence: number;
  /** Combined relevance score: similarity * (importance/10) * confidence */
  combinedRelevance: number;
  /** The type of scope this memory came from */
  scopeType: ScopeType;
  /** Human-readable label for the source scope */
  scopeLabel: string;
}

/** Result metadata */
export interface GraphContextMetadata {
  /** Total time for graph traversal and search */
  queryTimeMs: number;
  /** Number of scopes searched */
  scopeCount: number;
  /** Total memories found before filtering */
  totalMemoriesFound: number;
  /** Search type used */
  searchType: 'semantic' | 'text';
  /** Graph traversal depth used */
  maxDepth: number;
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
async function findUserContactId(pool: Pool, userEmail: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT ce.contact_id::text as contact_id
     FROM contact_endpoint ce
     WHERE ce.endpoint_type = 'email'
       AND lower(ce.endpoint_value) = lower($1)
     LIMIT 1`,
    [userEmail]
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
  contactId: string,
  options: GraphTraversalOptions = {}
): Promise<{
  contactIds: string[];
  relationshipIds: string[];
  scopeDetails: ScopeDetail[];
}> {
  const maxDepth = options.maxDepth ?? 1;

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
    [contactId]
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
    const isGroupRelationship =
      relTypeName === 'has_member' && rawContactAId !== contactId;

    if (!seen.has(otherContactId)) {
      seen.add(otherContactId);
      contactIds.push(otherContactId);

      const scopeType: ScopeType = isGroupRelationship ? 'group' : 'contact';

      scopeDetails.push({
        scopeType,
        scopeId: otherContactId,
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
        scopeType: 'relationship',
        scopeId: relId,
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
      [groupContactIds, contactId]
    );

    for (const row of groupMemberResult.rows) {
      const r = row as Record<string, unknown>;
      const memberId = r.member_id as string;
      const memberName = r.member_name as string;

      if (!seen.has(memberId)) {
        seen.add(memberId);
        contactIds.push(memberId);

        scopeDetails.push({
          scopeType: 'contact',
          scopeId: memberId,
          label: `Group member: ${memberName}`,
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
export async function collectGraphScopes(
  pool: Pool,
  userEmail: string,
  options: GraphTraversalOptions = {}
): Promise<GraphScope> {
  const scope: GraphScope = {
    userEmail,
    contactIds: [],
    relationshipIds: [],
    scopeDetails: [
      { scopeType: 'personal', scopeId: userEmail, label: 'Personal' },
    ],
  };

  const maxDepth = options.maxDepth ?? 1;

  if (maxDepth < 1) {
    return scope;
  }

  // Find the user's contact ID from their email
  const userContactId = await findUserContactId(pool, userEmail);

  if (!userContactId) {
    // No contact record found - return personal scope only
    return scope;
  }

  // Traverse relationships from this contact
  const traversal = await traverseRelationships(pool, userContactId, { maxDepth });

  scope.contactIds = traversal.contactIds;
  scope.relationshipIds = traversal.relationshipIds;
  scope.scopeDetails.push(...traversal.scopeDetails);

  return scope;
}

/**
 * Determines which scope type a memory belongs to based on its field values.
 */
function classifyScopeType(
  memory: {
    user_email: string | null;
    contact_id: string | null;
    relationship_id: string | null;
  },
  scopes: GraphScope
): { scopeType: ScopeType; scopeLabel: string } {
  // Check relationship scope first (most specific)
  if (memory.relationship_id && scopes.relationshipIds.includes(memory.relationship_id)) {
    const detail = scopes.scopeDetails.find(
      (s) => s.scopeType === 'relationship' && s.scopeId === memory.relationship_id
    );
    return {
      scopeType: 'relationship',
      scopeLabel: detail?.label ?? 'Relationship',
    };
  }

  // Check contact scope
  if (memory.contact_id && scopes.contactIds.includes(memory.contact_id)) {
    const detail = scopes.scopeDetails.find(
      (s) =>
        (s.scopeType === 'contact' || s.scopeType === 'group') &&
        s.scopeId === memory.contact_id
    );
    return {
      scopeType: detail?.scopeType ?? 'contact',
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
 *   WHERE (user_email = $userEmail
 *      OR contact_id = ANY($contactIds)
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
    minSimilarity: number;
  }
): Promise<{
  results: Array<{
    id: string;
    title: string;
    content: string;
    memory_type: string;
    user_email: string | null;
    contact_id: string | null;
    relationship_id: string | null;
    importance: number;
    confidence: number;
    similarity: number;
  }>;
  searchType: 'semantic' | 'text';
}> {
  const { limit, minSimilarity } = options;

  // Build scope conditions
  const scopeConditions: string[] = [];
  const params: (string | string[] | number)[] = [];
  let paramIndex = 1;

  // Always include user email scope
  scopeConditions.push(`m.user_email = $${paramIndex}`);
  params.push(scopes.userEmail);
  paramIndex++;

  // Include contact scopes if any
  if (scopes.contactIds.length > 0) {
    scopeConditions.push(`m.contact_id = ANY($${paramIndex}::uuid[])`);
    params.push(scopes.contactIds);
    paramIndex++;
  }

  // Include relationship scopes if any
  if (scopes.relationshipIds.length > 0) {
    scopeConditions.push(`m.relationship_id = ANY($${paramIndex}::uuid[])`);
    params.push(scopes.relationshipIds);
    paramIndex++;
  }

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
  } catch {
    // Fall through to text search
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
        m.user_email,
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
      semanticParams
    );

    // If semantic search found results, return them
    if (semanticResult.rows.length > 0) {
      return {
        results: semanticResult.rows as Array<{
          id: string;
          title: string;
          content: string;
          memory_type: string;
          user_email: string | null;
          contact_id: string | null;
          relationship_id: string | null;
          importance: number;
          confidence: number;
          similarity: number;
        }>,
        searchType: 'semantic',
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
      m.user_email,
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
    params
  );

  return {
    results: result.rows as Array<{
      id: string;
      title: string;
      content: string;
      memory_type: string;
      user_email: string | null;
      contact_id: string | null;
      relationship_id: string | null;
      importance: number;
      confidence: number;
      similarity: number;
    }>,
    searchType: 'text',
  };
}

/**
 * Builds a formatted context string with scope attribution.
 *
 * Groups memories by scope type and formats them for agent consumption.
 */
function buildGraphContextString(
  memories: ScopedMemoryResult[],
  maxLength: number
): string {
  if (memories.length === 0) {
    return '';
  }

  const parts: string[] = [];

  // Group by scope type
  const personal = memories.filter((m) => m.scopeType === 'personal');
  const contact = memories.filter((m) => m.scopeType === 'contact');
  const group = memories.filter((m) => m.scopeType === 'group');
  const relationship = memories.filter((m) => m.scopeType === 'relationship');

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
      parts.push(`- **${mem.title}** _(${mem.scopeLabel})_: ${mem.content}\n`);
    }
    parts.push('\n');
  }

  if (contact.length > 0) {
    parts.push('## Related People Context\n');
    for (const mem of contact) {
      parts.push(`- **${mem.title}** _(${mem.scopeLabel})_: ${mem.content}\n`);
    }
    parts.push('\n');
  }

  if (relationship.length > 0) {
    parts.push('## Relationship Context\n');
    for (const mem of relationship) {
      parts.push(`- **${mem.title}** _(${mem.scopeLabel})_: ${mem.content}\n`);
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
export async function retrieveGraphAwareContext(
  pool: Pool,
  input: GraphAwareContextInput
): Promise<GraphAwareContextResult> {
  const startTime = Date.now();

  const {
    userEmail,
    prompt,
    maxMemories = 10,
    minSimilarity = 0.3,
    maxDepth = 1,
    maxContextLength = 4000,
  } = input;

  // Step 1: Collect scopes via graph traversal
  const scopes = await collectGraphScopes(pool, userEmail, { maxDepth });

  // Step 2: Multi-scope semantic search
  const searchResult = await multiScopeMemorySearch(pool, prompt, scopes, {
    limit: maxMemories * 2, // Fetch extra to allow filtering
    minSimilarity,
  });

  // Step 3: Filter by similarity threshold and classify scopes
  const scoredMemories: ScopedMemoryResult[] = searchResult.results
    .filter((m) => m.similarity >= minSimilarity)
    .map((m) => {
      const { scopeType, scopeLabel } = classifyScopeType(
        {
          user_email: m.user_email,
          contact_id: m.contact_id,
          relationship_id: m.relationship_id,
        },
        scopes
      );

      // Combined relevance: similarity * (importance/10) * confidence
      const normalizedImportance = (m.importance ?? 5) / 10;
      const confidence = m.confidence ?? 1.0;
      const combinedRelevance = m.similarity * normalizedImportance * confidence;

      return {
        id: m.id,
        title: m.title,
        content: m.content,
        memoryType: m.memory_type,
        similarity: m.similarity,
        importance: m.importance,
        confidence: m.confidence ?? 1.0,
        combinedRelevance,
        scopeType,
        scopeLabel,
      };
    });

  // Step 4: Rank by combined relevance
  scoredMemories.sort((a, b) => b.combinedRelevance - a.combinedRelevance);

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
      queryTimeMs,
      scopeCount: scopes.scopeDetails.length,
      totalMemoriesFound: searchResult.results.length,
      searchType: searchResult.searchType,
      maxDepth,
    },
  };
}
