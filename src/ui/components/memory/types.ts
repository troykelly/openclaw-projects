export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  linked_item_id?: string;
  linked_item_title?: string;
  linked_item_kind?: 'project' | 'initiative' | 'epic' | 'issue';
  tags?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface MemoryFilter {
  search?: string;
  linked_item_kind?: 'project' | 'initiative' | 'epic' | 'issue';
  tags?: string[];
}

export interface MemoryFormData {
  title: string;
  content: string;
  tags?: string[];
}
