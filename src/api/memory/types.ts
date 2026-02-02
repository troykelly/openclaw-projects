/**
 * Memory types for the unified memory system.
 * Part of Epic #199, Issue #209
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
}

/** A memory entry from the database */
export interface MemoryEntry {
  id: string;
  userEmail: string | null;
  workItemId: string | null;
  contactId: string | null;
  title: string;
  content: string;
  memoryType: MemoryType;
  createdByAgent: string | null;
  createdByHuman: boolean;
  sourceUrl: string | null;
  importance: number;
  confidence: number;
  expiresAt: Date | null;
  supersededBy: string | null;
  embeddingStatus: 'pending' | 'complete' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

/** Query options for listing memories */
export interface ListMemoriesOptions extends MemoryScope {
  status?: 'pending' | 'dispatched' | 'failed';
  memoryType?: MemoryType;
  includeExpired?: boolean;
  includeSuperseded?: boolean;
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
  limit?: number;
  offset?: number;
  minSimilarity?: number;
}
