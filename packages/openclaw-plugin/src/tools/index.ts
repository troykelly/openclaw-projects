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

// Context search tool (Issue #1219)
export {
  createContextSearchTool,
  ContextSearchParamsSchema,
  EntityType,
  type ContextSearchParams,
  type ContextSearchTool,
  type ContextSearchResult,
  type ContextSearchResultItem,
  type ContextSearchToolOptions,
} from './context-search.js';

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

// Terminal connection and credential tools (Issue #1688)
export {
  createTerminalConnectionListTool,
  createTerminalConnectionCreateTool,
  createTerminalConnectionUpdateTool,
  createTerminalConnectionDeleteTool,
  createTerminalConnectionTestTool,
  createTerminalCredentialCreateTool,
  createTerminalCredentialListTool,
  createTerminalCredentialDeleteTool,
  TerminalConnectionListParamsSchema,
  TerminalConnectionCreateParamsSchema,
  TerminalConnectionUpdateParamsSchema,
  TerminalConnectionDeleteParamsSchema,
  TerminalConnectionTestParamsSchema,
  TerminalCredentialCreateParamsSchema,
  TerminalCredentialListParamsSchema,
  TerminalCredentialDeleteParamsSchema,
  TerminalAuthMethod,
  TerminalCredentialKind,
  type TerminalConnectionListParams,
  type TerminalConnectionCreateParams,
  type TerminalConnectionUpdateParams,
  type TerminalConnectionDeleteParams,
  type TerminalConnectionTestParams,
  type TerminalCredentialCreateParams,
  type TerminalCredentialListParams,
  type TerminalCredentialDeleteParams,
  type TerminalConnectionListTool,
  type TerminalConnectionCreateTool,
  type TerminalConnectionUpdateTool,
  type TerminalConnectionDeleteTool,
  type TerminalConnectionTestTool,
  type TerminalCredentialCreateTool,
  type TerminalCredentialListTool,
  type TerminalCredentialDeleteTool,
  type TerminalConnectionListResult,
  type TerminalConnectionCreateResult,
  type TerminalConnectionUpdateResult,
  type TerminalConnectionDeleteResult,
  type TerminalConnectionTestResult,
  type TerminalCredentialCreateResult,
  type TerminalCredentialListResult,
  type TerminalCredentialDeleteResult,
  type TerminalConnection,
  type TerminalCredential,
  type TerminalConnectionToolOptions,
} from './terminal-connections.js';

// Terminal session and command execution tools (Issue #1689)
export {
  createTerminalSessionStartTool,
  createTerminalSessionListTool,
  createTerminalSessionTerminateTool,
  createTerminalSessionInfoTool,
  createTerminalSendCommandTool,
  createTerminalSendKeysTool,
  createTerminalCapturePaneTool,
  TerminalSessionStartParamsSchema,
  TerminalSessionListParamsSchema,
  TerminalSessionTerminateParamsSchema,
  TerminalSessionInfoParamsSchema,
  TerminalSendCommandParamsSchema,
  TerminalSendKeysParamsSchema,
  TerminalCapturePaneParamsSchema,
  type TerminalSessionStartParams,
  type TerminalSessionListParams,
  type TerminalSessionTerminateParams,
  type TerminalSessionInfoParams,
  type TerminalSendCommandParams,
  type TerminalSendKeysParams,
  type TerminalCapturePaneParams,
  type TerminalSessionStartTool,
  type TerminalSessionListTool,
  type TerminalSessionTerminateTool,
  type TerminalSessionInfoTool,
  type TerminalSendCommandTool,
  type TerminalSendKeysTool,
  type TerminalCapturePaneTool,
  type TerminalSessionStartResult,
  type TerminalSessionListResult,
  type TerminalSessionTerminateResult,
  type TerminalSessionInfoResult,
  type TerminalSendCommandResult,
  type TerminalSendKeysResult,
  type TerminalCapturePaneResult,
  type TerminalSession,
  type TerminalSessionDetail,
  type TerminalSessionToolOptions,
} from './terminal-sessions.js';

// Terminal search and annotation tools (Issue #1690)
export {
  createTerminalSearchTool,
  createTerminalAnnotateTool,
  TerminalSearchParamsSchema,
  TerminalAnnotateParamsSchema,
  TerminalEntryKind,
  type TerminalSearchParams,
  type TerminalAnnotateParams,
  type TerminalSearchTool,
  type TerminalAnnotateTool,
  type TerminalSearchResult,
  type TerminalAnnotateResult,
  type TerminalSearchEntry,
  type TerminalSearchToolOptions,
} from './terminal-search.js';

