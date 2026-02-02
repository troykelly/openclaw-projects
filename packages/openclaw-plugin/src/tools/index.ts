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

// memory_store tool (to be implemented in #243)
// export * from './memory-store.js'

// memory_forget tool (to be implemented in #244)
// export * from './memory-forget.js'

// Project tools (to be implemented in #245)
// export * from './projects.js'

// Todo tools (to be implemented in #246)
// export * from './todos.js'

// Contact tools (to be implemented in #247)
// export * from './contacts.js'

/** Tool factory types */
export interface ToolFactoryOptions {
  // Common options for tool factories
}
