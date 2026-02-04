/**
 * Shared API response types for openclaw-projects.
 *
 * These types mirror the JSON shapes returned by the server endpoints
 * in `src/api/server.ts`. They are used by TanStack Query hooks for
 * type-safe data fetching and mutations.
 */

// ---------------------------------------------------------------------------
// Work Items
// ---------------------------------------------------------------------------

/** Summary returned in list endpoints. */
export interface WorkItemSummary {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  task_type: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/work-items */
export interface WorkItemsResponse {
  items: WorkItemSummary[];
}

/** Full detail returned from GET /api/work-items/:id */
export interface WorkItemDetail {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  kind: string;
  parent_id?: string | null;
  parent?: { id: string; title: string; kind: string } | null;
  not_before?: string | null;
  not_after?: string | null;
  estimate_minutes?: number | null;
  actual_minutes?: number | null;
  created_at: string;
  updated_at: string;
  dependencies?: {
    blocks: Array<{ id: string; title: string }>;
    blocked_by: Array<{ id: string; title: string }>;
  };
}

/** Tree node from GET /api/work-items/tree */
export interface WorkItemTreeNode {
  id: string;
  title: string;
  kind: string;
  status: string;
  priority: string;
  parent_id: string | null;
  children_count: number;
  children: WorkItemTreeNode[];
}

/** Response from GET /api/work-items/tree */
export interface WorkItemTreeResponse {
  items: WorkItemTreeNode[];
}

/** Body for POST /api/work-items */
export interface CreateWorkItemBody {
  title: string;
  kind?: string;
  status?: string;
  priority?: string;
  description?: string;
  parent_id?: string | null;
  not_before?: string | null;
  not_after?: string | null;
  estimate_minutes?: number | null;
}

/** Body for PUT /api/work-items/:id */
export interface UpdateWorkItemBody {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  not_before?: string | null;
  not_after?: string | null;
  estimate_minutes?: number | null;
  actual_minutes?: number | null;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/** Single activity entry from GET /api/activity */
export interface ActivityItem {
  id: string;
  type: string;
  work_item_id: string;
  work_item_title: string;
  actor_email: string | null;
  description: string;
  created_at: string;
}

/** Response from GET /api/activity */
export interface ActivityResponse {
  items: ActivityItem[];
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** Contact endpoint (email, phone, etc.) */
export interface ContactEndpoint {
  type: string;
  value: string;
}

/** Single contact from GET /api/contacts */
export interface Contact {
  id: string;
  display_name: string;
  notes: string | null;
  created_at: string;
  updated_at?: string;
  endpoints: ContactEndpoint[];
}

/** Response from GET /api/contacts */
export interface ContactsResponse {
  contacts: Contact[];
  total: number;
}

/** Body for POST /api/contacts and PATCH /api/contacts/:id */
export interface ContactBody {
  displayName: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

/** Single memory from GET /api/work-items/:id/memories or GET /api/memory */
export interface Memory {
  id: string;
  title: string;
  content: string;
  type?: string;
  work_item_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/work-items/:id/memories */
export interface WorkItemMemoriesResponse {
  memories: Memory[];
}

/** Response from GET /api/memory */
export interface MemoryListResponse {
  memories: Memory[];
  total: number;
}

/** Body for POST /api/work-items/:id/memories */
export interface CreateMemoryBody {
  title: string;
  content: string;
  type?: string;
}

/** Body for PATCH /api/memories/:id */
export interface UpdateMemoryBody {
  title?: string;
  content?: string;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Single notification from GET /api/notifications */
export interface Notification {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  read: boolean;
  work_item_id?: string | null;
  created_at: string;
}

/** Response from GET /api/notifications */
export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
}

/** Response from GET /api/notifications/unread-count */
export interface UnreadCountResponse {
  count: number;
}

// ---------------------------------------------------------------------------
// Projects (alias for work items filtered by kind)
// ---------------------------------------------------------------------------

/** Response from GET /api/work-items?kind=project (same shape as WorkItemsResponse) */
export type ProjectsResponse = WorkItemsResponse;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Item in a timeline/Gantt response. */
export interface TimelineItem {
  id: string;
  title: string;
  kind: string;
  status: string | null;
  priority: string | null;
  parent_id: string | null;
  level: number;
  not_before: string | null;
  not_after: string | null;
  estimate_minutes: number | null;
  actual_minutes: number | null;
  created_at: string;
}

/** Dependency edge in a timeline response. */
export interface TimelineDependency {
  id: string;
  from_id: string;
  to_id: string;
  kind: string;
}

/** Response from GET /api/work-items/:id/timeline or GET /api/timeline */
export interface TimelineResponse {
  items: TimelineItem[];
  dependencies: TimelineDependency[];
}

// ---------------------------------------------------------------------------
// Dependency Graph
// ---------------------------------------------------------------------------

/** Node in a dependency graph. */
export interface GraphNode {
  id: string;
  title: string;
  kind: string;
  status: string | null;
  priority: string | null;
  level: number;
  estimate_minutes: number | null;
  is_blocker: boolean;
}

/** Edge in a dependency graph. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

/** Item on the critical path. */
export interface CriticalPathItem {
  id: string;
  title: string;
  estimate_minutes: number | null;
}

/** Response from GET /api/work-items/:id/dependency-graph */
export interface DependencyGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  critical_path: CriticalPathItem[];
}

// ---------------------------------------------------------------------------
// Backlog / Kanban
// ---------------------------------------------------------------------------

/** Item in the backlog response. */
export interface BacklogItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  task_type: string | null;
  kind: string;
  estimate_minutes: number | null;
  created_at: string;
}

/** Response from GET /api/backlog */
export interface BacklogResponse {
  items: BacklogItem[];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** A single search result from GET /api/search */
export interface SearchResultItem {
  type: string;
  id: string;
  title: string;
  description: string;
  url: string;
}

/** Response from GET /api/search */
export interface SearchResponse {
  results: SearchResultItem[];
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

/** External message from GET /api/work-items/:id/communications */
export interface ApiCommunication {
  id: string;
  thread_id: string;
  body: string | null;
  direction: string;
  received_at: string | null;
  raw: unknown;
}

/** Response from GET /api/work-items/:id/communications */
export interface CommunicationsResponse {
  emails: ApiCommunication[];
  calendar_events: ApiCommunication[];
}

// ---------------------------------------------------------------------------
// Bootstrap (server-injected data)
// ---------------------------------------------------------------------------

/** Bootstrap data injected by the server into the HTML page. */
export interface AppBootstrap {
  route?: { kind?: string; id?: string };
  me?: { email?: string };
  workItems?: WorkItemSummary[];
  workItem?: { id?: string; title?: string } | null;
  participants?: Array<{ participant?: string; role?: string }>;
}
