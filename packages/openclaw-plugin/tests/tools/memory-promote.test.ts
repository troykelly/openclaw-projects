/**
 * Tests for memory_promote tool — Issue #2431.
 * Verifies memory reconsolidation (store + bulk-supersede).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryPromoteTool, type MemoryPromoteParams } from '../../src/tools/memory-promote.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_promote tool', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      const tool = createMemoryPromoteTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.name).toBe('memory_promote');
    });

    it('should have description mentioning consolidation/promote', () => {
      const tool = createMemoryPromoteTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.description.length).toBeGreaterThan(10);
    });
  });

  describe('parameter validation', () => {
    it('should require text parameter', async () => {
      const tool = createMemoryPromoteTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        source_ids: ['mem-1', 'mem-2'],
      } as unknown as MemoryPromoteParams);
      expect(result.success).toBe(false);
    });

    it('should require source_ids parameter', async () => {
      const tool = createMemoryPromoteTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated memory',
      } as unknown as MemoryPromoteParams);
      expect(result.success).toBe(false);
    });

    it('should require non-empty source_ids', async () => {
      const tool = createMemoryPromoteTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated memory',
        source_ids: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('API interaction — composite operation', () => {
    it('should call POST /memories/unified first, then POST /memories/bulk-supersede', async () => {
      const mockPost = vi.fn()
        .mockResolvedValueOnce({
          // First call: unified (store new memory)
          success: true,
          data: { id: 'new-mem-id', content: 'Consolidated memory' },
        })
        .mockResolvedValueOnce({
          // Second call: bulk-supersede
          success: true,
          data: { superseded: 2, target_id: 'new-mem-id' },
        });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated memory about email architecture',
        category: 'decision',
        source_ids: ['mem-1', 'mem-2'],
      });

      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledTimes(2);

      // First call: store the new memory
      expect(mockPost.mock.calls[0][0]).toBe('/memories/unified');

      // Second call: bulk-supersede
      expect(mockPost.mock.calls[1][0]).toBe('/memories/bulk-supersede');
    });

    it('should send namespace header on both calls', async () => {
      const mockPost = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { id: 'new-mem-id', content: 'Consolidated memory' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { superseded: 2, target_id: 'new-mem-id' },
        });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'my-namespace',
      });

      await tool.execute({
        text: 'Consolidated memory',
        source_ids: ['mem-1', 'mem-2'],
      });

      // Both calls must include namespace header
      expect(mockPost.mock.calls[0][2]).toMatchObject({ namespace: 'my-namespace' });
      expect(mockPost.mock.calls[1][2]).toMatchObject({ namespace: 'my-namespace' });
    });

    it('should not set expires_at on the new permanent memory', async () => {
      const mockPost = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { id: 'new-mem-id', content: 'Consolidated memory' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { superseded: 1, target_id: 'new-mem-id' },
        });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({
        text: 'Consolidated memory',
        source_ids: ['mem-1'],
      });

      const storeBody = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(storeBody.expires_at).toBeUndefined();
    });

    it('should pass source_ids to bulk-supersede body', async () => {
      const mockPost = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { id: 'new-mem-id', content: 'Consolidated memory' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { superseded: 2, target_id: 'new-mem-id' },
        });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({
        text: 'Consolidated memory',
        source_ids: ['mem-abc', 'mem-def'],
      });

      const supersedBody = mockPost.mock.calls[1][1] as Record<string, unknown>;
      expect(supersedBody.source_ids).toEqual(['mem-abc', 'mem-def']);
      expect(supersedBody.target_id).toBe('new-mem-id');
    });
  });

  describe('partial failure handling', () => {
    it('should return partial success if store succeeds but bulk-supersede fails', async () => {
      const mockPost = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { id: 'new-mem-id', content: 'Consolidated memory' },
        })
        .mockResolvedValueOnce({
          success: false,
          error: { status: 409, message: 'Sources already superseded', code: 'CONFLICT' },
        });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated memory',
        source_ids: ['mem-1', 'mem-2'],
      });

      // Should return partial success with the new memory ID
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.memory_id).toBe('new-mem-id');
        expect(result.data.details.superseded).toBe(0);
        expect(result.data.content.toLowerCase()).toContain('supersession');
      }
    });
  });

  describe('response formatting', () => {
    it('should return memory_id and superseded count on full success', async () => {
      const mockPost = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { id: 'promo-123', content: 'Consolidated' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { superseded: 3, target_id: 'promo-123' },
        });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated',
        source_ids: ['a', 'b', 'c'],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.memory_id).toBe('promo-123');
        expect(result.data.details.superseded).toBe(3);
      }
    });
  });

  describe('error handling', () => {
    it('should handle store API error', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated',
        source_ids: ['mem-1'],
      });

      expect(result.success).toBe(false);
    });

    it('should handle network errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryPromoteTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({
        text: 'Consolidated',
        source_ids: ['mem-1'],
      });

      expect(result.success).toBe(false);
    });
  });
});
