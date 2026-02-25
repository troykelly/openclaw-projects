/**
 * Plugin API source service client.
 * HTTP client for calling api-sources API endpoints from the plugin.
 * Part of API Onboarding feature (#1783).
 */

import type { ApiClient, ApiResponse, RequestOptions } from '../api-client.js';

// ── API Response types ──────────────────────────────────────────────────────

/** API source from the backend */
export interface ApiSourceResponse {
  [key: string]: unknown;
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  spec_url: string | null;
  servers: Array<{ url: string; description?: string }>;
  spec_version: string | null;
  spec_hash: string | null;
  tags: string[];
  refresh_interval_seconds: number | null;
  last_fetched_at: string | null;
  status: string;
  error_message: string | null;
  created_by_agent: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Credential from the backend */
export interface ApiCredentialResponse {
  [key: string]: unknown;
  id: string;
  api_source_id: string;
  purpose: string;
  header_name: string;
  header_prefix: string | null;
  resolve_strategy: string;
  resolve_reference: string;
  created_at: string;
  updated_at: string;
}

/** Onboard result from the backend */
export interface OnboardResultResponse {
  api_source: ApiSourceResponse;
  memories_created: number;
  memories_updated: number;
  memories_deleted: number;
}

/** Refresh result from the backend */
export interface RefreshResultResponse {
  api_source: ApiSourceResponse;
  memories_created: number;
  memories_updated: number;
  memories_deleted: number;
  spec_changed: boolean;
}

/** API memory search result from the backend */
export interface ApiMemorySearchResultResponse {
  id: string;
  api_source_id: string;
  memory_kind: string;
  operation_key: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  score: number;
  credentials?: ApiCredentialResponse[];
}

// ── Input types ─────────────────────────────────────────────────────────────

export interface OnboardParams {
  spec_url?: string;
  spec_content?: string;
  name?: string;
  description?: string;
  tags?: string[];
  credentials?: Array<{
    header_name: string;
    header_prefix?: string;
    resolve_strategy: string;
    resolve_reference: string;
    purpose?: string;
  }>;
  spec_auth_headers?: Record<string, string>;
}

export interface SearchParams {
  q: string;
  limit?: number;
  offset?: number;
  memory_kind?: string;
  api_source_id?: string;
  tags?: string[];
}

export interface UpdateApiSourceParams {
  name?: string;
  description?: string | null;
  tags?: string[];
  status?: string;
}

export interface CredentialManageParams {
  /** Action to perform: 'add', 'update', or 'remove' */
  action: 'add' | 'update' | 'remove';
  /** Credential ID (required for update/remove) */
  credential_id?: string;
  /** Credential fields (required for add/update) */
  header_name?: string;
  header_prefix?: string;
  resolve_strategy?: string;
  resolve_reference?: string;
  purpose?: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * HTTP client wrapper for the api-sources API.
 * Follows the same pattern as notification-service.ts.
 */
export class ApiSourceService {
  constructor(private client: ApiClient) {}

  /**
   * Onboard a new API source from an OpenAPI spec URL or inline content.
   */
  async onboard(
    params: OnboardParams,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: OnboardResultResponse }>> {
    return this.client.post<{ data: OnboardResultResponse }>(
      '/api/api-sources',
      params,
      options,
    );
  }

  /**
   * Search API memories using hybrid search.
   */
  async search(
    params: SearchParams,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: ApiMemorySearchResultResponse[]; limit: number; offset: number }>> {
    const searchParams = new URLSearchParams();
    searchParams.set('q', params.q);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.offset !== undefined) searchParams.set('offset', String(params.offset));
    if (params.memory_kind) searchParams.set('memory_kind', params.memory_kind);
    if (params.api_source_id) searchParams.set('api_source_id', params.api_source_id);
    if (params.tags && params.tags.length > 0) searchParams.set('tags', params.tags.join(','));

    return this.client.get<{ data: ApiMemorySearchResultResponse[]; limit: number; offset: number }>(
      `/api/api-memories/search?${searchParams}`,
      options,
    );
  }

  /**
   * Get a single API source by ID.
   */
  async get(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: ApiSourceResponse }>> {
    return this.client.get<{ data: ApiSourceResponse }>(
      `/api/api-sources/${encodeURIComponent(id)}`,
      options,
    );
  }

  /**
   * List API sources.
   */
  async list(
    params?: { limit?: number; offset?: number; status?: string },
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: ApiSourceResponse[]; limit: number; offset: number }>> {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
    if (params?.status) searchParams.set('status', params.status);

    const qs = searchParams.toString();
    const path = qs ? `/api/api-sources?${qs}` : '/api/api-sources';

    return this.client.get<{ data: ApiSourceResponse[]; limit: number; offset: number }>(
      path,
      options,
    );
  }

  /**
   * Update an API source.
   */
  async update(
    id: string,
    params: UpdateApiSourceParams,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: ApiSourceResponse }>> {
    return this.client.patch<{ data: ApiSourceResponse }>(
      `/api/api-sources/${encodeURIComponent(id)}`,
      params,
      options,
    );
  }

  /**
   * Manage credentials for an API source (add/update/remove).
   */
  async manageCredential(
    sourceId: string,
    params: CredentialManageParams,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: ApiCredentialResponse } | void>> {
    const basePath = `/api/api-sources/${encodeURIComponent(sourceId)}/credentials`;

    if (params.action === 'add') {
      return this.client.post<{ data: ApiCredentialResponse }>(basePath, {
        header_name: params.header_name,
        header_prefix: params.header_prefix,
        resolve_strategy: params.resolve_strategy,
        resolve_reference: params.resolve_reference,
        purpose: params.purpose,
      }, options);
    }

    if (params.action === 'update' && params.credential_id) {
      return this.client.patch<{ data: ApiCredentialResponse }>(
        `${basePath}/${encodeURIComponent(params.credential_id)}`,
        {
          header_name: params.header_name,
          header_prefix: params.header_prefix,
          resolve_strategy: params.resolve_strategy,
          resolve_reference: params.resolve_reference,
          purpose: params.purpose,
        },
        options,
      );
    }

    if (params.action === 'remove' && params.credential_id) {
      return this.client.delete<void>(
        `${basePath}/${encodeURIComponent(params.credential_id)}`,
        options,
      );
    }

    return {
      success: false,
      error: {
        status: 400,
        message: 'Invalid credential management action or missing credential_id',
      },
    };
  }

  /**
   * Refresh an API source from its spec URL.
   */
  async refresh(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: RefreshResultResponse }>> {
    return this.client.post<{ data: RefreshResultResponse }>(
      `/api/api-sources/${encodeURIComponent(id)}/refresh`,
      undefined,
      options,
    );
  }

  /**
   * Soft-delete an API source.
   */
  async remove(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<void>> {
    return this.client.delete<void>(
      `/api/api-sources/${encodeURIComponent(id)}`,
      options,
    );
  }

  /**
   * Restore a soft-deleted API source.
   */
  async restore(
    id: string,
    options?: RequestOptions,
  ): Promise<ApiResponse<{ data: ApiSourceResponse }>> {
    return this.client.post<{ data: ApiSourceResponse }>(
      `/api/api-sources/${encodeURIComponent(id)}/restore`,
      undefined,
      options,
    );
  }
}
