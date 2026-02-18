/**
 * Tests for plugin lifecycle hooks.
 * Covers auto-recall and auto-capture functionality.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAutoRecallHook, createAutoCaptureHook, createHealthCheck } from '../src/hooks.js';
import type { ApiClient } from '../src/api-client.js';
import type { Logger } from '../src/logger.js';
import type { PluginConfig } from '../src/config.js';

describe('lifecycle hooks', () => {
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

  describe('auto-recall hook', () => {
    describe('creation', () => {
      it('should create a callable hook function', () => {
        const hook = createAutoRecallHook({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(typeof hook).toBe('function');
      });

      it('should return null when autoRecall is disabled', async () => {
        const hook = createAutoRecallHook({
          client: mockApiClient,
          logger: mockLogger,
          config: { ...mockConfig, autoRecall: false },
          user_id: 'agent-1',
        });

        const result = await hook({ prompt: 'Hello' });
        expect(result).toBeNull();
      });
    });

    describe('execution', () => {
      it('should fetch context from memory search API', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [{ id: '1', content: 'User prefers dark mode.', category: 'preference', score: 0.95 }],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await hook({ prompt: 'Tell me about my preferences' });

        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/memories/search'), expect.any(Object));
        // Verify the prompt is passed as the search query
        const callUrl = mockGet.mock.calls[0][0] as string;
        expect(callUrl).toContain('q=Tell+me+about+my+preferences');
      });

      it('should return prependContext on success', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [{ id: '1', content: 'User prefers dark mode.', category: 'preference', score: 0.95 }],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me about my preferences' });

        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('User prefers dark mode.');
      });

      it('should return null on API error', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await hook({ prompt: 'Hello' });

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should return null on network error', async () => {
        const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await hook({ prompt: 'Hello' });

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should return null when no memories found', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { memories: [] },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const result = await hook({ prompt: 'Hello' });

        expect(result).toBeNull();
      });
    });

    describe('timeout protection', () => {
      it('should timeout after max duration', async () => {
        const mockGet = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10000)));
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
          timeoutMs: 100, // Very short timeout for test
        });

        const result = await hook({ prompt: 'Hello' });

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('timeout'), expect.any(Object));
      }, 1000);
    });

    describe('logging', () => {
      it('should not log prompt content at info level', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { memories: [{ id: '1', content: 'Some context', category: 'fact' }] },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await hook({ prompt: 'My secret password is hunter2' });

        for (const call of (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls) {
          const logMessage = JSON.stringify(call);
          expect(logMessage).not.toContain('hunter2');
          expect(logMessage).not.toContain('secret password');
        }
      });
    });
  });

  describe('auto-capture hook', () => {
    describe('creation', () => {
      it('should create a callable hook function', () => {
        const hook = createAutoCaptureHook({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });
        expect(typeof hook).toBe('function');
      });

      it('should return early when autoCapture is disabled', async () => {
        const mockPost = vi.fn();
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: { ...mockConfig, autoCapture: false },
          user_id: 'agent-1',
        });

        await hook({ messages: [{ role: 'user', content: 'Hello' }] });
        expect(mockPost).not.toHaveBeenCalled();
      });
    });

    describe('execution', () => {
      it('should post conversation summary to API', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { captured: 1 },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await hook({
          messages: [
            { role: 'user', content: 'Remember I prefer dark mode' },
            { role: 'assistant', content: 'Noted, you prefer dark mode.' },
          ],
        });

        expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/api/context/capture'), expect.any(Object), expect.any(Object));
      });

      it('should handle API errors gracefully', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        // Should not throw
        await expect(
          hook({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        ).resolves.not.toThrow();

        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should handle network errors gracefully', async () => {
        const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        // Should not throw
        await expect(
          hook({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        ).resolves.not.toThrow();

        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should skip capture for short conversations', async () => {
        const mockPost = vi.fn();
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await hook({ messages: [] });
        expect(mockPost).not.toHaveBeenCalled();
      });
    });

    describe('content filtering', () => {
      it('should not capture messages with sensitive patterns', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { captured: 0 },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        await hook({
          messages: [{ role: 'user', content: 'My API key is sk-1234567890abcdef' }],
        });

        // Should either not call API or filter out sensitive content
        if (mockPost.mock.calls.length > 0) {
          const body = mockPost.mock.calls[0][1];
          expect(JSON.stringify(body)).not.toContain('sk-1234567890');
        }
      });

      it('should consistently detect sensitive content across consecutive calls (no stale lastIndex)', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { captured: 0 },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const sensitiveMessage = { role: 'user', content: 'password=hunter2' };

        // Call multiple times with the same sensitive content.
        // Before the fix, stateful /g regexes would alternate between
        // detecting and missing the pattern due to stale lastIndex.
        for (let i = 0; i < 5; i++) {
          mockPost.mockClear();
          await hook({ messages: [sensitiveMessage] });
          // The sensitive message should be filtered every single time,
          // so either the API is not called at all or the content is redacted
          if (mockPost.mock.calls.length > 0) {
            const body = mockPost.mock.calls[0][1];
            expect(JSON.stringify(body)).not.toContain('hunter2');
          }
        }
      });

      it('should consistently detect API key patterns across consecutive calls', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { captured: 0 },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
        });

        const sensitiveMessage = { role: 'user', content: 'Here is sk-abcdef1234567890 my key' };

        for (let i = 0; i < 5; i++) {
          mockPost.mockClear();
          await hook({ messages: [sensitiveMessage] });
          if (mockPost.mock.calls.length > 0) {
            const body = mockPost.mock.calls[0][1];
            expect(JSON.stringify(body)).not.toContain('sk-abcdef1234567890');
          }
        }
      });
    });

    describe('timeout protection', () => {
      it('should timeout after max duration', async () => {
        const mockPost = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 15000)));
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'agent-1',
          timeoutMs: 100, // Very short timeout for test
        });

        // Should not throw even on timeout
        await expect(
          hook({
            messages: [{ role: 'user', content: 'Hello' }],
          }),
        ).resolves.not.toThrow();

        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('timeout'), expect.any(Object));
      }, 1000);
    });
  });

  describe('health check', () => {
    it('should return healthy when API is reachable', async () => {
      const mockHealthCheck = vi.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      });
      const client = { ...mockApiClient, healthCheck: mockHealthCheck };

      const healthCheck = createHealthCheck({
        client: client as unknown as ApiClient,
        logger: mockLogger,
      });

      const result = await healthCheck();

      expect(result.healthy).toBe(true);
    });

    it('should return unhealthy when API is unreachable', async () => {
      const mockHealthCheck = vi.fn().mockResolvedValue({
        healthy: false,
        latencyMs: 0,
      });
      const client = { ...mockApiClient, healthCheck: mockHealthCheck };

      const healthCheck = createHealthCheck({
        client: client as unknown as ApiClient,
        logger: mockLogger,
      });

      const result = await healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return unhealthy on network error', async () => {
      const mockHealthCheck = vi.fn().mockRejectedValue(new Error('Connection refused'));
      const client = { ...mockApiClient, healthCheck: mockHealthCheck };

      const healthCheck = createHealthCheck({
        client: client as unknown as ApiClient,
        logger: mockLogger,
      });

      const result = await healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
