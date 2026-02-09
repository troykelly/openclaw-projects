/**
 * Tests for contact management tools.
 * Covers contact_search, contact_get, and contact_create.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createContactSearchTool,
  createContactGetTool,
  createContactCreateTool,
  type ContactSearchParams,
  type ContactGetParams,
  type ContactCreateParams,
} from '../../src/tools/contacts.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('contact tools', () => {
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

  describe('contact_search', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createContactSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.name).toBe('contact_search');
      });

      it('should have description', () => {
        const tool = createContactSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });

    describe('parameter validation', () => {
      it('should require query parameter', async () => {
        const tool = createContactSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({} as ContactSearchParams);
        expect(result.success).toBe(false);
      });

      it('should reject empty query', async () => {
        const tool = createContactSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ query: '' });
        expect(result.success).toBe(false);
      });

      it('should reject query over 200 characters', async () => {
        const tool = createContactSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ query: 'a'.repeat(201) });
        expect(result.success).toBe(false);
      });

      it('should accept valid query', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { contacts: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactSearchTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ query: 'john' });
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('q=john'), expect.any(Object));
      });

      it('should accept limit within range', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { contacts: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactSearchTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ query: 'john', limit: 30 });
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=30'), expect.any(Object));
      });

      it('should reject limit above 50', async () => {
        const tool = createContactSearchTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ query: 'john', limit: 51 });
        expect(result.success).toBe(false);
      });
    });

    describe('response formatting', () => {
      it('should format contacts as list', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            contacts: [
              { id: 'c1', name: 'John Doe', email: 'john@example.com', phone: '+1234567890' },
              { id: 'c2', name: 'Jane Smith', email: 'jane@example.com' },
            ],
            total: 2,
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactSearchTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ query: 'john' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('John Doe');
          expect(result.data.content).toContain('john@example.com');
          expect(result.data.content).toContain('Jane Smith');
          expect(result.data.details.total).toBe(2);
        }
      });

      it('should handle empty results', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { contacts: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactSearchTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ query: 'nonexistent' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('No contacts found');
        }
      });
    });
  });

  describe('contact_get', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createContactGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.name).toBe('contact_get');
      });
    });

    describe('parameter validation', () => {
      it('should require id parameter', async () => {
        const tool = createContactGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({} as ContactGetParams);
        expect(result.success).toBe(false);
      });

      it('should validate UUID format', async () => {
        const tool = createContactGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ id: 'not-a-uuid' });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('UUID');
        }
      });

      it('should accept valid UUID', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { id: '123e4567-e89b-12d3-a456-426614174000', name: 'John Doe' },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactGetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });
        expect(mockGet).toHaveBeenCalled();
      });
    });

    describe('response', () => {
      it('should return contact details', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'John Doe',
            email: 'john@example.com',
            phone: '+1234567890',
            notes: 'Important client',
            createdAt: '2024-01-01T00:00:00Z',
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactGetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('John Doe');
          expect(result.data.content).toContain('john@example.com');
          expect(result.data.content).toContain('+1234567890');
          expect(result.data.content).toContain('Important client');
          expect(result.data.details.contact.name).toBe('John Doe');
        }
      });

      it('should handle not found', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Contact not found', code: 'NOT_FOUND' },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createContactGetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('not found');
        }
      });
    });
  });

  describe('contact_create', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.name).toBe('contact_create');
      });
    });

    describe('parameter validation', () => {
      it('should require name parameter', async () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({} as ContactCreateParams);
        expect(result.success).toBe(false);
      });

      it('should reject empty name', async () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: '' });
        expect(result.success).toBe(false);
      });

      it('should reject name over 200 characters', async () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: 'a'.repeat(201) });
        expect(result.success).toBe(false);
      });

      it('should accept valid email format', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'John Doe' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createContactCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ name: 'John Doe', email: 'john@example.com' });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            email: 'john@example.com',
          }),
          expect.any(Object),
        );
      });

      it('should reject invalid email format', async () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: 'John Doe', email: 'invalid-email' });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.toLowerCase()).toContain('email');
        }
      });

      it('should accept valid phone in E.164 format', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'John Doe' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createContactCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ name: 'John Doe', phone: '+1234567890' });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            phone: '+1234567890',
          }),
          expect.any(Object),
        );
      });

      it('should reject obviously invalid phone', async () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: 'John Doe', phone: 'abc' });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.toLowerCase()).toContain('phone');
        }
      });

      it('should reject notes over 2000 characters', async () => {
        const tool = createContactCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({
          name: 'John Doe',
          notes: 'a'.repeat(2001),
        });
        expect(result.success).toBe(false);
      });
    });

    describe('API interaction', () => {
      it('should call POST /api/contacts with correct body', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'John Doe' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createContactCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          notes: 'Important client',
        });

        expect(mockPost).toHaveBeenCalledWith(
          '/api/contacts',
          expect.objectContaining({
            name: 'John Doe',
            email: 'john@example.com',
            phone: '+1234567890',
            notes: 'Important client',
          }),
          expect.objectContaining({ userId: 'agent-1' }),
        );
      });
    });

    describe('response', () => {
      it('should return new contact ID', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'John Doe' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createContactCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: 'John Doe' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Created');
          expect(result.data.details.id).toBe('new-123');
        }
      });
    });

    describe('input sanitization', () => {
      it('should strip HTML tags from name', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'John Doe' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createContactCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ name: '<script>alert("xss")</script>John Doe' });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            name: 'John Doe',
          }),
          expect.any(Object),
        );
      });

      it('should strip HTML tags from notes', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'John Doe' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createContactCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ name: 'John Doe', notes: '<b>Important</b> client' });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            notes: 'Important client',
          }),
          expect.any(Object),
        );
      });
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createContactSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'john' });
      expect(result.success).toBe(false);
    });

    it('should handle network errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, get: mockGet };

      const tool = createContactSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'john' });
      expect(result.success).toBe(false);
    });

    it('should not expose internal details in error messages', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Connection refused to internal-db:5432'));
      const client = { ...mockApiClient, post: mockPost };

      const tool = createContactCreateTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ name: 'John Doe' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).not.toContain('5432');
        expect(result.error).not.toContain('internal-db');
      }
    });
  });

  describe('PII handling', () => {
    it('should not log contact details at info level', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          contacts: [{ id: 'c1', name: 'John Doe', email: 'john@example.com' }],
          total: 1,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createContactSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'john' });

      // Check that info logs don't contain PII
      for (const call of (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls) {
        const logMessage = JSON.stringify(call);
        expect(logMessage).not.toContain('john@example.com');
        expect(logMessage).not.toContain('John Doe');
      }
    });
  });

  describe('user scoping', () => {
    it('should include userId in all API calls', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { contacts: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createContactSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user',
      });

      await tool.execute({ query: 'john' });

      expect(mockGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'custom-user' }));
    });
  });
});
