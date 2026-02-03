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
} from './memory-recall.js'

// memory_store tool
export {
  createMemoryStoreTool,
  MemoryStoreParamsSchema,
  type MemoryStoreParams,
  type MemoryStoreTool,
  type MemoryStoreResult,
  type StoredMemory,
} from './memory-store.js'

// memory_forget tool
export {
  createMemoryForgetTool,
  MemoryForgetParamsSchema,
  type MemoryForgetParams,
  type MemoryForgetTool,
  type MemoryForgetResult,
} from './memory-forget.js'

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
} from './projects.js'

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
} from './todos.js'

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
} from './contacts.js'

// SMS tools
export {
  createSmsSendTool,
  SmsSendParamsSchema,
  type SmsSendParams,
  type SmsSendTool,
  type SmsSendResult,
  type SmsSendToolOptions,
} from './sms-send.js'

// Email tools
export {
  createEmailSendTool,
  EmailSendParamsSchema,
  type EmailSendParams,
  type EmailSendTool,
  type EmailSendResult,
  type EmailSendToolOptions,
} from './email-send.js'

/** Tool factory types */
export interface ToolFactoryOptions {
  // Common options for tool factories
}
