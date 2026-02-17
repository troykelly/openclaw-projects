/**
 * Tests for memory_forget tool.
 * Verifies GDPR-compliant memory deletion functionality.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryForgetTool, type MemoryForgetParams } from '../../src/tools/memory-forget.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_forget tool', () => {
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
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.name).toBe('memory_forget');
    });

    it('should have description', () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should require either memory_id or query', async () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({} as MemoryForgetParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('memory_id');
      }
    });

    it('should accept memory_id alone', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123' });
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should accept query alone', async () => {
      // Query-based forget searches first, may return candidates
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1', content: 'I like coffee', similarity: 0.95 }] },
      });
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ query: 'delete my coffee preference' });
      expect(mockGet).toHaveBeenCalled();
    });

    it('should reject query over 1000 characters', async () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const longQuery = 'a'.repeat(1001);
      const result = await tool.execute({ query: longQuery });
      expect(result.success).toBe(false);
    });
  });

  describe('delete by ID', () => {
    it('should call DELETE /api/memories/:id', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123' });

      expect(mockDelete).toHaveBeenCalledWith('/api/memories/mem-123', expect.objectContaining({ user_id: 'agent-1' }));
    });

    it('should return success for deleted memory', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Deleted');
        expect(result.data.details.deletedCount).toBe(1);
      }
    });

    it('should handle not found gracefully', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Memory not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'nonexistent' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('not found');
        expect(result.data.details.deletedCount).toBe(0);
      }
    });
  });

  describe('delete by query (OpenClaw two-phase)', () => {
    it('should search /api/memories/search with limit=5', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1', content: 'I like coffee', similarity: 0.95 }] },
      });
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ query: 'coffee' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/memories\/search\?q=coffee&limit=5$/),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should auto-delete single high-confidence match (>0.9)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1', content: 'I like dark roast coffee', similarity: 0.95 }] },
      });
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ query: 'coffee' });

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith('/api/memories/mem-1', expect.objectContaining({ user_id: 'agent-1' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Forgotten');
        expect(result.data.content).toContain('dark roast coffee');
        expect(result.data.details.deletedCount).toBe(1);
      }
    });

    it('should return candidates when multiple matches found (no auto-delete)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            { id: 'mem-1', content: 'I like dark roast coffee', similarity: 0.85 },
            { id: 'mem-2', content: 'Coffee shop on main street', similarity: 0.78 },
          ],
        },
      });
      const mockDelete = vi.fn();
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ query: 'coffee' });

      // Should NOT delete anything — returns candidates for agent to pick
      expect(mockDelete).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('candidates');
        expect(result.data.content).toContain('memory_id');
        expect(result.data.details.deletedCount).toBe(0);
      }
    });

    it('should return full UUIDs in candidate list (not truncated)', async () => {
      const fullUuid1 = '12345678-1234-1234-1234-123456789012';
      const fullUuid2 = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            { id: fullUuid1, content: 'First memory', similarity: 0.85 },
            { id: fullUuid2, content: 'Second memory', similarity: 0.78 },
          ],
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.success).toBe(true);
      if (result.success) {
        // Should contain FULL UUIDs, not truncated versions
        expect(result.data.content).toContain(fullUuid1);
        expect(result.data.content).toContain(fullUuid2);
        // Should not just show truncated 8-char versions
        expect(result.data.content).not.toMatch(/\[12345678\]/);
      }
    });

    it('should auto-delete single candidate when only one match found (regardless of score)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [{ id: 'mem-only', content: 'The only match', similarity: 0.75 }],
        },
      });
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ query: 'unique' });

      // When there's only 1 candidate, auto-delete it (don't make user copy/paste)
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith('/api/memories/mem-only', expect.objectContaining({ user_id: 'agent-1' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.deletedCount).toBe(1);
      }
    });

    it('should auto-delete single low-confidence match (improved UX)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1', content: 'I like coffee', similarity: 0.75 }] },
      });
      const mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ query: 'something vague' });

      // Single match (any confidence) → auto-delete for better UX
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.deletedCount).toBe(1);
        expect(result.data.content).toContain('Forgotten');
      }
    });

    it('should handle no matching memories', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [] },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ query: 'nonexistent' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No matching memories');
        expect(result.data.details.deletedCount).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Server error');
      }
    });

    it('should handle network errors', async () => {
      const mockDelete = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123' });

      expect(result.success).toBe(false);
    });

    it('should not expose internal details in error messages', async () => {
      const mockDelete = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-db');
      }
    });
  });

  describe('logging', () => {
    it('should log deletion invocation', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'memory_forget invoked',
        expect.objectContaining({
          user_id: 'agent-1',
          memory_id: 'mem-123',
        }),
      );
    });

    it('should log deletion completion with count', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123' });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'memory_forget completed',
        expect.objectContaining({
          deletedCount: 1,
        }),
      );
    });

    it('should log errors', async () => {
      const mockDelete = vi.fn().mockRejectedValue(new Error('Test error'));
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123' });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('user scoping', () => {
    it('should use provided user_id for API calls', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'custom-user-456',
      });

      await tool.execute({ memory_id: 'mem-123' });

      expect(mockDelete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ user_id: 'custom-user-456' }));
    });

    it('should include user_id in response details', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'my-agent',
      });

      const result = await tool.execute({ memory_id: 'mem-123' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.user_id).toBe('my-agent');
      }
    });
  });
});
