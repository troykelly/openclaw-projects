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

/** Valid communication channel types (issue #1269). */
export type CommChannel = 'telegram' | 'email' | 'sms' | 'voice';

/** Single contact from GET /api/contacts */
export interface Contact {
  id: string;
  display_name: string;
  notes: string | null;
  preferred_channel: CommChannel | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
  urgency_override_channel: CommChannel | null;
  notification_notes: string | null;
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
  preferred_channel?: CommChannel | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_timezone?: string | null;
  urgency_override_channel?: CommChannel | null;
  notification_notes?: string | null;
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

/** Response from GET /api/emails */
export interface EmailsResponse {
  emails: ApiCommunication[];
}

/** Response from GET /api/calendar/events */
export interface CalendarEventsResponse {
  events: ApiCommunication[];
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** Note visibility levels */
export type NoteVisibility = 'private' | 'shared' | 'public';

/** Embedding status for notes */
export type NoteEmbeddingStatus = 'pending' | 'complete' | 'failed' | 'skipped';

/** Single note from GET /api/notes or GET /api/notes/:id */
export interface Note {
  id: string;
  notebookId: string | null;
  userEmail: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  isPinned: boolean;
  sortOrder: number;
  visibility: NoteVisibility;
  hideFromAgents: boolean;
  embeddingStatus: NoteEmbeddingStatus;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notebook?: { id: string; name: string } | null;
  versionCount?: number;
}

/** Response from GET /api/notes */
export interface NotesResponse {
  notes: Note[];
  total: number;
  limit: number;
  offset: number;
}

/** Query params for GET /api/notes */
export interface ListNotesParams {
  notebookId?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  search?: string;
  isPinned?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

/** Body for POST /api/notes */
export interface CreateNoteBody {
  title: string;
  content?: string;
  notebookId?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  hideFromAgents?: boolean;
  summary?: string;
  isPinned?: boolean;
}

/** Body for PUT /api/notes/:id */
export interface UpdateNoteBody {
  title?: string;
  content?: string;
  notebookId?: string | null;
  tags?: string[];
  visibility?: NoteVisibility;
  hideFromAgents?: boolean;
  summary?: string | null;
  isPinned?: boolean;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Note Versions
// ---------------------------------------------------------------------------

/** Summary of a note version */
export interface NoteVersionSummary {
  id: string;
  versionNumber: number;
  title: string;
  changedByEmail: string | null;
  changeType: string;
  contentLength: number;
  createdAt: string;
}

/** Full note version with content */
export interface NoteVersion {
  id: string;
  noteId: string;
  versionNumber: number;
  title: string;
  content: string;
  summary: string | null;
  changedByEmail: string | null;
  changeType: string;
  contentLength: number;
  createdAt: string;
}

/** Response from GET /api/notes/:id/versions */
export interface NoteVersionsResponse {
  noteId: string;
  currentVersion: number;
  versions: NoteVersionSummary[];
  total: number;
}

/** Diff statistics */
export interface DiffStats {
  additions: number;
  deletions: number;
  changes: number;
}

/** Diff result between versions */
export interface DiffResult {
  titleChanged: boolean;
  titleDiff: string | null;
  contentChanged: boolean;
  contentDiff: string;
  stats: DiffStats;
}

/** Response from GET /api/notes/:id/versions/compare */
export interface CompareVersionsResponse {
  noteId: string;
  from: {
    versionNumber: number;
    title: string;
    createdAt: string;
  };
  to: {
    versionNumber: number;
    title: string;
    createdAt: string;
  };
  diff: DiffResult;
}

/** Response from POST /api/notes/:id/versions/:versionNumber/restore */
export interface RestoreVersionResponse {
  noteId: string;
  restoredFromVersion: number;
  newVersion: number;
  title: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Note Sharing
// ---------------------------------------------------------------------------

/** Share permission level */
export type SharePermission = 'read' | 'read_write';

/** Base share record */
interface BaseNoteShare {
  id: string;
  noteId: string;
  permission: SharePermission;
  expiresAt: string | null;
  createdByEmail: string;
  createdAt: string;
  lastAccessedAt: string | null;
}

/** User share record */
export interface NoteUserShare extends BaseNoteShare {
  type: 'user';
  sharedWithEmail: string;
}

/** Link share record */
export interface NoteLinkShare extends BaseNoteShare {
  type: 'link';
  token: string;
  isSingleView: boolean;
  viewCount: number;
  maxViews: number | null;
}

/** Union of share types */
export type NoteShare = NoteUserShare | NoteLinkShare;

/** Response from GET /api/notes/:id/shares */
export interface NoteSharesResponse {
  noteId: string;
  shares: NoteShare[];
}

/** Body for POST /api/notes/:id/share (user share) */
export interface CreateUserShareBody {
  email: string;
  permission?: SharePermission;
  expiresAt?: string | null;
}

/** Body for POST /api/notes/:id/share/link */
export interface CreateLinkShareBody {
  permission?: SharePermission;
  isSingleView?: boolean;
  maxViews?: number | null;
  expiresAt?: string | null;
}

/** Response from POST /api/notes/:id/share/link */
export interface CreateLinkShareResponse extends NoteLinkShare {
  url: string;
}

/** Body for PUT /api/notes/:id/shares/:shareId */
export interface UpdateShareBody {
  permission?: SharePermission;
  expiresAt?: string | null;
}

/** Entry in shared-with-me list */
export interface SharedWithMeEntry {
  id: string;
  title: string;
  sharedByEmail: string;
  permission: SharePermission;
  sharedAt: string;
}

/** Response from GET /api/notes/shared-with-me */
export interface SharedWithMeResponse {
  notes: SharedWithMeEntry[];
}

// ---------------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------------

/** Minimal note info for notebook expansion */
export interface NotebookNote {
  id: string;
  title: string;
  updatedAt: string;
}

/** Notebook from GET /api/notebooks or GET /api/notebooks/:id */
export interface Notebook {
  id: string;
  userEmail: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentNotebookId: string | null;
  sortOrder: number;
  isArchived: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  noteCount?: number;
  childCount?: number;
  parent?: { id: string; name: string } | null;
  children?: Notebook[];
  notes?: NotebookNote[];
}

/** Response from GET /api/notebooks */
export interface NotebooksResponse {
  notebooks: Notebook[];
  total: number;
}

/** Query params for GET /api/notebooks */
export interface ListNotebooksParams {
  parentId?: string | null;
  includeArchived?: boolean;
  includeNoteCounts?: boolean;
  includeChildCounts?: boolean;
  limit?: number;
  offset?: number;
}

/** Tree node for notebook hierarchy */
export interface NotebookTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  noteCount?: number;
  children: NotebookTreeNode[];
}

/** Response from GET /api/notebooks/tree */
export interface NotebookTreeResponse {
  notebooks: NotebookTreeNode[];
}

/** Body for POST /api/notebooks */
export interface CreateNotebookBody {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parentNotebookId?: string;
}

/** Body for PUT /api/notebooks/:id */
export interface UpdateNotebookBody {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  parentNotebookId?: string | null;
  sortOrder?: number;
}

/** Body for POST /api/notebooks/:id/notes (move/copy notes) */
export interface MoveNotesBody {
  noteIds: string[];
  action: 'move' | 'copy';
}

/** Response from POST /api/notebooks/:id/notes */
export interface MoveNotesResponse {
  moved: string[];
  failed: string[];
}

// ---------------------------------------------------------------------------
// Notebook Sharing
// ---------------------------------------------------------------------------

/** Base notebook share record */
interface BaseNotebookShare {
  id: string;
  notebookId: string;
  permission: SharePermission;
  expiresAt: string | null;
  createdByEmail: string;
  createdAt: string;
  lastAccessedAt: string | null;
}

/** Notebook user share record */
export interface NotebookUserShare extends BaseNotebookShare {
  type: 'user';
  sharedWithEmail: string;
}

/** Notebook link share record */
export interface NotebookLinkShare extends BaseNotebookShare {
  type: 'link';
  token: string;
}

/** Union of notebook share types */
export type NotebookShare = NotebookUserShare | NotebookLinkShare;

/** Response from GET /api/notebooks/:id/shares */
export interface NotebookSharesResponse {
  notebookId: string;
  shares: NotebookShare[];
}

/** Body for POST /api/notebooks/:id/share (user share) */
export interface CreateNotebookUserShareBody {
  email: string;
  permission?: SharePermission;
  expiresAt?: string | null;
}

/** Body for POST /api/notebooks/:id/share/link */
export interface CreateNotebookLinkShareBody {
  permission?: SharePermission;
  expiresAt?: string | null;
}

/** Response from POST /api/notebooks/:id/share/link */
export interface CreateNotebookLinkShareResponse extends NotebookLinkShare {
  url: string;
}

/** Body for PUT /api/notebooks/:id/shares/:shareId */
export interface UpdateNotebookShareBody {
  permission?: SharePermission;
  expiresAt?: string | null;
}

/** Entry in shared-with-me notebooks list */
export interface NotebookSharedWithMeEntry {
  id: string;
  name: string;
  sharedByEmail: string;
  permission: SharePermission;
  sharedAt: string;
}

/** Response from GET /api/notebooks/shared-with-me */
export interface NotebooksSharedWithMeResponse {
  notebooks: NotebookSharedWithMeEntry[];
}

// ---------------------------------------------------------------------------
// Skill Store
// ---------------------------------------------------------------------------

/** Skill store item status. */
export type SkillStoreItemStatus = 'active' | 'archived' | 'processing';

/** Skill store item embedding status. */
export type SkillStoreEmbeddingStatus = 'pending' | 'complete' | 'failed';

/** Single skill store item returned from the API. */
export interface SkillStoreItem {
  id: string;
  skill_id: string;
  collection: string;
  key: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  data: unknown | null;
  media_url: string | null;
  media_type: string | null;
  source_url: string | null;
  status: SkillStoreItemStatus;
  tags: string[];
  priority: number;
  expires_at: string | null;
  pinned: boolean;
  embedding_status: SkillStoreEmbeddingStatus | null;
  user_email: string | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/skill-store/items */
export interface SkillStoreItemsResponse {
  items: SkillStoreItem[];
  total: number;
  has_more: boolean;
}

/** Skill summary from GET /api/admin/skill-store/skills */
export interface SkillStoreSummary {
  skill_id: string;
  item_count: number;
  collection_count: number;
  last_activity: string;
}

/** Response from GET /api/admin/skill-store/skills */
export interface SkillStoreSkillsResponse {
  skills: SkillStoreSummary[];
}

/** Collection summary from GET /api/skill-store/collections */
export interface SkillStoreCollection {
  collection: string;
  count: number;
  latest_at: string | null;
}

/** Response from GET /api/skill-store/collections */
export interface SkillStoreCollectionsResponse {
  collections: SkillStoreCollection[];
}

/** Schedule from GET /api/skill-store/schedules */
export interface SkillStoreSchedule {
  id: string;
  skill_id: string;
  collection: string | null;
  cron_expression: string;
  timezone: string;
  webhook_url: string;
  webhook_headers: Record<string, string> | null;
  payload_template: Record<string, unknown> | null;
  enabled: boolean;
  max_retries: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/skill-store/schedules */
export interface SkillStoreSchedulesResponse {
  schedules: SkillStoreSchedule[];
  total: number;
}

/** Body for POST /api/skill-store/search */
export interface SkillStoreSearchBody {
  skill_id: string;
  query: string;
  collection?: string;
  limit?: number;
}

/** Response from POST /api/skill-store/search */
export interface SkillStoreSearchResponse {
  items: SkillStoreItem[];
  total: number;
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
