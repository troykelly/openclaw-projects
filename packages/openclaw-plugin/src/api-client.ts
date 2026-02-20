/**
 * HTTP API client for openclaw-projects backend.
 * Handles authentication, request/response formatting, error handling,
 * retry logic with exponential backoff, and timeout handling.
 */

import type { PluginConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';

/** API error response */
export interface ApiError {
  status: number;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  /** Retry-After value in seconds (for 429 responses) */
  retryAfter?: number;
}

/** API response wrapper */
export type ApiResponse<T> = { success: true; data: T } | { success: false; error: ApiError };

/** Request options */
export interface RequestOptions {
  /** User ID for scoping */
  user_id?: string;
  /** Custom timeout (overrides config) */
  timeout?: number;
  /** Mark request as coming from an agent (adds X-OpenClaw-Agent header) */
  isAgent?: boolean;
}

/** API client options */
export interface ApiClientOptions {
  config: PluginConfig;
  logger?: Logger;
}

/** Health check result */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique request ID for tracing.
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 */
function calculateRetryDelay(attempt: number, baseDelay = 1000, maxDelay = 10000): number {
  // Exponential backoff: 1s, 2s, 4s, 8s...
  const exponentialDelay = baseDelay * 2 ** attempt;
  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * (0.75 + Math.random() * 0.5);
  return Math.min(jitter, maxDelay);
}

/**
 * Check if an error is retryable.
 */
function isRetryableStatus(status: number): boolean {
  // Retry on 5xx server errors, 429 rate-limited, and network errors (status 0)
  return status === 0 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Map HTTP status to error code.
 */
function getErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 0) return 'NETWORK_ERROR';
  return 'CLIENT_ERROR';
}

/**
 * HTTP API client for the openclaw-projects backend.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly logger: Logger;
  private readonly timeout: number;
  private readonly maxRetries: number;
  constructor(options: ApiClientOptions) {
    // Ensure URL doesn't have trailing slash
    this.baseUrl = options.config.apiUrl.replace(/\/$/, '');
    this.apiKey = options.config.apiKey;
    this.logger = options.logger ?? createLogger('api-client');
    this.timeout = options.config.timeout;
    this.maxRetries = options.config.maxRetries;
  }

  /**
   * Makes an authenticated request to the API with retry logic.
   */
  private async request<T>(method: string, path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const requestId = generateRequestId();
    const timeout = options?.timeout ?? this.timeout;

    let lastError: ApiError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // For 429 responses, prefer the server-specified Retry-After delay
        const delay = lastError?.status === 429 && lastError.retryAfter ? lastError.retryAfter * 1000 : calculateRetryDelay(attempt - 1);
        this.logger.debug(`Retrying request (attempt ${attempt + 1}/${this.maxRetries + 1})`, {
          path,
          delay,
        });
        await sleep(delay);
      }

      try {
        const result = await this.executeRequest<T>(method, url, body, requestId, options, timeout);

        if (result.success) {
          return result;
        }

        lastError = result.error;

        if (!isRetryableStatus(result.error.status)) {
          return result;
        }
      } catch (error) {
        // Handle timeout or network errors
        lastError = {
          status: 0,
          message: error instanceof Error ? error.message : 'Unknown error',
          code: error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        };

        this.logger.error('API request failed', {
          method,
          path,
          requestId,
          error: lastError.message,
        });

        // Network errors are retryable
        if (attempt < this.maxRetries) {
        }
      }
    }

    return {
      success: false,
      error: lastError ?? {
        status: 0,
        message: 'Request failed after retries',
        code: 'NETWORK_ERROR',
      },
    };
  }

  /**
   * Execute a single request with timeout handling.
   */
  private async executeRequest<T>(
    method: string,
    url: string,
    body: unknown,
    requestId: string,
    options: RequestOptions | undefined,
    timeout: number,
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'X-Request-Id': requestId,
      };

      // Only set Content-Type for requests that have a body.
      // Fastify rejects Content-Type: application/json with an empty body.
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      if (options?.user_id) {
        headers['X-Agent-Id'] = options.user_id;
      }

      // Mark request as coming from an agent for privacy filtering
      if (options?.isAgent) {
        headers['X-OpenClaw-Agent'] = options.user_id || 'plugin-agent';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const retryAfter = response.headers.get('Retry-After');

        return {
          success: false,
          error: {
            status: response.status,
            message: errorBody.message || response.statusText,
            code: getErrorCode(response.status),
            details: errorBody.details,
            retryAfter: retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
          },
        };
      }

      // Handle no content
      if (response.status === 204) {
        return { success: true, data: undefined as T };
      }

      const data = (await response.json()) as T;
      return { success: true, data };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /** GET request */
  async get<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  /** POST request */
  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  /** PUT request */
  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  /** PATCH request */
  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  /** DELETE request */
  async delete<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /**
   * Health check endpoint.
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    const result = await this.get<{ status: string }>('/api/health');

    const latencyMs = Date.now() - start;

    return {
      healthy: result.success,
      latencyMs,
    };
  }
}

/**
 * Creates a new API client instance.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
