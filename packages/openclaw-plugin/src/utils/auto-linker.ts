/**
 * Auto-linker utility for inbound messages (Issue #1223).
 *
 * Automatically creates entity links when inbound SMS/email arrives:
 * 1. Sender -> Contact matching: matches sender email/phone to existing contacts
 * 2. Content -> Project/Todo matching: semantic search for related work items
 *    (only runs when sender is a known contact — safety decision to prevent
 *    untrusted senders from creating spurious links)
 *
 * Links are created via the skill_store API using the same pattern as
 * entity-links.ts tools. All operations are failure-isolated so that
 * auto-linking never crashes inbound message processing.
 */

import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import { sanitizeExternalMessage } from './injection-protection.js';
import { sanitizeErrorMessage } from './sanitize.js';

// ==================== Constants ====================

/** Default similarity threshold for content matching */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.75;

/** Skill ID for entity link storage (matches entity-links.ts) */
const SKILL_ID = 'entity-links';

/** Collection name for entity links (matches entity-links.ts) */
const COLLECTION = 'entity_links';

/** Maximum content length to send to search API */
const MAX_SEARCH_QUERY_LENGTH = 500;

/** Work item kinds that map to "project" in results */
const PROJECT_KINDS = new Set(['project']);

/** Work item kinds that map to "todo" in results */
const TODO_KINDS = new Set(['task', 'issue', 'epic', 'initiative']);

// ==================== Types ====================

/** Inbound message data for auto-linking */
export interface AutoLinkMessage {
  /** Thread ID (UUID) for the inbound message thread */
  thread_id: string;
  /** Sender email address, if known */
  senderEmail?: string;
  /** Sender phone number, if known */
  senderPhone?: string;
  /** Message body content */
  content: string;
}

/** Options for the auto-link function */
export interface AutoLinkOptions {
  /** API client for backend calls */
  client: ApiClient;
  /** Logger instance */
  logger: Logger;
  /** Getter for current user ID (reads from mutable state, Issue #1644) */
  getAgentId: () => string;
  /** Inbound message data */
  message: AutoLinkMessage;
  /** Similarity threshold for content matching (default: 0.75) */
  similarityThreshold?: number;
}

/** Result of auto-linking */
export interface AutoLinkResult {
  /** Number of entity links created */
  linksCreated: number;
  /** IDs of matched entities by type */
  matches: {
    contacts: string[];
    projects: string[];
    todos: string[];
  };
}

// ==================== Internal types ====================

/** Contact from API response */
interface ContactResult {
  id: string;
  display_name: string;
  email?: string;
  phone?: string;
}

/** Search result item from unified search API */
interface SearchResultItem {
  id: string;
  title: string;
  snippet: string;
  score: number;
  type: string;
  metadata?: { kind?: string; status?: string };
}

/** Skill store item shape */
interface SkillStoreItem {
  id: string;
  skill_id: string;
  collection: string;
  key: string | null;
  data: Record<string, unknown>;
  tags: string[];
  status: string;
}

// ==================== Helpers ====================

/**
 * Build a URI-style thread reference for use as target_ref.
 * Uses 'url' entity type since the entity-links schema has a fixed enum
 * and does not yet include a 'message_thread' type.
 * TODO(#1223): Add a proper 'message_thread' entity type to entity-links schema.
 */
function buildThreadRef(thread_id: string): string {
  return `thread:${thread_id}`;
}

/**
 * Build a composite key for a link (matches entity-links.ts pattern).
 */
function buildLinkKey(sourceType: string, sourceRef: string, targetType: string, targetRef: string): string {
  return `${sourceType}:${sourceRef}:${targetType}:${targetRef}`;
}

/**
 * Build a tag for source-entity lookup (matches entity-links.ts pattern).
 */
function buildSourceTag(entity_type: string, entityRef: string): string {
  return `src:${entity_type}:${entityRef}`;
}

/**
 * Create a bidirectional entity link via skill_store.
 * Returns true if both directions were created successfully.
 */
