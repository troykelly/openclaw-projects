/**
 * Auto-linker utility for inbound messages (Issue #1223).
 *
 * Automatically creates entity links when inbound SMS/email arrives:
 * 1. Sender -> Contact matching: matches sender email/phone to existing contacts
 * 2. Content -> Project/Todo matching: semantic search for related work items
 *
 * Links are created via the skill_store API using the same pattern as
 * entity-links.ts tools. All operations are failure-isolated so that
 * auto-linking never crashes inbound message processing.
 */

import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
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
  threadId: string;
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
  /** User ID for scoping API calls */
  userId: string;
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
 * Build a composite key for a link (matches entity-links.ts pattern).
 */
function buildLinkKey(sourceType: string, sourceRef: string, targetType: string, targetRef: string): string {
  return `${sourceType}:${sourceRef}:${targetType}:${targetRef}`;
}

/**
 * Build a tag for source-entity lookup (matches entity-links.ts pattern).
 */
function buildSourceTag(entityType: string, entityRef: string): string {
  return `src:${entityType}:${entityRef}`;
}

/**
 * Create a bidirectional entity link via skill_store.
 * Returns true if both directions were created successfully.
 */
async function createEntityLink(
  client: ApiClient,
  userId: string,
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
    { userId },
  );

  if (!forwardResponse.success) {
    logger.error('auto-linker: forward link creation failed', {
      userId,
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
    { userId },
  );

  if (!reverseResponse.success) {
    logger.error('auto-linker: reverse link creation failed', {
      userId,
      sourceType,
      targetType,
      status: reverseResponse.error.status,
    });

    // Best-effort rollback of orphaned forward link
    try {
      await client.delete(`/api/skill-store/items/${forwardResponse.data.id}`, { userId });
    } catch {
      logger.error('auto-linker: rollback of orphaned forward link failed', {
        userId,
        forwardId: forwardResponse.data.id,
      });
    }

    return false;
  }

  return true;
}

// ==================== Sender matching ====================

/**
 * Search for contacts matching the sender's email or phone.
 * Returns matched contact IDs and creates links for each match.
 */
async function matchSenderToContacts(
  client: ApiClient,
  logger: Logger,
  userId: string,
  threadId: string,
  senderEmail?: string,
  senderPhone?: string,
): Promise<string[]> {
  // Build search query from sender info
  const searchQuery = senderEmail ?? senderPhone;
  if (!searchQuery) {
    return [];
  }

  const queryParams = new URLSearchParams({
    search: searchQuery,
    limit: '5',
  });

  const response = await client.get<{
    contacts?: ContactResult[];
    items?: ContactResult[];
    total?: number;
  }>(`/api/contacts?${queryParams.toString()}`, { userId });

  if (!response.success) {
    logger.error('auto-linker: contact search failed', {
      userId,
      status: response.error.status,
      code: response.error.code,
    });
    return [];
  }

  const contacts = response.data.contacts ?? response.data.items ?? [];
  if (contacts.length === 0) {
    return [];
  }

  // Filter to exact matches on email or phone
  const matchedContacts = contacts.filter((c) => {
    if (senderEmail && c.email?.toLowerCase() === senderEmail.toLowerCase()) {
      return true;
    }
    if (senderPhone && c.phone === senderPhone) {
      return true;
    }
    return false;
  });

  const linkedContactIds: string[] = [];

  for (const contact of matchedContacts) {
    try {
      const linked = await createEntityLink(
        client,
        userId,
        logger,
        'contact',
        contact.id,
        'todo', // Using 'todo' as proxy for thread (threads not an entity-link type)
        threadId,
        'inbound-message-sender',
      );

      if (linked) {
        linkedContactIds.push(contact.id);
      }
    } catch (error) {
      logger.error('auto-linker: failed to create contact link', {
        userId,
        contactId: contact.id,
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
  userId: string,
  threadId: string,
  content: string,
  similarityThreshold: number,
): Promise<{ projects: string[]; todos: string[] }> {
  const trimmedContent = content.trim();
  if (trimmedContent.length === 0) {
    return { projects: [], todos: [] };
  }

  // Truncate for search
  const searchQuery = trimmedContent.substring(0, MAX_SEARCH_QUERY_LENGTH);

  const queryParams = new URLSearchParams({
    q: searchQuery,
    types: 'work_item',
    limit: '10',
    semantic: 'true',
    user_email: userId,
  });

  const response = await client.get<{
    results: SearchResultItem[];
    search_type: string;
    total: number;
  }>(`/api/search?${queryParams.toString()}`, { userId });

  if (!response.success) {
    logger.error('auto-linker: content search failed', {
      userId,
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
      userId,
      threshold: similarityThreshold,
      totalResults: results.length,
      topScore: results[0]?.score ?? 0,
    });
    return { projects: [], todos: [] };
  }

  const linkedProjects: string[] = [];
  const linkedTodos: string[] = [];

  for (const item of highConfidenceResults) {
    const kind = item.metadata?.kind;
    const isProject = kind !== undefined && PROJECT_KINDS.has(kind);
    const isTodo = kind !== undefined && TODO_KINDS.has(kind);

    if (!isProject && !isTodo) {
      continue;
    }

    const targetType = isProject ? 'project' : 'todo';

    try {
      const linked = await createEntityLink(
        client,
        userId,
        logger,
        targetType,
        item.id,
        'todo', // Using 'todo' as proxy for thread
        threadId,
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
        userId,
        itemId: item.id,
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
 * Performs sender matching and content matching in parallel.
 * Never throws - all errors are caught and logged.
 *
 * @param options - Auto-link configuration and message data
 * @returns Summary of links created and entities matched
 */
export async function autoLinkInboundMessage(options: AutoLinkOptions): Promise<AutoLinkResult> {
  const {
    client,
    logger,
    userId,
    message,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  } = options;

  const emptyResult: AutoLinkResult = {
    linksCreated: 0,
    matches: { contacts: [], projects: [], todos: [] },
  };

  try {
    logger.info('auto-linker: processing inbound message', {
      userId,
      threadId: message.threadId,
      hasSenderEmail: !!message.senderEmail,
      hasSenderPhone: !!message.senderPhone,
      contentLength: message.content.length,
    });

    // Run sender matching and content matching in parallel
    const [contactMatches, contentMatches] = await Promise.all([
      matchSenderToContacts(
        client,
        logger,
        userId,
        message.threadId,
        message.senderEmail,
        message.senderPhone,
      ).catch((error) => {
        logger.error('auto-linker: sender matching failed', {
          userId,
          error: sanitizeErrorMessage(error),
        });
        return [] as string[];
      }),
      matchContentToWorkItems(
        client,
        logger,
        userId,
        message.threadId,
        message.content,
        similarityThreshold,
      ).catch((error) => {
        logger.error('auto-linker: content matching failed', {
          userId,
          error: sanitizeErrorMessage(error),
        });
        return { projects: [] as string[], todos: [] as string[] };
      }),
    ]);

    const result: AutoLinkResult = {
      linksCreated: contactMatches.length + contentMatches.projects.length + contentMatches.todos.length,
      matches: {
        contacts: contactMatches,
        projects: contentMatches.projects,
        todos: contentMatches.todos,
      },
    };

    logger.info('auto-linker: completed', {
      userId,
      threadId: message.threadId,
      linksCreated: result.linksCreated,
      contactMatches: result.matches.contacts.length,
      projectMatches: result.matches.projects.length,
      todoMatches: result.matches.todos.length,
    });

    return result;
  } catch (error) {
    logger.error('auto-linker: unexpected failure', {
      userId,
      error: sanitizeErrorMessage(error),
    });
    return emptyResult;
  }
}
