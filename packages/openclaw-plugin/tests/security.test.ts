/**
 * Security tests for the OpenClaw plugin.
 * Tests input validation, injection prevention, and credential protection.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { validateConfig } from '../src/config.js'
import {
  createMemoryRecallTool,
  createMemoryStoreTool,
  createMemoryForgetTool,
  createProjectListTool,
  createProjectGetTool,
  createProjectCreateTool,
  createTodoCreateTool,
  createTodoCompleteTool,
  createContactSearchTool,
  createContactGetTool,
  createContactCreateTool,
} from '../src/tools/index.js'
import type { ApiClient } from '../src/api-client.js'
import type { Logger } from '../src/logger.js'
import type { PluginConfig } from '../src/config.js'

describe('Security Tests', () => {
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

  const toolOptions = {
    client: mockApiClient,
    logger: mockLogger,
    config: mockConfig,
    userId: 'agent-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Input Validation - SQL Injection Prevention', () => {
    const sqlInjectionPayloads = [
      "'; DROP TABLE memories; --",
      '1 OR 1=1',
      "' UNION SELECT * FROM users --",
      "1'; DELETE FROM memories WHERE '1'='1",
      "admin'--",
      "1' AND '1'='1",
    ]

    it('should handle SQL injection in memory recall query', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of sqlInjectionPayloads) {
        const result = await tool.execute({ query: payload })
        // Should not throw, should return sanitized or valid result
        expect(result).toBeDefined()
      }
    })

    it('should handle SQL injection in contact search', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { contacts: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createContactSearchTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of sqlInjectionPayloads) {
        const result = await tool.execute({ query: payload })
        expect(result).toBeDefined()
      }
    })

    it('should handle SQL injection in project list filter', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { projects: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createProjectListTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of sqlInjectionPayloads) {
        // Using payload as status filter (should be validated)
        const result = await tool.execute({ status: payload as any })
        expect(result).toBeDefined()
      }
    })
  })

  describe('Input Validation - XSS Prevention', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src="x" onerror="alert(1)">',
      '"><script>document.location="http://evil.com"</script>',
      "javascript:alert('XSS')",
      '<svg onload="alert(1)">',
      '<body onload="alert(1)">',
      '"><img src=x onerror=alert(1)//>',
    ]

    it('should handle XSS in memory store content', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { memory: { id: '1', content: '', category: 'fact' } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of xssPayloads) {
        const result = await tool.execute({
          content: payload,
          category: 'fact',
        })
        expect(result).toBeDefined()
        // Content sent to API should be the raw payload (backend handles storage)
        // Output formatting should strip HTML
      }
    })

    it('should handle XSS in project name', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { project: { id: '1', name: '', status: 'active' } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createProjectCreateTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of xssPayloads) {
        const result = await tool.execute({
          name: payload,
        })
        expect(result).toBeDefined()
      }
    })

    it('should handle XSS in todo title', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { todo: { id: '1', title: '', completed: false } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createTodoCreateTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of xssPayloads) {
        const result = await tool.execute({
          title: payload,
        })
        expect(result).toBeDefined()
      }
    })

    it('should handle XSS in contact name', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { contact: { id: '1', name: '' } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createContactCreateTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const payload of xssPayloads) {
        const result = await tool.execute({
          name: payload,
        })
        expect(result).toBeDefined()
      }
    })
  })

  describe('Input Validation - Oversized Inputs', () => {
    it('should handle very long query strings', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      const longQuery = 'a'.repeat(10000)
      const result = await tool.execute({ query: longQuery })
      expect(result).toBeDefined()
    })

    it('should handle very long content in memory store', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { memory: { id: '1', content: '', category: 'fact' } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      const longContent = 'a'.repeat(100000)
      const result = await tool.execute({
        content: longContent,
        category: 'fact',
      })
      expect(result).toBeDefined()
    })

    it('should handle very long project descriptions', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { project: { id: '1', name: 'test', status: 'active' } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createProjectCreateTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      const longDescription = 'a'.repeat(100000)
      const result = await tool.execute({
        name: 'test',
        description: longDescription,
      })
      expect(result).toBeDefined()
    })
  })

  describe('Input Validation - Malformed UUIDs', () => {
    // UUIDs that are clearly malformed (non-empty but wrong format)
    const malformedUuids = [
      '123',
      'not-a-uuid',
      'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      '12345678-1234-1234-1234-12345678901', // Too short
      '12345678-1234-1234-1234-1234567890123', // Too long
      '12345678_1234_1234_1234_123456789012', // Wrong separator
      '../../../etc/passwd',
      '12345678-1234-1234-1234-123456789012\n',
      '12345678-1234-1234-1234-123456789012; DROP TABLE',
    ]

    it('should reject malformed UUIDs in project get', async () => {
      const tool = createProjectGetTool(toolOptions)

      for (const badId of malformedUuids) {
        const result = await tool.execute({ id: badId })
        expect(result.success).toBe(false)
        // Error should mention the validation failure
        expect(result.error?.toLowerCase()).toMatch(/invalid|required|format/)
      }
    })

    it('should reject malformed UUIDs in todo complete', async () => {
      const tool = createTodoCompleteTool(toolOptions)

      for (const badId of malformedUuids) {
        const result = await tool.execute({ id: badId })
        expect(result.success).toBe(false)
        expect(result.error?.toLowerCase()).toMatch(/invalid|required|format/)
      }
    })

    it('should reject malformed UUIDs in contact get', async () => {
      const tool = createContactGetTool(toolOptions)

      for (const badId of malformedUuids) {
        const result = await tool.execute({ id: badId })
        expect(result.success).toBe(false)
        expect(result.error?.toLowerCase()).toMatch(/invalid|required|format/)
      }
    })

    it('should reject malformed UUIDs in memory forget with id param', async () => {
      const tool = createMemoryForgetTool(toolOptions)

      for (const badId of malformedUuids) {
        const result = await tool.execute({ memoryId: badId })
        expect(result.success).toBe(false)
        // Either validation error or API error
        expect(result.error).toBeDefined()
      }
    })
  })

  describe('Input Validation - Invalid Date Formats', () => {
    const invalidDates = [
      'not-a-date',
      '2024/01/15', // Wrong separator
      '15-01-2024', // Wrong order
      '2024-1-15', // Missing leading zeros
      '2024-13-01', // Invalid month
      '2024-01-32', // Invalid day
      '2024-01-15T25:00:00Z', // Invalid hour
      '2024-01-15T12:60:00Z', // Invalid minute
    ]

    it('should reject invalid dates in todo dueDate', async () => {
      const tool = createTodoCreateTool(toolOptions)

      for (const badDate of invalidDates) {
        const result = await tool.execute({
          title: 'Test todo',
          dueDate: badDate,
        })
        expect(result.success).toBe(false)
        // Error message should mention invalid date (case-insensitive)
        expect(result.error?.toLowerCase()).toContain('invalid')
      }
    })
  })

  describe('Input Validation - Unicode Edge Cases', () => {
    const unicodeEdgeCases = [
      '\u0000', // Null byte
      '\u200B', // Zero-width space
      '\u200E', // Left-to-right mark
      '\u200F', // Right-to-left mark
      '\uFEFF', // BOM
      '🔐🔑', // Emojis
      'مرحبا', // Arabic
      '你好', // Chinese
      '\u202E', // Right-to-left override (can be used for spoofing)
      'test\u0000hidden', // Null byte in middle
    ]

    it('should handle unicode edge cases in memory content', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { memory: { id: '1', content: '', category: 'fact' } },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const content of unicodeEdgeCases) {
        const result = await tool.execute({
          content,
          category: 'fact',
        })
        expect(result).toBeDefined()
      }
    })

    it('should handle unicode edge cases in search queries', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      for (const query of unicodeEdgeCases) {
        const result = await tool.execute({ query })
        expect(result).toBeDefined()
      }
    })
  })

  describe('Credential Protection', () => {
    it('should not expose API key in config validation errors', () => {
      const secretKey = 'super-secret-api-key-12345'

      try {
        // Invalid config that might include the API key in error
        validateConfig({
          apiUrl: 'not-a-valid-url',
          apiKey: secretKey,
        })
      } catch (error) {
        const errorMessage = String(error)
        expect(errorMessage).not.toContain(secretKey)
      }
    })

    it('should not log API key in tool execution', async () => {
      const secretKey = 'super-secret-api-key-12345'
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: { ...mockConfig, apiKey: secretKey },
        userId: 'agent-1',
      })

      await tool.execute({ query: 'test' })

      // Check all logger calls don't contain the secret
      for (const method of ['info', 'warn', 'error', 'debug'] as const) {
        for (const call of (mockLogger[method] as ReturnType<typeof vi.fn>).mock.calls) {
          const logOutput = JSON.stringify(call)
          expect(logOutput).not.toContain(secretKey)
        }
      }
    })
  })

  describe('Error Message Sanitization', () => {
    it('should not expose internal paths in error messages', async () => {
      const mockGet = vi.fn().mockRejectedValue(
        new Error('ENOENT: no such file or directory, open /internal/path/to/secret')
      )
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).not.toContain('/internal/path')
    })

    it('should not expose database connection strings in errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(
        new Error('Connection failed: postgres://user:password@localhost/db')
      )
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(false)
      expect(result.error).not.toContain('postgres://')
      expect(result.error).not.toContain('password')
    })
  })

  describe('Authorization - User Isolation', () => {
    it('should include userId in all API requests', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const tool = createMemoryRecallTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
        userId: 'test-user-123',
      })

      await tool.execute({ query: 'test' })

      expect(mockGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userId: 'test-user-123' })
      )
    })

    it('should use configured userId consistently', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: '1', content: 'test', category: 'fact' },
      })
      const client = { ...mockApiClient, post: mockPost }

      const tool = createMemoryStoreTool({
        ...toolOptions,
        client: client as unknown as ApiClient,
        userId: 'isolated-user-456',
      })

      await tool.execute({ content: 'test content for memory', category: 'fact' })

      // The tool should call the API with the userId
      expect(mockPost).toHaveBeenCalled()
      const lastCall = mockPost.mock.calls[0]
      expect(lastCall[2]).toEqual(expect.objectContaining({ userId: 'isolated-user-456' }))
    })
  })

  describe('URL Validation', () => {
    it('should accept valid HTTPS URLs', () => {
      expect(() =>
        validateConfig({
          apiUrl: 'https://api.example.com',
          apiKey: 'test-key',
        })
      ).not.toThrow()
    })

    it('should accept HTTP URLs for local development', () => {
      expect(() =>
        validateConfig({
          apiUrl: 'http://localhost:3000',
          apiKey: 'test-key',
        })
      ).not.toThrow()
    })

    it('should reject invalid URLs', () => {
      expect(() =>
        validateConfig({
          apiUrl: 'not-a-valid-url',
          apiKey: 'test-key',
        })
      ).toThrow()
    })

    it('should reject empty URLs', () => {
      expect(() =>
        validateConfig({
          apiUrl: '',
          apiKey: 'test-key',
        })
      ).toThrow()
    })
  })
})
