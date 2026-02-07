/**
 * Tests for skill store tools (Issue #800).
 *
 * Covers:
 * - skill_store_put: parameter validation, data size, credential detection, API calls
 * - skill_store_get: by ID, by composite key, not found
 * - skill_store_list: filtering, pagination
 * - skill_store_delete: by ID, by composite key, not found
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  createSkillStorePutTool,
  createSkillStoreGetTool,
  createSkillStoreListTool,
  createSkillStoreDeleteTool,
  SkillStorePutParamsSchema,
  SkillStoreGetParamsSchema,
  SkillStoreListParamsSchema,
  SkillStoreDeleteParamsSchema,
} from '../../src/tools/skill-store.js'
import type { ApiClient } from '../../src/api-client.js'
import type { Logger } from '../../src/logger.js'
import type { PluginConfig } from '../../src/config.js'

describe('Skill Store Tools (Issue #800)', () => {
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

  // ── skill_store_put ──────────────────────────────────────────────────

  describe('skill_store_put', () => {
    const tool = createSkillStorePutTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_put')
      })

      it('has description', () => {
        expect(tool.description).toBeDefined()
        expect(tool.description.length).toBeGreaterThan(10)
      })

      it('has parameter schema', () => {
        expect(tool.parameters).toBeDefined()
      })
    })

    describe('parameter validation', () => {
      it('requires skill_id', async () => {
        const result = await tool.execute({ title: 'No skill' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('skill_id')
        }
      })

      it('rejects empty skill_id', async () => {
        const result = await tool.execute({ skill_id: '' })
        expect(result.success).toBe(false)
      })

      it('rejects skill_id with invalid characters', async () => {
        const result = await tool.execute({ skill_id: 'has spaces!' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('skill_id')
        }
      })

      it('rejects skill_id over 100 chars', async () => {
        const result = await tool.execute({ skill_id: 'a'.repeat(101) })
        expect(result.success).toBe(false)
      })

      it('accepts valid skill_id formats', () => {
        expect(SkillStorePutParamsSchema.safeParse({ skill_id: 'my-skill' }).success).toBe(true)
        expect(SkillStorePutParamsSchema.safeParse({ skill_id: 'my_skill_2' }).success).toBe(true)
        expect(SkillStorePutParamsSchema.safeParse({ skill_id: 'CamelCase' }).success).toBe(true)
      })

      it('rejects data exceeding 1MB', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: { id: '123' },
        })

        const result = await tool.execute({
          skill_id: 'test',
          data: { big: 'x'.repeat(1_048_577) },
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('1MB')
        }
      })
    })

    describe('credential detection', () => {
      it('warns on potential credentials in content', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: {
            id: '123',
            skill_id: 'test',
            collection: '_default',
            key: null,
            title: null,
            summary: null,
            content: 'sk-abcdefghijklmnopqrstuvwxyz',
            data: {},
            status: 'active',
            tags: [],
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        })

        await tool.execute({
          skill_id: 'test',
          content: 'sk-abcdefghijklmnopqrstuvwxyz',
        })

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Potential credential detected in skill_store_put',
          expect.objectContaining({ userId: 'agent-1' })
        )
      })
    })

    describe('API interaction', () => {
      it('calls POST /api/skill-store/items', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: {
            id: 'item-uuid',
            skill_id: 'my-skill',
            collection: 'config',
            key: 'settings',
            title: 'My Settings',
            summary: null,
            content: null,
            data: { theme: 'dark' },
            status: 'active',
            tags: [],
            pinned: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        })

        const result = await tool.execute({
          skill_id: 'my-skill',
          collection: 'config',
          key: 'settings',
          title: 'My Settings',
          data: { theme: 'dark' },
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/skill-store/items',
          expect.objectContaining({
            skill_id: 'my-skill',
            collection: 'config',
            key: 'settings',
            title: 'My Settings',
            data: { theme: 'dark' },
          }),
          { userId: 'agent-1' }
        )

        if (result.success) {
          expect(result.data.content).toContain('item-uuid')
          expect(result.data.details.id).toBe('item-uuid')
        }
      })

      it('handles API errors', async () => {
        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        })

        const result = await tool.execute({ skill_id: 'my-skill' })
        expect(result.success).toBe(false)
      })
    })
  })

  // ── skill_store_get ──────────────────────────────────────────────────

  describe('skill_store_get', () => {
    const tool = createSkillStoreGetTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_get')
      })
    })

    describe('parameter validation', () => {
      it('requires either id or (skill_id + key)', async () => {
        const result = await tool.execute({})
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('id')
        }
      })

      it('requires key when using skill_id', async () => {
        const result = await tool.execute({ skill_id: 'my-skill' })
        expect(result.success).toBe(false)
      })
    })

    describe('API interaction', () => {
      it('fetches by UUID', async () => {
        const mockItem = {
          id: '550e8400-e29b-41d4-a716-446655440000',
          skill_id: 'my-skill',
          collection: 'config',
          key: 'settings',
          title: 'My Settings',
          summary: null,
          content: null,
          data: { theme: 'dark' },
          status: 'active',
          tags: ['config'],
          pinned: false,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }

        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: mockItem,
        })

        const result = await tool.execute({
          id: '550e8400-e29b-41d4-a716-446655440000',
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.get).toHaveBeenCalledWith(
          '/api/skill-store/items/550e8400-e29b-41d4-a716-446655440000',
          { userId: 'agent-1' }
        )
      })

      it('fetches by composite key', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            id: 'some-uuid',
            skill_id: 'my-skill',
            collection: 'config',
            key: 'theme',
            title: null,
            summary: null,
            content: null,
            data: { color: 'blue' },
            status: 'active',
            tags: [],
            pinned: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        })

        const result = await tool.execute({
          skill_id: 'my-skill',
          collection: 'config',
          key: 'theme',
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('/api/skill-store/items/by-key'),
          { userId: 'agent-1' }
        )
      })

      it('returns not found for 404', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
        })

        const result = await tool.execute({
          id: '550e8400-e29b-41d4-a716-446655440000',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('not found')
        }
      })
    })
  })

  // ── skill_store_list ─────────────────────────────────────────────────

  describe('skill_store_list', () => {
    const tool = createSkillStoreListTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_list')
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

      it('validates limit range', () => {
        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          limit: 0,
        }).success).toBe(false)

        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          limit: 201,
        }).success).toBe(false)

        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          limit: 50,
        }).success).toBe(true)
      })

      it('validates status enum', () => {
        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          status: 'invalid',
        }).success).toBe(false)

        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          status: 'active',
        }).success).toBe(true)
      })
    })

    describe('API interaction', () => {
      it('calls GET /api/skill-store/items with query params', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            items: [
              { id: '1', skill_id: 'test', collection: '_default', key: null, title: 'Item 1', status: 'active', tags: [], data: {} },
              { id: '2', skill_id: 'test', collection: '_default', key: null, title: 'Item 2', status: 'active', tags: [], data: {} },
            ],
            total: 2,
            has_more: false,
          },
        })

        const result = await tool.execute({
          skill_id: 'test',
          collection: 'notes',
          limit: 10,
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('skill_id=test'),
          { userId: 'agent-1' }
        )

        if (result.success) {
          expect(result.data.content).toContain('2 items')
          expect(result.data.details.total).toBe(2)
        }
      })

      it('handles empty results', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: {
            items: [],
            total: 0,
            has_more: false,
          },
        })

        const result = await tool.execute({ skill_id: 'test' })

        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.content).toContain('No items found')
        }
      })
    })
  })

  // ── skill_store_delete ───────────────────────────────────────────────

  describe('skill_store_delete', () => {
    const tool = createSkillStoreDeleteTool(toolOptions)

    describe('tool metadata', () => {
      it('has correct name', () => {
        expect(tool.name).toBe('skill_store_delete')
      })
    })

    describe('parameter validation', () => {
      it('requires either id or (skill_id + key)', async () => {
        const result = await tool.execute({})
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('id')
        }
      })
    })

    describe('API interaction', () => {
      it('deletes by UUID', async () => {
        vi.mocked(mockApiClient.delete).mockResolvedValue({
          success: true,
          data: undefined,
        })

        const result = await tool.execute({
          id: '550e8400-e29b-41d4-a716-446655440000',
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.delete).toHaveBeenCalledWith(
          '/api/skill-store/items/550e8400-e29b-41d4-a716-446655440000',
          { userId: 'agent-1' }
        )
      })

      it('deletes by composite key (lookup then delete)', async () => {
        vi.mocked(mockApiClient.get).mockResolvedValue({
          success: true,
          data: { id: 'found-uuid', skill_id: 'test', collection: 'config', key: 'old' },
        })
        vi.mocked(mockApiClient.delete).mockResolvedValue({
          success: true,
          data: undefined,
        })

        const result = await tool.execute({
          skill_id: 'test',
          collection: 'config',
          key: 'old',
        })

        expect(result.success).toBe(true)
        expect(mockApiClient.get).toHaveBeenCalledWith(
          expect.stringContaining('/api/skill-store/items/by-key'),
          { userId: 'agent-1' }
        )
        expect(mockApiClient.delete).toHaveBeenCalledWith(
          '/api/skill-store/items/found-uuid',
          { userId: 'agent-1' }
        )
      })

      it('returns not found for 404', async () => {
        vi.mocked(mockApiClient.delete).mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
        })

        const result = await tool.execute({
          id: '550e8400-e29b-41d4-a716-446655440000',
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error).toContain('not found')
        }
      })
    })
  })

  // ── Input validation fixes (Issue #829) ─────────────────────────────

  describe('Issue #829 fixes', () => {
    describe('collection format validation', () => {
      it('rejects collection with path traversal', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          collection: '../etc/passwd',
        }).success).toBe(false)
      })

      it('rejects collection with control characters', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          collection: 'bad\x00collection',
        }).success).toBe(false)
      })

      it('rejects collection with spaces', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          collection: 'has spaces',
        }).success).toBe(false)
      })

      it('rejects collection with newlines', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          collection: 'line\nbreak',
        }).success).toBe(false)
      })

      it('accepts valid collection names', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          collection: 'my-collection_v2.0:latest',
        }).success).toBe(true)
      })
    })

    describe('key format validation', () => {
      it('rejects key with control characters', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          key: 'bad\x00key',
        }).success).toBe(false)
      })

      it('rejects key with newlines', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          key: 'line\nbreak',
        }).success).toBe(false)
      })

      it('accepts valid key names', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          key: 'user:settings/theme@v2',
        }).success).toBe(true)
      })
    })

    describe('credential detection on data field', () => {
      it('warns when data field contains potential credentials', async () => {
        const tool = createSkillStorePutTool(toolOptions)

        vi.mocked(mockApiClient.post).mockResolvedValue({
          success: true,
          data: {
            id: '123',
            skill_id: 'test',
            collection: '_default',
            key: null,
            title: null,
            summary: null,
            content: null,
            data: { api_key: 'sk-abcdefghijklmnopqrstuvwxyz' },
            status: 'active',
            tags: [],
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        })

        await tool.execute({
          skill_id: 'test',
          data: { api_key: 'sk-abcdefghijklmnopqrstuvwxyz' },
        })

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Potential credential detected in skill_store_put',
          expect.objectContaining({ userId: 'agent-1' })
        )
      })
    })

    describe('config is optional in tool options', () => {
      it('tools work without config property', async () => {
        const optionsWithoutConfig = {
          client: mockApiClient,
          logger: mockLogger,
          userId: 'agent-1',
        }
        // Should not throw — config is optional
        const tool = createSkillStorePutTool(optionsWithoutConfig as SkillStoreToolOptions)
        expect(tool.name).toBe('skill_store_put')
      })
    })
  })

  // ── Zod schema validation ────────────────────────────────────────────

  describe('Schema validation', () => {
    describe('SkillStorePutParamsSchema', () => {
      it('validates required skill_id', () => {
        expect(SkillStorePutParamsSchema.safeParse({}).success).toBe(false)
        expect(SkillStorePutParamsSchema.safeParse({ skill_id: 'test' }).success).toBe(true)
      })

      it('validates tags array', () => {
        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          tags: ['valid'],
        }).success).toBe(true)

        expect(SkillStorePutParamsSchema.safeParse({
          skill_id: 'test',
          tags: Array.from({ length: 51 }, () => 'tag'),
        }).success).toBe(false)
      })
    })

    describe('SkillStoreGetParamsSchema', () => {
      it('accepts id', () => {
        expect(SkillStoreGetParamsSchema.safeParse({
          id: '550e8400-e29b-41d4-a716-446655440000',
        }).success).toBe(true)
      })

      it('accepts skill_id + key', () => {
        expect(SkillStoreGetParamsSchema.safeParse({
          skill_id: 'test',
          key: 'settings',
        }).success).toBe(true)
      })

      it('rejects invalid UUID for id', () => {
        expect(SkillStoreGetParamsSchema.safeParse({
          id: 'not-a-uuid',
        }).success).toBe(false)
      })
    })

    describe('SkillStoreListParamsSchema', () => {
      it('requires skill_id', () => {
        expect(SkillStoreListParamsSchema.safeParse({}).success).toBe(false)
      })

      it('validates order_by enum', () => {
        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          order_by: 'created_at',
        }).success).toBe(true)

        expect(SkillStoreListParamsSchema.safeParse({
          skill_id: 'test',
          order_by: 'invalid',
        }).success).toBe(false)
      })
    })

    describe('SkillStoreDeleteParamsSchema', () => {
      it('accepts id', () => {
        expect(SkillStoreDeleteParamsSchema.safeParse({
          id: '550e8400-e29b-41d4-a716-446655440000',
        }).success).toBe(true)
      })

      it('accepts skill_id + key', () => {
        expect(SkillStoreDeleteParamsSchema.safeParse({
          skill_id: 'test',
          key: 'to-delete',
        }).success).toBe(true)
      })
    })
  })
})
