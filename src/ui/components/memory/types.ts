export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  linked_item_id?: string;
  linked_item_title?: string;
  linked_item_kind?: 'project' | 'initiative' | 'epic' | 'issue';
  tags?: string[];
  is_active?: boolean;
  expires_at?: string | null;
  pinned?: boolean;
  superseded_by?: string | null;
  created_at: Date;
  updated_at: Date;
  /** ISO timestamp when this memory expires (TTL) */
  expires_at?: string;
  /** Whether this memory is pinned */
  pinned?: boolean;
  /** ID of the memory that supersedes this one */
  superseded_by?: string;
  /** IDs of memories that this memory supersedes */
  supersedes?: string[];
  /** Importance score (0-1) */
  importance?: number;
}

/** Lifecycle filter chip values for the memory list. */
export type MemoryLifecycleFilter = 'ephemeral' | 'permanent' | 'expired' | 'pinned' | 'superseded';

export interface MemoryFilter {
  search?: string;
  linked_item_kind?: 'project' | 'initiative' | 'epic' | 'issue';
  tags?: string[];
  /** Active lifecycle filter chips (combinable). */
  lifecycle?: MemoryLifecycleFilter[];
}

/** Sort options for the memory list. */
export type MemorySortOption = 'updated_at' | 'created_at' | 'expiring_soonest' | 'recently_superseded';

export interface MemoryFormData {
  title: string;
  content: string;
  tags?: string[];
  /** Tags to upsert (sliding window tags) */
  upsert_tags?: string[];
  /** TTL duration in seconds */
  ttl_seconds?: number;
  /** Whether this memory is pinned */
  pinned?: boolean;
}

/** A lifecycle event for display in the timeline */
export interface MemoryLifecycleEvent {
  type: 'created' | 'updated' | 'superseded' | 'reaped';
  timestamp: Date;
  actor?: string;
}

/** A node in the supersession chain */
export interface SupersessionNode {
  id: string;
  title: string;
  /** Whether this memory still exists */
  exists: boolean;
}
