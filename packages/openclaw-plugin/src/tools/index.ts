/**
 * Tool registration barrel.
 * Exports all available tools for the plugin.
 */

// Memory tools
export {
  createMemoryRecallTool,
  MemoryRecallParamsSchema,
  MemoryCategory,
  type MemoryRecallParams,
  type MemoryRecallTool,
  type MemoryRecallResult,
  type Memory,
} from './memory-recall.js';

// memory_store tool
export {
  createMemoryStoreTool,
  MemoryStoreParamsSchema,
  type MemoryStoreParams,
  type MemoryStoreTool,
  type MemoryStoreResult,
  type StoredMemory,
} from './memory-store.js';

// memory_forget tool
export {
  createMemoryForgetTool,
  MemoryForgetParamsSchema,
  type MemoryForgetParams,
  type MemoryForgetTool,
  type MemoryForgetResult,
} from './memory-forget.js';

// Project tools
export {
  createProjectListTool,
  createProjectGetTool,
  createProjectCreateTool,
  ProjectListParamsSchema,
  ProjectGetParamsSchema,
  ProjectCreateParamsSchema,
  ProjectStatus,
  type ProjectListParams,
  type ProjectGetParams,
  type ProjectCreateParams,
  type ProjectListTool,
  type ProjectGetTool,
  type ProjectCreateTool,
  type ProjectListResult,
  type ProjectGetResult,
  type ProjectCreateResult,
  type Project,
  type ProjectToolOptions,
} from './projects.js';

// Todo tools
export {
  createTodoListTool,
  createTodoCreateTool,
  createTodoCompleteTool,
  TodoListParamsSchema,
  TodoCreateParamsSchema,
  TodoCompleteParamsSchema,
  type TodoListParams,
  type TodoCreateParams,
  type TodoCompleteParams,
  type TodoListTool,
  type TodoCreateTool,
  type TodoCompleteTool,
  type TodoListResult,
  type TodoCreateResult,
  type TodoCompleteResult,
  type Todo,
  type TodoToolOptions,
} from './todos.js';

// Todo search tool (Issue #1216)
export {
  createTodoSearchTool,
  TodoSearchParamsSchema,
  type TodoSearchParams,
  type TodoSearchTool,
  type TodoSearchResult,
  type TodoSearchItem,
  type TodoSearchToolOptions,
} from './todo-search.js';

// Project search tool (Issue #1217)
export {
  createProjectSearchTool,
  ProjectSearchParamsSchema,
  type ProjectSearchParams,
  type ProjectSearchTool,
  type ProjectSearchResult,
  type ProjectSearchItem,
  type ProjectSearchToolOptions,
} from './project-search.js';

// Contact tools
export {
  createContactSearchTool,
  createContactGetTool,
  createContactCreateTool,
  ContactSearchParamsSchema,
  ContactGetParamsSchema,
  ContactCreateParamsSchema,
  type ContactSearchParams,
  type ContactGetParams,
  type ContactCreateParams,
  type ContactSearchTool,
  type ContactGetTool,
  type ContactCreateTool,
  type ContactSearchResult,
  type ContactGetResult,
  type ContactCreateResult,
  type Contact,
  type ContactToolOptions,
} from './contacts.js';

// SMS tools
export {
  createSmsSendTool,
  SmsSendParamsSchema,
  type SmsSendParams,
  type SmsSendTool,
  type SmsSendResult,
  type SmsSendToolOptions,
} from './sms-send.js';

// Email tools
export {
  createEmailSendTool,
  EmailSendParamsSchema,
  type EmailSendParams,
  type EmailSendTool,
  type EmailSendResult,
  type EmailSendToolOptions,
} from './email-send.js';

// Message search tools
export {
  createMessageSearchTool,
  MessageSearchParamsSchema,
  type MessageSearchParams,
  type MessageSearchTool,
  type MessageSearchResult,
  type MessageSearchToolOptions,
} from './message-search.js';

