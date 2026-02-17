/**
 * Tests for file_share tool.
 * Part of Epic #574, Issue #584.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFileShareTool, FileShareParamsSchema, type FileShareParams } from '../../src/tools/file-share.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';

describe('file_share tool', () => {
  let mockClient: ApiClient;
  let mockLogger: Logger;
  const user_id = 'test-user';

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as unknown as ApiClient;

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as Logger;
  });

  describe('schema validation', () => {
    it('should accept valid params', () => {
      const params: FileShareParams = {
        file_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_in: 3600,
        max_downloads: 10,
      };
      const result = FileShareParamsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });

    it('should accept minimal params', () => {
      const params = {
        file_id: '550e8400-e29b-41d4-a716-446655440000',
      };
      const result = FileShareParamsSchema.safeParse(params);
      expect(result.success).toBe(true);
      expect(result.data?.expires_in).toBe(3600); // default
    });

    it('should reject invalid file_id', () => {
      const params = {
        file_id: 'not-a-uuid',
      };
      const result = FileShareParamsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should reject expires_in less than 60', () => {
      const params = {
        file_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_in: 30,
      };
      const result = FileShareParamsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should reject expires_in greater than 604800', () => {
      const params = {
        file_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_in: 1000000,
      };
      const result = FileShareParamsSchema.safeParse(params);
      expect(result.success).toBe(false);
    });
  });

  describe('tool execution', () => {
    it('should return success with share URL', async () => {
      const tool = createFileShareTool({
        client: mockClient,
        logger: mockLogger,
        user_id,
      });

      const mockResponse = {
        success: true,
        data: {
          share_token: 'abc123xyz',
          url: 'https://example.com/api/files/shared/abc123xyz',
          expires_at: '2026-02-05T10:00:00Z',
          expires_in: 3600,
          filename: 'document.pdf',
          content_type: 'application/pdf',
          size_bytes: 1048576,
        },
      };

      vi.mocked(mockClient.post).mockResolvedValue(mockResponse);

      const result = await tool.execute({
        file_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_in: 3600,
      });

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain('document.pdf');
      expect(result.data?.content).toContain('1.0 MB');
      expect(result.data?.content).toContain('https://example.com/api/files/shared/abc123xyz');
      expect(result.data?.details?.url).toBe('https://example.com/api/files/shared/abc123xyz');
    });

    it('should return error for API failure', async () => {
      const tool = createFileShareTool({
        client: mockClient,
        logger: mockLogger,
        user_id,
      });

      vi.mocked(mockClient.post).mockResolvedValue({
        success: false,
        error: {
          status: 404,
          code: 'NOT_FOUND',
          message: 'File not found',
        },
      });

      const result = await tool.execute({
        file_id: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should include max_downloads in message when specified', async () => {
      const tool = createFileShareTool({
        client: mockClient,
        logger: mockLogger,
        user_id,
      });

      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: {
          share_token: 'abc123xyz',
          url: 'https://example.com/api/files/shared/abc123xyz',
          expires_at: '2026-02-05T10:00:00Z',
          expires_in: 3600,
          filename: 'document.pdf',
          content_type: 'application/pdf',
          size_bytes: 1048576,
        },
      });

      const result = await tool.execute({
        file_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_in: 3600,
        max_downloads: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data?.content).toContain('max 5 downloads');
    });

    it('should log invocation', async () => {
      const tool = createFileShareTool({
        client: mockClient,
        logger: mockLogger,
        user_id,
      });

      vi.mocked(mockClient.post).mockResolvedValue({
        success: true,
        data: {
          share_token: 'abc123xyz',
          url: 'https://example.com/api/files/shared/abc123xyz',
          expires_at: '2026-02-05T10:00:00Z',
          expires_in: 3600,
          filename: 'document.pdf',
          content_type: 'application/pdf',
          size_bytes: 1048576,
        },
      });

      await tool.execute({
        file_id: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'file_share invoked',
        expect.objectContaining({
          user_id,
          file_id: '550e8400-e29b-41d4-a716-446655440000',
        }),
      );
    });
  });
});
