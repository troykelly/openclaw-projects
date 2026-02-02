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

// Todo tools (to be implemented in #246)
// export * from './todos.js'

// Contact tools (to be implemented in #247)
// export * from './contacts.js'

/** Tool factory types */
export interface ToolFactoryOptions {
  // Common options for tool factories
}
