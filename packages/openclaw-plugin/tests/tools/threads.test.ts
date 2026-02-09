import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createThreadListTool, createThreadGetTool, ThreadListParamsSchema, ThreadGetParamsSchema } from '../../src/tools/threads.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('thread tools', () => {
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

  describe('thread_list tool', () => {
    describe('ThreadListParamsSchema', () => {
      it('should accept empty parameters', () => {
        const result = ThreadListParamsSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it('should accept parameters with channel filter', () => {
        const result = ThreadListParamsSchema.safeParse({
          channel: 'sms',
        });
        expect(result.success).toBe(true);
      });

      it('should accept parameters with all fields', () => {
        const result = ThreadListParamsSchema.safeParse({
          channel: 'email',
          contactId: '123e4567-e89b-12d3-a456-426614174000',
          limit: 50,
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid channel', () => {
        const result = ThreadListParamsSchema.safeParse({
          channel: 'invalid',
        });
        expect(result.success).toBe(false);
      });

      it('should accept valid channel values', () => {
        const channels = ['sms', 'email'];
        for (const channel of channels) {
          const result = ThreadListParamsSchema.safeParse({ channel });
          expect(result.success, `Expected channel '${channel}' to be valid`).toBe(true);
        }
      });

      it('should use default limit of 20', () => {
        const result = ThreadListParamsSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(20);
        }
      });

      it('should reject limit below 1', () => {
        const result = ThreadListParamsSchema.safeParse({
          limit: 0,
        });
        expect(result.success).toBe(false);
      });

      it('should reject limit above 100', () => {
        const result = ThreadListParamsSchema.safeParse({
          limit: 101,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('createThreadListTool', () => {
      it('should create tool with correct name', () => {
        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });
        expect(tool.name).toBe('thread_list');
      });

      it('should have a description', () => {
        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });

    describe('execute', () => {
      it('should list threads successfully', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: {
            threads: [
              {
                id: 'thread-1',
                channel: 'sms',
                contactName: 'John Smith',
                endpointValue: '+15551234567',
                messageCount: 15,
                lastMessageAt: '2024-01-15T10:30:00Z',
              },
              {
                id: 'thread-2',
                channel: 'email',
                contactName: 'Jane Doe',
                endpointValue: 'jane@example.com',
                messageCount: 8,
                lastMessageAt: '2024-01-14T14:20:00Z',
              },
            ],
            total: 2,
          },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.details?.threads).toHaveLength(2);
      });

      it('should call API with correct parameters', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: { threads: [], total: 0 },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        await tool.execute({
          channel: 'sms',
          contactId: '123e4567-e89b-12d3-a456-426614174000',
          limit: 30,
        });

        expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/threads'), { userId });
        const callUrl = (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(callUrl).toContain('channel=sms');
        expect(callUrl).toContain('contactId=123e4567-e89b-12d3-a456-426614174000');
        expect(callUrl).toContain('limit=30');
      });

      it('should handle API errors', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: false,
          error: {
            status: 500,
            code: 'INTERNAL_ERROR',
            message: 'Database error',
          },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({});

        expect(result.success).toBe(false);
        expect(result.error).toBe('Database error');
      });

      it('should return empty results gracefully', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: { threads: [], total: 0 },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.data?.content).toContain('No threads found');
      });
    });
  });

  describe('thread_get tool', () => {
    describe('ThreadGetParamsSchema', () => {
      it('should accept valid threadId', () => {
        const result = ThreadGetParamsSchema.safeParse({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
        });
        expect(result.success).toBe(true);
      });

      it('should accept threadId with messageLimit', () => {
        const result = ThreadGetParamsSchema.safeParse({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
          messageLimit: 100,
        });
        expect(result.success).toBe(true);
      });

      it('should reject missing threadId', () => {
        const result = ThreadGetParamsSchema.safeParse({});
        expect(result.success).toBe(false);
      });

      it('should use default messageLimit of 50', () => {
        const result = ThreadGetParamsSchema.safeParse({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.messageLimit).toBe(50);
        }
      });

      it('should reject messageLimit below 1', () => {
        const result = ThreadGetParamsSchema.safeParse({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
          messageLimit: 0,
        });
        expect(result.success).toBe(false);
      });

      it('should reject messageLimit above 200', () => {
        const result = ThreadGetParamsSchema.safeParse({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
          messageLimit: 201,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('createThreadGetTool', () => {
      it('should create tool with correct name', () => {
        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });
        expect(tool.name).toBe('thread_get');
      });

      it('should have a description', () => {
        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });

    describe('execute', () => {
      it('should get thread with messages successfully', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: {
            thread: {
              id: 'thread-1',
              channel: 'sms',
              contactName: 'John Smith',
              endpointValue: '+15551234567',
            },
            messages: [
              {
                id: 'msg-1',
                direction: 'inbound',
                body: 'Hello there',
                deliveryStatus: 'delivered',
                createdAt: '2024-01-15T10:30:00Z',
              },
              {
                id: 'msg-2',
                direction: 'outbound',
                body: 'Hi! How can I help?',
                deliveryStatus: 'sent',
                createdAt: '2024-01-15T10:31:00Z',
              },
            ],
          },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.details?.thread).toBeDefined();
        expect(result.data?.details?.messages).toHaveLength(2);
      });

      it('should call API with correct parameters', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: { thread: {}, messages: [] },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        await tool.execute({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
          messageLimit: 75,
        });

        expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/threads/123e4567-e89b-12d3-a456-426614174000'), { userId });
        const callUrl = (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(callUrl).toContain('messageLimit=75');
      });

      it('should handle thread not found', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: false,
          error: {
            status: 404,
            code: 'NOT_FOUND',
            message: 'Thread not found',
          },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Thread not found');
      });

      it('should validate threadId before fetching', async () => {
        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({
          threadId: '',
        });

        expect(result.success).toBe(false);
        expect(mockClient.get).not.toHaveBeenCalled();
      });

      it('should format messages in chronological order', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: {
            thread: {
              id: 'thread-1',
              channel: 'sms',
              contactName: 'John',
            },
            messages: [
              {
                id: 'msg-1',
                direction: 'inbound',
                body: 'First message',
                createdAt: '2024-01-15T10:30:00Z',
              },
              {
                id: 'msg-2',
                direction: 'outbound',
                body: 'Second message',
                createdAt: '2024-01-15T10:31:00Z',
              },
            ],
          },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          userId,
        });

        const result = await tool.execute({
          threadId: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(true);
        expect(result.data?.content).toContain('First message');
        expect(result.data?.content).toContain('Second message');
      });
    });
  });
});
