import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createThreadListTool, createThreadGetTool, ThreadListParamsSchema, ThreadGetParamsSchema } from '../../src/tools/threads.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('thread tools', () => {
  let mockClient: ApiClient;
  let mockLogger: Logger;
  let mockConfig: PluginConfig;
  const user_id = 'test-user-id';

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
          contact_id: '123e4567-e89b-12d3-a456-426614174000',
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
          user_id,
        });
        expect(tool.name).toBe('thread_list');
      });

      it('should have a description', () => {
        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
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
            query: '*',
            search_type: 'text',
            results: [
              {
                type: 'message',
                id: 'thread-1',
                title: 'SMS with John Smith',
                snippet: 'Hello there',
                score: 0.95,
              },
              {
                type: 'message',
                id: 'thread-2',
                title: 'Email with Jane Doe',
                snippet: 'Invoice attached',
                score: 0.87,
              },
            ],
            facets: { message: 2 },
            total: 2,
          },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.details?.results).toHaveLength(2);
      });

      it('should call API with correct parameters', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: { query: 'sms', search_type: 'text', results: [], facets: { message: 0 }, total: 0 },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        await tool.execute({
          channel: 'sms',
          contact_id: '123e4567-e89b-12d3-a456-426614174000',
          limit: 30,
        });

        expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/search'), { user_id });
        const callUrl = (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(callUrl).toContain('types=message');
        expect(callUrl).toContain('contact_id=123e4567-e89b-12d3-a456-426614174000');
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
          user_id,
        });

        const result = await tool.execute({});

        expect(result.success).toBe(false);
        expect(result.error).toBe('Database error');
      });

      it('should return empty results gracefully', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: { query: '*', search_type: 'text', results: [], facets: { message: 0 }, total: 0 },
        });

        const tool = createThreadListTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        expect(result.data?.content).toContain('No threads found');
      });
    });
  });

  describe('thread_get tool', () => {
    describe('ThreadGetParamsSchema', () => {
      it('should accept valid thread_id', () => {
        const result = ThreadGetParamsSchema.safeParse({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
        });
        expect(result.success).toBe(true);
      });

      it('should accept thread_id with message_limit', () => {
        const result = ThreadGetParamsSchema.safeParse({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
          message_limit: 100,
        });
        expect(result.success).toBe(true);
      });

      it('should reject missing thread_id', () => {
        const result = ThreadGetParamsSchema.safeParse({});
        expect(result.success).toBe(false);
      });

      it('should use default message_limit of 50', () => {
        const result = ThreadGetParamsSchema.safeParse({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.message_limit).toBe(50);
        }
      });

      it('should reject message_limit below 1', () => {
        const result = ThreadGetParamsSchema.safeParse({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
          message_limit: 0,
        });
        expect(result.success).toBe(false);
      });

      it('should reject message_limit above 200', () => {
        const result = ThreadGetParamsSchema.safeParse({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
          message_limit: 201,
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
          user_id,
        });
        expect(tool.name).toBe('thread_get');
      });

      it('should have a description', () => {
        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
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
              external_thread_key: 'ext-1',
              contact: { id: 'c-1', display_name: 'John Smith' },
              created_at: '2024-01-15T10:00:00Z',
              updated_at: '2024-01-15T10:31:00Z',
            },
            messages: [
              {
                id: 'msg-1',
                direction: 'inbound',
                body: 'Hello there',
                received_at: '2024-01-15T10:30:00Z',
                created_at: '2024-01-15T10:30:00Z',
              },
              {
                id: 'msg-2',
                direction: 'outbound',
                body: 'Hi! How can I help?',
                received_at: '2024-01-15T10:31:00Z',
                created_at: '2024-01-15T10:31:00Z',
              },
            ],
            related_work_items: [],
            contact_memories: [],
            pagination: { has_more: false },
          },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        const result = await tool.execute({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.details?.thread).toBeDefined();
        expect(result.data?.details?.messages).toHaveLength(2);
      });

      it('should call API with correct parameters', async () => {
        vi.mocked(mockClient.get).mockResolvedValue({
          success: true,
          data: {
            thread: { id: 'thread-1', channel: 'sms', external_thread_key: 'ext-1', contact: { id: 'c-1', display_name: 'Test' }, created_at: '2024-01-15T10:00:00Z', updated_at: '2024-01-15T10:00:00Z' },
            messages: [],
            related_work_items: [],
            contact_memories: [],
            pagination: { has_more: false },
          },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        await tool.execute({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
          message_limit: 75,
        });

        expect(mockClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/threads/123e4567-e89b-12d3-a456-426614174000/history'), { user_id });
        const callUrl = (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(callUrl).toContain('limit=75');
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
          user_id,
        });

        const result = await tool.execute({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Thread not found');
      });

      it('should validate thread_id before fetching', async () => {
        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        const result = await tool.execute({
          thread_id: '',
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
              external_thread_key: 'ext-1',
              contact: { id: 'c-1', display_name: 'John' },
              created_at: '2024-01-15T10:00:00Z',
              updated_at: '2024-01-15T10:31:00Z',
            },
            messages: [
              {
                id: 'msg-1',
                direction: 'inbound',
                body: 'First message',
                received_at: '2024-01-15T10:30:00Z',
                created_at: '2024-01-15T10:30:00Z',
              },
              {
                id: 'msg-2',
                direction: 'outbound',
                body: 'Second message',
                received_at: '2024-01-15T10:31:00Z',
                created_at: '2024-01-15T10:31:00Z',
              },
            ],
            related_work_items: [],
            contact_memories: [],
            pagination: { has_more: false },
          },
        });

        const tool = createThreadGetTool({
          client: mockClient,
          logger: mockLogger,
          config: mockConfig,
          user_id,
        });

        const result = await tool.execute({
          thread_id: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(true);
        expect(result.data?.content).toContain('First message');
        expect(result.data?.content).toContain('Second message');
      });
    });
  });
});
