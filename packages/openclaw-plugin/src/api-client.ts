/**
 * HTTP API client for clawdbot-projects backend.
 * Handles authentication, request/response formatting, and error handling.
 */

import type { PluginConfig } from './config.js'
import { createLogger, type Logger } from './logger.js'

/** API error response */
export interface ApiError {
  status: number
  message: string
  code?: string
  details?: Record<string, unknown>
}

/** API response wrapper */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError }

/** API client options */
export interface ApiClientOptions {
  config: PluginConfig
  logger?: Logger
}

/**
 * HTTP API client for the clawdbot-projects backend.
 */
export class ApiClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly logger: Logger

  constructor(options: ApiClientOptions) {
    // Ensure URL doesn't have trailing slash
    this.baseUrl = options.config.apiUrl.replace(/\/$/, '')
    this.apiKey = options.config.apiKey
    this.logger = options.logger ?? createLogger('api-client')
  }

  /**
   * Makes an authenticated request to the API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        return {
          success: false,
          error: {
            status: response.status,
            message: errorBody.message || response.statusText,
            code: errorBody.code,
            details: errorBody.details,
          },
        }
      }

      // Handle no content
      if (response.status === 204) {
        return { success: true, data: undefined as T }
      }

      const data = (await response.json()) as T
      return { success: true, data }
    } catch (error) {
      this.logger.error('API request failed', {
        method,
        path,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        success: false,
        error: {
          status: 0,
          message: error instanceof Error ? error.message : 'Unknown error',
          code: 'NETWORK_ERROR',
        },
      }
    }
  }

  /** GET request */
  async get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path)
  }

  /** POST request */
  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body)
  }

  /** PUT request */
  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body)
  }

  /** PATCH request */
  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body)
  }

  /** DELETE request */
  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path)
  }
}

/**
 * Creates a new API client instance.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options)
}
