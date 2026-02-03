/**
 * OpenClaw 2026 Plugin Registration
 *
 * This module implements the OpenClaw Gateway plugin API pattern:
 * - Default export function taking `api` object
 * - Tools registered via `api.registerTool()`
 * - Hooks registered via `api.registerHook()`
 * - CLI registered via `api.registerCli()`
 */

import type {
  OpenClawPluginAPI,
  PluginInitializer,
  ToolDefinition,
  JSONSchema,
  ToolContext,
  ToolResult,
} from './types/openclaw-api.js'
import { validateRawConfig, resolveConfigSecrets, redactConfig, type PluginConfig } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { createApiClient, type ApiClient } from './api-client.js'
import { extractContext, getUserScopeKey } from './context.js'
import { zodToJsonSchema } from './utils/zod-to-json-schema.js'
import {
  MemoryRecallParamsSchema,
  MemoryStoreParamsSchema,
  MemoryForgetParamsSchema,
  ProjectListParamsSchema,
  ProjectGetParamsSchema,
  ProjectCreateParamsSchema,
  TodoListParamsSchema,
  TodoCreateParamsSchema,
  TodoCompleteParamsSchema,
  ContactSearchParamsSchema,
  ContactGetParamsSchema,
  ContactCreateParamsSchema,
  MemoryCategory,
  ProjectStatus,
} from './tools/index.js'

/** Plugin state stored during registration */
interface PluginState {
  config: PluginConfig
  logger: Logger
  apiClient: ApiClient
  userId: string
}

/**
 * Memory recall tool JSON Schema
 */
const memoryRecallSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query for semantic memory search',
      minLength: 1,
      maxLength: 1000,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of memories to return',
      minimum: 1,
      maximum: 20,
      default: 5,
    },
    category: {
      type: 'string',
      description: 'Filter by memory category',
      enum: ['preference', 'fact', 'decision', 'context', 'other'],
    },
  },
  required: ['query'],
}

/**
 * Memory store tool JSON Schema
 */
const memoryStoreSchema: JSONSchema = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'Memory content to store',
      minLength: 1,
      maxLength: 10000,
    },
    category: {
      type: 'string',
      description: 'Memory category',
      enum: ['preference', 'fact', 'decision', 'context', 'other'],
      default: 'fact',
    },
    importance: {
      type: 'number',
      description: 'Importance score (0-1)',
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
  },
  required: ['content'],
}

/**
 * Memory forget tool JSON Schema
 */
const memoryForgetSchema: JSONSchema = {
  type: 'object',
  properties: {
    memoryId: {
      type: 'string',
      description: 'ID of the memory to forget',
      format: 'uuid',
    },
    query: {
      type: 'string',
      description: 'Search query to find memories to forget',
    },
  },
}

/**
 * Project list tool JSON Schema
 */
const projectListSchema: JSONSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      description: 'Filter by project status',
      enum: ['active', 'completed', 'archived', 'all'],
      default: 'active',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of projects to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
}

/**
 * Project get tool JSON Schema
 */
const projectGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Project ID to retrieve',
      format: 'uuid',
    },
  },
  required: ['projectId'],
}

/**
 * Project create tool JSON Schema
 */
const projectCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Project name',
      minLength: 1,
      maxLength: 200,
    },
    description: {
      type: 'string',
      description: 'Project description',
      maxLength: 5000,
    },
    status: {
      type: 'string',
      description: 'Initial project status',
      enum: ['active', 'completed', 'archived'],
      default: 'active',
    },
  },
  required: ['name'],
}

/**
 * Todo list tool JSON Schema
 */
const todoListSchema: JSONSchema = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Filter by project ID',
      format: 'uuid',
    },
    status: {
      type: 'string',
      description: 'Filter by todo status',
      enum: ['pending', 'in_progress', 'completed', 'all'],
      default: 'pending',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of todos to return',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
  },
}

/**
 * Todo create tool JSON Schema
 */
const todoCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Todo title',
      minLength: 1,
      maxLength: 500,
    },
    description: {
      type: 'string',
      description: 'Todo description',
      maxLength: 5000,
    },
    projectId: {
      type: 'string',
      description: 'Project to add the todo to',
      format: 'uuid',
    },
    priority: {
      type: 'string',
      description: 'Todo priority',
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    dueDate: {
      type: 'string',
      description: 'Due date in ISO 8601 format',
      format: 'date-time',
    },
  },
  required: ['title'],
}

/**
 * Todo complete tool JSON Schema
 */
const todoCompleteSchema: JSONSchema = {
  type: 'object',
  properties: {
    todoId: {
      type: 'string',
      description: 'Todo ID to mark as complete',
      format: 'uuid',
    },
  },
  required: ['todoId'],
}

/**
 * Contact search tool JSON Schema
 */
const contactSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query for contacts',
      minLength: 1,
      maxLength: 500,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of contacts to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
  required: ['query'],
}

/**
 * Contact get tool JSON Schema
 */
const contactGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    contactId: {
      type: 'string',
      description: 'Contact ID to retrieve',
      format: 'uuid',
    },
  },
  required: ['contactId'],
}

/**
 * Contact create tool JSON Schema
 */
const contactCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Contact name',
      minLength: 1,
      maxLength: 200,
    },
    email: {
      type: 'string',
      description: 'Contact email address',
      format: 'email',
    },
    phone: {
      type: 'string',
      description: 'Contact phone number',
    },
    notes: {
      type: 'string',
      description: 'Notes about the contact',
      maxLength: 5000,
    },
  },
  required: ['name'],
}

/**
 * Create tool execution handlers
 */
