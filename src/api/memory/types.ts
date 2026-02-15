/**
 * Memory types for the unified memory system.
 * Part of Epic #199, Issue #209
 * Tags added in Issue #492
 * Relationship scope added in Issue #493
 * Geolocation fields added in Epic #1204
 * Project scope added in Issue #1273
 */

/** Valid memory types */
export type MemoryType = 'preference' | 'fact' | 'note' | 'decision' | 'context' | 'reference';

/** Memory scoping options */
export interface MemoryScope {
  /** User email for global scope */
  userEmail?: string;
  /** Work item ID for work item scope */
  workItemId?: string;
  /** Contact ID for contact scope */
  contactId?: string;
  /** Relationship ID for relationship scope (e.g., anniversaries, interpersonal metadata) */
  relationshipId?: string;
  /** Project ID for project scope (FK to work_item of kind 'project') */
  projectId?: string;
}

/** Attribution metadata for a memory */
export interface MemoryAttribution {
  /** Agent that created this memory */
  createdByAgent?: string;
  /** Whether created by a human (vs agent) */
  createdByHuman?: boolean;
  /** Source URL for external references */
  sourceUrl?: string;
}

/** Lifecycle metadata for a memory */
export interface MemoryLifecycle {
  /** Importance score 1-10 */
  importance?: number;
  /** Confidence score 0-1 */
  confidence?: number;
  /** When the memory expires (for temporary context) */
  expiresAt?: Date;
  /** ID of memory that supersedes this one */
  supersededBy?: string;
}

/** Input for creating a new memory */
export interface CreateMemoryInput extends MemoryScope, MemoryAttribution, MemoryLifecycle {
  title: string;
  content: string;
  memoryType?: MemoryType;
  /** Freeform text tags for categorical filtering */
  tags?: string[];
  /** WGS84 latitude (-90 to 90) */
  lat?: number;
  /** WGS84 longitude (-180 to 180) */
  lng?: number;
  /** Reverse-geocoded address */
  address?: string;
  /** Short human-friendly place name */
  placeLabel?: string;
}

/** Input for updating a memory */
export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  memoryType?: MemoryType;
  importance?: number;
  confidence?: number;
  expiresAt?: Date | null;
  supersededBy?: string | null;
  /** Freeform text tags for categorical filtering */
  tags?: string[];
}

/** A memory entry from the database */
export interface MemoryEntry {
  id: string;
  userEmail: string | null;
  workItemId: string | null;
  contactId: string | null;
  /** Relationship this memory is scoped to (e.g., anniversaries, interpersonal metadata) */
  relationshipId: string | null;
  /** Project this memory is scoped to (FK to work_item of kind 'project') */
  projectId: string | null;
  title: string;
  content: string;
  memoryType: MemoryType;
  /** Freeform text tags for categorical filtering */
  tags: string[];
  createdByAgent: string | null;
  createdByHuman: boolean;
  sourceUrl: string | null;
  importance: number;
  confidence: number;
  expiresAt: Date | null;
  supersededBy: string | null;
  embeddingStatus: 'pending' | 'complete' | 'failed';
  /** WGS84 latitude */
  lat: number | null;
  /** WGS84 longitude */
  lng: number | null;
  /** Reverse-geocoded address */
  address: string | null;
  /** Short human-friendly place name */
  placeLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Number of file attachments (Issue #1271), populated when joined */
  attachmentCount?: number;
}

/** Query options for listing memories */
export interface ListMemoriesOptions extends MemoryScope {
  status?: 'pending' | 'dispatched' | 'failed';
  memoryType?: MemoryType;
  /** Filter to memories containing all of these tags */
  tags?: string[];
  includeExpired?: boolean;
  includeSuperseded?: boolean;
  /** Only include memories created at or after this date (issue #1272) */
  createdAfter?: Date;
  /** Only include memories created before this date (issue #1272) */
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

/** Result of listing memories */
export interface ListMemoriesResult {
  memories: MemoryEntry[];
  total: number;
}

/** Result of semantic memory search */
export interface MemorySearchResult {
  results: Array<MemoryEntry & { similarity: number }>;
  searchType: 'semantic' | 'text';
  queryEmbeddingProvider?: string;
}

/** Options for semantic search */
export interface SearchMemoriesOptions extends MemoryScope {
  memoryType?: MemoryType;
  /** Filter to memories containing all of these tags */
  tags?: string[];
  /** Only include memories created at or after this date (issue #1272) */
  createdAfter?: Date;
  /** Only include memories created before this date (issue #1272) */
  createdBefore?: Date;
  limit?: number;
  offset?: number;
  minSimilarity?: number;
}
