/**
 * Plugin lifecycle hooks implementation.
 * Provides auto-recall and auto-capture functionality.
 */

import type { ApiClient } from './api-client.js'
import type { Logger } from './logger.js'
import type { PluginConfig } from './config.js'

/** Default timeout for auto-recall hook (5 seconds) */
const DEFAULT_RECALL_TIMEOUT_MS = 5000

/** Default timeout for auto-capture hook (10 seconds) */
const DEFAULT_CAPTURE_TIMEOUT_MS = 10000

/** Patterns that indicate sensitive content to filter */
const SENSITIVE_PATTERNS = [
  /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
  /\b(?:api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
  /\bsk-[a-zA-Z0-9]{10,}/g, // API keys (10+ chars after sk-)
  /\b(?:secret|token)\s*[:=]\s*\S+/gi,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card numbers
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
]

/** Event data for auto-recall hook */
export interface AutoRecallEvent {
  prompt: string
}

/** Result from auto-recall hook */
export interface AutoRecallResult {
  prependContext: string
}

/** Event data for auto-capture hook */
export interface AutoCaptureEvent {
  messages: Array<{
    role: string
    content: string
  }>
}

/** Options for creating auto-recall hook */
export interface AutoRecallHookOptions {
  client: ApiClient
  logger: Logger
  config: PluginConfig
  userId: string
  timeoutMs?: number
}

/** Options for creating auto-capture hook */
export interface AutoCaptureHookOptions {
  client: ApiClient
  logger: Logger
  config: PluginConfig
  userId: string
  timeoutMs?: number
}

/** Options for creating health check */
export interface HealthCheckOptions {
  client: ApiClient
  logger: Logger
}

/** Health check result */
export interface HealthCheckResult {
  healthy: boolean
  error?: string
}

/**
 * Create a promise that rejects after a timeout.
 */
function createTimeoutPromise<T>(ms: number, timeoutResult: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(timeoutResult), ms)
  })
}

/**
 * Check if content contains sensitive patterns.
 */
function containsSensitiveContent(content: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(content))
}

/**
 * Filter sensitive content from a string.
 */
function filterSensitiveContent(content: string): string {
  let filtered = content
  for (const pattern of SENSITIVE_PATTERNS) {
    filtered = filtered.replace(pattern, '[REDACTED]')
  }
  return filtered
}

/**
 * Creates the auto-recall hook (before_agent_start).
 *
 * This hook fetches relevant context from the backend based on the user's prompt
 * and returns it to be prepended to the conversation.
 */
