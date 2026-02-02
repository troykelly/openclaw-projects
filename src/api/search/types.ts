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
  dateFrom?: Date;
  dateTo?: Date;
  semanticWeight?: number; // 0-1, weight for semantic vs text search in hybrid mode
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
  textScore: number;
  semanticScore?: number;
  metadata?: Record<string, unknown>;
}
