/**
 * Plugin lifecycle hooks implementation.
 * Provides auto-recall and auto-capture functionality.
 */

import type { ApiClient } from './api-client.js';
import type { Logger } from './logger.js';
import type { PluginConfig } from './config.js';
import { sanitizeExternalMessage } from './utils/injection-protection.js';

/** Default timeout for auto-recall hook (5 seconds) */
const DEFAULT_RECALL_TIMEOUT_MS = 5000;

/** Default timeout for auto-capture hook (10 seconds) */
const DEFAULT_CAPTURE_TIMEOUT_MS = 10000;

/** Patterns that indicate sensitive content to filter */
const SENSITIVE_PATTERNS = [
  /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
  /\b(?:api[_-]?key|apikey)\s*[:=]\s*\S+/i,
  /\bsk-[a-zA-Z0-9]{10,}/, // API keys (10+ chars after sk-)
  /\b(?:secret|token)\s*[:=]\s*\S+/i,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card numbers
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
];

/** Event data for auto-recall hook */
export interface AutoRecallEvent {
  prompt: string;
}

/** Result from auto-recall hook */
export interface AutoRecallResult {
  prependContext: string;
}

/** Event data for auto-capture hook */
export interface AutoCaptureEvent {
  messages: Array<{
    role: string;
    content: string;
  }>;
}

/** Options for creating auto-recall hook */
export interface AutoRecallHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
  timeoutMs?: number;
}

/** Options for creating auto-capture hook */
export interface AutoCaptureHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
  timeoutMs?: number;
}

/** Options for creating health check */
export interface HealthCheckOptions {
  client: ApiClient;
  logger: Logger;
}

/** Health check result */
export interface HealthCheckResult {
  healthy: boolean;
  error?: string;
}

/**
 * Create a promise that rejects after a timeout.
 */
function createTimeoutPromise<T>(ms: number, timeoutResult: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(timeoutResult), ms);
  });
}

/**
 * Check if content contains sensitive patterns.
 */
