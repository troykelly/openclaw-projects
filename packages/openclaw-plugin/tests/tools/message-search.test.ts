import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createMessageSearchTool, MessageSearchParamsSchema } from '../../src/tools/message-search.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('message_search tool', () => {
  let mockClient: ApiClient;
  let mockLogger: Logger;
  let mockConfig: PluginConfig;
  const userId = 'test-user-id';

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient;

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockConfig = {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      autoRecall: true,
      autoCapture: true,
      userScoping: 'agent',
      maxRecallMemories: 5,
      minRecallScore: 0.7,
      timeout: 30000,
      maxRetries: 3,
      secretCommandTimeout: 5000,
      debug: false,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MessageSearchParamsSchema', () => {
    it('should accept valid query-only parameters', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'What did John say about the meeting?',
      });
      expect(result.success).toBe(true);
    });

    it('should accept parameters with all optional fields', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'invoice discussion',
        channel: 'email',
        contactId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 20,
        includeThread: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing query', () => {
      const result = MessageSearchParamsSchema.safeParse({
        channel: 'sms',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty query', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid channel', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'test',
        channel: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid channel values', () => {
      const channels = ['sms', 'email', 'all'];
      for (const channel of channels) {
        const result = MessageSearchParamsSchema.safeParse({
          query: 'test',
          channel,
        });
        expect(result.success, `Expected channel '${channel}' to be valid`).toBe(true);
      }
    });

    it('should reject limit below 1', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'test',
        limit: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject limit above 100', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'test',
        limit: 101,
      });
      expect(result.success).toBe(false);
    });

    it('should use default limit of 10 when not provided', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(10);
      }
    });

    it('should use default channel of all when not provided', () => {
      const result = MessageSearchParamsSchema.safeParse({
        query: 'test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.channel).toBe('all');
      }
    });
  });

  describe('createMessageSearchTool', () => {
    it('should create tool with correct name', () => {
      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });
      expect(tool.name).toBe('message_search');
    });

    it('should have a description', () => {
      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameters schema', () => {
      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should search messages successfully', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'msg-1',
              body: 'Let me check the invoice',
              direction: 'inbound',
              channel: 'email',
              contactName: 'John Smith',
              timestamp: '2024-01-15T10:30:00Z',
              score: 0.95,
            },
            {
              id: 'msg-2',
              body: 'Invoice #1234 has been paid',
              direction: 'outbound',
              channel: 'email',
              contactName: 'John Smith',
              timestamp: '2024-01-15T10:35:00Z',
              score: 0.87,
            },
          ],
          total: 2,
        },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        query: 'invoice',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.details?.messages).toHaveLength(2);
      expect(result.data?.details?.total).toBe(2);
    });

    it('should call API with correct parameters', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: true,
        data: { results: [], total: 0 },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      await tool.execute({
        query: 'meeting notes',
        channel: 'sms',
        contactId: '123e4567-e89b-12d3-a456-426614174000',
        limit: 15,
      });

      expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/search'), { userId });
      const callUrl = (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callUrl).toContain('q=meeting+notes');
      expect(callUrl).toContain('types=message');
      expect(callUrl).toContain('channel=sms');
      expect(callUrl).toContain('contactId=123e4567-e89b-12d3-a456-426614174000');
      expect(callUrl).toContain('limit=15');
    });

    it('should not send channel when set to all', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: true,
        data: { results: [], total: 0 },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      await tool.execute({
        query: 'test',
        channel: 'all',
      });

      const callUrl = (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callUrl).not.toContain('channel=');
    });

    it('should handle API errors', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: false,
        error: {
          status: 500,
          code: 'INTERNAL_ERROR',
          message: 'Search service unavailable',
        },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search service unavailable');
    });

    it('should handle network errors', async () => {
      vi.mocked(mockClient.get).mockRejectedValue(new Error('Network error'));

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate parameters before searching', async () => {
      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        query: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('query');
      expect(mockClient.get).not.toHaveBeenCalled();
    });

    it('should return empty results gracefully', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: true,
        data: { results: [], total: 0 },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        query: 'nonexistent message',
      });

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain('No messages found');
      expect(result.data?.details?.messages).toHaveLength(0);
    });

    it('should log search invocation', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: true,
        data: { results: [], total: 0 },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      await tool.execute({
        query: 'test search',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('message_search invoked', expect.objectContaining({ userId }));
    });

    it('should format results with similarity scores', async () => {
      vi.mocked(mockClient.get).mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'msg-1',
              body: 'Test message content',
              direction: 'inbound',
              channel: 'sms',
              contactName: 'Test Contact',
              timestamp: '2024-01-15T10:30:00Z',
              score: 0.92,
            },
          ],
          total: 1,
        },
      });

      const tool = createMessageSearchTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.data?.details?.messages[0]?.similarity).toBe(0.92);
    });
  });
});
