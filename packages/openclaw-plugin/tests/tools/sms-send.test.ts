import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSmsSendTool, SmsSendParamsSchema } from '../../src/tools/sms-send.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('sms_send tool', () => {
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
      twilioAccountSid: 'ACtest123',
      twilioAuthToken: 'test-token',
      twilioPhoneNumber: '+15551234567',
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

  describe('SmsSendParamsSchema', () => {
    it('should accept valid parameters', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '+15559876543',
        body: 'Hello, this is a test message!',
      });
      expect(result.success).toBe(true);
    });

    it('should accept parameters with idempotency_key', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '+15559876543',
        body: 'Test message',
        idempotency_key: 'unique-key-123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing to', () => {
      const result = SmsSendParamsSchema.safeParse({
        body: 'Test message',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing body', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '+15559876543',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty body', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '+15559876543',
        body: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject body over 1600 characters', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '+15559876543',
        body: 'a'.repeat(1601),
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid phone number format', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '555-123-4567', // Not E.164 format
        body: 'Test message',
      });
      expect(result.success).toBe(false);
    });

    it('should accept international E.164 numbers', () => {
      const result = SmsSendParamsSchema.safeParse({
        to: '+447911123456', // UK number
        body: 'Test message',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createSmsSendTool', () => {
    it('should create tool with correct name', () => {
      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });
      expect(tool.name).toBe('sms_send');
    });

    it('should have a description', () => {
      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameters schema', () => {
      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should send SMS successfully', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: {
          message_id: 'SM123456',
          thread_id: 'TH789',
          status: 'queued',
        },
      });

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      const result = await tool.execute({
        to: '+15559876543',
        body: 'Hello, this is a test!',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.details?.message_id).toBe('SM123456');
      expect(result.data?.details?.status).toBe('queued');
    });

    it('should call API with correct parameters', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: { message_id: 'SM123', status: 'queued' },
      });

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      await tool.execute({
        to: '+15559876543',
        body: 'Test message',
        idempotency_key: 'key-123',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/api/twilio/sms/send',
        {
          to: '+15559876543',
          body: 'Test message',
          idempotency_key: 'key-123',
        },
        { user_id },
      );
    });

    it('should handle API errors', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: false,
        error: {
          status: 400,
          code: 'INVALID_PHONE',
          message: 'Invalid phone number format',
        },
      });

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      const result = await tool.execute({
        to: '+15559876543',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid phone number format');
    });

    it('should handle network errors', async () => {
      vi.mocked(mockClient.post).mockRejectedValue(new Error('Network error'));

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      const result = await tool.execute({
        to: '+15559876543',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate parameters before sending', async () => {
      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      const result = await tool.execute({
        to: 'invalid-phone',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('to');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('should validate body length before sending', async () => {
      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      const result = await tool.execute({
        to: '+15559876543',
        body: 'a'.repeat(1601),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('1600');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('should warn when Twilio is not configured', async () => {
      const configWithoutTwilio = {
        ...mockConfig,
        twilioAccountSid: undefined,
        twilioAuthToken: undefined,
        twilioPhoneNumber: undefined,
      };

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: configWithoutTwilio,
        user_id,
      });

      const result = await tool.execute({
        to: '+15559876543',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Twilio');
    });

    it('should log successful sends', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: { message_id: 'SM123', status: 'queued' },
      });

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      await tool.execute({
        to: '+15559876543',
        body: 'Test message',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('sms_send invoked', expect.objectContaining({ user_id }));
    });

    it('should not log phone number in errors', async () => {
      vi.mocked(mockClient.post).mockRejectedValue(new Error('Connection failed to +15559876543'));

      const tool = createSmsSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        user_id,
      });

      const result = await tool.execute({
        to: '+15559876543',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      // Error message should be sanitized
      expect(result.error).not.toContain('+15559876543');
    });
  });
});
