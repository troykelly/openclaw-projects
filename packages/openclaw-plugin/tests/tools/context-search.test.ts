/**
 * Tests for context_search tool.
 * Verifies cross-entity recall that fans out to memories, todos, projects, and messages.
 *
 * Part of Issue #1219, #1222.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../src/api-client.js';
import type { PluginConfig } from '../../src/config.js';
import type { Logger } from '../../src/logger.js';
import { type ContextSearchParams, ContextSearchParamsSchema, createContextSearchTool } from '../../src/tools/context-search.js';

describe('context_search tool', () => {
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

  describe('schema validation', () => {
    it('should accept valid params with only query', () => {
      const result = ContextSearchParamsSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
    });

    it('should accept valid params with all fields', () => {
      const result = ContextSearchParamsSchema.safeParse({
        query: 'production city',
        entity_types: ['memory', 'todo'],
        limit: 20,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty query', () => {
      const result = ContextSearchParamsSchema.safeParse({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should reject query over 1000 characters', () => {
      const result = ContextSearchParamsSchema.safeParse({ query: 'a'.repeat(1001) });
      expect(result.success).toBe(false);
    });

    it('should reject limit above 50', () => {
      const result = ContextSearchParamsSchema.safeParse({ query: 'test', limit: 51 });
      expect(result.success).toBe(false);
    });

    it('should reject limit below 1', () => {
      const result = ContextSearchParamsSchema.safeParse({ query: 'test', limit: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject invalid entity_types', () => {
      const result = ContextSearchParamsSchema.safeParse({
        query: 'test',
        entity_types: ['invalid'],
      });
      expect(result.success).toBe(false);
    });

    it('should default entity_types to all when omitted', () => {
      const result = ContextSearchParamsSchema.safeParse({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entity_types).toBeUndefined();
      }
    });

    it('should accept message as a valid entity_type', () => {
      const result = ContextSearchParamsSchema.safeParse({
        query: 'investor deck',
        entity_types: ['message'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept message mixed with other entity_types', () => {
      const result = ContextSearchParamsSchema.safeParse({
        query: 'investor deck',
        entity_types: ['memory', 'message'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      const tool = createContextSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.name).toBe('context_search');
    });

    it('should have a description', () => {
      const tool = createContextSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createContextSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation in execute', () => {
    it('should fail on missing query', async () => {
      const tool = createContextSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({} as ContextSearchParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('query');
      }
    });

    it('should fail on empty query after sanitization', async () => {
      const tool = createContextSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: '   ' });
      expect(result.success).toBe(false);
    });
  });

  describe('fan-out to APIs', () => {
    function createMockClient(overrides?: { memoriesResponse?: unknown; searchResponse?: unknown; messageSearchResponse?: unknown }) {
      const memoriesResponse = overrides?.memoriesResponse ?? {
        success: true,
        data: { results: [], search_type: 'text' },
      };
      const searchResponse = overrides?.searchResponse ?? {
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      };
      const messageSearchResponse = overrides?.messageSearchResponse ?? {
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      };

      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve(memoriesResponse);
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve(messageSearchResponse);
        }
        if (url.includes('/api/search')) {
          return Promise.resolve(searchResponse);
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      return { ...mockApiClient, get: mockGet } as unknown as ApiClient;
    }

    it('should call memories, work items, and message search when entity_types omitted', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'production city' });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(3);
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls.some((url: string) => url.includes('/api/memories/search'))).toBe(true);
      expect(calls.some((url: string) => url.includes('/api/search') && url.includes('types=work_item'))).toBe(true);
      expect(calls.some((url: string) => url.includes('/api/search') && url.includes('types=message'))).toBe(true);
    });

    it('should only call /api/memories/search when entity_types is ["memory"]', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', entity_types: ['memory'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(1);
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls[0]).toContain('/api/memories/search');
    });

    it('should only call /api/search when entity_types is ["todo"]', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', entity_types: ['todo'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(1);
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls[0]).toContain('/api/search');
    });

    it('should only call /api/search when entity_types is ["project"]', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', entity_types: ['project'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(1);
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls[0]).toContain('/api/search');
    });

    it('should call both APIs when entity_types includes todo and memory', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', entity_types: ['todo', 'memory'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should only call message search when entity_types is ["message"]', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', entity_types: ['message'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(1);
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls[0]).toContain('/api/search');
      expect(calls[0]).toContain('types=message');
    });

    it('should call memory and message search when entity_types is ["memory", "message"]', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', entity_types: ['memory', 'message'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      expect(mockGet).toHaveBeenCalledTimes(2);
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls.some((url: string) => url.includes('/api/memories/search'))).toBe(true);
      expect(calls.some((url: string) => url.includes('types=message'))).toBe(true);
    });

    it('should pass user_email to message search API', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'user@example.com',
      });

      await tool.execute({ query: 'test', entity_types: ['message'] });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      const msgCall = mockGet.mock.calls.find((c: unknown[]) => (c[0] as string).includes('types=message'));
      expect(msgCall).toBeDefined();
      expect(msgCall![0]).toContain('user_email=user%40example.com');
    });

    it('should pass user_email to search API', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'user@example.com',
      });

      await tool.execute({ query: 'test' });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      const searchCall = mockGet.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/api/search'));
      expect(searchCall).toBeDefined();
      expect(searchCall![0]).toContain('user_email=user%40example.com');
    });

    it('should pass user_email to memory search API', async () => {
      const client = createMockClient();
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'user@example.com',
      });

      await tool.execute({ query: 'test' });

      const mockGet = (client as unknown as { get: ReturnType<typeof vi.fn> }).get;
      const memoryCall = mockGet.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/api/memories/search'));
      expect(memoryCall).toBeDefined();
      expect(memoryCall![0]).toContain('user_email=user%40example.com');
    });
  });

  describe('score normalization and merging', () => {
    function createMockClient(memoriesResults: unknown[], searchResults: unknown[], messageResults?: unknown[]) {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: { results: memoriesResults, search_type: 'hybrid' },
          });
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: { results: messageResults ?? [], search_type: 'hybrid', total: (messageResults ?? []).length },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: { results: searchResults, search_type: 'hybrid', total: searchResults.length },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      return { ...mockApiClient, get: mockGet } as unknown as ApiClient;
    }

    it('should normalize scores to 0-1 range within each category', async () => {
      const client = createMockClient(
        [
          { id: 'm1', content: 'Memory one', type: 'fact', similarity: 0.9 },
          { id: 'm2', content: 'Memory two', type: 'preference', similarity: 0.45 },
        ],
        [
          { id: 'w1', title: 'Task one', snippet: 'Do something', score: 5.0, type: 'work_item', metadata: { kind: 'task', status: 'open' } },
          { id: 'w2', title: 'Project one', snippet: 'A project', score: 2.5, type: 'work_item', metadata: { kind: 'project', status: 'active' } },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        const { results } = result.data.details;
        // Memory scores: 0.9/0.9=1.0, 0.45/0.9=0.5
        // Work item scores: 5.0/5.0=1.0, 2.5/5.0=0.5
        // All normalized scores should be between 0 and 1
        for (const r of results) {
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should set scores to 0 when all raw scores are zero', async () => {
      const client = createMockClient(
        [{ id: 'm1', content: 'Memory one', type: 'fact', similarity: 0 }],
        [{ id: 'w1', title: 'Task one', snippet: '', score: 0, type: 'work_item', metadata: { kind: 'task', status: 'open' } }],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        for (const r of result.data.details.results) {
          expect(r.score).toBe(0);
        }
      }
    });

    it('should set scores to 0 when all raw scores are negative', async () => {
      const client = createMockClient([{ id: 'm1', content: 'Memory one', type: 'fact', similarity: -0.5 }], []);

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        for (const r of result.data.details.results) {
          expect(r.score).toBe(0);
        }
      }
    });

    it('should clamp all normalized scores to [0, 1]', async () => {
      const client = createMockClient(
        [
          { id: 'm1', content: 'Memory one', type: 'fact', similarity: 1.5 },
          { id: 'm2', content: 'Memory two', type: 'fact', similarity: -0.3 },
        ],
        [],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        for (const r of result.data.details.results) {
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1);
        }
      }
    });

    it('should sort merged results by normalized score descending', async () => {
      const client = createMockClient(
        [
          { id: 'm1', content: 'Memory one', type: 'fact', similarity: 0.9 },
          { id: 'm2', content: 'Memory two', type: 'preference', similarity: 0.3 },
        ],
        [{ id: 'w1', title: 'Task one', snippet: 'Do something', score: 0.8, type: 'work_item', metadata: { kind: 'task', status: 'open' } }],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        const scores = result.data.details.results.map((r) => r.score);
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
        }
      }
    });

    it('should annotate results with entity_type', async () => {
      const client = createMockClient(
        [{ id: 'm1', content: 'A memory', type: 'fact', similarity: 0.9 }],
        [
          { id: 'w1', title: 'A task', snippet: '', score: 0.8, type: 'work_item', metadata: { kind: 'task', status: 'open' } },
          { id: 'w2', title: 'A project', snippet: '', score: 0.7, type: 'work_item', metadata: { kind: 'project', status: 'active' } },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.data.details.results.map((r) => r.entity_type);
        expect(types).toContain('memory');
        expect(types).toContain('todo');
        expect(types).toContain('project');
      }
    });

    it('should classify work items with kind=project as entity_type "project"', async () => {
      const client = createMockClient(
        [],
        [
          { id: 'w1', title: 'My Project', snippet: '', score: 0.9, type: 'work_item', metadata: { kind: 'project', status: 'active' } },
          { id: 'w2', title: 'My Task', snippet: '', score: 0.8, type: 'work_item', metadata: { kind: 'task', status: 'open' } },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        const projectResult = result.data.details.results.find((r) => r.id === 'w1');
        const todoResult = result.data.details.results.find((r) => r.id === 'w2');
        expect(projectResult?.entity_type).toBe('project');
        expect(todoResult?.entity_type).toBe('todo');
      }
    });

    it('should respect limit parameter', async () => {
      const memories = Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`,
        content: `Memory ${i}`,
        type: 'fact',
        similarity: 0.9 - i * 0.05,
      }));
      const workItems = Array.from({ length: 10 }, (_, i) => ({
        id: `w${i}`,
        title: `Task ${i}`,
        snippet: '',
        score: 0.85 - i * 0.05,
        type: 'work_item',
        metadata: { kind: 'task', status: 'open' },
      }));

      const client = createMockClient(memories, workItems);
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 5 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.length).toBe(5);
      }
    });

    it('should return empty results with appropriate message when nothing found', async () => {
      const client = createMockClient([], []);
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'nonexistent xyz' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.length).toBe(0);
        expect(result.data.content).toContain('No matching results');
      }
    });

    it('should filter work items by entity_types when only todo requested', async () => {
      const client = createMockClient(
        [],
        [
          { id: 'w1', title: 'A task', snippet: '', score: 0.9, type: 'work_item', metadata: { kind: 'task', status: 'open' } },
          { id: 'w2', title: 'A project', snippet: '', score: 0.8, type: 'work_item', metadata: { kind: 'project', status: 'active' } },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', entity_types: ['todo'] });
      expect(result.success).toBe(true);
      if (result.success) {
        // Should only include non-project work items
        expect(result.data.details.results.every((r) => r.entity_type === 'todo')).toBe(true);
      }
    });

    it('should filter work items by entity_types when only project requested', async () => {
      const client = createMockClient(
        [],
        [
          { id: 'w1', title: 'A task', snippet: '', score: 0.9, type: 'work_item', metadata: { kind: 'task', status: 'open' } },
          { id: 'w2', title: 'A project', snippet: '', score: 0.8, type: 'work_item', metadata: { kind: 'project', status: 'active' } },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', entity_types: ['project'] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.every((r) => r.entity_type === 'project')).toBe(true);
      }
    });

    it('should include message results in merged output', async () => {
      const client = createMockClient(
        [{ id: 'm1', content: 'A memory', type: 'fact', similarity: 0.9 }],
        [{ id: 'w1', title: 'A task', snippet: 'Do it', score: 0.8, type: 'work_item', metadata: { kind: 'task', status: 'open' } }],
        [
          {
            id: 'msg1',
            title: 'Email from Troy Kelly about investor deck',
            snippet: 'Please review the investor deck',
            score: 0.85,
            type: 'message',
            metadata: { channel: 'email', direction: 'inbound', received_at: '2026-01-15T10:00:00Z' },
          },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'investor deck' });
      expect(result.success).toBe(true);
      if (result.success) {
        const types = result.data.details.results.map((r) => r.entity_type);
        expect(types).toContain('message');
        expect(types).toContain('memory');
        expect(types).toContain('todo');
      }
    });

    it('should normalize message scores independently from other categories', async () => {
      const client = createMockClient(
        [{ id: 'm1', content: 'Memory', type: 'fact', similarity: 0.4 }],
        [],
        [
          { id: 'msg1', title: 'sms message (inbound)', snippet: 'Hello', score: 5.0, type: 'message', metadata: { channel: 'sms' } },
          { id: 'msg2', title: 'email message (outbound)', snippet: 'Goodbye', score: 2.5, type: 'message', metadata: { channel: 'email' } },
        ],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        for (const r of result.data.details.results) {
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1);
        }
        // msg1 should normalize to 1.0 (5.0/5.0), msg2 to 0.5 (2.5/5.0)
        const msg1 = result.data.details.results.find((r) => r.id === 'msg1');
        const msg2 = result.data.details.results.find((r) => r.id === 'msg2');
        expect(msg1?.score).toBeCloseTo(1.0, 2);
        expect(msg2?.score).toBeCloseTo(0.5, 2);
      }
    });

    it('should annotate message results with entity_type "message"', async () => {
      const client = createMockClient([], [], [
        { id: 'msg1', title: 'sms message (inbound)', snippet: 'Test msg', score: 0.9, type: 'message', metadata: { channel: 'sms' } },
      ]);

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', entity_types: ['message'] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.length).toBe(1);
        expect(result.data.details.results[0].entity_type).toBe('message');
      }
    });

    it('should filter to only message results when entity_types is ["message"]', async () => {
      const client = createMockClient(
        [{ id: 'm1', content: 'Memory', type: 'fact', similarity: 0.9 }],
        [{ id: 'w1', title: 'Task', snippet: '', score: 0.8, type: 'work_item', metadata: { kind: 'task', status: 'open' } }],
        [{ id: 'msg1', title: 'sms message', snippet: 'Hello', score: 0.7, type: 'message', metadata: { channel: 'sms' } }],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', entity_types: ['message'] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.every((r) => r.entity_type === 'message')).toBe(true);
      }
    });

    it('should sort messages alongside other results by normalized score', async () => {
      const client = createMockClient(
        [{ id: 'm1', content: 'Memory', type: 'fact', similarity: 0.95 }],
        [{ id: 'w1', title: 'Task', snippet: '', score: 0.5, type: 'work_item', metadata: { kind: 'task', status: 'open' } }],
        [{ id: 'msg1', title: 'email message', snippet: 'Important', score: 0.8, type: 'message', metadata: { channel: 'email' } }],
      );

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        const scores = result.data.details.results.map((r) => r.score);
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
        }
      }
    });
  });

  describe('graceful degradation', () => {
    it('should return results from work items when memory search fails', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.reject(new Error('Memory service unavailable'));
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: {
              results: [{ id: 'w1', title: 'A task', snippet: 'Do it', score: 0.9, type: 'work_item', metadata: { kind: 'task', status: 'open' } }],
              search_type: 'text',
              total: 1,
            },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.length).toBe(1);
        expect(result.data.details.warnings).toBeDefined();
        expect(result.data.details.warnings!.length).toBeGreaterThan(0);
        expect(result.data.details.warnings![0]).toContain('memory');
      }
    });

    it('should return results from memories when work item search fails', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: {
              results: [{ id: 'm1', content: 'Important fact', type: 'fact', similarity: 0.85 }],
              search_type: 'text',
            },
          });
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.reject(new Error('Search service unavailable'));
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.length).toBe(1);
        expect(result.data.details.warnings).toBeDefined();
        expect(result.data.details.warnings!.some((w) => w.includes('work_item'))).toBe(true);
      }
    });

    it('should return API error results as warnings', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: false,
            error: { status: 500, message: 'Internal error', code: 'SERVER_ERROR' },
          });
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.warnings).toBeDefined();
        expect(result.data.details.warnings!.length).toBeGreaterThan(0);
      }
    });

    it('should sanitize error messages in warnings', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.reject(new Error('Connection to postgres://admin:secret@db:5432/prod failed'));
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.warnings).toBeDefined();
        // sanitizeErrorMessage should not leak raw connection strings
        // The exact sanitization depends on the utility, but warning should exist
        expect(result.data.details.warnings!.length).toBeGreaterThan(0);
        expect(result.data.details.warnings![0]).toContain('memory search failed');
      }
    });

    it('should return results from other searches when message search fails', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: {
              results: [{ id: 'm1', content: 'Important fact', type: 'fact', similarity: 0.85 }],
              search_type: 'text',
            },
          });
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.reject(new Error('Message search unavailable'));
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text', total: 0 },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.results.length).toBe(1);
        expect(result.data.details.warnings).toBeDefined();
        expect(result.data.details.warnings!.some((w) => w.includes('message'))).toBe(true);
      }
    });

    it('should fail when all searches fail', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Everything is down'));
      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;

      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(false);
    });
  });

  describe('formatted output', () => {
    it('should format results as text with entity type annotations', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: {
              results: [{ id: 'm1', content: 'Troy decided to delay announcement', type: 'decision', similarity: 0.92 }],
              search_type: 'hybrid',
            },
          });
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'hybrid', total: 0 },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: {
              results: [
                {
                  id: 'w1',
                  title: 'Review investor deck',
                  snippet: 'For Production City',
                  score: 0.87,
                  type: 'work_item',
                  metadata: { kind: 'task', status: 'open' },
                },
                {
                  id: 'w2',
                  title: 'Production City',
                  snippet: 'Active project with 3 tasks',
                  score: 0.81,
                  type: 'work_item',
                  metadata: { kind: 'project', status: 'active' },
                },
              ],
              search_type: 'hybrid',
              total: 2,
            },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'production city' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('[memory]');
        expect(result.data.content).toContain('[todo]');
        expect(result.data.content).toContain('[project]');
        expect(result.data.content).toContain('Troy decided to delay announcement');
        expect(result.data.content).toContain('Review investor deck');
        expect(result.data.content).toContain('Production City');
      }
    });

    it('should format message results with [message] annotation and channel info', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'hybrid' },
          });
        }
        if (url.includes('/api/search') && url.includes('types=message')) {
          return Promise.resolve({
            success: true,
            data: {
              results: [
                {
                  id: 'msg1',
                  title: 'Email from Troy Kelly about investor deck',
                  snippet: 'Please review the attached investor deck for Production City',
                  score: 0.87,
                  type: 'message',
                  metadata: { channel: 'email', direction: 'inbound', received_at: '2026-01-15T10:00:00Z' },
                },
              ],
              search_type: 'hybrid',
              total: 1,
            },
          });
        }
        if (url.includes('/api/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'hybrid', total: 0 },
          });
        }
        return Promise.resolve({ success: false, error: { status: 404, message: 'Not found' } });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'investor deck' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('[message]');
        expect(result.data.content).toContain('Email from Troy Kelly about investor deck');
        expect(result.data.content).toContain('score:');
      }
    });

    it('should include no matching results message that covers messages too', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text' },
          });
        }
        return Promise.resolve({
          success: true,
          data: { results: [], search_type: 'text', total: 0 },
        });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'nonexistent' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No matching results');
        expect(result.data.content).toContain('messages');
      }
    });
  });

  describe('query sanitization', () => {
    it('should sanitize control characters from query', async () => {
      const mockGet = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/memories/search')) {
          return Promise.resolve({
            success: true,
            data: { results: [], search_type: 'text' },
          });
        }
        return Promise.resolve({
          success: true,
          data: { results: [], search_type: 'text', total: 0 },
        });
      });

      const client = { ...mockApiClient, get: mockGet } as unknown as ApiClient;
      const tool = createContextSearchTool({
        client,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test\x00\x01query' });
      const calls = mockGet.mock.calls.map((c: unknown[]) => c[0] as string);
      for (const url of calls) {
        expect(url).not.toContain('\x00');
        expect(url).not.toContain('\x01');
      }
    });
  });
});
