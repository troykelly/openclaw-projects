/**
 * Types for thread history API.
 * Part of Epic #199, Issue #226
 */

export interface ThreadContact {
  id: string;
  display_name: string;
  notes?: string;
}

export interface ThreadInfo {
  id: string;
  channel: string;
  external_thread_key: string;
  contact: ThreadContact;
  created_at: Date;
  updated_at: Date;
}

export interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  subject?: string;
  from_address?: string;
  received_at: Date;
  created_at: Date;
}

export interface RelatedWorkItem {
  id: string;
  title: string;
  status: string;
  work_item_kind: string;
  not_before?: Date;
  not_after?: Date;
}

export interface ContactMemory {
  id: string;
  memory_type: string;
  title: string;
  content: string;
  importance: number;
}

export interface ThreadHistoryResponse {
  thread: ThreadInfo;
  messages: ThreadMessage[];
  related_work_items: RelatedWorkItem[];
  contact_memories: ContactMemory[];
  pagination: {
    has_more: boolean;
    oldest_timestamp?: string;
    newest_timestamp?: string;
  };
}

export interface ThreadHistoryOptions {
  limit?: number;
  before?: Date;
  after?: Date;
  includeWorkItems?: boolean;
  includeMemories?: boolean;
}

export interface ThreadListOptions {
  limit?: number;
  offset?: number;
  channel?: string;
  contact_id?: string;
  /** Filter by user email (Issue #1172) */
  user_email?: string;
  /** Epic #1418: namespace scoping (preferred over user_email) */
  queryNamespaces?: string[];
}

export interface ThreadListItem {
  id: string;
  channel: string;
  external_thread_key: string;
  contact: ThreadContact;
  created_at: Date;
  updated_at: Date;
  last_message?: {
    id: string;
    direction: 'inbound' | 'outbound';
    body: string | null;
    subject?: string;
    received_at: Date;
  };
  message_count: number;
}

export interface ThreadListResponse {
  threads: ThreadListItem[];
  total: number;
  pagination: {
    limit: number;
    offset: number;
    has_more: boolean;
  };
}
