/**
 * Tests for memory_store tool.
 * Verifies memory persistence functionality.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryStoreTool, type MemoryStoreParams } from '../../src/tools/memory-store.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_store tool', () => {
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
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.name).toBe('memory_store');
    });

    it('should have description', () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should require text or content parameter', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({} as MemoryStoreParams);
      expect(result.success).toBe(false);
    });

    it('should accept text parameter (OpenClaw native)', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ text: 'User prefers dark mode' });
      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({ content: 'User prefers dark mode' }),
        expect.any(Object),
      );
    });

    it('should accept content parameter as alias', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: 'User prefers dark mode' });
      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalled();
    });

    it('should reject empty content', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: '' });
      expect(result.success).toBe(false);
    });

    it('should reject content over 10000 characters', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const longText = 'a'.repeat(10001);
      const result = await tool.execute({ content: longText });
      expect(result.success).toBe(false);
    });

    it('should accept valid category', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test', category: 'preference' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'User prefers oat milk', category: 'preference' });
      expect(mockPost).toHaveBeenCalled();
    });

    it('should reject invalid category', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        content: 'test',
        category: 'invalid' as MemoryStoreParams['category'],
      });
      expect(result.success).toBe(false);
    });

    it('should accept importance between 0 and 1', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test', importance: 0.9 },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'Important fact', importance: 0.9 });
      expect(mockPost).toHaveBeenCalled();
    });

    it('should reject importance above 1', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: 'test', importance: 1.5 });
      expect(result.success).toBe(false);
    });

    it('should reject importance below 0', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: 'test', importance: -0.1 });
      expect(result.success).toBe(false);
    });
  });

  describe('input sanitization', () => {
    it('should strip control characters from text', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test text' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'test\x00\x1F text' });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: 'test text',
        }),
        expect.any(Object),
      );
    });

    it('should trim whitespace from text', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test text' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: '  test text  ' });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: 'test text',
        }),
        expect.any(Object),
      );
    });

    it('should warn when text contains potential credentials', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'api key is sk-abc123' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      // Use a longer key that matches the pattern (20+ chars after sk-)
      await tool.execute({ content: 'api key is sk-abc123xyz456def789ghijk' });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('credential'), expect.any(Object));
    });
  });

  describe('API interaction', () => {
    it('should call POST /api/memories/unified with correct body', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'User likes coffee' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({
        content: 'User likes coffee',
        category: 'preference',
        importance: 0.8,
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({
          content: 'User likes coffee',
          memory_type: 'preference',
          importance: 0.8,
        }),
        expect.objectContaining({ userId: 'agent-1' }),
      );
    });

    it('should map default category "other" to memory_type "note"', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'Some info' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'Some info' });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({
          memory_type: 'note',
        }),
        expect.any(Object),
      );
    });

    it('should use default importance 0.7 when not provided', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'Some info' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'Some info' });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({
          importance: 0.7,
        }),
        expect.any(Object),
      );
    });

    it('should map category to memory_type preserving known types', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'test', category: 'decision' });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({ memory_type: 'decision' }),
        expect.any(Object),
      );
    });
  });

  describe('response formatting', () => {
    it('should return success with stored memory details', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'mem-123',
          content: 'User birthday is March 15',
          category: 'fact',
          importance: 0.8,
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        content: 'User birthday is March 15',
        category: 'fact',
        importance: 0.8,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Stored memory');
        expect(result.data.details.id).toBe('mem-123');
        expect(result.data.details.userId).toBe('agent-1');
      }
    });

    it('should truncate long content in response preview', async () => {
      const longContent = 'a'.repeat(200);
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: longContent },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: longContent });

      expect(result.success).toBe(true);
      if (result.success) {
        // Response should have truncated preview
        expect(result.data.content.length).toBeLessThan(longContent.length + 50);
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

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: 'test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Server error');
      }
    });

    it('should handle network errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: 'test' });

      expect(result.success).toBe(false);
    });

    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ content: 'test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-db');
      }
    });
  });

  describe('logging', () => {
    it('should log tool invocation with metadata (not content)', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'Sensitive information here', category: 'fact' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'memory_store invoked',
        expect.objectContaining({
          userId: 'agent-1',
          category: 'fact',
          contentLength: expect.any(Number),
        }),
      );

      // Should NOT log the actual content
      const infoCalls = mockLogger.info.mock.calls;
      for (const call of infoCalls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain('Sensitive information');
      }
    });

    it('should log errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Test error'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ content: 'test' });

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('location fields', () => {
    it('should accept location with all fields', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        text: 'Met at the cafe',
        location: { lat: -33.8688, lng: 151.2093, address: '123 George St, Sydney', place_label: 'Sydney CBD' },
      });
      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({
          lat: -33.8688,
          lng: 151.2093,
          address: '123 George St, Sydney',
          place_label: 'Sydney CBD',
        }),
        expect.any(Object),
      );
    });

    it('should accept location with lat/lng only', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        text: 'At the park',
        location: { lat: 40.7128, lng: -74.006 },
      });
      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        '/api/memories/unified',
        expect.objectContaining({
          lat: 40.7128,
          lng: -74.006,
        }),
        expect.any(Object),
      );
      // address/place_label should not be in payload when not provided
      const payload = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.address).toBeUndefined();
      expect(payload.place_label).toBeUndefined();
    });

    it('should reject invalid latitude (> 90)', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        text: 'test',
        location: { lat: 91, lng: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid latitude (< -90)', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        text: 'test',
        location: { lat: -91, lng: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid longitude (> 180)', async () => {
      const tool = createMemoryStoreTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        text: 'test',
        location: { lat: 0, lng: 181 },
      });
      expect(result.success).toBe(false);
    });

    it('should not include location in payload when not provided', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-1', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ text: 'no location' });
      const payload = mockPost.mock.calls[0][1] as Record<string, unknown>;
      expect(payload.lat).toBeUndefined();
      expect(payload.lng).toBeUndefined();
    });
  });

  describe('user scoping', () => {
    it('should use provided userId for API calls', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user-456',
      });

      await tool.execute({ content: 'test' });

      expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({ userId: 'custom-user-456' }));
    });

    it('should include userId in response details', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, post: mockPost };

      const tool = createMemoryStoreTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'my-agent',
      });

      const result = await tool.execute({ content: 'test' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.userId).toBe('my-agent');
      }
    });
  });
});
