/**
 * Tests for plugin lifecycle hooks.
 * Covers auto-recall and auto-capture functionality.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createAutoRecallHook, createAutoCaptureHook, createGraphAwareRecallHook, createHealthCheck, extractTextContent } from '../src/hooks.js';
import type { ApiClient } from '../src/api-client.js';
import type { Logger } from '../src/logger.js';
import type { PluginConfig } from '../src/config.js';

describe('extractTextContent', () => {
  it('should pass through plain string content', () => {
    expect(extractTextContent('hello world')).toBe('hello world');
  });

  it('should extract text from array of content blocks', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'image', source: { data: '...' } },
      { type: 'text', text: 'World' },
    ];
    expect(extractTextContent(content)).toBe('Hello\nWorld');
  });

  it('should return empty string for non-string non-array content', () => {
    expect(extractTextContent(42)).toBe('');
    expect(extractTextContent(null)).toBe('');
    expect(extractTextContent(undefined)).toBe('');
  });

  it('should handle empty array', () => {
    expect(extractTextContent([])).toBe('');
  });

  it('should skip blocks without text property', () => {
    const content = [
      { type: 'text', text: 'Keep' },
      { type: 'tool_use', name: 'search', input: {} },
      { type: 'text' }, // missing text property
    ];
    expect(extractTextContent(content)).toBe('Keep');
  });
});

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
          getAgentId: () => 'agent-1',
        });
        expect(typeof hook).toBe('function');
      });

      it('should return null when autoRecall is disabled', async () => {
        const hook = createAutoRecallHook({
          client: mockApiClient,
          logger: mockLogger,
          config: { ...mockConfig, autoRecall: false },
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
          timeoutMs: 100, // Very short timeout for test
        });

        const result = await hook({ prompt: 'Hello' });

        expect(result).toBeNull();
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('timeout'), expect.any(Object));
      }, 1000);
    });

    describe('minRecallScore filtering (#1926)', () => {
      it('should filter out memories below minRecallScore threshold', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [
              { id: '1', content: 'High relevance memory', category: 'fact', score: 0.9 },
              { id: '2', content: 'Low relevance memory', category: 'fact', score: 0.5 },
              { id: '3', content: 'Very low relevance memory', category: 'fact', score: 0.3 },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: { ...mockConfig, minRecallScore: 0.7 },
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me something' });

        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('High relevance memory');
        expect(result?.prependContext).not.toContain('Low relevance memory');
        expect(result?.prependContext).not.toContain('Very low relevance memory');
      });

      it('should keep at least 1 memory even if all are below threshold (graceful degradation)', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [
              { id: '1', content: 'Best of the low', category: 'fact', score: 0.5 },
              { id: '2', content: 'Worst memory', category: 'fact', score: 0.2 },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: { ...mockConfig, minRecallScore: 0.7 },
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me something' });

        // Should return the highest-scoring memory as graceful degradation
        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('Best of the low');
        expect(result?.prependContext).not.toContain('Worst memory');
      });

      it('should treat memories without a score as 0', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [
              { id: '1', content: 'Scored memory', category: 'fact', score: 0.9 },
              { id: '2', content: 'Unscored memory', category: 'fact' },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: { ...mockConfig, minRecallScore: 0.7 },
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me something' });

        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('Scored memory');
        expect(result?.prependContext).not.toContain('Unscored memory');
      });
    });

    describe('provenance markers (#1926)', () => {
      it('should include memory_type and relevance percentage in recalled context', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [
              { id: '1', content: 'User prefers dark mode.', category: 'preference', score: 0.95 },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me about my preferences' });

        expect(result).not.toBeNull();
        // Should contain provenance: [memory_type] (relevance: XX%)
        expect(result?.prependContext).toMatch(/\[preference\]/);
        expect(result?.prependContext).toMatch(/relevance:\s*95%/);
      });

      it('should include context handling guidance note', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            memories: [
              { id: '1', content: 'Some fact', category: 'fact', score: 0.9 },
            ],
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const hook = createAutoRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'What do you know?' });

        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('Recalled from long-term memory');
        expect(result?.prependContext).toContain('memory_recall');
        expect(result?.prependContext).toContain('context_search');
        expect(result?.prependContext).toContain('tool_guide');
      });
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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
          getAgentId: () => 'agent-1',
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

    describe('structured content handling (#1563)', () => {
      it('should extract text from structured content blocks and post to API', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { captured: 1 },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          getAgentId: () => 'agent-1',
        });

        await hook({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Remember I like dark mode' },
                { type: 'image', source: { data: 'base64...' } },
              ] as unknown as string,
            },
          ],
        });

        expect(mockPost).toHaveBeenCalledWith(
          expect.stringContaining('/api/context/capture'),
          expect.objectContaining({
            conversation: 'Remember I like dark mode',
          }),
          expect.any(Object),
        );
      });

      it('should not produce [object Object] in conversation summary', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { captured: 1 },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createAutoCaptureHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          getAgentId: () => 'agent-1',
        });

        await hook({
          messages: [
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Here is the result' },
                { type: 'tool_use', name: 'search', input: { query: 'test' } },
              ] as unknown as string,
            },
          ],
        });

        if (mockPost.mock.calls.length > 0) {
          const body = mockPost.mock.calls[0][1];
          expect(body.conversation).not.toContain('[object Object]');
          expect(body.conversation).toContain('Here is the result');
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
          getAgentId: () => 'agent-1',
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

  describe('graph-aware recall hook (#1926)', () => {
    describe('minRecallScore filtering', () => {
      it('should filter graph-aware memories below minRecallScore by combinedRelevance', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            context: null, // We'll test per-memory formatting
            memories: [
              {
                id: '1', title: 'High', content: 'High relevance', memory_type: 'fact',
                similarity: 0.95, importance: 0.8, confidence: 0.9, combinedRelevance: 0.88,
                scopeType: 'personal', scopeLabel: 'me',
              },
              {
                id: '2', title: 'Low', content: 'Low relevance', memory_type: 'fact',
                similarity: 0.4, importance: 0.3, confidence: 0.5, combinedRelevance: 0.4,
                scopeType: 'personal', scopeLabel: 'me',
              },
            ],
            metadata: { queryTimeMs: 50, scopeCount: 1, totalMemoriesFound: 2, search_type: 'graph', maxDepth: 1 },
          },
        });
        // Graph endpoint returns memories but no pre-formatted context
        // so the fallback to fetchContext kicks in; we need to simulate the graph endpoint
        // returning a pre-formatted context string
        const mockPostWithContext = vi.fn().mockResolvedValue({
          success: true,
          data: {
            context: 'some context',
            memories: [
              {
                id: '1', title: 'High', content: 'High relevance', memory_type: 'fact',
                similarity: 0.95, importance: 0.8, confidence: 0.9, combinedRelevance: 0.88,
                scopeType: 'personal', scopeLabel: 'me',
              },
              {
                id: '2', title: 'Low', content: 'Low relevance', memory_type: 'fact',
                similarity: 0.4, importance: 0.3, confidence: 0.5, combinedRelevance: 0.4,
                scopeType: 'personal', scopeLabel: 'me',
              },
            ],
            metadata: { queryTimeMs: 50, scopeCount: 1, totalMemoriesFound: 2, search_type: 'graph', maxDepth: 1 },
          },
        });
        const client = { ...mockApiClient, post: mockPostWithContext };

        const hook = createGraphAwareRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: { ...mockConfig, minRecallScore: 0.7 },
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me something' });

        expect(result).not.toBeNull();
        // The high-relevance memory should be included
        expect(result?.prependContext).toContain('High relevance');
        // The low-relevance memory should be filtered out
        expect(result?.prependContext).not.toContain('Low relevance');
      });

      it('should keep at least 1 graph-aware memory even if all below threshold', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            context: 'some context',
            memories: [
              {
                id: '1', title: 'Best', content: 'Best memory', memory_type: 'decision',
                similarity: 0.5, importance: 0.4, confidence: 0.6, combinedRelevance: 0.5,
                scopeType: 'personal', scopeLabel: 'me',
              },
              {
                id: '2', title: 'Worst', content: 'Worst memory', memory_type: 'fact',
                similarity: 0.2, importance: 0.1, confidence: 0.3, combinedRelevance: 0.2,
                scopeType: 'personal', scopeLabel: 'me',
              },
            ],
            metadata: { queryTimeMs: 50, scopeCount: 1, totalMemoriesFound: 2, search_type: 'graph', maxDepth: 1 },
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createGraphAwareRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: { ...mockConfig, minRecallScore: 0.7 },
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me something' });

        // Should return at least the best memory as graceful degradation
        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('Best memory');
        expect(result?.prependContext).not.toContain('Worst memory');
      });

      it('should include provenance markers in graph-aware recalled context', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            context: 'some context',
            memories: [
              {
                id: '1', title: 'Important fact', content: 'User prefers dark mode', memory_type: 'preference',
                similarity: 0.95, importance: 0.9, confidence: 0.95, combinedRelevance: 0.93,
                scopeType: 'personal', scopeLabel: 'me',
              },
            ],
            metadata: { queryTimeMs: 50, scopeCount: 1, totalMemoriesFound: 1, search_type: 'graph', maxDepth: 1 },
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createGraphAwareRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Preferences' });

        expect(result).not.toBeNull();
        expect(result?.prependContext).toMatch(/\[preference\]/);
        expect(result?.prependContext).toMatch(/relevance:\s*93%/);
      });

      it('should include context handling guidance note for graph-aware recall', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: {
            context: 'some context',
            memories: [
              {
                id: '1', title: 'Fact', content: 'Something', memory_type: 'fact',
                similarity: 0.9, importance: 0.8, confidence: 0.9, combinedRelevance: 0.87,
                scopeType: 'personal', scopeLabel: 'me',
              },
            ],
            metadata: { queryTimeMs: 50, scopeCount: 1, totalMemoriesFound: 1, search_type: 'graph', maxDepth: 1 },
          },
        });
        const client = { ...mockApiClient, post: mockPost };

        const hook = createGraphAwareRecallHook({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          getAgentId: () => 'agent-1',
        });

        const result = await hook({ prompt: 'Tell me facts' });

        expect(result).not.toBeNull();
        expect(result?.prependContext).toContain('Recalled from long-term memory');
        expect(result?.prependContext).toContain('memory_recall');
      });
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
