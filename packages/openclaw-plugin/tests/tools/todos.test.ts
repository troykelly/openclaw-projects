/**
 * Tests for todo management tools.
 * Covers todo_list, todo_create, and todo_complete.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createTodoListTool,
  createTodoCreateTool,
  createTodoCompleteTool,
  type TodoCreateParams,
  type TodoCompleteParams,
} from '../../src/tools/todos.js'
import type { ApiClient } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'
import type { PluginConfig } from '../../src/config.js'

describe('todo tools', () => {
  const mockLogger: Logger = {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockConfig: PluginConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    autoRecall: true,
    autoCapture: true,
    userScoping: 'agent',
    maxRecallMemories: 5,
    minRecallScore: 0.7,
    timeout: 30000,
    maxRetries: 3,
    debug: false,
  }

  const mockApiClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as ApiClient

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('todo_list', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createTodoListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })
        expect(tool.name).toBe('todo_list')
      })

      it('should have description', () => {
        const tool = createTodoListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })
        expect(tool.description.length).toBeGreaterThan(10)
      })
    })

    describe('parameter validation', () => {
      it('should accept no parameters', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { todos: [], total: 0 },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({})
        expect(mockGet).toHaveBeenCalled()
        expect(result.success).toBe(true)
      })

      it('should accept valid projectId filter', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { todos: [], total: 0 },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ projectId: '123e4567-e89b-12d3-a456-426614174000' })
        expect(mockGet).toHaveBeenCalledWith(
          expect.stringContaining('projectId=123e4567-e89b-12d3-a456-426614174000'),
          expect.any(Object)
        )
      })

      it('should reject invalid projectId format', async () => {
        const tool = createTodoListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ projectId: 'not-a-uuid' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('UUID')
        }
      })

      it('should accept completed filter', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { todos: [], total: 0 },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ completed: true })
        expect(mockGet).toHaveBeenCalledWith(
          expect.stringContaining('completed=true'),
          expect.any(Object)
        )
      })

      it('should accept limit within range', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { todos: [], total: 0 },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ limit: 100 })
        expect(mockGet).toHaveBeenCalledWith(
          expect.stringContaining('limit=100'),
          expect.any(Object)
        )
      })

      it('should reject limit above 200', async () => {
        const tool = createTodoListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ limit: 201 })
        expect(result.success).toBe(false)
      })
    })

    describe('response formatting', () => {
      it('should format todos as checkbox list', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            todos: [
              { id: 't1', title: 'Buy groceries', completed: false },
              { id: 't2', title: 'Call mom', completed: true, dueDate: '2024-01-15' },
            ],
            total: 2,
          },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({})

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('[ ]')
          expect(result.data.content).toContain('[x]')
          expect(result.data.content).toContain('Buy groceries')
          expect(result.data.content).toContain('Call mom')
          expect(result.data.details.total).toBe(2)
        }
      })

      it('should handle empty results', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { todos: [], total: 0 },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({})

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('No todos found')
        }
      })

      it('should include due dates in output', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            todos: [
              { id: 't1', title: 'Submit report', completed: false, dueDate: '2024-02-01' },
            ],
            total: 1,
          },
        })
        const client = { ...mockApiClient, get: mockGet }

        const tool = createTodoListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({})

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('2024-02-01')
        }
      })
    })
  })

  describe('todo_create', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createTodoCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })
        expect(tool.name).toBe('todo_create')
      })
    })

    describe('parameter validation', () => {
      it('should require title parameter', async () => {
        const tool = createTodoCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({} as TodoCreateParams)
        expect(result.success).toBe(false)
      })

      it('should reject empty title', async () => {
        const tool = createTodoCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ title: '' })
        expect(result.success).toBe(false)
      })

      it('should reject title over 500 characters', async () => {
        const tool = createTodoCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ title: 'a'.repeat(501) })
        expect(result.success).toBe(false)
      })

      it('should accept valid projectId', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', title: 'New Todo' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({
          title: 'New Todo',
          projectId: '123e4567-e89b-12d3-a456-426614174000',
        })

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            projectId: '123e4567-e89b-12d3-a456-426614174000',
          }),
          expect.any(Object)
        )
      })

      it('should reject invalid projectId format', async () => {
        const tool = createTodoCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({
          title: 'New Todo',
          projectId: 'invalid-uuid',
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('UUID')
        }
      })

      it('should accept valid due date in ISO 8601 format', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', title: 'New Todo' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({
          title: 'New Todo',
          dueDate: '2024-12-31',
        })

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            dueDate: '2024-12-31',
          }),
          expect.any(Object)
        )
      })

      it('should reject invalid due date format', async () => {
        const tool = createTodoCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({
          title: 'New Todo',
          dueDate: 'invalid-date',
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('date')
        }
      })
    })

    describe('API interaction', () => {
      it('should call POST /api/todos with correct body', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', title: 'Buy groceries' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ title: 'Buy groceries' })

        expect(mockPost).toHaveBeenCalledWith(
          '/api/todos',
          expect.objectContaining({
            title: 'Buy groceries',
          }),
          expect.objectContaining({ userId: 'agent-1' })
        )
      })
    })

    describe('response', () => {
      it('should return new todo ID', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', title: 'Buy groceries' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ title: 'Buy groceries' })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('Created')
          expect(result.data.details.id).toBe('new-123')
        }
      })
    })

    describe('input sanitization', () => {
      it('should strip HTML tags from title', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', title: 'Buy groceries' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ title: '<script>alert("xss")</script>Buy groceries' })

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            title: 'Buy groceries',
          }),
          expect.any(Object)
        )
      })
    })
  })

  describe('todo_complete', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createTodoCompleteTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })
        expect(tool.name).toBe('todo_complete')
      })
    })

    describe('parameter validation', () => {
      it('should require id parameter', async () => {
        const tool = createTodoCompleteTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({} as TodoCompleteParams)
        expect(result.success).toBe(false)
      })

      it('should validate UUID format', async () => {
        const tool = createTodoCompleteTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ id: 'not-a-uuid' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('UUID')
        }
      })

      it('should accept valid UUID', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { completed: true },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCompleteTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' })
        expect(mockPost).toHaveBeenCalled()
      })
    })

    describe('API interaction', () => {
      it('should call POST /api/todos/:id/complete', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { completed: true },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCompleteTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' })

        expect(mockPost).toHaveBeenCalledWith(
          '/api/todos/123e4567-e89b-12d3-a456-426614174000/complete',
          {},
          expect.objectContaining({ userId: 'agent-1' })
        )
      })
    })

    describe('response', () => {
      it('should return success confirmation', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { completed: true, title: 'Buy groceries' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCompleteTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('completed')
        }
      })

      it('should handle not found', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Todo not found', code: 'NOT_FOUND' },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCompleteTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('not found')
        }
      })

      it('should be idempotent (completing twice returns success)', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { completed: true, alreadyCompleted: true },
        })
        const client = { ...mockApiClient, post: mockPost }

        const tool = createTodoCompleteTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        })

        const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' })

        expect(result.success).toBe(true)
      })
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createTodoListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({})
      expect(result.success).toBe(false)
    })

    it('should handle network errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'))
      const client = { ...mockApiClient, get: mockGet }

      const tool = createTodoListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({})
      expect(result.success).toBe(false)
    })

    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(
        new Error('Connection refused to internal-db:5432')
      )
      const client = { ...mockApiClient, post: mockPost }

      const tool = createTodoCreateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ title: 'Test todo' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).not.toContain('5432')
        expect(result.error).not.toContain('internal-db')
      }
    })
  })

  describe('user scoping', () => {
    it('should include userId in all API calls', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { todos: [], total: 0 },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createTodoListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user',
      })

      await tool.execute({})

      expect(mockGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userId: 'custom-user' })
      )
    })
  })
})
