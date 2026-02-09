/**
 * Error types and retry logic for the embedding service.
 */

export type EmbeddingErrorType = 'rate_limit' | 'auth' | 'network' | 'invalid_input' | 'timeout';

/**
 * Structured error for embedding operations.
 */
export class EmbeddingError extends Error {
  readonly type: EmbeddingErrorType;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly provider?: string;

  constructor(
    type: EmbeddingErrorType,
    message: string,
    options?: {
      retryAfterMs?: number;
      provider?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'EmbeddingError';
    this.type = type;
    this.provider = options?.provider;
    this.retryAfterMs = options?.retryAfterMs;

    // Determine if retryable based on error type
    switch (type) {
      case 'rate_limit':
        this.retryable = true;
        break;
      case 'network':
        this.retryable = true;
        break;
      case 'timeout':
        this.retryable = true;
        break;
      case 'auth':
        this.retryable = false;
        break;
      case 'invalid_input':
        this.retryable = false;
        break;
      default:
        this.retryable = false;
    }

    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  /**
   * Returns a safe error message that doesn't include API keys or sensitive data.
   */
  toSafeString(): string {
    const parts = [`[${this.type}]`, this.message];
    if (this.provider) {
      parts.push(`(provider: ${this.provider})`);
    }
    if (this.retryable) {
      parts.push('(retryable)');
    }
    return parts.join(' ');
  }
}

/**
 * Retry configuration for embedding operations.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
}

/**
 * Default retry configuration by error type.
 */
export const DEFAULT_RETRY_CONFIG: Record<EmbeddingErrorType, RetryConfig> = {
  rate_limit: {
    maxRetries: 3,
    baseDelayMs: 1000, // 1s, 2s, 4s
    maxDelayMs: 10000,
  },
  network: {
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  },
  timeout: {
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  },
  auth: {
    maxRetries: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
  },
  invalid_input: {
    maxRetries: 0,
    baseDelayMs: 0,
    maxDelayMs: 0,
  },
};

/**
 * Calculate the delay for a retry attempt using exponential backoff.
 *
 * @param attempt Current retry attempt (0-indexed)
 * @param config Retry configuration
 * @param serverSuggestedMs Optional server-suggested delay (e.g., from Retry-After header)
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig, serverSuggestedMs?: number): number {
  // If server suggests a delay, use it (but cap at maxDelayMs)
  if (serverSuggestedMs !== undefined && serverSuggestedMs > 0) {
    return Math.min(serverSuggestedMs, config.maxDelayMs);
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Add jitter (0-25% of delay) to prevent thundering herd
  const jitter = exponentialDelay * Math.random() * 0.25;

  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * Execute an operation with retry logic.
 *
 * @param operation The async operation to execute
 * @param getConfig Function to get retry config based on error
 * @returns Result of the operation
 * @throws EmbeddingError if all retries exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  getConfig: (error: EmbeddingError) => RetryConfig = (error) => DEFAULT_RETRY_CONFIG[error.type] ?? DEFAULT_RETRY_CONFIG.network,
): Promise<T> {
  let lastError: EmbeddingError | undefined;
  let attempt = 0;

  // First attempt (attempt 0) plus retries
  while (true) {
    try {
      return await operation();
    } catch (error) {
      // Wrap non-EmbeddingError in EmbeddingError
      const embeddingError =
        error instanceof EmbeddingError
          ? error
          : new EmbeddingError('network', (error as Error).message || 'Unknown error', {
              cause: error,
            });

      lastError = embeddingError;

      // Check if retryable
      if (!embeddingError.retryable) {
        throw embeddingError;
      }

      const config = getConfig(embeddingError);

      // Check if we've exhausted retries
      if (attempt >= config.maxRetries) {
        throw embeddingError;
      }

      // Calculate and wait for delay
      const delay = calculateRetryDelay(attempt, config, embeddingError.retryAfterMs);

      // Log retry attempt (no secrets)
      console.warn(`[Embeddings] Retry ${attempt + 1}/${config.maxRetries} after ${Math.round(delay)}ms:`, embeddingError.toSafeString());

      await sleep(delay);
      attempt++;
    }
  }
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