function containsSensitiveContent(content: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Filter sensitive content from a string.
 */
function filterSensitiveContent(content: string): string {
  let filtered = content;
  for (const pattern of SENSITIVE_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    filtered = filtered.replace(globalPattern, '[REDACTED]');
  }
  return filtered;
}

/**
 * Creates the auto-recall hook (before_agent_start).
 *
 * This hook fetches relevant context from the backend based on the user's prompt
 * and returns it to be prepended to the conversation.
 */
export function createAutoRecallHook(options: AutoRecallHookOptions): (event: AutoRecallEvent) => Promise<AutoRecallResult | null> {
  const { client, logger, config, userId, timeoutMs = DEFAULT_RECALL_TIMEOUT_MS } = options;

  return async (event: AutoRecallEvent): Promise<AutoRecallResult | null> => {
    // Skip if auto-recall is disabled
    if (!config.autoRecall) {
      logger.debug('auto-recall skipped: disabled in config', { userId });
      return null;
    }

    // Log without prompt content
    logger.info('auto-recall invoked', {
      userId,
      promptLength: event.prompt.length,
    });

    try {
      // Race between API call and timeout
      const result = await Promise.race([
        fetchContext(client, userId, event.prompt, logger, config.maxRecallMemories),
        createTimeoutPromise<AutoRecallResult | null>(timeoutMs, null).then(() => {
          logger.warn('auto-recall timeout exceeded', { userId, timeoutMs });
          return null;
        }),
      ]);

      if (result === null) {
        logger.debug('auto-recall returned no context', { userId });
        return null;
      }

      logger.debug('auto-recall completed', {
        userId,
        contextLength: result.prependContext.length,
      });

      return result;
    } catch (error) {
      logger.error('auto-recall failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
}

/**
 * Fetch context from the backend API using semantic memory search.
 *
 * Uses the existing `/api/memories/search` endpoint (which works)
 * instead of the non-existent `/api/context` endpoint.
 * The user's actual prompt is passed as the search query for semantic matching.
 */
async function fetchContext(client: ApiClient, userId: string, prompt: string, logger: Logger, maxResults = 5): Promise<AutoRecallResult | null> {
  // Truncate prompt to a reasonable length for the search query
  const searchQuery = prompt.substring(0, 500);

  const queryParams = new URLSearchParams({
    q: searchQuery,
    limit: String(maxResults),
  });

  const response = await client.get<{
    memories: Array<{
      id: string;
      content: string;
      category: string;
      score?: number;
    }>;
  }>(`/api/memories/search?${queryParams.toString()}`, { userId });

  if (!response.success) {
    logger.error('auto-recall API error', {
      userId,
      status: response.error.status,
      code: response.error.code,
    });
    return null;
  }

  const memories = response.data.memories ?? [];
  if (memories.length === 0) {
    return null;
  }

  // Format memories as context to prepend to the conversation.
  // Sanitize memory content to remove invisible characters that
  // could be used for injection via stored memory content.
  const context = memories.map((m) => `- [${m.category}] ${sanitizeExternalMessage(m.content)}`).join('\n');

  return {
    prependContext: context,
  };
}

/**
 * Creates the auto-capture hook (agent_end).
 *
 * This hook analyzes the completed conversation and stores important
 * information as memories.
 */
export function createAutoCaptureHook(options: AutoCaptureHookOptions): (event: AutoCaptureEvent) => Promise<void> {
  const { client, logger, config, userId, timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS } = options;

  return async (event: AutoCaptureEvent): Promise<void> => {
    // Skip if auto-capture is disabled
    if (!config.autoCapture) {
      logger.debug('auto-capture skipped: disabled in config', { userId });
      return;
    }

    // Skip empty conversations
    if (!event.messages || event.messages.length === 0) {
      logger.debug('auto-capture skipped: no messages', { userId });
      return;
    }

    // Log without message content
    logger.info('auto-capture invoked', {
      userId,
      messageCount: event.messages.length,
    });

    try {
      // Race between API call and timeout
      await Promise.race([
        captureContext(client, userId, event.messages, logger),
        createTimeoutPromise<void>(timeoutMs, undefined).then(() => {
          logger.warn('auto-capture timeout exceeded', { userId, timeoutMs });
        }),
      ]);

      logger.debug('auto-capture completed', { userId });
    } catch (error) {
      logger.error('auto-capture failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - hook errors should not crash the agent
    }
  };
}

/**
 * Capture context from conversation messages.
 */
async function captureContext(client: ApiClient, userId: string, messages: AutoCaptureEvent['messages'], logger: Logger): Promise<void> {
  // Filter out messages with sensitive content
  const filteredMessages = messages.filter((msg) => {
    if (containsSensitiveContent(msg.content)) {
      logger.debug('auto-capture filtered sensitive message', { userId });
      return false;
    }
    return true;
  });

  if (filteredMessages.length === 0) {
    logger.debug('auto-capture skipped: all messages filtered', { userId });
    return;
  }

  // Prepare conversation summary for capture
  const conversationSummary = filteredMessages.map((msg) => filterSensitiveContent(msg.content)).join('\n');

  const response = await client.post<{ captured: number }>(
    '/api/context/capture',
    {
      conversation: conversationSummary,
      messageCount: filteredMessages.length,
    },
    { userId },
  );

  if (!response.success) {
    logger.error('auto-capture API error', {
      userId,
      status: response.error.status,
      code: response.error.code,
    });
  }
}

/** Options for graph-aware auto-recall hook */
export interface GraphAwareRecallHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
  timeoutMs?: number;
}

/** Graph-aware context API response shape */
interface GraphAwareContextApiResponse {
  /** Formatted context string with scope attribution */
  context: string | null;
  /** Individual memory results with scope attribution */
  memories: Array<{
    id: string;
    title: string;
    content: string;
    memoryType: string;
    similarity: number;
    importance: number;
    confidence: number;
    combinedRelevance: number;
    scopeType: string;
    scopeLabel: string;
  }>;
  /** Metadata about the retrieval */
  metadata: {
    queryTimeMs: number;
    scopeCount: number;
    totalMemoriesFound: number;
    searchType: string;
    maxDepth: number;
  };
}

/**
 * Creates a graph-aware auto-recall hook (before_agent_start).
 *
 * This hook uses the graph-aware context retrieval API to fetch memories
 * across the user's relationship graph (personal, contact, group, relationship
 * scopes). Falls back to basic memory search if the graph-aware endpoint
 * is unavailable.
 *
 * Part of Epic #486, Issue #497.
 */
export function createGraphAwareRecallHook(options: GraphAwareRecallHookOptions): (event: AutoRecallEvent) => Promise<AutoRecallResult | null> {
  const { client, logger, config, userId, timeoutMs = DEFAULT_RECALL_TIMEOUT_MS } = options;

  return async (event: AutoRecallEvent): Promise<AutoRecallResult | null> => {
    // Skip if auto-recall is disabled
    if (!config.autoRecall) {
      logger.debug('graph-aware-recall skipped: disabled in config', { userId });
      return null;
    }

    // Log without prompt content
    logger.info('graph-aware-recall invoked', {
      userId,
      promptLength: event.prompt.length,
    });

    try {
      // Race between API call and timeout
      const result = await Promise.race([
        fetchGraphAwareContext(client, userId, event.prompt, logger, config.maxRecallMemories),
        createTimeoutPromise<AutoRecallResult | null>(timeoutMs, null).then(() => {
          logger.warn('graph-aware-recall timeout exceeded', { userId, timeoutMs });
          return null;
        }),
      ]);

      if (result === null) {
        logger.debug('graph-aware-recall returned no context', { userId });
        return null;
      }

      logger.debug('graph-aware-recall completed', {
        userId,
        contextLength: result.prependContext.length,
      });

      return result;
    } catch (error) {
      logger.error('graph-aware-recall failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
}

/**
 * Fetch context using the graph-aware context retrieval API.
 *
 * Calls POST /api/context/graph-aware with the user's prompt for
 * multi-scope semantic search across relationships.
 * Falls back to basic /api/memories/search if the graph-aware endpoint fails.
 */
async function fetchGraphAwareContext(client: ApiClient, userId: string, prompt: string, logger: Logger, maxResults = 10): Promise<AutoRecallResult | null> {
  // Truncate prompt for the search query
  const searchPrompt = prompt.substring(0, 500);

  // Try graph-aware endpoint first
  const graphResponse = await client.post<GraphAwareContextApiResponse>(
    '/api/context/graph-aware',
    {
      prompt: searchPrompt,
      maxMemories: maxResults,
      maxDepth: 1,
    },
    { userId },
  );

  if (graphResponse.success && graphResponse.data.context) {
    logger.debug('graph-aware context retrieved', {
      userId,
      memoryCount: graphResponse.data.memories.length,
      scopeCount: graphResponse.data.metadata.scopeCount,
      searchType: graphResponse.data.metadata.searchType,
      queryTimeMs: graphResponse.data.metadata.queryTimeMs,
    });

    return {
      prependContext: graphResponse.data.context,
    };
  }

  // Fall back to basic memory search if graph-aware endpoint fails
  logger.debug('graph-aware endpoint unavailable, falling back to basic recall', {
    userId,
    graphError: graphResponse.success ? 'no context' : graphResponse.error.code,
  });

  return fetchContext(client, userId, prompt, logger, maxResults);
}

/**
 * Creates the health check function.
 */
export function createHealthCheck(options: HealthCheckOptions): () => Promise<HealthCheckResult> {
  const { client, logger } = options;

  return async (): Promise<HealthCheckResult> => {
    try {
      const response = await client.healthCheck();

      if (!response.healthy) {
        logger.warn('health check failed', { latencyMs: response.latencyMs });
        return {
          healthy: false,
          error: 'Health check failed',
        };
      }

      logger.debug('health check passed', { latencyMs: response.latencyMs });
      return { healthy: true };
    } catch (error) {
      logger.error('health check error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}
