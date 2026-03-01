/**
 * Plugin lifecycle hooks implementation.
 * Provides auto-recall and auto-capture functionality.
 */

import type { ApiClient } from './api-client.js';
import type { Logger } from './logger.js';
import type { PluginConfig } from './config.js';
import { createBoundaryMarkers, wrapExternalMessage } from './utils/injection-protection.js';

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
    content: string | unknown;
  }>;
}

/** Options for creating auto-recall hook */
export interface AutoRecallHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  getAgentId: () => string;
  timeoutMs?: number;
}

/** Options for creating auto-capture hook */
export interface AutoCaptureHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  getAgentId: () => string;
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
 * Extract plain text from message content.
 * OpenClaw message content can be a plain string or an array of content blocks
 * (e.g., [{type: "text", text: "..."}, {type: "image", ...}]).
 * This normalizes both forms to a plain string (#1563).
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n');
  }
  return '';
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
  const { client, logger, config, getAgentId, timeoutMs = DEFAULT_RECALL_TIMEOUT_MS } = options;

  return async (event: AutoRecallEvent): Promise<AutoRecallResult | null> => {
    const user_id = getAgentId();

    // Skip if auto-recall is disabled
    if (!config.autoRecall) {
      logger.debug('auto-recall skipped: disabled in config', { user_id });
      return null;
    }

    // Log without prompt content
    logger.info('auto-recall invoked', {
      user_id,
      promptLength: event.prompt.length,
    });

    try {
      // Race between API call and timeout
      const result = await Promise.race([
        fetchContext(client, user_id, event.prompt, logger, config.maxRecallMemories, config.minRecallScore),
        createTimeoutPromise<AutoRecallResult | null>(timeoutMs, null).then(() => {
          logger.warn('auto-recall timeout exceeded', { user_id, timeoutMs });
          return null;
        }),
      ]);

      if (result === null) {
        logger.debug('auto-recall returned no context', { user_id });
        return null;
      }

      logger.debug('auto-recall completed', {
        user_id,
        contextLength: result.prependContext.length,
      });

      return result;
    } catch (error) {
      logger.error('auto-recall failed', {
        user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
}

/** Guidance note prepended to recalled context (#1926) */
const RECALL_GUIDANCE_NOTE =
  '[Recalled from long-term memory. For deeper investigation, use memory_recall, context_search, or tool_guide.]';

/**
 * Fetch context from the backend API using semantic memory search.
 *
 * Uses the existing `/api/memories/search` endpoint (which works)
 * instead of the non-existent `/api/context` endpoint.
 * The user's actual prompt is passed as the search query for semantic matching.
 * Filters results by minRecallScore with graceful degradation (#1926).
 */
async function fetchContext(client: ApiClient, user_id: string, prompt: string, logger: Logger, max_results = 5, minScore = 0.7): Promise<AutoRecallResult | null> {
  // Truncate prompt to a reasonable length for the search query
  const searchQuery = prompt.substring(0, 500);

  const queryParams = new URLSearchParams({
    q: searchQuery,
    limit: String(max_results),
  });

  const response = await client.get<{
    memories: Array<{
      id: string;
      content: string;
      category: string;
      score?: number;
    }>;
  }>(`/api/memories/search?${queryParams.toString()}`, { user_id });

  if (!response.success) {
    logger.error('auto-recall API error', {
      user_id,
      status: response.error.status,
      code: response.error.code,
    });
    return null;
  }

  const memories = response.data.memories ?? [];
  if (memories.length === 0) {
    return null;
  }

  // Filter memories by minRecallScore (#1926)
  const filtered = filterByScore(memories, minScore, (m) => m.score ?? 0);

  // Generate a per-invocation nonce for boundary markers (#1255)
  const { nonce } = createBoundaryMarkers();

  // Format memories as context to prepend to the conversation.
  // Boundary-wrap each memory to mark recalled content as untrusted data.
  // Memory content may originate from external messages (indirect injection path).
  // Include provenance markers with memory_type and relevance % (#1926).
  const context = filtered
    .map((m) => {
      const label = sanitizeLabel(m.category);
      const wrapped = wrapExternalMessage(m.content, { channel: `memory:${label}`, nonce });
      const relevancePct = Math.round(safeScore(m.score) * 100);
      return `- [${label}] (relevance: ${relevancePct}%) ${wrapped}`;
    })
    .join('\n');

  return {
    prependContext: `${RECALL_GUIDANCE_NOTE}\n${context}`,
  };
}

/**
 * Normalize a score to a finite number, treating NaN/Infinity/undefined as 0.
 */
function safeScore(score: number | undefined): number {
  return Number.isFinite(score) ? score as number : 0;
}

/**
 * Sanitize a provenance label (category/memory_type) to prevent injection
 * of instruction-like text outside boundary wrappers.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Filter items by a minimum score threshold with graceful degradation.
 * If no items meet the threshold, the single highest-scoring item is kept (#1926).
 * Scores are normalized with safeScore to handle NaN/Infinity.
 */
function filterByScore<T>(items: T[], minScore: number, getScore: (item: T) => number): T[] {
  if (items.length === 0) return [];

  const passing = items.filter((item) => safeScore(getScore(item)) >= minScore);
  if (passing.length > 0) return passing;

  // Graceful degradation: keep the best single item
  let best = items[0];
  for (let i = 1; i < items.length; i++) {
    if (safeScore(getScore(items[i])) > safeScore(getScore(best))) {
      best = items[i];
    }
  }
  return [best];
}

/**
 * Creates the auto-capture hook (agent_end).
 *
 * This hook analyzes the completed conversation and stores important
 * information as memories.
 */
export function createAutoCaptureHook(options: AutoCaptureHookOptions): (event: AutoCaptureEvent) => Promise<void> {
  const { client, logger, config, getAgentId, timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS } = options;

  return async (event: AutoCaptureEvent): Promise<void> => {
    const user_id = getAgentId();

    // Skip if auto-capture is disabled
    if (!config.autoCapture) {
      logger.debug('auto-capture skipped: disabled in config', { user_id });
      return;
    }

    // Skip empty conversations
    if (!event.messages || event.messages.length === 0) {
      logger.debug('auto-capture skipped: no messages', { user_id });
      return;
    }

    // Log without message content
    logger.info('auto-capture invoked', {
      user_id,
      message_count: event.messages.length,
    });

    try {
      // Race between API call and timeout
      await Promise.race([
        captureContext(client, user_id, event.messages, logger),
        createTimeoutPromise<void>(timeoutMs, undefined).then(() => {
          logger.warn('auto-capture timeout exceeded', { user_id, timeoutMs });
        }),
      ]);

      logger.debug('auto-capture completed', { user_id });
    } catch (error) {
      logger.error('auto-capture failed', {
        user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - hook errors should not crash the agent
    }
  };
}

/**
 * Capture context from conversation messages.
 */
async function captureContext(client: ApiClient, user_id: string, messages: AutoCaptureEvent['messages'], logger: Logger): Promise<void> {
  // Filter out messages with sensitive content
  // Use extractTextContent to handle structured content blocks (#1563)
  const filteredMessages = messages.filter((msg) => {
    const text = extractTextContent(msg.content);
    if (containsSensitiveContent(text)) {
      logger.debug('auto-capture filtered sensitive message', { user_id });
      return false;
    }
    return true;
  });

  if (filteredMessages.length === 0) {
    logger.debug('auto-capture skipped: all messages filtered', { user_id });
    return;
  }

  // Prepare conversation summary for capture
  const conversationSummary = filteredMessages.map((msg) => filterSensitiveContent(extractTextContent(msg.content))).join('\n');

  const response = await client.post<{ captured: number }>(
    '/api/context/capture',
    {
      conversation: conversationSummary,
      message_count: filteredMessages.length,
    },
    { user_id },
  );

  if (!response.success) {
    logger.error('auto-capture API error', {
      user_id,
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
  getAgentId: () => string;
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
    memory_type: string;
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
    search_type: string;
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
  const { client, logger, config, getAgentId, timeoutMs = DEFAULT_RECALL_TIMEOUT_MS } = options;

  return async (event: AutoRecallEvent): Promise<AutoRecallResult | null> => {
    const user_id = getAgentId();

    // Skip if auto-recall is disabled
    if (!config.autoRecall) {
      logger.debug('graph-aware-recall skipped: disabled in config', { user_id });
      return null;
    }

    // Log without prompt content
    logger.info('graph-aware-recall invoked', {
      user_id,
      promptLength: event.prompt.length,
    });

    try {
      // Race between API call and timeout
      const result = await Promise.race([
        fetchGraphAwareContext(client, user_id, event.prompt, logger, config.maxRecallMemories, config.minRecallScore),
        createTimeoutPromise<AutoRecallResult | null>(timeoutMs, null).then(() => {
          logger.warn('graph-aware-recall timeout exceeded', { user_id, timeoutMs });
          return null;
        }),
      ]);

      if (result === null) {
        logger.debug('graph-aware-recall returned no context', { user_id });
        return null;
      }

      logger.debug('graph-aware-recall completed', {
        user_id,
        contextLength: result.prependContext.length,
      });

      return result;
    } catch (error) {
      logger.error('graph-aware-recall failed', {
        user_id,
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
async function fetchGraphAwareContext(client: ApiClient, user_id: string, prompt: string, logger: Logger, max_results = 10, minScore = 0.7): Promise<AutoRecallResult | null> {
  // Truncate prompt for the search query
  const searchPrompt = prompt.substring(0, 500);

  // Try graph-aware endpoint first
  const graphResponse = await client.post<GraphAwareContextApiResponse>(
    '/api/context/graph-aware',
    {
      prompt: searchPrompt,
      maxMemories: max_results,
      maxDepth: 1,
    },
    { user_id },
  );

  if (graphResponse.success && graphResponse.data.memories.length > 0) {
    logger.debug('graph-aware context retrieved', {
      user_id,
      memoryCount: graphResponse.data.memories.length,
      scopeCount: graphResponse.data.metadata.scopeCount,
      search_type: graphResponse.data.metadata.search_type,
      queryTimeMs: graphResponse.data.metadata.queryTimeMs,
    });

    // Filter memories by minRecallScore using combinedRelevance (#1926)
    const filtered = filterByScore(graphResponse.data.memories, minScore, (m) => m.combinedRelevance);

    // Generate a per-invocation nonce for boundary markers (#1255)
    const { nonce } = createBoundaryMarkers();

    // Format each memory with provenance markers and boundary wrapping (#1926).
    // Memory content may originate from external messages (indirect injection path).
    const context = filtered
      .map((m) => {
        const label = sanitizeLabel(m.memory_type);
        const wrapped = wrapExternalMessage(m.content, { channel: `memory:${label}`, nonce });
        const relevancePct = Math.round(safeScore(m.combinedRelevance) * 100);
        return `- [${label}] (relevance: ${relevancePct}%) ${wrapped}`;
      })
      .join('\n');

    return {
      prependContext: `${RECALL_GUIDANCE_NOTE}\n${context}`,
    };
  }

  // Fall back to basic memory search if graph-aware endpoint fails or returns no memories
  logger.debug('graph-aware endpoint unavailable, falling back to basic recall', {
    user_id,
    graphError: graphResponse.success ? 'no context' : graphResponse.error.code,
  });

  return fetchContext(client, user_id, prompt, logger, max_results, minScore);
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