// Thread tools
export {
  createThreadListTool,
  createThreadGetTool,
  ThreadListParamsSchema,
  ThreadGetParamsSchema,
  type ThreadListParams,
  type ThreadGetParams,
  type ThreadListTool,
  type ThreadGetTool,
  type ThreadListResult,
  type ThreadGetResult,
  type ThreadToolOptions,
} from './threads.js';

// Note tools
export {
  createNoteCreateTool,
  createNoteGetTool,
  createNoteUpdateTool,
  createNoteDeleteTool,
  createNoteSearchTool,
  NoteCreateParamsSchema,
  NoteGetParamsSchema,
  NoteUpdateParamsSchema,
  NoteDeleteParamsSchema,
  NoteSearchParamsSchema,
  NoteVisibility,
  type NoteCreateParams,
  type NoteGetParams,
  type NoteUpdateParams,
  type NoteDeleteParams,
  type NoteSearchParams,
  type NoteCreateTool,
  type NoteGetTool,
  type NoteUpdateTool,
  type NoteDeleteTool,
  type NoteSearchTool,
  type NoteCreateResult,
  type NoteGetResult,
  type NoteUpdateResult,
  type NoteDeleteResult,
  type NoteSearchToolResult,
  type Note,
  type NoteToolOptions,
} from './notes.js';

// Relationship tools
export {
  createRelationshipSetTool,
  createRelationshipQueryTool,
  RelationshipSetParamsSchema,
  RelationshipQueryParamsSchema,
  type RelationshipSetParams,
  type RelationshipQueryParams,
  type RelationshipSetTool,
  type RelationshipQueryTool,
  type RelationshipSetResult,
  type RelationshipQueryResult,
  type RelatedContact,
  type RelationshipToolOptions,
} from './relationships.js';

// Notebook tools
export {
  createNotebookListTool,
  createNotebookCreateTool,
  createNotebookGetTool,
  NotebookListParamsSchema,
  NotebookCreateParamsSchema,
  NotebookGetParamsSchema,
  type NotebookListParams,
  type NotebookCreateParams,
  type NotebookGetParams,
  type NotebookListTool,
  type NotebookCreateTool,
  type NotebookGetTool,
  type NotebookListResult,
  type NotebookCreateResult,
  type NotebookGetResult,
  type Notebook,
  type NotebookToolOptions,
} from './notebooks.js';

// File sharing tools
export {
  createFileShareTool,
  FileShareParamsSchema,
  type FileShareParams,
  type FileShareTool,
  type FileShareResult,
  type FileShareToolOptions,
} from './file-share.js';

// Skill Store tools (Issue #800, #801)
export {
  createSkillStorePutTool,
  createSkillStoreGetTool,
  createSkillStoreListTool,
  createSkillStoreDeleteTool,
  createSkillStoreSearchTool,
  createSkillStoreCollectionsTool,
  createSkillStoreAggregateTool,
  SkillStorePutParamsSchema,
  SkillStoreGetParamsSchema,
  SkillStoreListParamsSchema,
  SkillStoreDeleteParamsSchema,
  SkillStoreSearchParamsSchema,
  SkillStoreCollectionsParamsSchema,
  SkillStoreAggregateParamsSchema,
  type SkillStorePutParams,
  type SkillStoreGetParams,
  type SkillStoreListParams,
  type SkillStoreDeleteParams,
  type SkillStoreSearchParams,
  type SkillStoreCollectionsParams,
  type SkillStoreAggregateParams,
  type SkillStoreTool,
  type SkillStoreToolResult,
  type SkillStoreItem,
  type SkillStoreToolOptions,
} from './skill-store.js';

// Entity linking tools (Issue #1220)
export {
  createLinksSetTool,
  createLinksQueryTool,
  createLinksRemoveTool,
  LinksSetParamsSchema,
  LinksQueryParamsSchema,
  LinksRemoveParamsSchema,
  type LinksSetParams,
  type LinksQueryParams,
  type LinksRemoveParams,
  type EntityLinkTool,
  type EntityLinkToolResult,
  type EntityLinkToolOptions,
} from './entity-links.js';

/** Tool factory types */
export type ToolFactoryOptions = Record<string, never>;
