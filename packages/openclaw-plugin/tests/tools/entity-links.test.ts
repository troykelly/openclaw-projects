/**
 * Tests for entity linking tools.
 * Covers links_set, links_query, and links_remove.
 * Part of Issue #1220
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createLinksSetTool,
  createLinksQueryTool,
  createLinksRemoveTool,
  LinksSetParamsSchema,
  LinksQueryParamsSchema,
  LinksRemoveParamsSchema,
  type EntityLinkToolOptions,
} from '../../src/tools/entity-links.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('entity link tools', () => {
  const mockLogger: Logger = {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

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
  };

  const mockApiClient = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    healthCheck: vi.fn(),
  } as unknown as ApiClient;

  const toolOptions: EntityLinkToolOptions = {
    client: mockApiClient,
    logger: mockLogger,
    config: mockConfig,
    userId: 'agent-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== links_set ====================

  describe('links_set', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createLinksSetTool(toolOptions);
        expect(tool.name).toBe('links_set');
      });

      it('should have a descriptive description', () => {
        const tool = createLinksSetTool(toolOptions);
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.description).toContain('link');
      });

      it('should have valid zod parameter schema', () => {
        const tool = createLinksSetTool(toolOptions);
        expect(tool.parameters).toBe(LinksSetParamsSchema);
      });
    });

    describe('parameter validation', () => {
      it('should require source_type', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require source_id', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require target_type', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require target_ref', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should validate source_type enum', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'invalid_type',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });

      it('should validate target_type enum', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'invalid_type',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });

      it('should validate source_id is UUID', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: 'not-a-uuid',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });

      it('should reject empty target_ref', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '',
        });
        expect(result.success).toBe(false);
      });

      it('should reject non-UUID target_ref for internal target_type', async () => {
        const tool = createLinksSetTool(toolOptions);
        for (const internalType of ['memory', 'todo', 'project', 'contact'] as const) {
          const result = await tool.execute({
            source_type: 'todo',
            source_id: '019c5ae8-0000-0000-0000-000000000001',
            target_type: internalType,
            target_ref: 'not-a-uuid',
          });
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error).toContain('UUID');
          }
        }
      });

      it('should allow non-UUID target_ref for github_issue target_type', async () => {
        const result = LinksSetParamsSchema.safeParse({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'github_issue',
          target_ref: 'owner/repo#123',
        });
        expect(result.success).toBe(true);
      });

      it('should allow non-UUID target_ref for url target_type', async () => {
        const result = LinksSetParamsSchema.safeParse({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'url',
          target_ref: 'https://example.com/page',
        });
        expect(result.success).toBe(true);
      });

      it('should accept optional label', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'todo:019c5ae8-0000-0000-0000-000000000001:project:019c5ae8-0000-0000-0000-000000000002', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
          label: 'spawned from',
        });
        expect(result.success).toBe(true);
      });

      it('should reject label over 100 characters', async () => {
        const tool = createLinksSetTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
          label: 'a'.repeat(101),
        });
        expect(result.success).toBe(false);
      });

      it('should accept github_issue as target_type with owner/repo#N ref', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'todo:019c5ae8-0000-0000-0000-000000000001:github_issue:troykelly/openclaw-projects#1220', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'github_issue',
          target_ref: 'troykelly/openclaw-projects#1220',
        });
        expect(result.success).toBe(true);
      });

      it('should accept url as target_type', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'todo:019c5ae8-0000-0000-0000-000000000001:url:https://example.com', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'url',
          target_ref: 'https://example.com',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('API interaction', () => {
      it('should create two skill_store items for bidirectional link', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        // Should create forward link (A->B) and reverse link (B->A)
        expect(mockPost).toHaveBeenCalledTimes(2);
      });

      it('should use entity_links collection', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(mockPost).toHaveBeenCalledWith(
          '/api/skill-store/items',
          expect.objectContaining({ collection: 'entity_links' }),
          expect.objectContaining({ userId: 'agent-1' }),
        );
      });

      it('should construct composite key from source and target', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
          label: 'tracks',
        });

        // Forward link key: source_type:source_id:target_type:target_ref
        expect(mockPost).toHaveBeenCalledWith(
          '/api/skill-store/items',
          expect.objectContaining({
            key: 'todo:019c5ae8-0000-0000-0000-000000000001:project:019c5ae8-0000-0000-0000-000000000002',
          }),
          expect.any(Object),
        );

        // Reverse link key: target_type:target_ref:source_type:source_id
        expect(mockPost).toHaveBeenCalledWith(
          '/api/skill-store/items',
          expect.objectContaining({
            key: 'project:019c5ae8-0000-0000-0000-000000000002:todo:019c5ae8-0000-0000-0000-000000000001',
          }),
          expect.any(Object),
        );
      });

      it('should store link data with source, target, label, and created_at', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
          label: 'tracks',
        });

        // Verify forward link data payload
        expect(mockPost).toHaveBeenCalledWith(
          '/api/skill-store/items',
          expect.objectContaining({
            data: expect.objectContaining({
              source_type: 'todo',
              source_id: '019c5ae8-0000-0000-0000-000000000001',
              target_type: 'project',
              target_ref: '019c5ae8-0000-0000-0000-000000000002',
              label: 'tracks',
              created_at: expect.any(String),
            }),
          }),
          expect.any(Object),
        );
      });

      it('should include tags for efficient lookup', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        // Forward link should have tag for source entity lookup
        expect(mockPost).toHaveBeenCalledWith(
          '/api/skill-store/items',
          expect.objectContaining({
            key: 'todo:019c5ae8-0000-0000-0000-000000000001:project:019c5ae8-0000-0000-0000-000000000002',
            tags: expect.arrayContaining(['src:todo:019c5ae8-0000-0000-0000-000000000001']),
          }),
          expect.any(Object),
        );
      });
    });

    describe('response formatting', () => {
      it('should return success with link details', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
          label: 'tracks',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('todo');
          expect(result.data.content).toContain('project');
          expect(result.data.details).toHaveProperty('source_type', 'todo');
          expect(result.data.details).toHaveProperty('target_type', 'project');
        }
      });
    });

    describe('error handling', () => {
      it('should handle API errors gracefully', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });

      it('should handle network errors', async () => {
        const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });

      it('should not expose internal details in error messages', async () => {
        const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).not.toContain('5432');
          expect(result.error).not.toContain('internal-db');
        }
      });

      it('should rollback forward link when reverse link creation fails', async () => {
        const mockPost = vi.fn()
          .mockResolvedValueOnce({
            success: true,
            data: { id: 'fwd-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
          })
          .mockResolvedValueOnce({
            success: false,
            error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
          });
        const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
        const client = { ...mockApiClient, post: mockPost, delete: mockDelete };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        // Should attempt to delete the orphaned forward link
        expect(mockDelete).toHaveBeenCalledWith('/api/skill-store/items/fwd-1', expect.any(Object));
      });

      it('should report partial state when rollback also fails', async () => {
        const mockPost = vi.fn()
          .mockResolvedValueOnce({
            success: true,
            data: { id: 'fwd-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
          })
          .mockResolvedValueOnce({
            success: false,
            error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
          });
        const mockDelete = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Delete failed' },
        });
        const client = { ...mockApiClient, post: mockPost, delete: mockDelete };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('partial');
        }
      });
    });

    describe('user scoping', () => {
      it('should include userId in API calls', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'item-1', skill_id: 'entity-links', collection: 'entity_links', key: 'test', data: {}, tags: [], status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', title: null, summary: null, content: null, media_url: null, media_type: null, source_url: null, priority: null, expires_at: null, pinned: false, user_email: null },
        });
        const client = { ...mockApiClient, post: mockPost };
        const tool = createLinksSetTool({ ...toolOptions, client: client as unknown as ApiClient, userId: 'custom-user' });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Object),
          expect.objectContaining({ userId: 'custom-user' }),
        );
      });
    });
  });

  // ==================== links_query ====================

  describe('links_query', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createLinksQueryTool(toolOptions);
        expect(tool.name).toBe('links_query');
      });

      it('should have a descriptive description', () => {
        const tool = createLinksQueryTool(toolOptions);
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.description).toContain('link');
      });

      it('should have valid zod parameter schema', () => {
        const tool = createLinksQueryTool(toolOptions);
        expect(tool.parameters).toBe(LinksQueryParamsSchema);
      });
    });

    describe('parameter validation', () => {
      it('should require entity_type', async () => {
        const tool = createLinksQueryTool(toolOptions);
        const result = await tool.execute({
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require entity_id', async () => {
        const tool = createLinksQueryTool(toolOptions);
        const result = await tool.execute({
          entity_type: 'todo',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should validate entity_type enum', async () => {
        const tool = createLinksQueryTool(toolOptions);
        const result = await tool.execute({
          entity_type: 'invalid',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });
        expect(result.success).toBe(false);
      });

      it('should validate entity_id is UUID', async () => {
        const tool = createLinksQueryTool(toolOptions);
        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
      });

      it('should accept optional link_types filter', () => {
        const result = LinksQueryParamsSchema.safeParse({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
          link_types: ['project', 'memory'],
        });
        expect(result.success).toBe(true);
      });
    });

    describe('API interaction', () => {
      it('should query skill_store items by collection and tags', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, has_more: false },
        });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });

        expect(mockGet).toHaveBeenCalledWith(
          expect.stringContaining('collection=entity_links'),
          expect.objectContaining({ userId: 'agent-1' }),
        );
        expect(mockGet).toHaveBeenCalledWith(
          expect.stringContaining('tags=src%3Atodo%3A019c5ae8-0000-0000-0000-000000000001'),
          expect.any(Object),
        );
      });
    });

    describe('response formatting', () => {
      it('should return empty message when no links found', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, has_more: false },
        });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('No links found');
        }
      });

      it('should format found links as readable list', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            items: [
              {
                id: 'item-1',
                skill_id: 'entity-links',
                collection: 'entity_links',
                key: 'todo:019c5ae8-0000-0000-0000-000000000001:project:019c5ae8-0000-0000-0000-000000000002',
                data: {
                  source_type: 'todo',
                  source_id: '019c5ae8-0000-0000-0000-000000000001',
                  target_type: 'project',
                  target_ref: '019c5ae8-0000-0000-0000-000000000002',
                  label: 'tracks',
                  created_at: '2026-01-01T00:00:00Z',
                },
                tags: ['src:todo:019c5ae8-0000-0000-0000-000000000001'],
                status: 'active',
                priority: null,
                user_email: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                title: null,
                summary: null,
                content: null,
                media_url: null,
                media_type: null,
                source_url: null,
                expires_at: null,
                pinned: false,
              },
            ],
            total: 1,
            has_more: false,
          },
        });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('project');
          expect(result.data.content).toContain('tracks');
          expect(result.data.details).toHaveProperty('links');
          expect((result.data.details.links as unknown[]).length).toBe(1);
        }
      });

      it('should filter by link_types when specified', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            items: [
              {
                id: 'item-1',
                collection: 'entity_links',
                key: 'todo:019c5ae8-0000-0000-0000-000000000001:project:019c5ae8-0000-0000-0000-000000000002',
                data: {
                  source_type: 'todo',
                  source_id: '019c5ae8-0000-0000-0000-000000000001',
                  target_type: 'project',
                  target_ref: '019c5ae8-0000-0000-0000-000000000002',
                  label: null,
                  created_at: '2026-01-01T00:00:00Z',
                },
                tags: [],
                status: 'active',
              },
              {
                id: 'item-2',
                collection: 'entity_links',
                key: 'todo:019c5ae8-0000-0000-0000-000000000001:memory:019c5ae8-0000-0000-0000-000000000003',
                data: {
                  source_type: 'todo',
                  source_id: '019c5ae8-0000-0000-0000-000000000001',
                  target_type: 'memory',
                  target_ref: '019c5ae8-0000-0000-0000-000000000003',
                  label: null,
                  created_at: '2026-01-01T00:00:00Z',
                },
                tags: [],
                status: 'active',
              },
            ],
            total: 2,
            has_more: false,
          },
        });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
          link_types: ['project'],
        });

        expect(result.success).toBe(true);
        if (result.success) {
          const links = result.data.details.links as Array<{ target_type: string }>;
          expect(links.length).toBe(1);
          expect(links[0].target_type).toBe('project');
        }
      });
    });

    describe('error handling', () => {
      it('should handle API errors gracefully', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });
        expect(result.success).toBe(false);
      });

      it('should handle network errors', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });
        expect(result.success).toBe(false);
      });

      it('should not expose internal details in error messages', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksQueryTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          entity_type: 'todo',
          entity_id: '019c5ae8-0000-0000-0000-000000000001',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).not.toContain('5432');
          expect(result.error).not.toContain('internal-db');
        }
      });
    });
  });

  // ==================== links_remove ====================

  describe('links_remove', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createLinksRemoveTool(toolOptions);
        expect(tool.name).toBe('links_remove');
      });

      it('should have a descriptive description', () => {
        const tool = createLinksRemoveTool(toolOptions);
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.description).toContain('link');
      });

      it('should have valid zod parameter schema', () => {
        const tool = createLinksRemoveTool(toolOptions);
        expect(tool.parameters).toBe(LinksRemoveParamsSchema);
      });
    });

    describe('parameter validation', () => {
      it('should require source_type', async () => {
        const tool = createLinksRemoveTool(toolOptions);
        const result = await tool.execute({
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require source_id', async () => {
        const tool = createLinksRemoveTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require target_type', async () => {
        const tool = createLinksRemoveTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should require target_ref', async () => {
        const tool = createLinksRemoveTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
        } as Record<string, unknown>);
        expect(result.success).toBe(false);
      });

      it('should validate source_id is UUID', async () => {
        const tool = createLinksRemoveTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: 'not-a-uuid',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('API interaction', () => {
      it('should look up both forward and reverse items by key', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({
            success: true,
            data: { id: 'fwd-1', key: 'todo:019c5ae8-0000-0000-0000-000000000001:project:019c5ae8-0000-0000-0000-000000000002' },
          })
          .mockResolvedValueOnce({
            success: true,
            data: { id: 'rev-1', key: 'project:019c5ae8-0000-0000-0000-000000000002:todo:019c5ae8-0000-0000-0000-000000000001' },
          });
        const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
        const client = { ...mockApiClient, get: mockGet, delete: mockDelete };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        // Should look up both forward and reverse items
        expect(mockGet).toHaveBeenCalledTimes(2);
        // Should delete both
        expect(mockDelete).toHaveBeenCalledTimes(2);
      });

      it('should delete both forward and reverse link items', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({
            success: true,
            data: { id: 'fwd-1' },
          })
          .mockResolvedValueOnce({
            success: true,
            data: { id: 'rev-1' },
          });
        const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
        const client = { ...mockApiClient, get: mockGet, delete: mockDelete };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(mockDelete).toHaveBeenCalledWith('/api/skill-store/items/fwd-1', expect.any(Object));
        expect(mockDelete).toHaveBeenCalledWith('/api/skill-store/items/rev-1', expect.any(Object));
      });
    });

    describe('response formatting', () => {
      it('should return success confirmation', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({ success: true, data: { id: 'fwd-1' } })
          .mockResolvedValueOnce({ success: true, data: { id: 'rev-1' } });
        const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
        const client = { ...mockApiClient, get: mockGet, delete: mockDelete };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Removed link');
        }
      });

      it('should handle case where forward link not found', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({ success: false, error: { status: 404, message: 'Not found' } })
          .mockResolvedValueOnce({ success: false, error: { status: 404, message: 'Not found' } });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('not found');
        }
      });
    });

    describe('error handling', () => {
      it('should handle network errors', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });
        expect(result.success).toBe(false);
      });

      it('should not expose internal details in error messages', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).not.toContain('5432');
          expect(result.error).not.toContain('internal-db');
        }
      });

      it('should report failure when a delete operation fails', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({ success: true, data: { id: 'fwd-1' } })
          .mockResolvedValueOnce({ success: true, data: { id: 'rev-1' } });
        const mockDelete = vi.fn()
          .mockResolvedValueOnce({ success: true, data: {} })
          .mockResolvedValueOnce({ success: false, error: { status: 500, message: 'Delete failed', code: 'SERVER_ERROR' } });
        const client = { ...mockApiClient, get: mockGet, delete: mockDelete };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('partial');
        }
      });

      it('should differentiate non-404 lookup errors from not-found', async () => {
        // Both lookups return non-404 errors (e.g. 500)
        const mockGet = vi.fn()
          .mockResolvedValueOnce({ success: false, error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' } })
          .mockResolvedValueOnce({ success: false, error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' } });
        const client = { ...mockApiClient, get: mockGet };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          // Should NOT say "not found" since it's a server error, not 404
          expect(result.error).not.toContain('not found');
        }
      });

      it('should refuse to delete when one lookup succeeds and the other returns non-404 error', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({ success: true, data: { id: 'fwd-1' } })
          .mockResolvedValueOnce({ success: false, error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' } });
        const mockDelete = vi.fn();
        const client = { ...mockApiClient, get: mockGet, delete: mockDelete };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'project',
          target_ref: '019c5ae8-0000-0000-0000-000000000002',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('Server error');
        }
        // Must NOT attempt any deletes — that would leave one-sided state
        expect(mockDelete).not.toHaveBeenCalled();
      });

      it('should reject non-UUID target_ref for internal target_type', async () => {
        const tool = createLinksRemoveTool(toolOptions);
        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'contact',
          target_ref: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('UUID');
        }
      });

      it('should allow non-UUID target_ref for external target_type in remove', async () => {
        const mockGet = vi.fn()
          .mockResolvedValueOnce({ success: true, data: { id: 'fwd-1' } })
          .mockResolvedValueOnce({ success: true, data: { id: 'rev-1' } });
        const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
        const client = { ...mockApiClient, get: mockGet, delete: mockDelete };
        const tool = createLinksRemoveTool({ ...toolOptions, client: client as unknown as ApiClient });

        const result = await tool.execute({
          source_type: 'todo',
          source_id: '019c5ae8-0000-0000-0000-000000000001',
          target_type: 'github_issue',
          target_ref: 'owner/repo#42',
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==================== schema validation tests ====================

  describe('Zod schema validation', () => {
    it('LinksSetParamsSchema should validate correct input', () => {
      const result = LinksSetParamsSchema.safeParse({
        source_type: 'todo',
        source_id: '019c5ae8-0000-0000-0000-000000000001',
        target_type: 'project',
        target_ref: '019c5ae8-0000-0000-0000-000000000002',
      });
      expect(result.success).toBe(true);
    });

    it('LinksSetParamsSchema should accept optional label', () => {
      const result = LinksSetParamsSchema.safeParse({
        source_type: 'memory',
        source_id: '019c5ae8-0000-0000-0000-000000000001',
        target_type: 'contact',
        target_ref: '019c5ae8-0000-0000-0000-000000000002',
        label: 'related to',
      });
      expect(result.success).toBe(true);
    });

    it('LinksSetParamsSchema should reject missing required fields', () => {
      const result = LinksSetParamsSchema.safeParse({
        source_type: 'todo',
      });
      expect(result.success).toBe(false);
    });

    it('LinksQueryParamsSchema should validate correct input', () => {
      const result = LinksQueryParamsSchema.safeParse({
        entity_type: 'todo',
        entity_id: '019c5ae8-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
    });

    it('LinksQueryParamsSchema should accept optional link_types', () => {
      const result = LinksQueryParamsSchema.safeParse({
        entity_type: 'project',
        entity_id: '019c5ae8-0000-0000-0000-000000000001',
        link_types: ['todo', 'memory', 'github_issue'],
      });
      expect(result.success).toBe(true);
    });

    it('LinksQueryParamsSchema should reject missing entity_type', () => {
      const result = LinksQueryParamsSchema.safeParse({
        entity_id: '019c5ae8-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(false);
    });

    it('LinksRemoveParamsSchema should validate correct input', () => {
      const result = LinksRemoveParamsSchema.safeParse({
        source_type: 'todo',
        source_id: '019c5ae8-0000-0000-0000-000000000001',
        target_type: 'project',
        target_ref: '019c5ae8-0000-0000-0000-000000000002',
      });
      expect(result.success).toBe(true);
    });

    it('LinksRemoveParamsSchema should reject invalid source_type', () => {
      const result = LinksRemoveParamsSchema.safeParse({
        source_type: 'invalid',
        source_id: '019c5ae8-0000-0000-0000-000000000001',
        target_type: 'project',
        target_ref: '019c5ae8-0000-0000-0000-000000000002',
      });
      expect(result.success).toBe(false);
    });
  });
});