// Terminal tunnel tools (Issue #1690)
export {
  createTerminalTunnelCreateTool,
  createTerminalTunnelListTool,
  createTerminalTunnelCloseTool,
  TerminalTunnelCreateParamsSchema,
  TerminalTunnelListParamsSchema,
  TerminalTunnelCloseParamsSchema,
  TunnelDirection,
  type TerminalTunnelCreateParams,
  type TerminalTunnelListParams,
  type TerminalTunnelCloseParams,
  type TerminalTunnelCreateTool,
  type TerminalTunnelListTool,
  type TerminalTunnelCloseTool,
  type TerminalTunnelCreateResult,
  type TerminalTunnelListResult,
  type TerminalTunnelCloseResult,
  type TerminalTunnel,
  type TerminalTunnelToolOptions,
} from './terminal-tunnels.js';

// API onboarding tools (Issue #1784, #1785, #1786)
export {
  createApiOnboardTool,
  ApiOnboardParamsSchema,
  type ApiOnboardParams,
  type ApiOnboardTool,
  type ApiOnboardResult,
  type ApiOnboardToolOptions,
} from './api-onboard.js';

export {
  createApiRecallTool,
  ApiRecallParamsSchema,
  type ApiRecallParams,
  type ApiRecallTool,
  type ApiRecallResult,
  type ApiRecallToolOptions,
} from './api-recall.js';

export {
  createApiGetTool,
  ApiGetParamsSchema,
  type ApiGetParams,
  type ApiGetTool,
  type ApiGetResult,
  type ApiGetToolOptions,
} from './api-get.js';

export {
  createApiListTool,
  ApiListParamsSchema,
  type ApiListParams,
  type ApiListTool,
  type ApiListResult,
  type ApiListToolOptions,
} from './api-list.js';

export {
  createApiUpdateTool,
  ApiUpdateParamsSchema,
  type ApiUpdateParams,
  type ApiUpdateTool,
  type ApiUpdateResult,
  type ApiUpdateToolOptions,
} from './api-update.js';

export {
  createApiCredentialManageTool,
  ApiCredentialManageParamsSchema,
  type ApiCredentialManageParams,
  type ApiCredentialManageTool,
  type ApiCredentialManageResult,
  type ApiCredentialManageToolOptions,
} from './api-credential-manage.js';

export {
  createApiRefreshTool,
  ApiRefreshParamsSchema,
  type ApiRefreshParams,
  type ApiRefreshTool,
  type ApiRefreshResult,
  type ApiRefreshToolOptions,
} from './api-refresh.js';

export {
  createApiRemoveTool,
  ApiRemoveParamsSchema,
  type ApiRemoveParams,
  type ApiRemoveTool,
  type ApiRemoveResult,
  type ApiRemoveToolOptions,
} from './api-remove.js';

export {
  createApiRestoreTool,
  ApiRestoreParamsSchema,
  type ApiRestoreParams,
  type ApiRestoreTool,
  type ApiRestoreResult,
  type ApiRestoreToolOptions,
} from './api-restore.js';

// Dev session tools (Issue #1896)
export {
  createDevSessionCreateTool,
  createDevSessionListTool,
  createDevSessionGetTool,
  createDevSessionUpdateTool,
  createDevSessionCompleteTool,
  DevSessionCreateParamsSchema,
  DevSessionListParamsSchema,
  DevSessionGetParamsSchema,
  DevSessionUpdateParamsSchema,
  DevSessionCompleteParamsSchema,
  type DevSessionCreateParams,
  type DevSessionListParams,
  type DevSessionGetParams,
  type DevSessionUpdateParams,
  type DevSessionCompleteParams,
  type DevSessionCreateTool,
  type DevSessionListTool,
  type DevSessionGetTool,
  type DevSessionUpdateTool,
  type DevSessionCompleteTool,
  type DevSessionCreateResult,
  type DevSessionListResult,
  type DevSessionGetResult,
  type DevSessionUpdateResult,
  type DevSessionCompleteResult,
  type DevSession,
  type DevSessionToolOptions,
} from './dev-sessions.js';

// Tool guide meta-tool (Issue #1923)
export {
  createToolGuideTool,
  ToolGuideParamsSchema,
  type ToolGuideParams,
  type ToolGuideTool,
  type ToolGuideResult,
} from './tool-guide.js';

/** Tool factory types */
export type ToolFactoryOptions = Record<string, never>;
