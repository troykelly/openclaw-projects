/**
 * Typed API client for openclaw-projects.
 *
 * Wraps fetch() with consistent error handling, base URL resolution,
 * Bearer token injection, and automatic 401 retry with token refresh.
 * Base URL is derived from the hostname via {@link getApiBaseUrl} —
 * same-origin for localhost, cross-origin (`api.{domain}`) for production.
 */

import type { ZodSchema } from 'zod';

import { getApiBaseUrl } from './api-config.ts';
import { clearAccessToken, getAccessToken, refreshAccessToken } from './auth-manager.ts';

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
export interface RequestOptions<T = unknown> {
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
  /** Additional headers to merge with defaults. */
  headers?: Record<string, string>;
  /**
   * Optional Zod schema for runtime response validation.
   * When provided, the parsed JSON body is validated against the schema
   * before being returned. If validation fails, a ZodError is thrown.
   * Use `.passthrough()` on object schemas to be lenient about extra fields.
   */
  schema?: ZodSchema<T>;
}

/** Resolve a path against the API base URL. */
function resolveUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

/**
 * Build the headers for a request, injecting the Authorization header
 * when an access token is available.
 */
function buildHeaders(base: Record<string, string>, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...base, ...extra };
  const token = getAccessToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Auth endpoint prefix — 401s on these paths are NOT retried to prevent loops. */
const AUTH_PATH_PREFIX = '/api/auth/';

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
 * Core request function with auth header injection and 401 retry.
 *
 * On a 401 response (except for auth endpoints), attempts to refresh
 * the access token and retries the original request once. If refresh
 * fails, clears the token and redirects to the login page.
 */
async function request<T>(path: string, init: RequestInit, baseHeaders: Record<string, string>, opts?: RequestOptions<T>): Promise<{ res: Response; parsed: T }> {
  const headers = buildHeaders(baseHeaders, opts?.headers);
  const url = resolveUrl(path);

  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
    signal: opts?.signal,
  });

  // Handle 401: attempt token refresh and retry (once)
  if (res.status === 401 && !path.startsWith(AUTH_PATH_PREFIX)) {
    try {
      await refreshAccessToken();
    } catch {
      // Refresh failed — clear auth state and redirect to login
      clearAccessToken();
      window.location.href = '/app/login';
      throw await parseErrorResponse(res);
    }

    // Retry with the new token
    const retryHeaders = buildHeaders(baseHeaders, opts?.headers);
    const retryRes = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: retryHeaders,
      signal: opts?.signal,
    });

    if (!retryRes.ok) {
      throw await parseErrorResponse(retryRes);
    }

    return { res: retryRes, parsed: await parseBody<T>(retryRes, opts?.schema) };
  }

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return { res, parsed: await parseBody<T>(res, opts?.schema) };
}


/**
 * Recursively convert all camelCase object keys to snake_case.
 * Used when sending request bodies to the API.
 */
function camelToSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function snakeifyKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(snakeifyKeys);
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnakeKey(key)] = snakeifyKeys(value);
    }
    return result;
  }
  return obj;
}

/**
 * Parse response body as JSON, returning undefined for 204 No Content.
 * When a Zod schema is provided, the parsed JSON is validated against it.
 * This catches shape mismatches early instead of letting them propagate
 * as cryptic runtime errors deep in React component trees.
 */
async function parseBody<T>(res: Response, schema?: ZodSchema<T>): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }
  const json = await res.json();
  return schema ? schema.parse(json) : (json as T);
}

/**
 * Typed API client singleton.
 *
 * All methods use the browser's built-in fetch with `credentials: 'include'`
 * for cross-origin cookie support. The base URL is resolved via
 * {@link getApiBaseUrl} — same-origin for localhost, `api.{domain}` in production.
 *
 * When an access token is available (via auth-manager), it is automatically
 * injected as an `Authorization: Bearer` header. On 401 responses, the client
 * transparently refreshes the token and retries the request once.
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
  async get<T>(path: string, opts?: RequestOptions<T>): Promise<T> {
    const { parsed } = await request<T>(path, { method: 'GET' }, { accept: 'application/json' }, opts);
    return parsed;
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
  async post<T>(path: string, body: unknown, opts?: RequestOptions<T>): Promise<T> {
    const { parsed } = await request<T>(
      path,
      { method: 'POST', body: JSON.stringify(snakeifyKeys(body)) },
      { 'content-type': 'application/json', accept: 'application/json' },
      opts,
    );
    return parsed;
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
  async put<T>(path: string, body: unknown, opts?: RequestOptions<T>): Promise<T> {
    const { parsed } = await request<T>(
      path,
      { method: 'PUT', body: JSON.stringify(snakeifyKeys(body)) },
      { 'content-type': 'application/json', accept: 'application/json' },
      opts,
    );
    return parsed;
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
  async patch<T>(path: string, body: unknown, opts?: RequestOptions<T>): Promise<T> {
    const { parsed } = await request<T>(
      path,
      { method: 'PATCH', body: JSON.stringify(snakeifyKeys(body)) },
      { 'content-type': 'application/json', accept: 'application/json' },
      opts,
    );
    return parsed;
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
  async delete<T = void>(path: string, opts?: RequestOptions<T>): Promise<T> {
    const { parsed } = await request<T>(path, { method: 'DELETE' }, { accept: 'application/json' }, opts);
    return parsed;
  },
};
