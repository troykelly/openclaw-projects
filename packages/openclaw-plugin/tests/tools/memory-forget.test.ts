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
        userId: 'agent-1',
      });
      expect(tool.name).toBe('memory_forget');
    });

    it('should have description', () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should require either memoryId or query', async () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({} as MemoryForgetParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('memoryId');
      }
    });

    it('should accept memoryId alone', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ memoryId: 'mem-123' });
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should accept query alone', async () => {
      // First GET to find memories, then DELETE
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1' }] },
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
        userId: 'agent-1',
      });

      await tool.execute({ query: 'delete my coffee preference' });
      expect(mockGet).toHaveBeenCalled();
    });

    it('should reject query over 1000 characters', async () => {
      const tool = createMemoryForgetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
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
        userId: 'agent-1',
      });

      await tool.execute({ memoryId: 'mem-123' });

      expect(mockDelete).toHaveBeenCalledWith('/api/memories/mem-123', expect.objectContaining({ userId: 'agent-1' }));
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
        userId: 'agent-1',
      });

      const result = await tool.execute({ memoryId: 'mem-123' });

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
        userId: 'agent-1',
      });

      const result = await tool.execute({ memoryId: 'nonexistent' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('not found');
        expect(result.data.details.deletedCount).toBe(0);
      }
    });
  });

  describe('delete by query', () => {
    it('should search for memories first', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1' }] },
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
        userId: 'agent-1',
      });

      await tool.execute({ query: 'coffee' });

      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/memories/search'), expect.objectContaining({ userId: 'agent-1' }));
    });

    it('should delete matching memories', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ id: 'mem-1' }, { id: 'mem-2' }] },
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
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'coffee' });

      expect(mockDelete).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.deletedCount).toBe(2);
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
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'nonexistent' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No matching memories');
        expect(result.data.details.deletedCount).toBe(0);
      }
    });
  });

  describe('bulk delete protection', () => {
    it('should require confirmBulkDelete for >5 memories', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: Array(6)
            .fill(null)
            .map((_, i) => ({ id: `mem-${i}` })),
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('confirmBulkDelete');
        expect(result.error).toContain('6');
      }
    });

    it('should allow bulk delete with confirmBulkDelete: true', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: Array(6)
            .fill(null)
            .map((_, i) => ({ id: `mem-${i}` })),
        },
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
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', confirmBulkDelete: true });

      expect(mockDelete).toHaveBeenCalledTimes(6);
      expect(result.success).toBe(true);
    });

    it('should delete in parallel batches', async () => {
      // Create 15 memories to verify batching (batch size = 10)
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: Array(15)
            .fill(null)
            .map((_, i) => ({ id: `mem-${i}` })),
        },
      });
      const deleteCallOrder: string[] = [];
      const mockDelete = vi.fn().mockImplementation((path: string) => {
        deleteCallOrder.push(path);
        return Promise.resolve({ success: true, data: { deleted: true } });
      });
      const client = { ...mockApiClient, get: mockGet, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', confirmBulkDelete: true });

      expect(mockDelete).toHaveBeenCalledTimes(15);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.deletedCount).toBe(15);
      }
    });

    it('should not require confirmBulkDelete for <=5 memories', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: Array(5)
            .fill(null)
            .map((_, i) => ({ id: `mem-${i}` })),
        },
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
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });

      expect(mockDelete).toHaveBeenCalledTimes(5);
      expect(result.success).toBe(true);
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
        userId: 'agent-1',
      });

      const result = await tool.execute({ memoryId: 'mem-123' });

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
        userId: 'agent-1',
      });

      const result = await tool.execute({ memoryId: 'mem-123' });

      expect(result.success).toBe(false);
    });

    it('should not expose internal details in error messages', async () => {
      const mockDelete = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ memoryId: 'mem-123' });

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
        userId: 'agent-1',
      });

      await tool.execute({ memoryId: 'mem-123' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'memory_forget invoked',
        expect.objectContaining({
          userId: 'agent-1',
          memoryId: 'mem-123',
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
        userId: 'agent-1',
      });

      await tool.execute({ memoryId: 'mem-123' });

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
        userId: 'agent-1',
      });

      await tool.execute({ memoryId: 'mem-123' });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('user scoping', () => {
    it('should use provided userId for API calls', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user-456',
      });

      await tool.execute({ memoryId: 'mem-123' });

      expect(mockDelete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'custom-user-456' }));
    });

    it('should include userId in response details', async () => {
      const mockDelete = vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true },
      });
      const client = { ...mockApiClient, delete: mockDelete };

      const tool = createMemoryForgetTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'my-agent',
      });

      const result = await tool.execute({ memoryId: 'mem-123' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.userId).toBe('my-agent');
      }
    });
  });
});
