/**
 * Tests for skill store search, collections, and aggregate tools (Issue #801).
 *
 * Covers:
 * - skill_store_search: parameter validation, full-text search, semantic search, fallback, filtering
 * - skill_store_collections: parameter validation, API calls, formatting
 * - skill_store_aggregate: parameter validation, operations (count, count_by_tag, count_by_status, latest, oldest)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createSkillStoreSearchTool,
  createSkillStoreCollectionsTool,
  createSkillStoreAggregateTool,
  SkillStoreSearchParamsSchema,
  SkillStoreCollectionsParamsSchema,
  SkillStoreAggregateParamsSchema,
} from '../../src/tools/skill-store.js'
import type { ApiClient } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'
import type { PluginConfig } from '../../src/config.js'

describe('Skill Store Search Tools (Issue #801)', () => {
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

  // ── skill_store_search ──────────────────────────────────────────────

  describe('skill_store_search', () => {
    const tool = createSkillStoreSearchTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_search')
      })

      it('has description mentioning search', () => {
        expect(tool.description).toBeDefined()
        expect(tool.description.toLowerCase()).toContain('search')
      })

      it('has parameter schema', () => {
        expect(tool.parameters).toBeDefined()
      })
    })

    describe('parameter validation', () => {
      it('requires skill_id', async () => {
        const result = await tool.execute({ query: 'test' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('skill_id')
        }
      })

      it('requires query', async () => {
        const result = await tool.execute({ skill_id: 'test' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('query')
        }
      })

      it('rejects empty query', async () => {
        const result = await tool.execute({ skill_id: 'test', query: '' })
        expect(result.success).toBe(false)
      })

      it('validates limit range', () => {
        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          limit: 0,
        }).success).toBe(false)

        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          limit: 201,
        }).success).toBe(false)

        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          limit: 50,
        }).success).toBe(true)
      })

      it('accepts optional filters', () => {
        const result = SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          collection: 'notes',
          tags: ['important'],
          semantic: true,
          min_similarity: 0.5,
          limit: 10,
          user_email: 'user@example.com',
        })
        expect(result.success).toBe(true)
      })

      it('validates min_similarity range', () => {
        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          min_similarity: -0.1,
        }).success).toBe(false)

        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          min_similarity: 1.1,
        }).success).toBe(false)

        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          min_similarity: 0.7,
        }).success).toBe(true)
      })
    })

    describe('full-text search (semantic: false)', () => {
      it('calls POST /api/skill-store/search', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: {
            results: [
              {
                id: 'item-1',
                skill_id: 'test',
                collection: 'notes',
                key: null,
                title: 'Meeting Notes',
                summary: 'Notes from standup',
                content: 'Discussed the roadmap',
                data: {},
                tags: ['meeting'],
                status: 'active',
                priority: 0,
                user_email: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                relevance: 0.85,
              },
            ],
            total: 1,
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          query: 'roadmap',
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/skill-store/search',
          expect.objectContaining({
            skill_id: 'test',
            query: 'roadmap',
          }),
          { userId: 'agent-1' }
        )

        if (result.success) {
          expect(result.data.content).toContain('Meeting Notes')
          expect(result.data.details.results).toHaveLength(1)
          expect(result.data.details.total).toBe(1)
        }
      })

      it('includes filters in request', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: { results: [], total: 0 },
        })

        await tool.execute({
          skill_id: 'test',
          query: 'hello',
          collection: 'notes',
          tags: ['important'],
          limit: 5,
          user_email: 'user@example.com',
        })

        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/skill-store/search',
          expect.objectContaining({
            skill_id: 'test',
            query: 'hello',
            collection: 'notes',
            tags: ['important'],
            limit: 5,
            user_email: 'user@example.com',
          }),
          { userId: 'agent-1' }
        )
      })
    })

    describe('semantic search (semantic: true)', () => {
      it('calls POST /api/skill-store/search/semantic', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: {
            results: [
              {
                id: 'item-2',
                skill_id: 'test',
                collection: 'notes',
                key: null,
                title: 'Design Doc',
                summary: 'Architecture overview',
                content: 'The system uses microservices',
                data: {},
                tags: [],
                status: 'active',
                priority: 0,
                user_email: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                similarity: 0.92,
              },
            ],
            search_type: 'semantic',
            query_embedding_provider: 'voyage',
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          query: 'system architecture',
          semantic: true,
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/skill-store/search/semantic',
          expect.objectContaining({
            skill_id: 'test',
            query: 'system architecture',
          }),
          { userId: 'agent-1' }
        )

        if (result.success) {
          expect(result.data.content).toContain('Design Doc')
          expect(result.data.details.search_type).toBe('semantic')
        }
      })

      it('includes min_similarity in semantic request', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: { results: [], search_type: 'semantic' },
        })

        await tool.execute({
          skill_id: 'test',
          query: 'hello',
          semantic: true,
          min_similarity: 0.8,
        })

        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/skill-store/search/semantic',
          expect.objectContaining({
            min_similarity: 0.8,
          }),
          { userId: 'agent-1' }
        )
      })

      it('reports fallback when semantic falls back to text', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: {
            results: [
              {
                id: 'item-3',
                skill_id: 'test',
                collection: '_default',
                key: null,
                title: 'Fallback Result',
                summary: null,
                content: 'Found via text',
                data: {},
                tags: [],
                status: 'active',
                priority: 0,
                user_email: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                similarity: 0.5,
              },
            ],
            search_type: 'text',
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          query: 'hello',
          semantic: true,
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.details.search_type).toBe('text')
        }
      })
    })

    describe('empty results', () => {
      it('returns friendly message when no results found', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: { results: [], total: 0 },
        })

        const result = await tool.execute({
          skill_id: 'test',
          query: 'nonexistent',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('No items found')
        }
      })
    })

    describe('error handling', () => {
      it('handles API errors', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        })

        const result = await tool.execute({
          skill_id: 'test',
          query: 'hello',
        })
        expect(result.success).toBe(false)
      })

      it('handles network exceptions', async () => {
        vi.mocked(mockApiClient.post).mockRejectedValue(new Error('Network timeout'))

        const result = await tool.execute({
          skill_id: 'test',
          query: 'hello',
        })
        expect(result.success).toBe(false)
      })
    })
  })

  // ── skill_store_collections ─────────────────────────────────────────

  describe('skill_store_collections', () => {
    const tool = createSkillStoreCollectionsTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_collections')
      })

      it('has description mentioning collections', () => {
        expect(tool.description).toBeDefined()
        expect(tool.description.toLowerCase()).toContain('collection')
      })
    })

    describe('parameter validation', () => {
      it('requires skill_id', async () => {
        const result = await tool.execute({})
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('skill_id')
        }
      })

      it('accepts optional user_email', () => {
        expect(SkillStoreCollectionsParamsSchema.safeParse({
          skill_id: 'test',
          user_email: 'user@example.com',
        }).success).toBe(true)
      })

      it('validates user_email format', () => {
        expect(SkillStoreCollectionsParamsSchema.safeParse({
          skill_id: 'test',
          user_email: 'not-an-email',
        }).success).toBe(false)
      })
    })

    describe('API interaction', () => {
      it('calls GET /api/skill-store/collections', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            collections: [
              { collection: 'notes', count: 15, latest_at: '2026-01-15T00:00:00Z' },
              { collection: 'config', count: 3, latest_at: '2026-01-10T00:00:00Z' },
            ],
          },
        })

        const result = await tool.execute({ skill_id: 'my-skill' })

        expect(result.success).toBe(true)
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('skill_id=my-skill'),
          { userId: 'agent-1' }
        )

        if (result.success) {
          expect(result.data.content).toContain('notes')
          expect(result.data.content).toContain('15')
          expect(result.data.content).toContain('config')
          expect(result.data.content).toContain('3')
          expect(result.data.details.collections).toHaveLength(2)
        }
      })

      it('includes user_email in request', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { collections: [] },
        })

        await tool.execute({
          skill_id: 'test',
          user_email: 'user@example.com',
        })

        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('user_email=user%40example.com'),
          { userId: 'agent-1' }
        )
      })

      it('handles empty collections', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { collections: [] },
        })

        const result = await tool.execute({ skill_id: 'empty-skill' })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('No collections found')
        }
      })

      it('handles API errors', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        })

        const result = await tool.execute({ skill_id: 'test' })
        expect(result.success).toBe(false)
      })
    })
  })

  // ── skill_store_aggregate ───────────────────────────────────────────

  describe('skill_store_aggregate', () => {
    const tool = createSkillStoreAggregateTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_aggregate')
      })

      it('has description mentioning aggregate', () => {
        expect(tool.description).toBeDefined()
        expect(tool.description.toLowerCase()).toContain('aggregat')
      })
    })

    describe('parameter validation', () => {
      it('requires skill_id', async () => {
        const result = await tool.execute({ operation: 'count' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('skill_id')
        }
      })

      it('requires operation', async () => {
        const result = await tool.execute({ skill_id: 'test' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('operation')
        }
      })

      it('validates operation enum', () => {
        const validOps = ['count', 'count_by_tag', 'count_by_status', 'latest', 'oldest']
        for (const op of validOps) {
          expect(SkillStoreAggregateParamsSchema.safeParse({
            skill_id: 'test',
            operation: op,
          }).success).toBe(true)
        }

        expect(SkillStoreAggregateParamsSchema.safeParse({
          skill_id: 'test',
          operation: 'invalid',
        }).success).toBe(false)
      })

      it('accepts optional filters', () => {
        expect(SkillStoreAggregateParamsSchema.safeParse({
          skill_id: 'test',
          operation: 'count',
          collection: 'notes',
          since: '2026-01-01T00:00:00Z',
          until: '2026-02-01T00:00:00Z',
          user_email: 'user@example.com',
        }).success).toBe(true)
      })
    })

    describe('count operation', () => {
      it('returns total count', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { count: 42 } },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count',
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('skill_id=test'),
          { userId: 'agent-1' }
        )
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('operation=count'),
          { userId: 'agent-1' }
        )

        if (result.success) {
          expect(result.data.content).toContain('42')
          expect(result.data.details.result).toEqual({ count: 42 })
        }
      })

      it('includes collection filter', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { count: 10 } },
        })

        await tool.execute({
          skill_id: 'test',
          operation: 'count',
          collection: 'notes',
        })

        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('collection=notes'),
          { userId: 'agent-1' }
        )
      })
    })

    describe('count_by_tag operation', () => {
      it('returns tag counts', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            result: {
              tags: [
                { tag: 'important', count: 10 },
                { tag: 'draft', count: 5 },
              ],
            },
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count_by_tag',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('important')
          expect(result.data.content).toContain('10')
          expect(result.data.content).toContain('draft')
          expect(result.data.content).toContain('5')
        }
      })
    })

    describe('count_by_status operation', () => {
      it('returns status counts', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            result: {
              statuses: [
                { status: 'active', count: 20 },
                { status: 'archived', count: 8 },
                { status: 'processing', count: 2 },
              ],
            },
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count_by_status',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('active')
          expect(result.data.content).toContain('20')
          expect(result.data.content).toContain('archived')
          expect(result.data.content).toContain('8')
        }
      })
    })

    describe('latest operation', () => {
      it('returns most recent item', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            result: {
              item: {
                id: 'latest-uuid',
                skill_id: 'test',
                collection: 'notes',
                key: null,
                title: 'Most Recent Note',
                status: 'active',
                created_at: '2026-02-01T12:00:00Z',
                updated_at: '2026-02-01T12:00:00Z',
              },
            },
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'latest',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('Most Recent Note')
          expect(result.data.details.result.item).toBeDefined()
        }
      })

      it('handles no items found', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { item: null } },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'latest',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('No items found')
        }
      })
    })

    describe('oldest operation', () => {
      it('returns oldest item', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            result: {
              item: {
                id: 'oldest-uuid',
                skill_id: 'test',
                collection: 'notes',
                key: null,
                title: 'First Note',
                status: 'active',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
              },
            },
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'oldest',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('First Note')
        }
      })
    })

    describe('time range filters', () => {
      it('includes since and until in request', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { count: 5 } },
        })

        await tool.execute({
          skill_id: 'test',
          operation: 'count',
          since: '2026-01-01T00:00:00Z',
          until: '2026-02-01T00:00:00Z',
        })

        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('since='),
          { userId: 'agent-1' }
        )
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('until='),
          { userId: 'agent-1' }
        )
      })
    })

    describe('error handling', () => {
      it('handles API errors', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count',
        })
        expect(result.success).toBe(false)
      })

      it('handles network exceptions', async () => {
        vi.mocked(mockApiClient.get).mockRejectedValue(new Error('Network timeout'))

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count',
        })
        expect(result.success).toBe(false)
      })
    })
  })

  // ── Issue #829 fixes ──────────────────────────────────────────────

  describe('Issue #829 fixes', () => {
    describe('search query max length', () => {
      it('rejects query over 2000 characters', () => {
        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'a'.repeat(2001),
        }).success).toBe(false)
      })

      it('accepts query at 2000 characters', () => {
        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'a'.repeat(2000),
        }).success).toBe(true)
      })
    })

    describe('aggregate handles malformed API responses', () => {
      const tool = createSkillStoreAggregateTool(toolOptions)

      it('handles count_by_tag with non-array tags', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { tags: 'not-an-array' } },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count_by_tag',
        })

        // Should not crash, should return a safe fallback
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toBeTruthy()
        }
      })

      it('handles count_by_status with non-array statuses', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { statuses: 'not-an-array' } },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'count_by_status',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toBeTruthy()
        }
      })

      it('handles latest with non-object item', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { result: { item: 'not-an-object' } },
        })

        const result = await tool.execute({
          skill_id: 'test',
          operation: 'latest',
        })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toBeTruthy()
        }
      })
    })

    describe('collection format validation in search', () => {
      it('rejects collection with path traversal', () => {
        expect(SkillStoreSearchParamsSchema.safeParse({
          skill_id: 'test',
          query: 'hello',
          collection: '../secrets',
        }).success).toBe(false)
      })
    })

    describe('collection format validation in aggregate', () => {
      it('rejects collection with path traversal', () => {
        expect(SkillStoreAggregateParamsSchema.safeParse({
          skill_id: 'test',
          operation: 'count',
          collection: '../secrets',
        }).success).toBe(false)
      })
    })
  })

  // ── Schema exports ──────────────────────────────────────────────────

  describe('Schema exports', () => {
    it('exports SkillStoreSearchParamsSchema', () => {
      expect(SkillStoreSearchParamsSchema).toBeDefined()
    })

    it('exports SkillStoreCollectionsParamsSchema', () => {
      expect(SkillStoreCollectionsParamsSchema).toBeDefined()
    })

    it('exports SkillStoreAggregateParamsSchema', () => {
      expect(SkillStoreAggregateParamsSchema).toBeDefined()
    })
  })
})
