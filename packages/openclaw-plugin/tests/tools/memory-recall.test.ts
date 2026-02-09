/**
 * Tests for memory_recall tool.
 * Verifies semantic memory search functionality.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createMemoryRecallTool, type MemoryRecallParams } from '../../src/tools/memory-recall.js'
import type { ApiClient, } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'
import type { PluginConfig } from '../../src/config.js'

describe('memory_recall tool', () => {
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
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })
      expect(tool.name).toBe('memory_recall')
    })

    it('should have description', () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })
      expect(tool.description).toBeDefined()
      expect(tool.description.length).toBeGreaterThan(10)
    })

    it('should have parameter schema', () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })
      expect(tool.parameters).toBeDefined()
    })
  })

  describe('parameter validation', () => {
    it('should require query parameter', async () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({} as MemoryRecallParams)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('query')
      }
    })

    it('should reject empty query', async () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: '' })
      expect(result.success).toBe(false)
    })

    it('should reject query over 1000 characters', async () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const longQuery = 'a'.repeat(1001)
      const result = await tool.execute({ query: longQuery })
      expect(result.success).toBe(false)
    })

    it('should accept valid limit within range', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'test', limit: 10 })
      expect(mockGet).toHaveBeenCalled()
    })

    it('should reject limit above 20', async () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'test', limit: 21 })
      expect(result.success).toBe(false)
    })

    it('should reject limit below 1', async () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'test', limit: 0 })
      expect(result.success).toBe(false)
    })

    it('should accept valid category filter', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'test', category: 'preference' })
      expect(mockGet).toHaveBeenCalled()
    })

    it('should reject invalid category', async () => {
      const tool = createMemoryRecallTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({
        query: 'test',
        category: 'invalid' as MemoryRecallParams['category'],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('API interaction', () => {
    it('should call API with query and limit', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'coffee preferences', limit: 5 })

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/memories/search'),
        expect.objectContaining({ userId: 'agent-1' })
      )
    })

    it('should include category in API call when provided', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'coffee', category: 'preference' })

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('category=preference'),
        expect.any(Object)
      )
    })

    it('should use default limit of 5 when not specified', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'test' })

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('limit=5'),
        expect.any(Object)
      )
    })
  })

  describe('response formatting', () => {
    it('should format memories as bullet list', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [
            { id: '1', content: 'User prefers oat milk', category: 'preference', score: 0.95 },
            { id: '2', content: 'User birthday is March 15', category: 'fact', score: 0.85 },
          ],
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'user info' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.content).toContain('[preference]')
        expect(result.data.content).toContain('User prefers oat milk')
        expect(result.data.content).toContain('[fact]')
        expect(result.data.content).toContain('User birthday is March 15')
      }
    })

    it('should return count and memories in details', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [
            { id: '1', content: 'Memory 1', category: 'fact', score: 0.9 },
          ],
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.details.count).toBe(1)
        expect(result.data.details.memories).toHaveLength(1)
        expect(result.data.details.userId).toBe('agent-1')
      }
    })

    it('should handle empty results gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'nonexistent' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.content).toBe('No relevant memories found.')
        expect(result.data.details.count).toBe(0)
      }
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Server error')
      }
    })

    it('should handle network errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'))
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(false)
    })

    it('should not expose internal details in error messages', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused to internal-host:5432'))
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(false)
      if (!result.success) {
        // Should have a generic error, not expose internal details
        expect(result.error).not.toContain('5432')
        expect(result.error).not.toContain('internal-host')
      }
    })
  })

  describe('input sanitization', () => {
    it('should sanitize query with control characters', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      // Query with control characters
      await tool.execute({ query: 'test\x00\x1F query' })

      // Should have called API with sanitized query
      expect(mockGet).toHaveBeenCalled()
      const calledUrl = mockGet.mock.calls[0][0] as string
      expect(calledUrl).not.toContain('\x00')
      expect(calledUrl).not.toContain('\x1F')
    })

    it('should trim whitespace from query', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: '  test query  ' })

      const calledUrl = mockGet.mock.calls[0][0] as string
      // URLSearchParams encodes spaces as + (application/x-www-form-urlencoded)
      expect(calledUrl).toContain('q=test+query')
    })
  })

  describe('logging', () => {
    it('should log tool invocation at info level', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'test' })

      expect(mockLogger.info).toHaveBeenCalledWith(
        'memory_recall invoked',
        expect.objectContaining({ userId: 'agent-1' })
      )
    })

    it('should NOT log query content at info level', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'sensitive query about medical info' })

      // Check that info log doesn't contain the actual query
      const infoCalls = mockLogger.info.mock.calls
      for (const call of infoCalls) {
        const logMessage = JSON.stringify(call)
        expect(logMessage).not.toContain('sensitive query')
        expect(logMessage).not.toContain('medical info')
      }
    })

    it('should log errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Test error'))
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      })

      await tool.execute({ query: 'test' })

      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('user scoping', () => {
    it('should use provided userId for API calls', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user-123',
      })

      await tool.execute({ query: 'test' })

      expect(mockGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userId: 'custom-user-123' })
      )
    })

    it('should include userId in response details', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'my-agent',
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.details.userId).toBe('my-agent')
      }
    })
  })
})
