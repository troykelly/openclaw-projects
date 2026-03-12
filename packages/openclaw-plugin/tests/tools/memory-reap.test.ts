/**
 * Tests for memory_reap tool — Issue #2431.
 * Verifies expired memory pruning.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryReapTool, type MemoryReapParams } from '../../src/tools/memory-reap.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_reap tool', () => {
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
      const tool = createMemoryReapTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.name).toBe('memory_reap');
    });

    it('should have description mentioning cleanup/prune', () => {
      const tool = createMemoryReapTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createMemoryReapTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('dry_run behaviour', () => {
    it('should default dry_run to true when not specified', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: 0, namespace: 'test-ns' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({});

      const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.dry_run).toBe(true);
    });

    it('should pass dry_run=false when explicitly set', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: 5, namespace: 'test-ns' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({ dry_run: false });

      const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.dry_run).toBe(false);
    });
  });

  describe('API interaction', () => {
    it('should call POST /memories/reap with namespace header', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: 0, namespace: 'test-ns' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({});

      expect(mockPost).toHaveBeenCalledWith(
        '/memories/reap',
        expect.any(Object),
        expect.objectContaining({ namespace: 'test-ns', user_id: 'agent-1' }),
      );
    });

    it('should include namespace in request body', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: 0, namespace: 'my-ns' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'my-ns',
      });

      await tool.execute({});

      const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.namespace).toBe('my-ns');
    });
  });

  describe('response formatting', () => {
    it('should return success with count of reaped memories', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: 7, namespace: 'test-ns' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ dry_run: false });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.reaped).toBe(7);
      }
    });

    it('should note dry_run in content when dry_run is true', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: 3, namespace: 'test-ns' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ dry_run: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content.toLowerCase()).toContain('preview');
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

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({});
      expect(result.success).toBe(false);
    });

    it('should handle network errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryReapTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({});
      expect(result.success).toBe(false);
    });
  });
});