async function createEntityLink(
  client: ApiClient,
  user_id: string,
  logger: Logger,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetRef: string,
  label?: string,
): Promise<boolean> {
  const now = new Date().toISOString();

  const forwardKey = buildLinkKey(sourceType, sourceId, targetType, targetRef);
  const reverseKey = buildLinkKey(targetType, targetRef, sourceType, sourceId);

  const forwardData = {
    source_type: sourceType,
    source_id: sourceId,
    target_type: targetType,
    target_ref: targetRef,
    label: label ?? null,
    created_at: now,
    auto_linked: true,
  };

  const reverseData = {
    source_type: targetType,
    source_id: targetRef,
    target_type: sourceType,
    target_ref: sourceId,
    label: label ?? null,
    created_at: now,
    auto_linked: true,
  };

  // Create forward link
  const forwardResponse = await client.post<SkillStoreItem>(
    '/api/skill-store/items',
    {
      skill_id: SKILL_ID,
      collection: COLLECTION,
      key: forwardKey,
      data: forwardData,
      tags: [buildSourceTag(sourceType, sourceId)],
    },
    { user_id },
  );

  if (!forwardResponse.success) {
    logger.error('auto-linker: forward link creation failed', {
      user_id,
      sourceType,
      targetType,
      status: forwardResponse.error.status,
    });
    return false;
  }

  // Create reverse link
  const reverseResponse = await client.post<SkillStoreItem>(
    '/api/skill-store/items',
    {
      skill_id: SKILL_ID,
      collection: COLLECTION,
      key: reverseKey,
      data: reverseData,
      tags: [buildSourceTag(targetType, targetRef)],
    },
    { user_id },
  );

  if (!reverseResponse.success) {
    logger.error('auto-linker: reverse link creation failed', {
      user_id,
      sourceType,
      targetType,
      status: reverseResponse.error.status,
    });

    // Best-effort rollback of orphaned forward link
    const rollbackResponse = await client.delete(
      `/api/skill-store/items/${forwardResponse.data.id}`,
      { user_id },
    );

    if (!rollbackResponse.success) {
      logger.error('auto-linker: rollback of orphaned forward link failed — partial state', {
        user_id,
        forwardId: forwardResponse.data.id,
        rollbackStatus: rollbackResponse.error.status,
      });
    }

    return false;
  }

  return true;
}

// ==================== Sender matching ====================

/**
 * Search for contacts matching the sender's email and/or phone.
 * Searches both identifiers separately when both are present,
 * then deduplicates matched contact IDs.
 * Returns matched contact IDs and creates links for each match.
 */
async function matchSenderToContacts(
  client: ApiClient,
  logger: Logger,
  user_id: string,
  thread_id: string,
  senderEmail?: string,
  senderPhone?: string,
): Promise<string[]> {
  if (!senderEmail && !senderPhone) {
    return [];
  }

  // Search both email and phone separately to catch all matches
  const searchQueries: string[] = [];
  if (senderEmail) searchQueries.push(senderEmail);
  if (senderPhone) searchQueries.push(senderPhone);

  // Collect all contacts from all searches
  const allContacts: ContactResult[] = [];

  for (const searchQuery of searchQueries) {
    const queryParams = new URLSearchParams({
      search: searchQuery,
      limit: '5',
      user_email: user_id,
    });

    const response = await client.get<{
      contacts?: ContactResult[];
      items?: ContactResult[];
      total?: number;
    }>(`/api/contacts?${queryParams.toString()}`, { user_id });

    if (!response.success) {
      logger.error('auto-linker: contact search failed', {
        user_id,
        status: response.error.status,
        code: response.error.code,
      });
      continue;
    }

    const contacts = response.data.contacts ?? response.data.items ?? [];
    allContacts.push(...contacts);
  }

  if (allContacts.length === 0) {
    return [];
  }

  // Filter to exact matches on email or phone, deduplicate by ID
  const seen = new Set<string>();
  const matchedContacts: ContactResult[] = [];

  for (const c of allContacts) {
    if (seen.has(c.id)) continue;

    const emailMatch = senderEmail != null && c.email?.toLowerCase() === senderEmail.toLowerCase();
    const phoneMatch = senderPhone != null && c.phone === senderPhone;

    if (emailMatch || phoneMatch) {
      seen.add(c.id);
      matchedContacts.push(c);
    }
  }

  const threadRef = buildThreadRef(thread_id);
  const linkedContactIds: string[] = [];

  for (const contact of matchedContacts) {
    try {
      // Use 'url' type with thread: URI since entity-links schema does not have
      // a 'message_thread' type yet. See buildThreadRef() for details.
      const linked = await createEntityLink(
        client,
        user_id,
        logger,
        'contact',
        contact.id,
        'url',
        threadRef,
        'inbound-message-sender',
      );

      if (linked) {
        linkedContactIds.push(contact.id);
      }
    } catch (error) {
      logger.error('auto-linker: failed to create contact link', {
        user_id,
        contact_id: contact.id,
        error: sanitizeErrorMessage(error),
      });
    }
  }

  return linkedContactIds;
}

// ==================== Content matching ====================

/**
 * Search for projects and todos matching the message content.
 * Returns matched entity IDs by type and creates links for each match.
 */
