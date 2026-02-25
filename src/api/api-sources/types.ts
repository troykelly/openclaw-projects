/**
 * TypeScript types for the api-sources module.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 * Part of API Onboarding feature.
 */

/**
 * API source status
 */
export type ApiSourceStatus = 'active' | 'error' | 'disabled';

/**
 * Credential purpose
 */
export type CredentialPurpose = 'api_call' | 'spec_fetch';

/**
 * Credential resolve strategy
 */
export type CredentialResolveStrategy = 'literal' | 'env' | 'file' | 'command';

/**
 * API memory kind
 */
export type ApiMemoryKind = 'overview' | 'tag_group' | 'operation';

/**
 * Embedding status for API memories
 */
export type EmbeddingStatus = 'pending' | 'complete' | 'failed';

/**
 * A tracked OpenAPI-documented API source.
 */
export interface ApiSource {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  spec_url: string | null;
  servers: Record<string, unknown>[];
  spec_version: string | null;
  spec_hash: string | null;
  tags: string[];
  refresh_interval_seconds: number | null;
  last_fetched_at: Date | null;
  status: ApiSourceStatus;
  error_message: string | null;
  created_by_agent: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating an API source.
 */
export interface CreateApiSourceInput {
  namespace?: string;
  name: string;
  description?: string;
  spec_url?: string;
  servers?: Record<string, unknown>[];
  tags?: string[];
  refresh_interval_seconds?: number;
  created_by_agent?: string;
}

/**
 * Input for updating an API source.
 */
export interface UpdateApiSourceInput {
  name?: string;
  description?: string | null;
  spec_url?: string | null;
  servers?: Record<string, unknown>[];
  spec_version?: string | null;
  spec_hash?: string | null;
  tags?: string[];
  refresh_interval_seconds?: number | null;
  last_fetched_at?: Date | null;
  status?: ApiSourceStatus;
  error_message?: string | null;
}

/**
 * Credential for authenticating API calls.
 */
export interface ApiCredential {
  id: string;
  api_source_id: string;
  purpose: CredentialPurpose;
  header_name: string;
  header_prefix: string | null;
  resolve_strategy: CredentialResolveStrategy;
  resolve_reference: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating an API credential.
 */
export interface CreateApiCredentialInput {
  api_source_id: string;
  purpose?: CredentialPurpose;
  header_name: string;
  header_prefix?: string;
  resolve_strategy: CredentialResolveStrategy;
  resolve_reference: string;
}

/**
 * Input for updating an API credential.
 */
export interface UpdateApiCredentialInput {
  purpose?: CredentialPurpose;
  header_name?: string;
  header_prefix?: string | null;
  resolve_strategy?: CredentialResolveStrategy;
  resolve_reference?: string;
}

/**
 * Semantically searchable memory generated from an OpenAPI spec.
 */
export interface ApiMemory {
  id: string;
  api_source_id: string;
  namespace: string;
  memory_kind: ApiMemoryKind;
  operation_key: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  embedding_model: string | null;
  embedding_provider: string | null;
  embedding_status: EmbeddingStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating an API memory.
 */
export interface CreateApiMemoryInput {
  api_source_id: string;
  namespace?: string;
  memory_kind: ApiMemoryKind;
  operation_key: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Options for searching API memories.
 */
export interface ApiMemorySearchOptions {
  namespace: string;
  query: string;
  api_source_id?: string;
  memory_kind?: ApiMemoryKind;
  tags?: string[];
  limit?: number;
  semantic_weight?: number;
  keyword_weight?: number;
}

/**
 * A single result from an API memory search.
 */
export interface ApiMemorySearchResult {
  id: string;
  api_source_id: string;
  memory_kind: ApiMemoryKind;
  operation_key: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  score: number;
}

/**
 * Result of onboarding an API source from an OpenAPI spec.
 */
export interface OnboardResult {
  api_source: ApiSource;
  memories_created: number;
  memories_updated: number;
  memories_deleted: number;
}

/**
 * Result of refreshing an API source from its spec URL.
 */
export interface RefreshResult {
  api_source: ApiSource;
  memories_created: number;
  memories_updated: number;
  memories_deleted: number;
  spec_changed: boolean;
}
