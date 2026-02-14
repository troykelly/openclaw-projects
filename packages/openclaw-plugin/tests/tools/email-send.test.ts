import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createEmailSendTool, EmailSendParamsSchema } from '../../src/tools/email-send.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('email_send tool', () => {
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
      twilioAccountSid: 'ACtest123',
      twilioAuthToken: 'test-token',
      twilioPhoneNumber: '+15551234567',
      postmarkToken: 'pm-test-token',
      postmarkFromEmail: 'sender@example.com',
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

  describe('EmailSendParamsSchema', () => {
    it('should accept valid parameters', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'This is a test email body.',
      });
      expect(result.success).toBe(true);
    });

    it('should accept parameters with optional fields', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'This is a test email body.',
        htmlBody: '<p>This is a test email body.</p>',
        threadId: 'thread-123',
        idempotencyKey: 'unique-key-123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing to', () => {
      const result = EmailSendParamsSchema.safeParse({
        subject: 'Test Subject',
        body: 'Test body',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing subject', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        body: 'Test body',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing body', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        subject: 'Test Subject',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty subject', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        subject: '',
        body: 'Test body',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty body', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email format', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'invalid-email',
        subject: 'Test Subject',
        body: 'Test body',
      });
      expect(result.success).toBe(false);
    });

    it('should accept various valid email formats', () => {
      const validEmails = ['simple@example.com', 'user.name@example.com', 'user+tag@example.com', 'user@subdomain.example.com'];

      for (const email of validEmails) {
        const result = EmailSendParamsSchema.safeParse({
          to: email,
          subject: 'Test',
          body: 'Test',
        });
        expect(result.success, `Expected ${email} to be valid`).toBe(true);
      }
    });

    it('should reject subject over 998 characters', () => {
      const result = EmailSendParamsSchema.safeParse({
        to: 'recipient@example.com',
        subject: 'a'.repeat(999),
        body: 'Test body',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createEmailSendTool', () => {
    it('should create tool with correct name', () => {
      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });
      expect(tool.name).toBe('email_send');
    });

    it('should have a description', () => {
      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameters schema', () => {
      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should send email successfully', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: {
          messageId: 'MSG123456',
          threadId: 'TH789',
          status: 'sent',
        },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test email body',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.details?.messageId).toBe('MSG123456');
      expect(result.data?.details?.status).toBe('sent');
    });

    it('should call API with correct parameters', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: { messageId: 'MSG123', status: 'sent' },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test message',
        htmlBody: '<p>Test message</p>',
        threadId: 'thread-123',
        idempotencyKey: 'key-123',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/api/postmark/email/send',
        {
          to: 'recipient@example.com',
          subject: 'Test Subject',
          body: 'Test message',
          htmlBody: '<p>Test message</p>',
          threadId: 'thread-123',
          idempotencyKey: 'key-123',
        },
        { userId },
      );
    });

    it('should handle API errors', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: false,
        error: {
          status: 400,
          code: 'INVALID_EMAIL',
          message: 'Invalid recipient email address',
        },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid recipient email address');
    });

    it('should handle network errors', async () => {
      vi.mocked(mockClient.post).mockRejectedValue(new Error('Network error'));

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate parameters before sending', async () => {
      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'invalid-email',
        subject: 'Test Subject',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('to');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('should validate subject before sending', async () => {
      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: '',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('subject');
      expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('should call API even when Postmark is not configured in plugin config', async () => {
      // The API server has its own Postmark credentials via env vars,
      // so the plugin should NOT block email_send when plugin-level
      // Postmark config is missing. See issue #1174.
      const configWithoutPostmark = {
        ...mockConfig,
        postmarkToken: undefined,
        postmarkFromEmail: undefined,
      };

      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: {
          messageId: 'MSG-NO-CONFIG',
          threadId: 'TH-NO-CONFIG',
          status: 'sent',
        },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: configWithoutPostmark,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test message',
      });

      // Should succeed — the API handles Postmark auth, not the plugin
      expect(result.success).toBe(true);
      expect(mockClient.post).toHaveBeenCalledWith(
        '/api/postmark/email/send',
        expect.objectContaining({
          to: 'recipient@example.com',
          subject: 'Test Subject',
          body: 'Test message',
        }),
        { userId },
      );
    });

    it('should call API when only postmarkToken is missing from plugin config', async () => {
      const configPartial = {
        ...mockConfig,
        postmarkToken: undefined,
      };

      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: { messageId: 'MSG-PARTIAL', status: 'sent' },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: configPartial,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test',
        body: 'Test body',
      });

      expect(result.success).toBe(true);
      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should call API when only postmarkFromEmail is missing from plugin config', async () => {
      const configPartial = {
        ...mockConfig,
        postmarkFromEmail: undefined,
      };

      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: { messageId: 'MSG-PARTIAL2', status: 'sent' },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: configPartial,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test',
        body: 'Test body',
      });

      expect(result.success).toBe(true);
      expect(mockClient.post).toHaveBeenCalled();
    });

    it('should log successful sends', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: { messageId: 'MSG123', status: 'sent' },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test message',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('email_send invoked', expect.objectContaining({ userId }));
    });

    it('should not log email address in errors', async () => {
      vi.mocked(mockClient.post).mockRejectedValue(new Error('Failed to send to recipient@example.com'));

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      // Error message should be sanitized
      expect(result.error).not.toContain('recipient@example.com');
    });

    it('should handle bounce errors gracefully', async () => {
      vi.mocked(mockClient.post).mockResolvedValue({
        success: false,
        error: {
          status: 422,
          code: 'HARD_BOUNCE',
          message: 'The recipient email address has bounced',
        },
      });

      const tool = createEmailSendTool({
        client: mockClient,
        logger: mockLogger,
        config: mockConfig,
        userId,
      });

      const result = await tool.execute({
        to: 'bounced@example.com',
        subject: 'Test Subject',
        body: 'Test message',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('bounced');
    });
  });
});
