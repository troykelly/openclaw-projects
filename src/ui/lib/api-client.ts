/**
 * Typed API client for openclaw-projects.
 *
 * Wraps fetch() with consistent error handling, base URL resolution,
 * and typed request/response methods. Base URL is derived from the
 * hostname via {@link getApiBaseUrl} — same-origin for localhost,
 * cross-origin (`api.{domain}`) for production.
 */

import { getApiBaseUrl } from './api-config.ts';

/** Standard error shape returned by the API. */
export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
}

/** Custom error class for API failures. */
export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
}

/** Options for individual API requests. */
export interface RequestOptions {
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
  /** Additional headers to merge with defaults. */
  headers?: Record<string, string>;
}

/** Resolve a path against the API base URL. */
function resolveUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

/**
 * Parse an API error response body into a structured error.
 * Falls back to a generic message if the body is not JSON.
 */
async function parseErrorResponse(res: Response): Promise<ApiRequestError> {
  let message = `Request failed: ${res.status} ${res.statusText}`;
  let details: unknown;

  try {
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body.message === 'string') {
      message = body.message;
    }
    if (typeof body.error === 'string') {
      message = body.error;
    }
    details = body;
  } catch {
    // Response body is not JSON -- use default message
  }

  return new ApiRequestError(res.status, message, details);
}

/**
 * Typed API client singleton.
 *
 * All methods use the browser's built-in fetch with `credentials: 'include'`
 * for cross-origin cookie support. The base URL is resolved via
 * {@link getApiBaseUrl} — same-origin for localhost, `api.{domain}` in production.
 */
export const apiClient = {
  /**
   * Perform a GET request and return the parsed JSON body.
   *
   * @typeParam T - Expected response shape
   * @param path - API path starting with `/api/...`
   * @param opts - Optional request configuration
   * @returns Parsed JSON response
   * @throws {ApiRequestError} on non-2xx responses
   */
  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    const res = await fetch(resolveUrl(path), {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...opts?.headers,
      },
      signal: opts?.signal,
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    return (await res.json()) as T;
  },

  /**
   * Perform a POST request with a JSON body.
   *
   * @typeParam T - Expected response shape
   * @param path - API path starting with `/api/...`
   * @param body - Request body (will be serialised to JSON)
   * @param opts - Optional request configuration
   * @returns Parsed JSON response
   * @throws {ApiRequestError} on non-2xx responses
   */
  async post<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    const res = await fetch(resolveUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...opts?.headers,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    return (await res.json()) as T;
  },

  /**
   * Perform a PUT request with a JSON body.
   *
   * @typeParam T - Expected response shape
   * @param path - API path starting with `/api/...`
   * @param body - Request body (will be serialised to JSON)
   * @param opts - Optional request configuration
   * @returns Parsed JSON response
   * @throws {ApiRequestError} on non-2xx responses
   */
  async put<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    const res = await fetch(resolveUrl(path), {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...opts?.headers,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    return (await res.json()) as T;
  },

  /**
   * Perform a PATCH request with a JSON body.
   *
   * @typeParam T - Expected response shape
   * @param path - API path starting with `/api/...`
   * @param body - Partial update body (will be serialised to JSON)
   * @param opts - Optional request configuration
   * @returns Parsed JSON response
   * @throws {ApiRequestError} on non-2xx responses
   */
  async patch<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    const res = await fetch(resolveUrl(path), {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...opts?.headers,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    return (await res.json()) as T;
  },

  /**
   * Perform a DELETE request.
   *
   * @typeParam T - Expected response shape (often void / empty)
   * @param path - API path starting with `/api/...`
   * @param opts - Optional request configuration
   * @returns Parsed JSON response (or undefined for 204 No Content)
   * @throws {ApiRequestError} on non-2xx responses
   */
  async delete<T = void>(path: string, opts?: RequestOptions): Promise<T> {
    const res = await fetch(resolveUrl(path), {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...opts?.headers,
      },
      signal: opts?.signal,
    });

    if (!res.ok) {
      throw await parseErrorResponse(res);
    }

    // 204 No Content has no body
    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  },
};