async function matchContentToWorkItems(
  client: ApiClient,
  logger: Logger,
  user_id: string,
  thread_id: string,
  content: string,
  similarityThreshold: number,
): Promise<{ projects: string[]; todos: string[] }> {
  // Sanitize external content before using it in search queries.
  // Removes control characters, unicode invisibles, and potential injection payloads.
  const sanitizedContent = sanitizeExternalMessage(content);

  if (sanitizedContent.length === 0) {
    return { projects: [], todos: [] };
  }

  // Truncate for search
  const searchQuery = sanitizedContent.substring(0, MAX_SEARCH_QUERY_LENGTH);

  const queryParams = new URLSearchParams({
    q: searchQuery,
    types: 'work_item',
    limit: '10',
    semantic: 'true',
    user_email: user_id,
  });

  const response = await client.get<{
    results: SearchResultItem[];
    search_type: string;
    total: number;
  }>(`/api/search?${queryParams.toString()}`, { user_id });

  if (!response.success) {
    logger.error('auto-linker: content search failed', {
      user_id,
      status: response.error.status,
      code: response.error.code,
    });
    return { projects: [], todos: [] };
  }

  const results = response.data.results ?? [];

  // Filter to items above the similarity threshold
  const highConfidenceResults = results.filter((r) => r.score >= similarityThreshold);

  if (highConfidenceResults.length === 0) {
    logger.debug('auto-linker: no content matches above threshold', {
      user_id,
      threshold: similarityThreshold,
      totalResults: results.length,
      topScore: results[0]?.score ?? 0,
    });
    return { projects: [], todos: [] };
  }

  const threadRef = buildThreadRef(thread_id);
  const linkedProjects: string[] = [];
  const linkedTodos: string[] = [];

  for (const item of highConfidenceResults) {
    const kind = item.metadata?.kind;
    const isProject = kind !== undefined && PROJECT_KINDS.has(kind);
    const isTodo = kind !== undefined && TODO_KINDS.has(kind);

    if (!isProject && !isTodo) {
      continue;
    }

    const sourceType = isProject ? 'project' : 'todo';

    try {
      // Use 'url' type with thread: URI since entity-links schema does not have
      // a 'message_thread' type yet. See buildThreadRef() for details.
      const linked = await createEntityLink(
        client,
        user_id,
        logger,
        sourceType,
        item.id,
        'url',
        threadRef,
        `auto-linked:${item.title.substring(0, 50)}`,
      );

      if (linked) {
        if (isProject) {
          linkedProjects.push(item.id);
        } else {
          linkedTodos.push(item.id);
        }
      }
    } catch (error) {
      logger.error('auto-linker: failed to create work item link', {
        user_id,
        item_id: item.id,
        itemKind: kind,
        error: sanitizeErrorMessage(error),
      });
    }
  }

  return { projects: linkedProjects, todos: linkedTodos };
}

// ==================== Main function ====================

/**
 * Auto-link an inbound message to related entities.
 *
 * Performs sender matching first. Content matching only runs when at least
 * one contact matched — this prevents untrusted/unknown senders from
 * creating spurious links to projects and todos.
 *
 * Never throws - all errors are caught and logged.
 *
 * @param options - Auto-link configuration and message data
 * @returns Summary of links created and entities matched
 */
export async function autoLinkInboundMessage(options: AutoLinkOptions): Promise<AutoLinkResult> {
  const {
    client,
    logger,
    getAgentId,
    message,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  } = options;
  const user_id = getAgentId();

  const emptyResult: AutoLinkResult = {
    linksCreated: 0,
    matches: { contacts: [], projects: [], todos: [] },
  };

  try {
    logger.info('auto-linker: processing inbound message', {
      user_id,
      thread_id: message.thread_id,
      hasSenderEmail: !!message.senderEmail,
      hasSenderPhone: !!message.senderPhone,
      contentLength: message.content.length,
    });

    // Step 1: Sender matching — always runs when sender info is available
    const contactMatches = await matchSenderToContacts(
      client,
      logger,
      user_id,
      message.thread_id,
      message.senderEmail,
      message.senderPhone,
    ).catch((error) => {
      logger.error('auto-linker: sender matching failed', {
        user_id,
        error: sanitizeErrorMessage(error),
      });
      return [] as string[];
    });

    // Step 2: Content matching — only runs when sender is a known contact.
    // Safety decision: untrusted/unknown senders should not trigger content-based
    // linking to prevent spam or malicious messages from creating spurious links
    // to the user's projects and todos.
    let contentMatches = { projects: [] as string[], todos: [] as string[] };

    if (contactMatches.length > 0) {
      contentMatches = await matchContentToWorkItems(
        client,
        logger,
        user_id,
        message.thread_id,
        message.content,
        similarityThreshold,
      ).catch((error) => {
        logger.error('auto-linker: content matching failed', {
          user_id,
          error: sanitizeErrorMessage(error),
        });
        return { projects: [] as string[], todos: [] as string[] };
      });
    } else {
      logger.debug('auto-linker: skipping content matching — no known sender contact', {
        user_id,
        thread_id: message.thread_id,
      });
    }

    const result: AutoLinkResult = {
      linksCreated: contactMatches.length + contentMatches.projects.length + contentMatches.todos.length,
      matches: {
        contacts: contactMatches,
        projects: contentMatches.projects,
        todos: contentMatches.todos,
      },
    };

    logger.info('auto-linker: completed', {
      user_id,
      thread_id: message.thread_id,
      linksCreated: result.linksCreated,
      contactMatches: result.matches.contacts.length,
      projectMatches: result.matches.projects.length,
      todoMatches: result.matches.todos.length,
    });

    return result;
  } catch (error) {
    logger.error('auto-linker: unexpected failure', {
      user_id,
      error: sanitizeErrorMessage(error),
    });
    return emptyResult;
  }
}
