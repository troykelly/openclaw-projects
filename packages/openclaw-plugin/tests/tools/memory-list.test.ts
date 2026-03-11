/**
 * Tests for memory_list tool.
 * Verifies memory browsing and pagination functionality.
 * Issue #2377.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryListTool, type MemoryListParams } from '../../src/tools/memory-list.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_list tool', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.name).toBe('memory_list');
    });

    it('should have description', () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should accept empty params (all optional)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);
      expect(result.success).toBe(true);
    });

    it('should reject limit above 100', async () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ limit: 101 } as MemoryListParams);
      expect(result.success).toBe(false);
    });

    it('should reject limit below 1', async () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ limit: 0 } as MemoryListParams);
      expect(result.success).toBe(false);
    });

    it('should reject negative offset', async () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ offset: -1 } as MemoryListParams);
      expect(result.success).toBe(false);
    });

    it('should reject period combined with since', async () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ period: 'today', since: '7d' } as MemoryListParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('mutually exclusive');
      }
    });

    it('should reject invalid category', async () => {
      const tool = createMemoryListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ category: 'invalid' } as unknown as MemoryListParams);
      expect(result.success).toBe(false);
    });
  });

  describe('API interaction', () => {
    it('should call /memories/unified with default params', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({} as MemoryListParams);

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/memories/unified'),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('limit=20');
      expect(calledUrl).toContain('offset=0');
    });

    it('should pass category as memory_type to API', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ category: 'preference' } as MemoryListParams);

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('memory_type=preference');
    });

    it('should map other category to note for API', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ category: 'other' } as MemoryListParams);

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('memory_type=note');
    });

    it('should pass temporal params to API', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ since: '7d', before: '1d' } as MemoryListParams);

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('since=7d');
      expect(calledUrl).toContain('before=1d');
    });

    it('should pass sort params to API', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ sort: 'created_at', sort_direction: 'desc' } as MemoryListParams);

      const calledUrl = mockGet.mock.calls[0][0] as string;
      expect(calledUrl).toContain('sort=created_at');
      expect(calledUrl).toContain('sort_direction=desc');
    });
  });

  describe('response formatting', () => {
    it('should format memories as bullet list with timestamps', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [
            { id: '1', content: 'User prefers oat milk', type: 'preference', created_at: '2026-03-10T12:00:00Z' },
            { id: '2', content: 'Deployment is v0.0.55', type: 'fact', tags: ['deployment'], created_at: '2026-03-09T08:00:00Z' },
          ],
          total: 5,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Showing 1-2 of 5 memories');
        expect(result.data.content).toContain('[preference]');
        expect(result.data.content).toContain('User prefers oat milk');
        expect(result.data.content).toContain('{deployment}');
        expect(result.data.details.count).toBe(2);
        expect(result.data.details.total).toBe(5);
        expect(result.data.details.offset).toBe(0);
      }
    });

    it('should handle empty results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('No memories found.');
        expect(result.data.details.count).toBe(0);
        expect(result.data.details.total).toBe(0);
      }
    });

    it('should map API note type to plugin other category', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [{ id: '1', content: 'A note', type: 'note' }],
          total: 1,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.memories[0].category).toBe('other');
      }
    });

    it('should show correct offset in pagination header', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [{ id: '1', content: 'Memory at offset 20', type: 'fact' }],
          total: 50,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ offset: 20, limit: 10 } as MemoryListParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Showing 21-21 of 50 memories');
        expect(result.data.details.offset).toBe(20);
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

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Server error');
      }
    });

    it('should handle network errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(false);
    });

    it('should not expose internal details in error messages', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused to internal-host:5432'));
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-host');
      }
    });
  });

  describe('user scoping', () => {
    it('should include user_id in response details', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { memories: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'my-agent',
      });

      const result = await tool.execute({} as MemoryListParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.user_id).toBe('my-agent');
      }
    });
  });
});
