/**
 * Tests for note tools.
 * Part of Epic #339, Issues #359, #360, #361, #362
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createNoteCreateTool,
  createNoteGetTool,
  createNoteUpdateTool,
  createNoteDeleteTool,
  createNoteSearchTool,
  type NoteCreateParams,
  type NoteGetParams,
  type NoteUpdateParams,
  type NoteSearchParams,
} from '../../src/tools/notes.js'
import type { ApiClient } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'
import type { PluginConfig } from '../../src/config.js'

describe('note tools', () => {
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
    baseUrl: 'https://app.example.com',
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

  describe('note_create tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.name).toBe('note_create')
      })

      it('should have description', () => {
        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.description).toBeDefined()
        expect(tool.description).toContain('note')
      })

      it('should have parameter schema', () => {
        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.parameters).toBeDefined()
      })
    })

    describe('parameter validation', () => {
      it('should require title', async () => {
        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({ content: 'test' } as NoteCreateParams)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('title')
        }
      })

      it('should require content', async () => {
        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({ title: 'Test' } as NoteCreateParams)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('content')
        }
      })

      it('should reject too long title', async () => {
        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          title: 'a'.repeat(501),
          content: 'test',
        })
        expect(result.success).toBe(false)
      })
    })

    describe('execution', () => {
      it('should create note successfully', async () => {
        const mockNote = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Test Note',
          content: 'Test content',
          notebookId: null,
          visibility: 'private',
          createdAt: '2024-01-01T00:00:00Z',
        }

        ;(mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNote,
        })

        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          title: 'Test Note',
          content: 'Test content',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.id).toBe(mockNote.id)
          expect(result.data.title).toBe(mockNote.title)
          expect(result.data.url).toContain(mockNote.id)
        }
      })

      it('should handle API errors', async () => {
        ;(mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error' },
        })

        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          title: 'Test Note',
          content: 'Test content',
        })

        expect(result.success).toBe(false)
      })

      it('should sanitize text', async () => {
        ;(mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            title: 'Test Note',
            content: 'Test content',
            notebookId: null,
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
          },
        })

        const tool = createNoteCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        await tool.execute({
          title: 'Test\x00Note',
          content: 'Test\x0Bcontent',
        })

        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/notes',
          expect.objectContaining({
            title: 'TestNote',
            content: 'Testcontent',
          }),
          expect.anything()
        )
      })
    })
  })

  describe('note_get tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNoteGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.name).toBe('note_get')
      })
    })

    describe('parameter validation', () => {
      it('should require valid UUID for noteId', async () => {
        const tool = createNoteGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({ noteId: 'invalid' } as NoteGetParams)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('UUID')
        }
      })
    })

    describe('execution', () => {
      it('should get note successfully', async () => {
        const mockNote = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Test Note',
          content: 'Test content',
          notebookId: null,
          tags: ['tag1'],
          visibility: 'private',
          summary: null,
          isPinned: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        }

        ;(mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNote,
        })

        const tool = createNoteGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.id).toBe(mockNote.id)
          expect(result.data.content).toBe(mockNote.content)
        }
      })

      it('should handle not found', async () => {
        ;(mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Not found' },
        })

        const tool = createNoteGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('not found')
        }
      })
    })
  })

  describe('note_update tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNoteUpdateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.name).toBe('note_update')
      })
    })

    describe('parameter validation', () => {
      it('should require noteId', async () => {
        const tool = createNoteUpdateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({ title: 'New' } as NoteUpdateParams)
        expect(result.success).toBe(false)
      })

      it('should require at least one change', async () => {
        const tool = createNoteUpdateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('No changes')
        }
      })
    })

    describe('execution', () => {
      it('should update note successfully', async () => {
        const mockNote = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Updated Title',
          visibility: 'private',
          updatedAt: '2024-01-01T00:00:00Z',
        }

        ;(mockApiClient.put as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNote,
        })

        const tool = createNoteUpdateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Updated Title',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.title).toBe(mockNote.title)
          expect(result.data.changes).toContain('title')
        }
      })

      it('should handle 403 forbidden', async () => {
        ;(mockApiClient.put as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: { status: 403, message: 'Forbidden' },
        })

        const tool = createNoteUpdateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
          title: 'New Title',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('permission')
        }
      })
    })
  })

  describe('note_delete tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNoteDeleteTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.name).toBe('note_delete')
      })
    })

    describe('execution', () => {
      it('should delete note successfully', async () => {
        ;(mockApiClient.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: undefined,
        })

        const tool = createNoteDeleteTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.message).toContain('deleted')
        }
      })

      it('should handle 404 not found', async () => {
        ;(mockApiClient.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Not found' },
        })

        const tool = createNoteDeleteTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({
          noteId: '123e4567-e89b-12d3-a456-426614174000',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('not found')
        }
      })
    })
  })

  describe('undefined baseUrl handling', () => {
    const noBaseUrlConfig: PluginConfig = {
      ...mockConfig,
      baseUrl: undefined,
    }

    it('note_create should omit url when baseUrl is undefined', async () => {
      ;(mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Test Note',
          content: 'Test content',
          notebookId: null,
          visibility: 'private',
          createdAt: '2024-01-01T00:00:00Z',
        },
      })

      const tool = createNoteCreateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        userId: 'user@example.com',
      })

      const result = await tool.execute({
        title: 'Test Note',
        content: 'Test content',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.url).toBeUndefined()
        expect(JSON.stringify(result.data)).not.toContain('undefined')
      }
    })

    it('note_get should omit url when baseUrl is undefined', async () => {
      ;(mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Test Note',
          content: 'Test content',
          notebookId: null,
          tags: [],
          visibility: 'private',
          summary: null,
          isPinned: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      const tool = createNoteGetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        userId: 'user@example.com',
      })

      const result = await tool.execute({
        noteId: '123e4567-e89b-12d3-a456-426614174000',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.url).toBeUndefined()
        expect(JSON.stringify(result.data)).not.toContain('undefined')
      }
    })

    it('note_update should omit url when baseUrl is undefined', async () => {
      ;(mockApiClient.put as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Updated Title',
          visibility: 'private',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      const tool = createNoteUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        userId: 'user@example.com',
      })

      const result = await tool.execute({
        noteId: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Updated Title',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.url).toBeUndefined()
        expect(JSON.stringify(result.data)).not.toContain('undefined')
      }
    })

    it('note_search should omit url from results when baseUrl is undefined', async () => {
      ;(mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          query: 'test',
          searchType: 'hybrid',
          results: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              title: 'Test Note',
              snippet: 'Test content...',
              score: 0.95,
              tags: ['test'],
              visibility: 'private',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        },
      })

      const tool = createNoteSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        userId: 'user@example.com',
      })

      const result = await tool.execute({ query: 'test' })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.results[0].url).toBeUndefined()
        expect(JSON.stringify(result.data)).not.toContain('undefined')
      }
    })
  })

  describe('note_search tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNoteSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })
        expect(tool.name).toBe('note_search')
      })
    })

    describe('parameter validation', () => {
      it('should require query', async () => {
        const tool = createNoteSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({} as NoteSearchParams)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('query')
        }
      })
    })

    describe('execution', () => {
      it('should search notes successfully', async () => {
        const mockResults = {
          query: 'test',
          searchType: 'hybrid',
          results: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              title: 'Test Note',
              snippet: 'Test content...',
              score: 0.95,
              tags: ['test'],
              visibility: 'private',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }

        ;(mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockResults,
        })

        const tool = createNoteSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        const result = await tool.execute({ query: 'test' })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.query).toBe('test')
          expect(result.data.results.length).toBe(1)
          expect(result.data.results[0].url).toContain(mockResults.results[0].id)
        }
      })

      it('should pass isAgent flag', async () => {
        ;(mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: {
            query: 'test',
            searchType: 'hybrid',
            results: [],
            total: 0,
            limit: 20,
            offset: 0,
          },
        })

        const tool = createNoteSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'user@example.com',
        })

        await tool.execute({ query: 'test' })

        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('/api/notes/search'),
          expect.objectContaining({ isAgent: true })
        )
      })
    })
  })
})