export function createAutoRecallHook(
  options: AutoRecallHookOptions
): (event: AutoRecallEvent) => Promise<AutoRecallResult | null> {
  const {
    client,
    logger,
    config,
    userId,
    timeoutMs = DEFAULT_RECALL_TIMEOUT_MS,
  } = options

  return async (event: AutoRecallEvent): Promise<AutoRecallResult | null> => {
    // Skip if auto-recall is disabled
    if (!config.autoRecall) {
      logger.debug('auto-recall skipped: disabled in config', { userId })
      return null
    }

    // Log without prompt content
    logger.info('auto-recall invoked', {
      userId,
      promptLength: event.prompt.length,
    })

    try {
      // Race between API call and timeout
      const result = await Promise.race([
        fetchContext(client, userId, event.prompt, logger, config.maxRecallMemories),
        createTimeoutPromise<AutoRecallResult | null>(timeoutMs, null).then(() => {
          logger.warn('auto-recall timeout exceeded', { userId, timeoutMs })
          return null
        }),
      ])

      if (result === null) {
        logger.debug('auto-recall returned no context', { userId })
        return null
      }

      logger.debug('auto-recall completed', {
        userId,
        contextLength: result.prependContext.length,
      })

      return result
    } catch (error) {
      logger.error('auto-recall failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}

/**
 * Fetch context from the backend API using semantic memory search.
 *
 * Uses the existing `/api/memories/search` endpoint (which works)
 * instead of the non-existent `/api/context` endpoint.
 * The user's actual prompt is passed as the search query for semantic matching.
 */
async function fetchContext(
  client: ApiClient,
  userId: string,
  prompt: string,
  logger: Logger,
  maxResults = 5
): Promise<AutoRecallResult | null> {
  // Truncate prompt to a reasonable length for the search query
  const searchQuery = prompt.substring(0, 500)

  const queryParams = new URLSearchParams({
    q: searchQuery,
    limit: String(maxResults),
  })

  const response = await client.get<{
    memories: Array<{
      id: string
      content: string
      category: string
      score?: number
    }>
  }>(
    `/api/memories/search?${queryParams.toString()}`,
    { userId }
  )

  if (!response.success) {
    logger.error('auto-recall API error', {
      userId,
      status: response.error.status,
      code: response.error.code,
    })
    return null
  }

  const memories = response.data.memories ?? []
  if (memories.length === 0) {
    return null
  }

  // Format memories as context to prepend to the conversation
  const context = memories
    .map((m) => `- [${m.category}] ${m.content}`)
    .join('\n')

  return {
    prependContext: context,
  }
}

/**
 * Creates the auto-capture hook (agent_end).
 *
 * This hook analyzes the completed conversation and stores important
 * information as memories.
 */
export function createAutoCaptureHook(
  options: AutoCaptureHookOptions
): (event: AutoCaptureEvent) => Promise<void> {
  const {
    client,
    logger,
    config,
    userId,
    timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
  } = options

  return async (event: AutoCaptureEvent): Promise<void> => {
    // Skip if auto-capture is disabled
    if (!config.autoCapture) {
      logger.debug('auto-capture skipped: disabled in config', { userId })
      return
    }

    // Skip empty conversations
    if (!event.messages || event.messages.length === 0) {
      logger.debug('auto-capture skipped: no messages', { userId })
      return
    }

    // Log without message content
    logger.info('auto-capture invoked', {
      userId,
      messageCount: event.messages.length,
    })

    try {
      // Race between API call and timeout
      await Promise.race([
        captureContext(client, userId, event.messages, logger),
        createTimeoutPromise<void>(timeoutMs, undefined).then(() => {
          logger.warn('auto-capture timeout exceeded', { userId, timeoutMs })
        }),
      ])

      logger.debug('auto-capture completed', { userId })
    } catch (error) {
      logger.error('auto-capture failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't throw - hook errors should not crash the agent
    }
  }
}

/**
 * Capture context from conversation messages.
 */
async function captureContext(
  client: ApiClient,
  userId: string,
  messages: AutoCaptureEvent['messages'],
  logger: Logger
): Promise<void> {
  // Filter out messages with sensitive content
  const filteredMessages = messages.filter((msg) => {
    if (containsSensitiveContent(msg.content)) {
      logger.debug('auto-capture filtered sensitive message', { userId })
      return false
    }
    return true
  })

  if (filteredMessages.length === 0) {
    logger.debug('auto-capture skipped: all messages filtered', { userId })
    return
  }

  // Prepare conversation summary for capture
  const conversationSummary = filteredMessages
    .map((msg) => filterSensitiveContent(msg.content))
    .join('\n')

  const response = await client.post<{ captured: number }>(
    '/api/context/capture',
    {
      conversation: conversationSummary,
      messageCount: filteredMessages.length,
    },
    { userId }
  )

  if (!response.success) {
    logger.error('auto-capture API error', {
      userId,
      status: response.error.status,
      code: response.error.code,
    })
  }
}

/**
 * Creates the health check function.
 */
export function createHealthCheck(
  options: HealthCheckOptions
): () => Promise<HealthCheckResult> {
  const { client, logger } = options

  return async (): Promise<HealthCheckResult> => {
    try {
      const response = await client.healthCheck()

      if (!response.healthy) {
        logger.warn('health check failed', { latencyMs: response.latencyMs })
        return {
          healthy: false,
          error: 'Health check failed',
        }
      }

      logger.debug('health check passed', { latencyMs: response.latencyMs })
      return { healthy: true }
    } catch (error) {
      logger.error('health check error', {
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}
