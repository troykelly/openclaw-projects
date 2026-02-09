/**
 * Tests for memory_store tool.
 * Verifies memory persistence functionality.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createMemoryStoreTool, type MemoryStoreParams } from '../../src/tools/memory-store.js'
import type { ApiClient } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'
import type { PluginConfig } from '../../src/config.js'

describe('memory_store tool', () => {
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

  describe('tool metadata', () => {
    it('should have correct name', () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })
      expect(tool.name).toBe('memory_store')
    })

    it('should have description', () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })
      expect(tool.description).toBeDefined()
      expect(tool.description.length).toBeGreaterThan(10)
    })

    it('should have parameter schema', () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })
      expect(tool.parameters).toBeDefined()
    })
  })

  describe('parameter validation', () => {
    it('should require text parameter', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({} as MemoryStoreParams)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('text')
      }
    })

    it('should reject empty text', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: '' })
      expect(result.success).toBe(false)
    })

    it('should reject text over 5000 characters', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const longText = 'a'.repeat(5001)
      const result = await tool.execute({ text: longText })
      expect(result.success).toBe(false)
    })

    it('should accept valid category', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test', category: 'preference' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'User prefers oat milk', category: 'preference' })
      expect(mockPost).toHaveBeenCalled()
    })

    it('should reject invalid category', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({
        text: 'test',
        category: 'invalid' as MemoryStoreParams['category'],
      })
      expect(result.success).toBe(false)
    })

    it('should accept importance between 0 and 1', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test', importance: 0.9 },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'Important fact', importance: 0.9 })
      expect(mockPost).toHaveBeenCalled()
    })

    it('should reject importance above 1', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: 'test', importance: 1.5 })
      expect(result.success).toBe(false)
    })

    it('should reject importance below 0', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: 'test', importance: -0.1 })
      expect(result.success).toBe(false)
    })
  })

  describe('input sanitization', () => {
    it('should strip control characters from text', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test text' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'test\x00\x1F text' })

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: 'test text',
        }),
        expect.any(Object)
      )
    })

    it('should trim whitespace from text', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test text' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: '  test text  ' })

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: 'test text',
        }),
        expect.any(Object)
      )
    })

    it('should warn when text contains potential credentials', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'api key is sk-abc123' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      // Use a longer key that matches the pattern (20+ chars after sk-)
      await tool.execute({ text: 'api key is sk-abc123xyz456def789ghijk' })

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('credential'),
        expect.any(Object)
      )
    })
  })

  describe('API interaction', () => {
    it('should call POST /api/memories with correct body', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'User likes coffee' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({
        text: 'User likes coffee',
        category: 'preference',
        importance: 0.8,
      })

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories',
        expect.objectContaining({
          content: 'User likes coffee',
          category: 'preference',
          importance: 0.8,
        }),
        expect.objectContaining({ userId: 'agent-1' })
      )
    })

    it('should use default category "other" when not provided', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'Some info' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'Some info' })

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories',
        expect.objectContaining({
          category: 'other',
        }),
        expect.any(Object)
      )
    })

    it('should use default importance 0.7 when not provided', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'Some info' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'Some info' })

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories',
        expect.objectContaining({
          importance: 0.7,
        }),
        expect.any(Object)
      )
    })
  })

  describe('response formatting', () => {
    it('should return success with stored memory details', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          content: 'User birthday is March 15',
          category: 'fact',
          importance: 0.8,
        },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({
        text: 'User birthday is March 15',
        category: 'fact',
        importance: 0.8,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.content).toContain('Stored memory')
        expect(result.data.details.id).toBe('mem-123')
        expect(result.data.details.userId).toBe('agent-1')
      }
    })

    it('should truncate long content in response preview', async () => {
      const longContent = 'a'.repeat(200)
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: longContent },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: longContent })

      expect(result.success).toBe(true)
      if (result.success) {
        // Response should have truncated preview
        expect(result.data.content.length).toBeLessThan(longContent.length + 50)
      }
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: 'test' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Server error')
      }
    })

    it('should handle network errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'))
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: 'test' })

      expect(result.success).toBe(false)
    })

    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(
        new Error('Connection refused to internal-db:5432')
      )
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ text: 'test' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).not.toContain('5432')
        expect(result.error).not.toContain('internal-db')
      }
    })
  })

  describe('logging', () => {
    it('should log tool invocation with metadata (not content)', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'Sensitive information here', category: 'fact' })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'memory_store invoked',
        expect.objectContaining({
          userId: 'agent-1',
          category: 'fact',
          textLength: expect.any(Number),
        })
      )

      // Should NOT log the actual content
      const infoCalls = mockLogger.info.mock.calls
      for (const call of infoCalls) {
        const logMessage = JSON.stringify(call)
        expect(logMessage).not.toContain('Sensitive information')
      }
    })

    it('should log errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Test error'))
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ text: 'test' })

      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('user scoping', () => {
    it('should use provided userId for API calls', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user-456',
      })

      await tool.execute({ text: 'test' })

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ userId: 'custom-user-456' })
      )
    })

    it('should include userId in response details', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'my-agent',
      })

      const result = await tool.execute({ text: 'test' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.details.userId).toBe('my-agent')
      }
    })
  })
})
