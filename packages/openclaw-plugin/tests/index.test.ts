import { describe, expect, it } from 'vitest'
import {
  register,
  plugin,
  createMemoryRecallTool,
  createMemoryStoreTool,
  createMemoryForgetTool,
  createProjectListTool,
  createProjectGetTool,
  createProjectCreateTool,
  createTodoListTool,
  createTodoCreateTool,
  createTodoCompleteTool,
  createContactSearchTool,
  createContactGetTool,
  createContactCreateTool,
  createAutoRecallHook,
  createAutoCaptureHook,
  createHealthCheck,
  MemoryRecallParamsSchema,
  MemoryStoreParamsSchema,
  MemoryForgetParamsSchema,
  MemoryCategory,
  ProjectListParamsSchema,
  ProjectGetParamsSchema,
  ProjectCreateParamsSchema,
  ProjectStatus,
  TodoListParamsSchema,
  TodoCreateParamsSchema,
  TodoCompleteParamsSchema,
  ContactSearchParamsSchema,
  ContactGetParamsSchema,
  ContactCreateParamsSchema,
} from '../src/index.js'

describe('Plugin Entry Point', () => {
  describe('exports', () => {
    it('should export register function', () => {
      expect(typeof register).toBe('function')
    })

    it('should export plugin object', () => {
      expect(plugin).toBeDefined()
      expect(typeof plugin).toBe('object')
    })
  })

  describe('plugin object', () => {
    it('should have id property', () => {
      expect(plugin.id).toBe('openclaw-projects')
    })

    it('should have name property', () => {
      expect(plugin.name).toBe('OpenClaw Projects Plugin')
    })

    it('should have kind property set to memory', () => {
      expect(plugin.kind).toBe('memory')
    })

    it('should have register method', () => {
      expect(typeof plugin.register).toBe('function')
    })
  })

  describe('register function', () => {
    it('should be callable with context', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
      }
      // Should not throw
      expect(() => register(mockContext)).not.toThrow()
    })

    it('should return plugin instance', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result).toBeDefined()
    })

    it('should return instance with memoryRecall tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.memoryRecall).toBeDefined()
      expect(result.tools.memoryRecall.name).toBe('memory_recall')
    })

    it('should return instance with memoryStore tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.memoryStore).toBeDefined()
      expect(result.tools.memoryStore.name).toBe('memory_store')
    })

    it('should return instance with memoryForget tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.memoryForget).toBeDefined()
      expect(result.tools.memoryForget.name).toBe('memory_forget')
    })

    it('should return instance with projectList tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.projectList).toBeDefined()
      expect(result.tools.projectList.name).toBe('project_list')
    })

    it('should return instance with projectGet tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.projectGet).toBeDefined()
      expect(result.tools.projectGet.name).toBe('project_get')
    })

    it('should return instance with projectCreate tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.projectCreate).toBeDefined()
      expect(result.tools.projectCreate.name).toBe('project_create')
    })

    it('should return instance with todoList tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.todoList).toBeDefined()
      expect(result.tools.todoList.name).toBe('todo_list')
    })

    it('should return instance with todoCreate tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.todoCreate).toBeDefined()
      expect(result.tools.todoCreate.name).toBe('todo_create')
    })

    it('should return instance with todoComplete tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.todoComplete).toBeDefined()
      expect(result.tools.todoComplete.name).toBe('todo_complete')
    })

    it('should return instance with contactSearch tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.contactSearch).toBeDefined()
      expect(result.tools.contactSearch.name).toBe('contact_search')
    })

    it('should return instance with contactGet tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.contactGet).toBeDefined()
      expect(result.tools.contactGet.name).toBe('contact_get')
    })

    it('should return instance with contactCreate tool', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.tools).toBeDefined()
      expect(result.tools.contactCreate).toBeDefined()
      expect(result.tools.contactCreate.name).toBe('contact_create')
    })

    it('should return instance with hooks', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(result.hooks).toBeDefined()
      expect(typeof result.hooks.beforeAgentStart).toBe('function')
      expect(typeof result.hooks.agentEnd).toBe('function')
    })

    it('should return instance with healthCheck', () => {
      const mockContext = {
        config: { apiUrl: 'http://example.com', apiKey: 'test-key' },
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, namespace: 'test' },
      }
      const result = register(mockContext)
      expect(typeof result.healthCheck).toBe('function')
    })
  })

  describe('tool exports', () => {
    it('should export createMemoryRecallTool', () => {
      expect(typeof createMemoryRecallTool).toBe('function')
    })

    it('should export createMemoryStoreTool', () => {
      expect(typeof createMemoryStoreTool).toBe('function')
    })

    it('should export createMemoryForgetTool', () => {
      expect(typeof createMemoryForgetTool).toBe('function')
    })

    it('should export MemoryRecallParamsSchema', () => {
      expect(MemoryRecallParamsSchema).toBeDefined()
    })

    it('should export MemoryStoreParamsSchema', () => {
      expect(MemoryStoreParamsSchema).toBeDefined()
    })

    it('should export MemoryForgetParamsSchema', () => {
      expect(MemoryForgetParamsSchema).toBeDefined()
    })

    it('should export MemoryCategory enum', () => {
      expect(MemoryCategory).toBeDefined()
    })

    it('should export createProjectListTool', () => {
      expect(typeof createProjectListTool).toBe('function')
    })

    it('should export createProjectGetTool', () => {
      expect(typeof createProjectGetTool).toBe('function')
    })

    it('should export createProjectCreateTool', () => {
      expect(typeof createProjectCreateTool).toBe('function')
    })

    it('should export ProjectListParamsSchema', () => {
      expect(ProjectListParamsSchema).toBeDefined()
    })

    it('should export ProjectGetParamsSchema', () => {
      expect(ProjectGetParamsSchema).toBeDefined()
    })

    it('should export ProjectCreateParamsSchema', () => {
      expect(ProjectCreateParamsSchema).toBeDefined()
    })

    it('should export ProjectStatus enum', () => {
      expect(ProjectStatus).toBeDefined()
    })

    it('should export createTodoListTool', () => {
      expect(typeof createTodoListTool).toBe('function')
    })

    it('should export createTodoCreateTool', () => {
      expect(typeof createTodoCreateTool).toBe('function')
    })

    it('should export createTodoCompleteTool', () => {
      expect(typeof createTodoCompleteTool).toBe('function')
    })

    it('should export TodoListParamsSchema', () => {
      expect(TodoListParamsSchema).toBeDefined()
    })

    it('should export TodoCreateParamsSchema', () => {
      expect(TodoCreateParamsSchema).toBeDefined()
    })

    it('should export TodoCompleteParamsSchema', () => {
      expect(TodoCompleteParamsSchema).toBeDefined()
    })

    it('should export createContactSearchTool', () => {
      expect(typeof createContactSearchTool).toBe('function')
    })

    it('should export createContactGetTool', () => {
      expect(typeof createContactGetTool).toBe('function')
    })

    it('should export createContactCreateTool', () => {
      expect(typeof createContactCreateTool).toBe('function')
    })

    it('should export ContactSearchParamsSchema', () => {
      expect(ContactSearchParamsSchema).toBeDefined()
    })

    it('should export ContactGetParamsSchema', () => {
      expect(ContactGetParamsSchema).toBeDefined()
    })

    it('should export ContactCreateParamsSchema', () => {
      expect(ContactCreateParamsSchema).toBeDefined()
    })

    it('should export createAutoRecallHook', () => {
      expect(typeof createAutoRecallHook).toBe('function')
    })

    it('should export createAutoCaptureHook', () => {
      expect(typeof createAutoCaptureHook).toBe('function')
    })

    it('should export createHealthCheck', () => {
      expect(typeof createHealthCheck).toBe('function')
    })
  })
})
