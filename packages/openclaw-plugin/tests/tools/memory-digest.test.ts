/**
 * Tests for memory_digest tool — Issue #2430.
 * Verifies agent-facing rehearsal detection (cluster endpoint calls).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryDigestTool, type MemoryDigestParams } from '../../src/tools/memory-digest.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_digest tool', () => {
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
      const tool = createMemoryDigestTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.name).toBe('memory_digest');
    });

    it('should have description mentioning digest/clustering', () => {
      const tool = createMemoryDigestTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.description.toLowerCase()).toContain('cluster');
    });

    it('should have parameter schema', () => {
      const tool = createMemoryDigestTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should require since parameter', async () => {
      const tool = createMemoryDigestTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({} as MemoryDigestParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.toLowerCase()).toContain('since');
      }
    });

    it('should accept valid since with ISO date', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          clusters: [],
          orphans: [],
          total_memories: 0,
          total_clusters: 0,
          total_orphans: 0,
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '2026-03-01T00:00:00Z' });
      expect(result.success).toBe(true);
    });

    it('should accept relative time format for since (24h)', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          clusters: [],
          orphans: [],
          total_memories: 0,
          total_clusters: 0,
          total_orphans: 0,
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(true);
    });

    it('should accept threshold parameter between 0 and 1', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { clusters: [], orphans: [], total_memories: 0, total_clusters: 0, total_orphans: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h', threshold: 0.9 });
      expect(result.success).toBe(true);
    });

    it('should reject threshold > 1', async () => {
      const tool = createMemoryDigestTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h', threshold: 1.5 });
      expect(result.success).toBe(false);
    });

    it('should reject threshold < 0', async () => {
      const tool = createMemoryDigestTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h', threshold: -0.1 });
      expect(result.success).toBe(false);
    });
  });

  describe('API interaction', () => {
    it('should call POST /memories/digest with namespace header', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { clusters: [], orphans: [], total_memories: 0, total_clusters: 0, total_orphans: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({ since: '24h' });

      expect(mockPost).toHaveBeenCalledWith(
        '/memories/digest',
        expect.any(Object),
        expect.objectContaining({ namespace: 'test-ns', user_id: 'agent-1' }),
      );
    });

    it('should include namespace in request body', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { clusters: [], orphans: [], total_memories: 0, total_clusters: 0, total_orphans: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'my-namespace',
      });

      await tool.execute({ since: '24h' });

      const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.namespace).toBe('my-namespace');
    });

    it('should pass since/before as ISO timestamps in body', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { clusters: [], orphans: [], total_memories: 0, total_clusters: 0, total_orphans: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({ since: '24h' });

      const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.before).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should pass threshold as similarity_threshold in body', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { clusters: [], orphans: [], total_memories: 0, total_clusters: 0, total_orphans: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      await tool.execute({ since: '24h', threshold: 0.75 });

      const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(body.similarity_threshold).toBe(0.75);
    });
  });

  describe('response formatting', () => {
    it('should format empty results gracefully', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { clusters: [], orphans: [], total_memories: 0, total_clusters: 0, total_orphans: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No memories');
      }
    });

    it('should format clusters with topic label and memory count', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          clusters: [
            {
              id: 'cluster-1',
              size: 3,
              centroid_text: 'Email architecture',
              memories: [
                { id: 'mem-1', title: 'Email triage', created_at: new Date().toISOString(), importance: 0.5 },
                { id: 'mem-2', title: 'SMTP handling', created_at: new Date().toISOString(), importance: 0.4 },
                { id: 'mem-3', title: 'Email routing', created_at: new Date().toISOString(), importance: 0.6 },
              ],
              avg_similarity: 0.85,
              time_span: { first: new Date().toISOString(), last: new Date().toISOString() },
            },
          ],
          orphans: [],
          total_memories: 3,
          total_clusters: 1,
          total_orphans: 0,
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Email architecture');
        expect(result.data.content).toContain('3');
      }
    });

    it('should not expose raw similarity scores in output', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          clusters: [
            {
              id: 'cluster-1',
              size: 2,
              centroid_text: 'Topic A',
              memories: [
                { id: 'mem-1', title: 'Note A', created_at: new Date().toISOString(), importance: 0.5, similarity: 0.9234 },
                { id: 'mem-2', title: 'Note B', created_at: new Date().toISOString(), importance: 0.4, similarity: 0.8876 },
              ],
              avg_similarity: 0.9055,
              time_span: { first: new Date().toISOString(), last: new Date().toISOString() },
            },
          ],
          orphans: [],
          total_memories: 2,
          total_clusters: 1,
          total_orphans: 0,
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(true);
      if (result.success) {
        // Raw similarity scores (0.9234, 0.8876, 0.9055) must not appear in output
        expect(result.data.content).not.toContain('0.9234');
        expect(result.data.content).not.toContain('0.8876');
        expect(result.data.content).not.toContain('0.9055');
      }
    });

    it('should return details with cluster and summary data', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          clusters: [],
          orphans: [{ id: 'mem-1', title: 'Orphan note', created_at: new Date().toISOString() }],
          total_memories: 1,
          total_clusters: 0,
          total_orphans: 1,
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.total_memories).toBe(1);
        expect(result.data.details.total_orphans).toBe(1);
        expect(result.data.details.total_clusters).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Internal server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(false);
    });

    it('should handle network errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryDigestTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
        namespace: 'test-ns',
      });

      const result = await tool.execute({ since: '24h' });
      expect(result.success).toBe(false);
    });
  });
});
