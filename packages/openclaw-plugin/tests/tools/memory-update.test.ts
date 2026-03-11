/**
 * Tests for memory_update tool.
 * Verifies in-place memory editing functionality.
 * Issue #2378.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMemoryUpdateTool, type MemoryUpdateParams } from '../../src/tools/memory-update.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('memory_update tool', () => {
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
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.name).toBe('memory_update');
    });

    it('should have description', () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should require memory_id', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ text: 'new content' } as unknown as MemoryUpdateParams);
      expect(result.success).toBe(false);
    });

    it('should require at least one update field', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123' } as MemoryUpdateParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('At least one field');
      }
    });

    it('should reject empty memory_id', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: '', text: 'content' } as MemoryUpdateParams);
      expect(result.success).toBe(false);
    });

    it('should reject text over 10000 characters', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({
        memory_id: 'mem-123',
        text: 'a'.repeat(10001),
      } as MemoryUpdateParams);
      expect(result.success).toBe(false);
    });

    it('should reject importance out of range', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({
        memory_id: 'mem-123',
        importance: 1.5,
      } as MemoryUpdateParams);
      expect(result.success).toBe(false);
    });

    it('should reject invalid category', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({
        memory_id: 'mem-123',
        category: 'invalid',
      } as unknown as MemoryUpdateParams);
      expect(result.success).toBe(false);
    });
  });

  describe('API interaction', () => {
    it('should call PATCH /memories/:id with text as content', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'updated content', type: 'fact' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', text: 'updated content' });

      expect(mockPatch).toHaveBeenCalledWith(
        '/memories/mem-123',
        expect.objectContaining({ content: 'updated content' }),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should map other category to note for API', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test', type: 'note' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', category: 'other' });

      expect(mockPatch).toHaveBeenCalledWith(
        '/memories/mem-123',
        expect.objectContaining({ memory_type: 'note' }),
        expect.any(Object),
      );
    });

    it('should pass importance to API', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test', importance: 0.9 },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', importance: 0.9 });

      expect(mockPatch).toHaveBeenCalledWith(
        '/memories/mem-123',
        expect.objectContaining({ importance: 0.9 }),
        expect.any(Object),
      );
    });

    it('should pass tags to API', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test', tags: ['new-tag'] },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', tags: ['new-tag'] });

      expect(mockPatch).toHaveBeenCalledWith(
        '/memories/mem-123',
        expect.objectContaining({ tags: ['new-tag'] }),
        expect.any(Object),
      );
    });

    it('should pass expires_at null to clear expiry', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', expires_at: null });

      expect(mockPatch).toHaveBeenCalledWith(
        '/memories/mem-123',
        expect.objectContaining({ expires_at: null }),
        expect.any(Object),
      );
    });
  });

  describe('response formatting', () => {
    it('should return success with content preview', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'Deployment is v0.0.55', type: 'fact' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123', text: 'Deployment is v0.0.55' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Updated memory mem-123');
        expect(result.data.content).toContain('Deployment is v0.0.55');
        expect(result.data.details.id).toBe('mem-123');
        expect(result.data.details.user_id).toBe('agent-1');
      }
    });

    it('should handle not found error', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'nonexistent', text: 'new content' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123', text: 'test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Server error');
      }
    });

    it('should handle network errors', async () => {
      const mockPatch = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123', text: 'test' });

      expect(result.success).toBe(false);
    });

    it('should not expose internal details in error messages', async () => {
      const mockPatch = vi.fn().mockRejectedValue(new Error('Connection refused to internal-host:5432'));
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({ memory_id: 'mem-123', text: 'test' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-host');
      }
    });

    it('should reject text that becomes empty after sanitization', async () => {
      const tool = createMemoryUpdateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      const result = await tool.execute({
        memory_id: 'mem-123',
        text: '\x00\x01\x02',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('empty');
      }
    });
  });

  describe('logging', () => {
    it('should log invocation at info level', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', text: 'test' });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'memory_update invoked',
        expect.objectContaining({
          user_id: 'agent-1',
          memory_id: 'mem-123',
        }),
      );
    });

    it('should NOT log content at info level', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'sensitive info' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'agent-1',
      });

      await tool.execute({ memory_id: 'mem-123', text: 'sensitive info about medical records' });

      const infoCalls = mockLogger.info.mock.calls;
      for (const call of infoCalls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain('sensitive info');
        expect(logMessage).not.toContain('medical records');
      }
    });
  });

  describe('user scoping', () => {
    it('should use provided user_id for API calls', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'mem-123', content: 'test' },
      });
      const client = { ...mockApiClient, patch: mockPatch };

      const tool = createMemoryUpdateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        user_id: 'custom-user-789',
      });

      await tool.execute({ memory_id: 'mem-123', text: 'test' });

      expect(mockPatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ user_id: 'custom-user-789' }),
      );
    });
  });
});
