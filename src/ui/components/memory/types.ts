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
}
