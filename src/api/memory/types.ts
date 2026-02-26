/**
 * Memory types for the unified memory system.
 * Part of Epic #199, Issue #209
 * Tags added in Issue #492
 * Relationship scope added in Issue #493
 * Geolocation fields added in Epic #1204
 * Project scope added in Issue #1273
 *
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

/** Valid memory types */
export type MemoryType = 'preference' | 'fact' | 'note' | 'decision' | 'context' | 'reference';

/** Memory scoping options */
export interface MemoryScope {
  /** Work item ID for work item scope */
  work_item_id?: string;
  /** Contact ID for contact scope */
  contact_id?: string;
  /** Relationship ID for relationship scope (e.g., anniversaries, interpersonal metadata) */
  relationship_id?: string;
  /** Project ID for project scope (FK to work_item of kind 'project') */
  project_id?: string;
}

/** Attribution metadata for a memory */
export interface MemoryAttribution {
  /** Agent that created this memory */
  created_by_agent?: string;
  /** Whether created by a human (vs agent) */
  created_by_human?: boolean;
  /** Source URL for external references */
  source_url?: string;
}

/** Lifecycle metadata for a memory */
export interface MemoryLifecycle {
  /** Importance score 1-10 */
  importance?: number;
  /** Confidence score 0-1 */
  confidence?: number;
  /** When the memory expires (for temporary context) */
  expires_at?: Date;
  /** ID of memory that supersedes this one */
  superseded_by?: string;
}

/** Input for creating a new memory */
export interface CreateMemoryInput extends MemoryScope, MemoryAttribution, MemoryLifecycle {
  title: string;
  content: string;
  memory_type?: MemoryType;
  /** Freeform text tags for categorical filtering */
  tags?: string[];
  /** WGS84 latitude (-90 to 90) */
  lat?: number;
  /** WGS84 longitude (-180 to 180) */
  lng?: number;
  /** Reverse-geocoded address */
  address?: string;
  /** Short human-friendly place name */
  place_label?: string;
  /** Epic #1418: namespace for data scoping */
  namespace?: string;
}

/** Input for updating a memory */
export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  memory_type?: MemoryType;
  importance?: number;
  confidence?: number;
  expires_at?: Date | null;
  superseded_by?: string | null;
  /** Freeform text tags for categorical filtering */
  tags?: string[];
}

/** A memory entry from the database */
export interface MemoryEntry {
  id: string;
  work_item_id: string | null;
  contact_id: string | null;
  /** Relationship this memory is scoped to (e.g., anniversaries, interpersonal metadata) */
  relationship_id: string | null;
  /** Project this memory is scoped to (FK to work_item of kind 'project') */
  project_id: string | null;
  title: string;
  content: string;
  memory_type: MemoryType;
  /** Freeform text tags for categorical filtering */
  tags: string[];
  created_by_agent: string | null;
  created_by_human: boolean;
  source_url: string | null;
  importance: number;
  confidence: number;
  expires_at: Date | null;
  superseded_by: string | null;
  embedding_status: 'pending' | 'complete' | 'failed';
  /** Whether this memory is currently active */
  is_active: boolean;
  /** WGS84 latitude */
  lat: number | null;
  /** WGS84 longitude */
  lng: number | null;
  /** Reverse-geocoded address */
  address: string | null;
  /** Short human-friendly place name */
  place_label: string | null;
  created_at: Date;
  updated_at: Date;
  /** Number of file attachments (Issue #1271), populated when joined */
  attachment_count?: number;
}

/** Query options for listing memories */
export interface ListMemoriesOptions extends MemoryScope {
  status?: 'pending' | 'dispatched' | 'failed';
  memory_type?: MemoryType;
  /** Filter to memories containing all of these tags */
  tags?: string[];
  include_expired?: boolean;
  include_superseded?: boolean;
  /** Only include memories created at or after this date (issue #1272) */
  created_after?: Date;
  /** Only include memories created before this date (issue #1272) */
  created_before?: Date;
  limit?: number;
  offset?: number;
  /** Epic #1418: namespace scoping */
  queryNamespaces?: string[];
}

/** Result of listing memories */
export interface ListMemoriesResult {
  memories: MemoryEntry[];
  total: number;
}

/** Result of semantic memory search */
export interface MemorySearchResult {
  results: Array<MemoryEntry & { similarity: number; namespace?: string; namespace_priority?: number }>;
  search_type: 'semantic' | 'text';
  query_embedding_provider?: string;
}

/** Options for semantic search */
export interface SearchMemoriesOptions extends MemoryScope {
  memory_type?: MemoryType;
  /** Filter to memories containing all of these tags */
  tags?: string[];
  /** Only include memories created at or after this date (issue #1272) */
  created_after?: Date;
  /** Only include memories created before this date (issue #1272) */
  created_before?: Date;
  limit?: number;
  offset?: number;
  min_similarity?: number;
  /** Epic #1418: namespace scoping */
  queryNamespaces?: string[];
  /** Issue #1535: namespace priorities for recall scoring (namespace -> priority 0-100) */
  namespacePriorities?: Record<string, number>;
}
