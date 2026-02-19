/**
 * Types for unified search API.
 * Part of Issue #216.
 */

export type SearchEntityType = 'work_item' | 'contact' | 'memory' | 'message';

export type SearchType = 'hybrid' | 'text' | 'semantic';

export interface SearchOptions {
  query: string;
  types?: SearchEntityType[];
  limit?: number;
  offset?: number;
  semantic?: boolean;
  date_from?: Date;
  date_to?: Date;
  semantic_weight?: number; // 0-1, weight for semantic vs text search in hybrid mode
  /** @deprecated user_email column dropped from work_item table in Phase 4 (Epic #1418) */
  user_email?: string;
  /** Epic #1418: namespace scoping for entity queries */
  queryNamespaces?: string[];
}

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  title: string;
  snippet: string;
  score: number;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  search_type: SearchType;
  embedding_provider?: string;
  results: SearchResult[];
  facets: Record<SearchEntityType, number>;
  total: number;
}

export interface EntitySearchResult {
  id: string;
  title: string;
  snippet: string;
  text_score: number;
  semantic_score?: number;
  metadata?: Record<string, unknown>;
}