function createToolHandlers(state: PluginState) {
  const { config, logger, apiClient, userId } = state

  return {
    async memory_recall(params: Record<string, unknown>): Promise<ToolResult> {
      const { query, limit = config.maxRecallMemories, category } = params as {
        query: string
        limit?: number
        category?: string
      }

      try {
        const queryParams = new URLSearchParams({ q: query, limit: String(limit) })
        if (category) queryParams.set('category', category)

        const response = await apiClient.get<{ memories: Array<{ id: string; content: string; category: string; score?: number }> }>(
          `/api/memories/search?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        const memories = response.data.memories ?? []
        const content =
          memories.length > 0
            ? memories.map((m) => `- [${m.category}] ${m.content}`).join('\n')
            : 'No relevant memories found.'

        return {
          success: true,
          data: {
            content,
            details: { count: memories.length, memories, userId },
          },
        }
      } catch (error) {
        logger.error('memory_recall failed', { error })
        return { success: false, error: 'Failed to search memories' }
      }
    },

    async memory_store(params: Record<string, unknown>): Promise<ToolResult> {
      const { content, category = 'fact', importance = 0.5 } = params as {
        content: string
        category?: string
        importance?: number
      }

      try {
        const response = await apiClient.post<{ id: string }>(
          '/api/memories',
          { content, category, importance },
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        return {
          success: true,
          data: {
            content: `Memory stored successfully (ID: ${response.data.id})`,
            details: { id: response.data.id, userId },
          },
        }
      } catch (error) {
        logger.error('memory_store failed', { error })
        return { success: false, error: 'Failed to store memory' }
      }
    },

    async memory_forget(params: Record<string, unknown>): Promise<ToolResult> {
      const { memoryId, query } = params as { memoryId?: string; query?: string }

      try {
        if (memoryId) {
          const response = await apiClient.delete(`/api/memories/${memoryId}`, { userId })
          if (!response.success) {
            return { success: false, error: response.error.message }
          }
          return {
            success: true,
            data: { content: `Memory ${memoryId} forgotten successfully` },
          }
        }

        if (query) {
          const response = await apiClient.post<{ deleted: number }>(
            '/api/memories/forget',
            { query },
            { userId }
          )
          if (!response.success) {
            return { success: false, error: response.error.message }
          }
          return {
            success: true,
            data: {
              content: `Forgotten ${response.data.deleted} matching memories`,
              details: { deletedCount: response.data.deleted },
            },
          }
        }

        return { success: false, error: 'Either memoryId or query is required' }
      } catch (error) {
        logger.error('memory_forget failed', { error })
        return { success: false, error: 'Failed to forget memory' }
      }
    },

    async project_list(params: Record<string, unknown>): Promise<ToolResult> {
      const { status = 'active', limit = 10 } = params as { status?: string; limit?: number }

      try {
        const queryParams = new URLSearchParams({ limit: String(limit) })
        if (status !== 'all') queryParams.set('status', status)

        const response = await apiClient.get<{ projects: Array<{ id: string; name: string; status: string }> }>(
          `/api/projects?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        const projects = response.data.projects ?? []
        const content =
          projects.length > 0
            ? projects.map((p) => `- ${p.name} (${p.status})`).join('\n')
            : 'No projects found.'

        return {
          success: true,
          data: { content, details: { count: projects.length, projects } },
        }
      } catch (error) {
        logger.error('project_list failed', { error })
        return { success: false, error: 'Failed to list projects' }
      }
    },

    async project_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { projectId } = params as { projectId: string }

      try {
        const response = await apiClient.get<{ id: string; name: string; description?: string; status: string }>(
          `/api/projects/${projectId}`,
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        const project = response.data
        return {
          success: true,
          data: {
            content: `Project: ${project.name}\nStatus: ${project.status}\n${project.description || ''}`,
            details: { project },
          },
        }
      } catch (error) {
        logger.error('project_get failed', { error })
        return { success: false, error: 'Failed to get project' }
      }
    },

    async project_create(params: Record<string, unknown>): Promise<ToolResult> {
      const { name, description, status = 'active' } = params as {
        name: string
        description?: string
        status?: string
      }

      try {
        const response = await apiClient.post<{ id: string }>(
          '/api/projects',
          { name, description, status },
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        return {
          success: true,
          data: {
            content: `Project "${name}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id },
          },
        }
      } catch (error) {
        logger.error('project_create failed', { error })
        return { success: false, error: 'Failed to create project' }
      }
    },

    async todo_list(params: Record<string, unknown>): Promise<ToolResult> {
      const { projectId, status = 'pending', limit = 20 } = params as {
        projectId?: string
        status?: string
        limit?: number
      }

      try {
        const queryParams = new URLSearchParams({ limit: String(limit) })
        if (status !== 'all') queryParams.set('status', status)
        if (projectId) queryParams.set('projectId', projectId)

        const response = await apiClient.get<{ todos: Array<{ id: string; title: string; status: string }> }>(
          `/api/todos?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        const todos = response.data.todos ?? []
        const content =
          todos.length > 0
            ? todos.map((t) => `- [${t.status}] ${t.title}`).join('\n')
            : 'No todos found.'

        return {
          success: true,
          data: { content, details: { count: todos.length, todos } },
        }
      } catch (error) {
        logger.error('todo_list failed', { error })
        return { success: false, error: 'Failed to list todos' }
      }
    },

    async todo_create(params: Record<string, unknown>): Promise<ToolResult> {
      const { title, description, projectId, priority = 'medium', dueDate } = params as {
        title: string
        description?: string
        projectId?: string
        priority?: string
        dueDate?: string
      }

      try {
        const response = await apiClient.post<{ id: string }>(
          '/api/todos',
          { title, description, projectId, priority, dueDate },
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        return {
          success: true,
          data: {
            content: `Todo "${title}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id },
          },
        }
      } catch (error) {
        logger.error('todo_create failed', { error })
        return { success: false, error: 'Failed to create todo' }
      }
    },

    async todo_complete(params: Record<string, unknown>): Promise<ToolResult> {
      const { todoId } = params as { todoId: string }

      try {
        const response = await apiClient.patch<{ id: string }>(
          `/api/todos/${todoId}`,
          { status: 'completed' },
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        return {
          success: true,
          data: { content: `Todo ${todoId} marked as complete` },
        }
      } catch (error) {
        logger.error('todo_complete failed', { error })
        return { success: false, error: 'Failed to complete todo' }
      }
    },

    async contact_search(params: Record<string, unknown>): Promise<ToolResult> {
      const { query, limit = 10 } = params as { query: string; limit?: number }

      try {
        const queryParams = new URLSearchParams({ q: query, limit: String(limit) })
        const response = await apiClient.get<{ contacts: Array<{ id: string; name: string; email?: string }> }>(
          `/api/contacts/search?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        const contacts = response.data.contacts ?? []
        const content =
          contacts.length > 0
            ? contacts.map((c) => `- ${c.name}${c.email ? ` (${c.email})` : ''}`).join('\n')
            : 'No contacts found.'

        return {
          success: true,
          data: { content, details: { count: contacts.length, contacts } },
        }
      } catch (error) {
        logger.error('contact_search failed', { error })
        return { success: false, error: 'Failed to search contacts' }
      }
    },

    async contact_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { contactId } = params as { contactId: string }

      try {
        const response = await apiClient.get<{ id: string; name: string; email?: string; phone?: string; notes?: string }>(
          `/api/contacts/${contactId}`,
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        const contact = response.data
        const lines = [`Contact: ${contact.name}`]
        if (contact.email) lines.push(`Email: ${contact.email}`)
        if (contact.phone) lines.push(`Phone: ${contact.phone}`)
        if (contact.notes) lines.push(`Notes: ${contact.notes}`)

        return {
          success: true,
          data: { content: lines.join('\n'), details: { contact } },
        }
      } catch (error) {
        logger.error('contact_get failed', { error })
        return { success: false, error: 'Failed to get contact' }
      }
    },

    async contact_create(params: Record<string, unknown>): Promise<ToolResult> {
      const { name, email, phone, notes } = params as {
        name: string
        email?: string
        phone?: string
        notes?: string
      }

      try {
        const response = await apiClient.post<{ id: string }>(
          '/api/contacts',
          { name, email, phone, notes },
          { userId }
        )

        if (!response.success) {
          return { success: false, error: response.error.message }
        }

        return {
          success: true,
          data: {
            content: `Contact "${name}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id },
          },
        }
      } catch (error) {
        logger.error('contact_create failed', { error })
        return { success: false, error: 'Failed to create contact' }
      }
    },
  }
}

/**
 * OpenClaw 2026 Plugin Registration Function
 *
 * This is the main entry point for the plugin using the OpenClaw API pattern.
 * Registers all tools, hooks, and CLI commands via the provided API object.
 */
export const registerOpenClaw: PluginInitializer = async (api: OpenClawPluginAPI) => {
  // Validate and resolve configuration
  const rawConfig = validateRawConfig(api.config)
  const config = await resolveConfigSecrets(rawConfig)

  // Create logger and API client
  const logger = api.logger ?? createLogger('openclaw-projects')
  const apiClient = createApiClient({ config, logger })

  // Extract context and user ID
  const context = extractContext(api.runtime)
  const userId = getUserScopeKey(
    {
      agentId: context.agent.agentId,
      sessionKey: context.session.sessionId,
    },
    config.userScoping
  )

  // Store plugin state
  const state: PluginState = { config, logger, apiClient, userId }

  // Create tool handlers
  const handlers = createToolHandlers(state)

  // Register all 12 tools
  const tools: ToolDefinition[] = [
    {
      name: 'memory_recall',
      description: 'Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.',
      parameters: memoryRecallSchema,
      execute: (params) => handlers.memory_recall(params),
    },
    {
      name: 'memory_store',
      description: 'Store a new memory for future reference. Use when the user shares important preferences, facts, or decisions.',
      parameters: memoryStoreSchema,
      execute: (params) => handlers.memory_store(params),
    },
    {
      name: 'memory_forget',
      description: 'Remove a memory by ID or search query. Use when information is outdated or the user requests deletion.',
      parameters: memoryForgetSchema,
      execute: (params) => handlers.memory_forget(params),
    },
    {
      name: 'project_list',
      description: 'List projects for the user. Use to see what projects exist or filter by status.',
      parameters: projectListSchema,
      execute: (params) => handlers.project_list(params),
    },
    {
      name: 'project_get',
      description: 'Get details about a specific project. Use when you need full project information.',
      parameters: projectGetSchema,
      execute: (params) => handlers.project_get(params),
    },
    {
      name: 'project_create',
      description: 'Create a new project. Use when the user wants to start tracking a new initiative.',
      parameters: projectCreateSchema,
      execute: (params) => handlers.project_create(params),
    },
    {
      name: 'todo_list',
      description: 'List todos, optionally filtered by project or status. Use to see pending tasks.',
      parameters: todoListSchema,
      execute: (params) => handlers.todo_list(params),
    },
    {
      name: 'todo_create',
      description: 'Create a new todo item. Use when the user wants to track a task.',
      parameters: todoCreateSchema,
      execute: (params) => handlers.todo_create(params),
    },
    {
      name: 'todo_complete',
      description: 'Mark a todo as complete. Use when a task is done.',
      parameters: todoCompleteSchema,
      execute: (params) => handlers.todo_complete(params),
    },
    {
      name: 'contact_search',
      description: 'Search contacts by name, email, or other fields. Use to find people.',
      parameters: contactSearchSchema,
      execute: (params) => handlers.contact_search(params),
    },
    {
      name: 'contact_get',
      description: 'Get details about a specific contact. Use when you need full contact information.',
      parameters: contactGetSchema,
      execute: (params) => handlers.contact_get(params),
    },
    {
      name: 'contact_create',
      description: 'Create a new contact. Use when the user mentions someone new to track.',
      parameters: contactCreateSchema,
      execute: (params) => handlers.contact_create(params),
    },
  ]

  for (const tool of tools) {
    api.registerTool(tool)
  }

  // Register hooks
  if (config.autoRecall) {
    api.registerHook('beforeAgentStart', async (event: unknown) => {
      // Auto-recall relevant memories at conversation start
      logger.debug('Auto-recall hook triggered')
      try {
        const result = await handlers.memory_recall({
          query: 'relevant context for this conversation',
          limit: config.maxRecallMemories,
        })
        if (result.success && result.data) {
          const eventObj = typeof event === 'object' && event !== null ? event : {}
          return { ...eventObj, injectedContext: result.data.content }
        }
      } catch (error) {
        logger.error('Auto-recall failed', { error })
      }
      return event
    })
  }

  if (config.autoCapture) {
    api.registerHook('agentEnd', async (event: unknown) => {
      // Auto-capture hook would analyze conversation for important info
      logger.debug('Auto-capture hook triggered')
      // Implementation would extract and store relevant memories
      return event
    })
  }

  // Register CLI commands
  api.registerCli(({ program }) => {
    program
      .command('status')
      .description('Show plugin status and statistics')
      .action(async () => {
        try {
          const response = await apiClient.get('/api/health', { userId })
          console.log('Plugin Status:', response.success ? 'Connected' : 'Error')
        } catch {
          console.log('Plugin Status: Error - Unable to connect')
        }
      })

    program
      .command('recall')
      .description('Recall memories matching a query')
      .action(async (...args: unknown[]) => {
        const query = typeof args[0] === 'string' ? args[0] : ''
        const options = (args[1] ?? {}) as { limit?: string }
        const result = await handlers.memory_recall({
          query,
          limit: options.limit ? parseInt(options.limit, 10) : 5,
        })
        if (result.success && result.data) {
          console.log(result.data.content)
        } else {
          console.error('Error:', result.error)
        }
      })
  })

  logger.info('OpenClaw Projects plugin registered', {
    agentId: context.agent.agentId,
    sessionId: context.session.sessionId,
    userId,
    toolCount: tools.length,
    config: redactConfig(config),
  })
}

/** Default export for OpenClaw 2026 API compatibility */
export default registerOpenClaw

/** Export JSON Schemas for external use */
export const schemas = {
  memoryRecall: memoryRecallSchema,
  memoryStore: memoryStoreSchema,
  memoryForget: memoryForgetSchema,
  projectList: projectListSchema,
  projectGet: projectGetSchema,
  projectCreate: projectCreateSchema,
  todoList: todoListSchema,
  todoCreate: todoCreateSchema,
  todoComplete: todoCompleteSchema,
  contactSearch: contactSearchSchema,
  contactGet: contactGetSchema,
  contactCreate: contactCreateSchema,
}
