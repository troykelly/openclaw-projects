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
  namespace?: string;
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
  namespace?: string;
  dependencies?: Array<{ id: string; title: string; kind: string; status: string; direction: 'blocks' | 'blocked_by' }>;
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
  recurrence_rule?: string | null;
  recurrence_natural?: string | null;
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

/** Contact endpoint types expanded (#1575). */
export type EndpointType =
  | 'email' | 'phone' | 'telegram' | 'whatsapp' | 'signal'
  | 'discord' | 'linkedin' | 'twitter' | 'mastodon'
  | 'instagram' | 'facebook' | 'website' | 'sip' | 'imessage';

/** Contact endpoint from GET /api/contacts/:id?include=endpoints */
export interface ContactEndpoint {
  id?: string;
  type: string;
  value: string;
  normalized_value?: string;
  label?: string | null;
  is_primary?: boolean;
  is_login_eligible?: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/** Contact address (#1573). */
export interface ContactAddress {
  id: string;
  address_type: 'home' | 'work' | 'other';
  label?: string | null;
  street_address?: string | null;
  extended_address?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

/** Contact date (#1574). */
export interface ContactDate {
  id: string;
  date_type: 'birthday' | 'anniversary' | 'other';
  label?: string | null;
  date_value: string;
  created_at: string;
  updated_at: string;
}

/** Custom key-value field (#1577). */
export interface CustomField {
  key: string;
  value: string;
}

/** Contact kind enumeration (#1569). */
export type ContactKind = 'person' | 'organisation' | 'group' | 'agent';

/** Valid communication channel types (issue #1269). */
export type CommChannel = 'telegram' | 'email' | 'sms' | 'voice' | 'whatsapp' | 'signal' | 'discord';

/** Single contact from GET /api/contacts (#1582 expanded). */
export interface Contact {
  id: string;
  display_name: string | null;
  // Structured name fields (#1572)
  given_name?: string | null;
  family_name?: string | null;
  middle_name?: string | null;
  name_prefix?: string | null;
  name_suffix?: string | null;
  nickname?: string | null;
  phonetic_given_name?: string | null;
  phonetic_family_name?: string | null;
  file_as?: string | null;
  notes: string | null;
  contact_kind?: ContactKind;
  custom_fields?: CustomField[];
  photo_url?: string | null;
  preferred_channel: CommChannel | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_timezone: string | null;
  urgency_override_channel: CommChannel | null;
  notification_notes: string | null;
  namespace?: string;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  // Eager-loaded child collections (via ?include=)
  endpoints?: ContactEndpoint[];
  addresses?: ContactAddress[];
  dates?: ContactDate[];
  tags?: string[];
  relationships?: ContactRelationship[];
}

/** Contact relationship from ?include=relationships. */
export interface ContactRelationship {
  id: string;
  relationship_type: string;
  from_contact_id: string;
  to_contact_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  related_display_name?: string;
}

/** Response from GET /api/contacts */
export interface ContactsResponse {
  contacts: Contact[];
  total: number;
}

/** Body for POST /api/contacts (#1582 expanded). */
export interface CreateContactBody {
  display_name?: string;
  given_name?: string | null;
  family_name?: string | null;
  middle_name?: string | null;
  name_prefix?: string | null;
  name_suffix?: string | null;
  nickname?: string | null;
  phonetic_given_name?: string | null;
  phonetic_family_name?: string | null;
  file_as?: string | null;
  notes?: string | null;
  contact_kind?: ContactKind;
  custom_fields?: CustomField[];
  tags?: string[];
  preferred_channel?: CommChannel | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_timezone?: string | null;
  urgency_override_channel?: string | null;
  notification_notes?: string | null;
}

/** Body for PATCH /api/contacts/:id (#1582 expanded). */
export interface UpdateContactBody extends Partial<CreateContactBody> {}

/**
 * @deprecated Use CreateContactBody or UpdateContactBody instead.
 * Kept for backward compatibility during migration.
 */
export type ContactBody = CreateContactBody;

/** Tag with contact count from GET /api/tags. */
export interface TagCount {
  tag: string;
  contact_count: number;
}

/** Import result from POST /api/contacts/import. */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

/** Merge result from POST /api/contacts/merge. */
export interface MergeResult {
  merged: Contact;
  loser_id: string;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

/** Valid memory types. */
export type MemoryType = 'preference' | 'fact' | 'note' | 'decision' | 'context' | 'reference';

/** Embedding status for memories. */
export type MemoryEmbeddingStatus = 'pending' | 'complete' | 'failed';

/** Single memory from GET /api/work-items/:id/memories or GET /api/memory */
export interface Memory {
  id: string;
  title: string;
  content: string;
  /** @deprecated Use memory_type instead */
  type?: string;
  memory_type: MemoryType;
  work_item_id?: string | null;
  contact_id?: string | null;
  relationship_id?: string | null;
  project_id?: string | null;
  /** Importance score 1-10 */
  importance: number;
  /** Confidence score 0-1 */
  confidence: number;
  /** When the memory expires (ISO date string) */
  expires_at?: string | null;
  /** Source URL for external references */
  source_url?: string | null;
  /** Freeform text tags */
  tags: string[];
  /** Agent that created this memory */
  created_by_agent?: string | null;
  /** Whether created by a human (vs agent) */
  created_by_human: boolean;
  /** Whether this memory is currently active */
  is_active: boolean;
  /** ID of memory that supersedes this one */
  superseded_by?: string | null;
  /** Embedding generation status */
  embedding_status: MemoryEmbeddingStatus;
  /** WGS84 latitude */
  lat?: number | null;
  /** WGS84 longitude */
  lng?: number | null;
  /** Reverse-geocoded address */
  address?: string | null;
  /** Short human-friendly place name */
  place_label?: string | null;
  /** Namespace for data scoping */
  namespace?: string;
  /** Number of file attachments */
  attachment_count?: number;
  created_at: string;
  updated_at: string;
}

/** A memory search result with similarity score. */
export interface MemorySearchResult extends Memory {
  similarity: number;
  namespace_priority?: number;
}

/** Response from GET /api/memories/search */
export interface MemorySearchResponse {
  results: MemorySearchResult[];
  search_type: 'semantic' | 'text';
  /** Server returns embedding_provider (not query_embedding_provider) */
  embedding_provider?: string;
}

/** Response from GET /api/memories/:id/similar */
export interface SimilarMemoriesResponse {
  source_memory_id: string;
  threshold: number;
  similar: Array<Memory & { similarity: number }>;
}

/** Response from GET /api/work-items/:id/memories */
export interface WorkItemMemoriesResponse {
  memories: Memory[];
}

/** Response from GET /api/memory — backend returns `items`, not `memories`. */
export interface MemoryListResponse {
  items: Memory[];
  total: number;
}

/** Response from GET /api/projects/:id/memories */
export interface ProjectMemoriesResponse {
  memories: Memory[];
  total: number;
}

/** Response from GET /api/contacts/:id/memories */
export interface ContactMemoriesResponse {
  memories: Memory[];
}

/** Body for POST /api/memory or POST /api/work-items/:id/memories */
export interface CreateMemoryBody {
  title: string;
  content: string;
  type?: string;
  memory_type?: MemoryType;
  importance?: number;
  confidence?: number;
  expires_at?: string | null;
  source_url?: string | null;
  tags?: string[];
  work_item_id?: string | null;
  contact_id?: string | null;
  relationship_id?: string | null;
  project_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  place_label?: string | null;
}

/** Body for PATCH /api/memories/:id */
export interface UpdateMemoryBody {
  title?: string;
  content?: string;
  memory_type?: MemoryType;
  importance?: number;
  confidence?: number;
  expires_at?: string | null;
  superseded_by?: string | null;
  tags?: string[];
  source_url?: string | null;
}

/** Linked contact for a memory. */
export interface MemoryLinkedContact {
  contact_id: string;
  display_name: string | null;
  linked_at: string;
}

/** Response from GET /api/memories/:id/contacts */
export interface MemoryLinkedContactsResponse {
  contacts: MemoryLinkedContact[];
}

/** Related memory entry from GET /api/memories/:id/related */
export interface RelatedMemory {
  /** Relationship row ID */
  relationship_id: string;
  /** Relationship type (related, supersedes, contradicts, supports) */
  relationship_type: string;
  /** Notes on the relationship */
  relationship_notes: string | null;
  /** When the relationship was created */
  linked_at: string;
  /** Direction of the relationship (incoming or outgoing) */
  direction: 'incoming' | 'outgoing';
  /** Related memory ID */
  id: string;
  /** Related memory title */
  title: string;
  /** Related memory content */
  content: string;
  /** Related memory type */
  type: string;
  /** Linked work item ID */
  linked_item_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/memories/:id/related */
export interface RelatedMemoriesResponse {
  related: RelatedMemory[];
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
// Contact Suggest-Match (Issue #1270)
// ---------------------------------------------------------------------------

/** Single match from GET /api/contacts/suggest-match */
export interface ContactMatch {
  contact_id: string;
  display_name: string;
  confidence: number;
  match_reasons: string[];
  endpoints: Array<{ type: string; value: string }>;
}

/** Response from GET /api/contacts/suggest-match */
export interface ContactSuggestMatchResponse {
  matches: ContactMatch[];
}

/** Response from POST /api/messages/:id/link-contact */
export interface MessageLinkContactResponse {
  message_id: string;
  contact_id: string;
  from_address: string | null;
  linked: boolean;
}

// ---------------------------------------------------------------------------
// Entity Links (Issue #1276)
// ---------------------------------------------------------------------------

/** Source entity type for entity links. */
export type EntityLinkSourceType = 'message' | 'thread' | 'memory' | 'todo' | 'project_event';

/** Target entity type for entity links. */
export type EntityLinkTargetType = 'project' | 'contact' | 'todo' | 'memory';

/** Relationship kind for entity links. */
export type EntityLinkRelType = 'related' | 'caused_by' | 'resulted_in' | 'about';

/** Single entity link from GET /api/entity-links. */
export interface EntityLink {
  id: string;
  source_type: EntityLinkSourceType;
  source_id: string;
  target_type: EntityLinkTargetType;
  target_id: string;
  link_type: EntityLinkRelType;
  created_by: string | null;
  created_at: string;
}

/** Response from GET /api/entity-links. */
export interface EntityLinksResponse {
  links: EntityLink[];
}

/** Body for POST /api/entity-links. */
export interface CreateEntityLinkBody {
  source_type: EntityLinkSourceType;
  source_id: string;
  target_type: EntityLinkTargetType;
  target_id: string;
  link_type?: EntityLinkRelType;
  created_by?: string;
}

// ---------------------------------------------------------------------------
// Memory Attachments (Issue #1271)
// ---------------------------------------------------------------------------

/** File attachment metadata */
export interface MemoryAttachment {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  attached_at: string;
  attached_by?: string | null;
}

/** Response from GET /api/memories/:id/attachments */
export interface MemoryAttachmentsResponse {
  attachments: MemoryAttachment[];
}

// ---------------------------------------------------------------------------
// Dev Sessions (Issue #1285)
// ---------------------------------------------------------------------------

/** A dev session tracking a long-running agent development session. */
export interface DevSession {
  id: string;
  user_email: string;
  project_id: string | null;
  session_name: string;
  node: string;
  container: string | null;
  container_user: string | null;
  repo_org: string | null;
  repo_name: string | null;
  branch: string | null;
  status: 'active' | 'stalled' | 'completed' | 'errored';
  task_summary: string | null;
  task_prompt: string | null;
  linked_issues: string[];
  linked_prs: string[];
  context_pct: number | null;
  last_capture: string | null;
  last_capture_at: string | null;
  webhook_id: string | null;
  completion_summary: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/dev-sessions */
export interface DevSessionsResponse {
  sessions: DevSession[];
}

/** Body for POST /api/dev-sessions */
export interface CreateDevSessionBody {
  session_name: string;
  node: string;
  project_id?: string;
  container?: string;
  container_user?: string;
  repo_org?: string;
  repo_name?: string;
  branch?: string;
  task_summary?: string;
  task_prompt?: string;
  linked_issues?: string[];
  linked_prs?: string[];
}

/** Body for PATCH /api/dev-sessions/:id */
export interface UpdateDevSessionBody {
  status?: string;
  task_summary?: string;
  branch?: string;
  context_pct?: number;
  last_capture?: string;
  linked_issues?: string[];
  linked_prs?: string[];
  completion_summary?: string;
}

// ---------------------------------------------------------------------------
// Recipes (Issue #1278)
// ---------------------------------------------------------------------------

export interface Recipe {
  id: string;
  user_email: string;
  title: string;
  description: string | null;
  source_url: string | null;
  source_name: string | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  total_time_min: number | null;
  servings: number | null;
  difficulty: string | null;
  cuisine: string | null;
  meal_type: string[];
  tags: string[];
  rating: number | null;
  notes: string | null;
  is_favourite: boolean;
  image_s3_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  is_optional: boolean;
  notes: string | null;
  sort_order: number;
}

export interface RecipeStep {
  id: string;
  recipe_id: string;
  step_number: number;
  instruction: string;
  duration_min: number | null;
  image_s3_key: string | null;
}

export interface RecipeWithDetails extends Recipe {
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
}

export interface RecipesResponse {
  recipes: Recipe[];
}

export interface CreateRecipeBody {
  title: string;
  description?: string;
  source_url?: string;
  source_name?: string;
  prep_time_min?: number;
  cook_time_min?: number;
  total_time_min?: number;
  servings?: number;
  difficulty?: string;
  cuisine?: string;
  meal_type?: string[];
  tags?: string[];
  ingredients?: Array<{
    name: string;
    quantity?: string;
    unit?: string;
    category?: string;
    is_optional?: boolean;
  }>;
  steps?: Array<{
    step_number: number;
    instruction: string;
    duration_min?: number;
  }>;
}

export interface UpdateRecipeBody {
  title?: string;
  description?: string;
  rating?: number;
  is_favourite?: boolean;
  notes?: string;
  cuisine?: string;
  meal_type?: string[];
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Meal Log (Issue #1279)
// ---------------------------------------------------------------------------

export interface MealLogEntry {
  id: string;
  user_email: string;
  meal_date: string;
  meal_type: string;
  title: string;
  source: string;
  recipe_id: string | null;
  order_ref: string | null;
  restaurant: string | null;
  cuisine: string | null;
  who_ate: string[];
  who_cooked: string | null;
  rating: number | null;
  notes: string | null;
  leftovers_stored: boolean;
  image_s3_key: string | null;
  created_at: string;
}

export interface MealLogResponse {
  meals: MealLogEntry[];
}

export interface CreateMealLogBody {
  meal_date: string;
  meal_type: string;
  title: string;
  source: string;
  recipe_id?: string;
  restaurant?: string;
  cuisine?: string;
  who_ate?: string[];
  who_cooked?: string;
  rating?: number;
  notes?: string;
  leftovers_stored?: boolean;
}

export interface UpdateMealLogBody {
  rating?: number;
  notes?: string;
  cuisine?: string;
  leftovers_stored?: boolean;
}

export interface MealLogStats {
  total: number;
  days: number;
  by_source: Array<{ source: string; count: number }>;
  by_cuisine: Array<{ cuisine: string; count: number }>;
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
  notebook_id: string | null;
  user_email: string;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  is_pinned: boolean;
  sort_order: number;
  visibility: NoteVisibility;
  hide_from_agents: boolean;
  embedding_status: NoteEmbeddingStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  notebook?: { id: string; name: string } | null;
  version_count?: number;
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
  notebook_id?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  search?: string;
  is_pinned?: boolean;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
  sort_by?: 'created_at' | 'updated_at' | 'title';
  sort_order?: 'asc' | 'desc';
}

/** Body for POST /api/notes */
export interface CreateNoteBody {
  title: string;
  content?: string;
  notebook_id?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  hide_from_agents?: boolean;
  summary?: string;
  is_pinned?: boolean;
}

/** Body for PUT /api/notes/:id */
export interface UpdateNoteBody {
  title?: string;
  content?: string;
  notebook_id?: string | null;
  tags?: string[];
  visibility?: NoteVisibility;
  hide_from_agents?: boolean;
  summary?: string | null;
  is_pinned?: boolean;
  sort_order?: number;
}

// ---------------------------------------------------------------------------
// Note Versions
// ---------------------------------------------------------------------------

/** Summary of a note version */
export interface NoteVersionSummary {
  id: string;
  version_number: number;
  title: string;
  changed_by_email: string | null;
  change_type: string;
  content_length: number;
  created_at: string;
}

/** Full note version with content */
export interface NoteVersion {
  id: string;
  note_id: string;
  version_number: number;
  title: string;
  content: string;
  summary: string | null;
  changed_by_email: string | null;
  change_type: string;
  content_length: number;
  created_at: string;
}

/** Response from GET /api/notes/:id/versions */
export interface NoteVersionsResponse {
  note_id: string;
  current_version: number;
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
  title_changed: boolean;
  title_diff: string | null;
  content_changed: boolean;
  content_diff: string;
  stats: DiffStats;
}

/** Response from GET /api/notes/:id/versions/compare */
export interface CompareVersionsResponse {
  note_id: string;
  from: {
    version_number: number;
    title: string;
    created_at: string;
  };
  to: {
    version_number: number;
    title: string;
    created_at: string;
  };
  diff: DiffResult;
}

/** Response from POST /api/notes/:id/versions/:versionNumber/restore */
export interface RestoreVersionResponse {
  note_id: string;
  restored_from_version: number;
  new_version: number;
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
  note_id: string;
  permission: SharePermission;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
  last_accessed_at: string | null;
}

/** User share record */
export interface NoteUserShare extends BaseNoteShare {
  type: 'user';
  shared_with_email: string;
}

/** Link share record */
export interface NoteLinkShare extends BaseNoteShare {
  type: 'link';
  token: string;
  is_single_view: boolean;
  view_count: number;
  max_views: number | null;
}

/** Union of share types */
export type NoteShare = NoteUserShare | NoteLinkShare;

/** Response from GET /api/notes/:id/shares */
export interface NoteSharesResponse {
  note_id: string;
  shares: NoteShare[];
}

/** Body for POST /api/notes/:id/share (user share) */
export interface CreateUserShareBody {
  email: string;
  permission?: SharePermission;
  expires_at?: string | null;
}

/** Body for POST /api/notes/:id/share/link */
export interface CreateLinkShareBody {
  permission?: SharePermission;
  is_single_view?: boolean;
  max_views?: number | null;
  expires_at?: string | null;
}

/** Response from POST /api/notes/:id/share/link */
export interface CreateLinkShareResponse extends NoteLinkShare {
  url: string;
}

/** Body for PUT /api/notes/:id/shares/:shareId */
export interface UpdateShareBody {
  permission?: SharePermission;
  expires_at?: string | null;
}

/** Entry in shared-with-me list */
export interface SharedWithMeEntry {
  id: string;
  title: string;
  shared_by_email: string;
  permission: SharePermission;
  shared_at: string;
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
  updated_at: string;
}

/** Notebook from GET /api/notebooks or GET /api/notebooks/:id */
export interface Notebook {
  id: string;
  user_email: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parent_notebook_id: string | null;
  sort_order: number;
  is_archived: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  note_count?: number;
  child_count?: number;
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
  parent_id?: string | null;
  include_archived?: boolean;
  include_note_counts?: boolean;
  include_child_counts?: boolean;
  limit?: number;
  offset?: number;
}

/** Tree node for notebook hierarchy */
export interface NotebookTreeNode {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  note_count?: number;
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
  parent_notebook_id?: string;
}

/** Body for PUT /api/notebooks/:id */
export interface UpdateNotebookBody {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  parent_notebook_id?: string | null;
  sort_order?: number;
}

/** Body for POST /api/notebooks/:id/notes (move/copy notes) */
export interface MoveNotesBody {
  note_ids: string[];
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
  notebook_id: string;
  permission: SharePermission;
  expires_at: string | null;
  created_by_email: string;
  created_at: string;
  last_accessed_at: string | null;
}

/** Notebook user share record */
export interface NotebookUserShare extends BaseNotebookShare {
  type: 'user';
  shared_with_email: string;
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
  notebook_id: string;
  shares: NotebookShare[];
}

/** Body for POST /api/notebooks/:id/share (user share) */
export interface CreateNotebookUserShareBody {
  email: string;
  permission?: SharePermission;
  expires_at?: string | null;
}

/** Body for POST /api/notebooks/:id/share/link */
export interface CreateNotebookLinkShareBody {
  permission?: SharePermission;
  expires_at?: string | null;
}

/** Response from POST /api/notebooks/:id/share/link */
export interface CreateNotebookLinkShareResponse extends NotebookLinkShare {
  url: string;
}

/** Body for PUT /api/notebooks/:id/shares/:shareId */
export interface UpdateNotebookShareBody {
  permission?: SharePermission;
  expires_at?: string | null;
}

/** Entry in shared-with-me notebooks list */
export interface NotebookSharedWithMeEntry {
  id: string;
  name: string;
  shared_by_email: string;
  permission: SharePermission;
  shared_at: string;
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
// Agent Identity (Issue #1287)
// ---------------------------------------------------------------------------

/** The agent's core identity/persona. */
export interface AgentIdentity {
  id: string;
  name: string;
  display_name: string;
  emoji: string | null;
  avatar_s3_key: string | null;
  persona: string;
  principles: string[];
  quirks: string[];
  voice_config: Record<string, unknown> | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

/** A history entry tracking identity changes. */
export interface AgentIdentityHistoryEntry {
  id: string;
  identity_id: string;
  version: number;
  changed_by: string;
  change_type: 'create' | 'update' | 'propose' | 'approve' | 'reject' | 'rollback';
  change_reason: string | null;
  field_changed: string | null;
  previous_value: string | null;
  new_value: string | null;
  full_snapshot: Record<string, unknown>;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

/** Response from GET /api/identity/history */
export interface AgentIdentityHistoryResponse {
  history: AgentIdentityHistoryEntry[];
}

/** Body for PUT /api/identity */
export interface CreateAgentIdentityBody {
  name: string;
  display_name?: string;
  emoji?: string;
  persona: string;
  principles?: string[];
  quirks?: string[];
}

/** Body for POST /api/identity/proposals */
export interface ProposeIdentityChangeBody {
  name: string;
  field: string;
  new_value: string;
  reason?: string;
  proposed_by: string;
}

// ---------------------------------------------------------------------------
// Bootstrap (server-injected data)
// ---------------------------------------------------------------------------

/** A namespace grant from the namespace_grant table (Epic #1418, #1571). */
export interface NamespaceGrant {
  namespace: string;
  access: string;
  is_home: boolean;
}

/** Bootstrap data injected by the server into the HTML page. */
export interface AppBootstrap {
  route?: { kind?: string; id?: string };
  me?: { email?: string };
  work_items?: WorkItemSummary[];
  workItem?: { id?: string; title?: string } | null;
  participants?: Array<{ participant?: string; role?: string }>;
  /** Namespace grants for the authenticated user (Epic #1418). */
  namespace_grants?: NamespaceGrant[];
}

// ---------------------------------------------------------------------------
// Terminal Management (Epic #1667)
// ---------------------------------------------------------------------------

/** Terminal connection definition. */
export interface TerminalConnection {
  id: string;
  namespace: string;
  name: string;
  host: string | null;
  port: number;
  username: string | null;
  auth_method: string | null;
  credential_id: string | null;
  proxy_jump_id: string | null;
  is_local: boolean;
  env: Record<string, string> | null;
  connect_timeout_s: number;
  keepalive_interval: number;
  idle_timeout_s: number | null;
  max_sessions: number | null;
  host_key_policy: string;
  tags: string[];
  notes: string | null;
  last_connected_at: string | null;
  last_error: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/terminal/connections */
export interface TerminalConnectionsResponse {
  connections: TerminalConnection[];
}

/** Terminal credential (secrets never returned). */
export interface TerminalCredential {
  id: string;
  namespace: string;
  name: string;
  kind: string;
  fingerprint: string | null;
  public_key: string | null;
  command: string | null;
  command_timeout_s: number;
  cache_ttl_s: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Response from GET /api/terminal/credentials */
export interface TerminalCredentialsResponse {
  credentials: TerminalCredential[];
}

/** Response from POST /api/terminal/credentials/generate */
export interface TerminalKeyPairResponse {
  credential: TerminalCredential;
  public_key: string;
}

/** Terminal session. */
export interface TerminalSession {
  id: string;
  namespace: string;
  connection_id: string;
  tmux_session_name: string;
  worker_id: string | null;
  status: string;
  cols: number;
  rows: number;
  capture_interval_s: number;
  capture_on_command: boolean;
  embed_commands: boolean;
  embed_scrollback: boolean;
  started_at: string | null;
  last_activity_at: string | null;
  terminated_at: string | null;
  exit_code: number | null;
  error_message: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  connection?: TerminalConnection;
  windows?: TerminalSessionWindow[];
}

/** Response from GET /api/terminal/sessions */
export interface TerminalSessionsResponse {
  sessions: TerminalSession[];
}

/** Terminal session window. */
export interface TerminalSessionWindow {
  id: string;
  session_id: string;
  namespace: string;
  window_index: number;
  window_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  panes?: TerminalSessionPane[];
}

/** Terminal session pane. */
export interface TerminalSessionPane {
  id: string;
  window_id: string;
  namespace: string;
  pane_index: number;
  is_active: boolean;
  pid: number | null;
  current_command: string | null;
  created_at: string;
  updated_at: string;
}

/** Terminal session entry (command, output, annotation, etc.). */
export interface TerminalSessionEntry {
  id: string;
  session_id: string;
  pane_id: string | null;
  namespace: string;
  kind: string;
  content: string;
  embedded_at: string | null;
  sequence: number;
  captured_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Response from GET /api/terminal/sessions/:id/entries */
export interface TerminalEntriesResponse {
  entries: TerminalSessionEntry[];
  total: number;
}

/** SSH tunnel. */
export interface TerminalTunnel {
  id: string;
  namespace: string;
  connection_id: string;
  session_id: string | null;
  direction: string;
  bind_host: string;
  bind_port: number;
  target_host: string | null;
  target_port: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  connection?: TerminalConnection;
}

/** Response from GET /api/terminal/tunnels */
export interface TerminalTunnelsResponse {
  tunnels: TerminalTunnel[];
}

/** Enrollment token. */
export interface TerminalEnrollmentToken {
  id: string;
  namespace: string;
  label: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  connection_defaults: Record<string, unknown> | null;
  allowed_tags: string[];
  created_at: string;
  /** Only set on creation response. */
  token?: string;
}

/** Response from GET /api/terminal/enrollment-tokens */
export interface TerminalEnrollmentTokensResponse {
  tokens: TerminalEnrollmentToken[];
}

/** SSH known host. */
export interface TerminalKnownHost {
  id: string;
  namespace: string;
  connection_id: string | null;
  host: string;
  port: number;
  key_type: string;
  key_fingerprint: string;
  public_key: string;
  trusted_at: string;
  trusted_by: string | null;
  created_at: string;
}

/** Response from GET /api/terminal/known-hosts */
export interface TerminalKnownHostsResponse {
  known_hosts: TerminalKnownHost[];
}

/** Terminal activity log entry. */
export interface TerminalActivityItem {
  id: string;
  namespace: string;
  session_id: string | null;
  connection_id: string | null;
  actor: string;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

/** Response from GET /api/terminal/activity */
export interface TerminalActivityResponse {
  items: TerminalActivityItem[];
}

/** Terminal search result. */
export interface TerminalSearchResult {
  entry: TerminalSessionEntry;
  score: number;
  context: TerminalSessionEntry[];
}

/** Response from POST /api/terminal/search */
export interface TerminalSearchResponse {
  results: TerminalSearchResult[];
  total: number;
}

/** Terminal dashboard stats. */
export interface TerminalDashboardStats {
  active_sessions: number;
  total_connections: number;
  active_tunnels: number;
  recent_errors: number;
}

// ---------------------------------------------------------------------------
// Chat (Epic #1940)
// ---------------------------------------------------------------------------

/** Chat session status. */
export type ChatSessionStatus = 'active' | 'ended' | 'expired';

/** Chat message status. */
export type ChatMessageStatus = 'pending' | 'streaming' | 'delivered' | 'failed';

/** Chat message content type. */
export type ChatContentType = 'text/plain' | 'text/markdown' | 'application/vnd.openclaw.rich-card';

/** Chat session from GET /api/chat/sessions */
export interface ChatSession {
  id: string;
  thread_id: string;
  user_email: string;
  agent_id: string;
  namespace: string;
  status: ChatSessionStatus;
  title: string | null;
  version: number;
  started_at: string;
  ended_at: string | null;
  last_activity_at: string;
  metadata: Record<string, unknown>;
}

/** Response from GET /api/chat/sessions */
export interface ChatSessionsResponse {
  sessions: ChatSession[];
}

/** Chat message from GET /api/chat/sessions/:id/messages */
export interface ChatMessage {
  id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  status: ChatMessageStatus;
  content_type: ChatContentType;
  idempotency_key: string | null;
  agent_run_id: string | null;
  received_at: string;
  updated_at: string | null;
}

/** Response from GET /api/chat/sessions/:id/messages (cursor-paginated) */
export interface ChatMessagesResponse {
  messages: ChatMessage[];
  cursor: string | null;
  has_more: boolean;
}

/** Available agent for chat. */
export interface ChatAgent {
  id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
}

/** Response from GET /api/chat/agents */
export interface ChatAgentsResponse {
  agents: ChatAgent[];
}

/** Body for POST /api/chat/sessions */
export interface CreateChatSessionBody {
  agent_id?: string;
  title?: string;
}

/** Body for POST /api/chat/sessions/:id/messages */
export interface SendChatMessageBody {
  content: string;
  idempotency_key: string;
}

/** Body for PATCH /api/chat/sessions/:id */
export interface UpdateChatSessionBody {
  title?: string;
}
