/**
 * Types for thread history API.
 * Part of Epic #199, Issue #226
 */

export interface ThreadContact {
  id: string;
  displayName: string;
  notes?: string;
}

export interface ThreadInfo {
  id: string;
  channel: string;
  externalThreadKey: string;
  contact: ThreadContact;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  subject?: string;
  fromAddress?: string;
  receivedAt: Date;
  createdAt: Date;
}

export interface RelatedWorkItem {
  id: string;
  title: string;
  status: string;
  workItemKind: string;
  notBefore?: Date;
  notAfter?: Date;
}

export interface ContactMemory {
  id: string;
  memoryType: string;
  title: string;
  content: string;
  importance: number;
}

export interface ThreadHistoryResponse {
  thread: ThreadInfo;
  messages: ThreadMessage[];
  relatedWorkItems: RelatedWorkItem[];
  contactMemories: ContactMemory[];
  pagination: {
    hasMore: boolean;
    oldestTimestamp?: string;
    newestTimestamp?: string;
  };
}

export interface ThreadHistoryOptions {
  limit?: number;
  before?: Date;
  after?: Date;
  includeWorkItems?: boolean;
  includeMemories?: boolean;
}
