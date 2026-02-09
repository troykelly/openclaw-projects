/**
 * Tests for CLI command handlers.
 * Covers status, users, recall, stats, and export commands.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createStatusCommand,
  createUsersCommand,
  createRecallCommand,
  createStatsCommand,
  createExportCommand,
  createCliCommands,
  type CliContext,
} from '../src/cli.js'
import type { ApiClient } from '../src/api-client.js'
import type { Logger } from '../src/logger.js'
import type { PluginConfig } from '../src/config.js'

describe('CLI Commands', () => {
  const mockLogger: Logger = {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockConfig: PluginConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key-secret-12345',
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

  const mockContext: CliContext = {
    client: mockApiClient,
    logger: mockLogger,
    config: mockConfig,
    userId: 'agent-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('status command', () => {
    it('should create a callable command function', () => {
      const command = createStatusCommand(mockContext)
      expect(typeof command).toBe('function')
    })

    it('should return success when API is healthy', async () => {
      const mockHealthCheck = vi.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      })
      const client = { ...mockApiClient, healthCheck: mockHealthCheck }

      const command = createStatusCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(true)
      expect(result.message).toContain('healthy')
      expect(result.data?.latencyMs).toBe(50)
    })

    it('should return failure when API is unhealthy', async () => {
      const mockHealthCheck = vi.fn().mockResolvedValue({
        healthy: false,
        latencyMs: 0,
      })
      const client = { ...mockApiClient, healthCheck: mockHealthCheck }

      const command = createStatusCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(false)
      expect(result.message).toContain('unhealthy')
    })

    it('should return failure on network error', async () => {
      const mockHealthCheck = vi.fn().mockRejectedValue(new Error('Connection refused'))
      const client = { ...mockApiClient, healthCheck: mockHealthCheck }

      const command = createStatusCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(false)
      expect(result.message).toContain('error')
    })

    it('should never display API key in output', async () => {
      const mockHealthCheck = vi.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      })
      const client = { ...mockApiClient, healthCheck: mockHealthCheck }

      const command = createStatusCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(JSON.stringify(result)).not.toContain('test-key-secret')
      expect(JSON.stringify(result)).not.toContain(mockConfig.apiKey)
    })

    it('should include API URL in status (without credentials)', async () => {
      const mockHealthCheck = vi.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      })
      const client = { ...mockApiClient, healthCheck: mockHealthCheck }

      const command = createStatusCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.data?.apiUrl).toBe('https://api.example.com')
    })
  })

  describe('users command', () => {
    it('should create a callable command function', () => {
      const command = createUsersCommand(mockContext)
      expect(typeof command).toBe('function')
    })

    it('should display current user scoping mode', async () => {
      const command = createUsersCommand(mockContext)
      const result = await command()

      expect(result.success).toBe(true)
      expect(result.data?.scopingMode).toBe('agent')
    })

    it('should explain agent scoping mode', async () => {
      const command = createUsersCommand({
        ...mockContext,
        config: { ...mockConfig, userScoping: 'agent' },
      })

      const result = await command()

      expect(result.data?.description).toContain('agent')
    })

    it('should explain identity scoping mode', async () => {
      const command = createUsersCommand({
        ...mockContext,
        config: { ...mockConfig, userScoping: 'identity' },
      })

      const result = await command()

      expect(result.data?.scopingMode).toBe('identity')
      expect(result.data?.description).toContain('identity')
    })

    it('should explain session scoping mode', async () => {
      const command = createUsersCommand({
        ...mockContext,
        config: { ...mockConfig, userScoping: 'session' },
      })

      const result = await command()

      expect(result.data?.scopingMode).toBe('session')
      expect(result.data?.description).toContain('session')
    })

    it('should include current userId', async () => {
      const command = createUsersCommand(mockContext)
      const result = await command()

      expect(result.data?.currentUserId).toBe('agent-1')
    })

    it('should never display API key', async () => {
      const command = createUsersCommand(mockContext)
      const result = await command()

      expect(JSON.stringify(result)).not.toContain('test-key-secret')
    })
  })

  describe('recall command', () => {
    it('should create a callable command function', () => {
      const command = createRecallCommand(mockContext)
      expect(typeof command).toBe('function')
    })

    it('should search memories with query', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [
            { id: '1', content: 'User prefers dark mode', score: 0.95 },
            { id: '2', content: 'User is in timezone UTC+10', score: 0.85 },
          ],
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createRecallCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command({ query: 'preferences' })

      expect(result.success).toBe(true)
      expect(result.data?.memories).toHaveLength(2)
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/memory/recall'),
        expect.any(Object)
      )
    })

    it('should support limit option', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createRecallCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      await command({ query: 'test', limit: 10 })

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      )
    })

    it('should use default limit when not specified', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createRecallCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      await command({ query: 'test' })

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('limit=5'),
        expect.any(Object)
      )
    })

    it('should return error when query is empty', async () => {
      const command = createRecallCommand(mockContext)
      const result = await command({ query: '' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('query')
    })

    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createRecallCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command({ query: 'test' })

      expect(result.success).toBe(false)
      expect(result.message).toContain('error')
    })

    it('should format memories for display', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [
            { id: '1', content: 'Memory content', score: 0.95, category: 'preference' },
          ],
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createRecallCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command({ query: 'test' })

      expect(result.data?.memories[0]).toHaveProperty('content')
      expect(result.data?.memories[0]).toHaveProperty('score')
    })
  })

  describe('stats command', () => {
    it('should create a callable command function', () => {
      const command = createStatsCommand(mockContext)
      expect(typeof command).toBe('function')
    })

    it('should fetch and display memory statistics', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          totalMemories: 42,
          byCategory: {
            preference: 15,
            fact: 20,
            decision: 5,
            context: 2,
          },
          recentActivity: {
            last24h: 5,
            last7d: 12,
          },
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createStatsCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(true)
      expect(result.data?.totalMemories).toBe(42)
      expect(result.data?.byCategory).toBeDefined()
    })

    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createStatsCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(false)
    })

    it('should call stats endpoint', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { totalMemories: 0, byCategory: {} },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createStatsCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      await command()

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/memory/stats'),
        expect.any(Object)
      )
    })
  })

  describe('export command', () => {
    it('should create a callable command function', () => {
      const command = createExportCommand(mockContext)
      expect(typeof command).toBe('function')
    })

    it('should fetch all memories for export', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [
            { id: '1', content: 'Memory 1', category: 'preference' },
            { id: '2', content: 'Memory 2', category: 'fact' },
          ],
          exportedAt: '2024-01-15T12:00:00Z',
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createExportCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(true)
      expect(result.data?.memories).toHaveLength(2)
    })

    it('should include export metadata', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [],
          exportedAt: '2024-01-15T12:00:00Z',
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createExportCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.data?.exportedAt).toBeDefined()
      expect(result.data?.userId).toBe('agent-1')
    })

    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createExportCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(result.success).toBe(false)
    })

    it('should support output path option', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [],
          exportedAt: '2024-01-15T12:00:00Z',
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createExportCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command({ output: '/tmp/export.json' })

      expect(result.data?.suggestedPath).toBe('/tmp/export.json')
    })

    it('should never include API key in export', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [{ id: '1', content: 'test' }],
          exportedAt: '2024-01-15T12:00:00Z',
        },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createExportCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      const result = await command()

      expect(JSON.stringify(result)).not.toContain('test-key-secret')
    })
  })

  describe('createCliCommands', () => {
    it('should create all command handlers', () => {
      const commands = createCliCommands(mockContext)

      expect(commands.status).toBeDefined()
      expect(commands.users).toBeDefined()
      expect(commands.recall).toBeDefined()
      expect(commands.stats).toBeDefined()
      expect(commands.export).toBeDefined()
    })

    it('should create callable functions for each command', () => {
      const commands = createCliCommands(mockContext)

      expect(typeof commands.status).toBe('function')
      expect(typeof commands.users).toBe('function')
      expect(typeof commands.recall).toBe('function')
      expect(typeof commands.stats).toBe('function')
      expect(typeof commands.export).toBe('function')
    })
  })

  describe('security', () => {
    it('should log CLI command execution without content', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [] },
      })
      const client = { ...mockApiClient, get: mockGet }

      const command = createRecallCommand({
        ...mockContext,
        client: client as unknown as ApiClient,
      })

      await command({ query: 'secret password info' })

      // Check that logger was called
      expect(mockLogger.info).toHaveBeenCalled()

      // Check that the query content is not logged at info level
      for (const call of (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls) {
        const logMessage = JSON.stringify(call)
        expect(logMessage).not.toContain('secret password')
      }
    })
  })
})
