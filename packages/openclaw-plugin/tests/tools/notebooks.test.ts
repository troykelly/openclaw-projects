/**
 * Tests for notebook tools.
 * Part of Epic #339, Issue #363
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createNotebookListTool,
  createNotebookCreateTool,
  createNotebookGetTool,
  type NotebookCreateParams,
  type NotebookGetParams,
} from '../../src/tools/notebooks.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('notebook tools', () => {
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
    baseUrl: 'https://app.example.com',
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

  describe('undefined baseUrl handling', () => {
    const noBaseUrlConfig: PluginConfig = {
      ...mockConfig,
      baseUrl: undefined,
    };

    it('notebook_list should omit url when baseUrl is undefined', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          notebooks: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              name: 'Work Notes',
              description: 'Notes for work',
              isArchived: false,
              noteCount: 5,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        },
      });

      const tool = createNotebookListTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        user_id: 'user@example.com',
      });

      const result = await tool.execute({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notebooks[0].url).toBeUndefined();
        expect(JSON.stringify(result.data)).not.toContain('undefined');
      }
    });

    it('notebook_create should omit url when baseUrl is undefined', async () => {
      (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'New Notebook',
          description: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      });

      const tool = createNotebookCreateTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        user_id: 'user@example.com',
      });

      const result = await tool.execute({ name: 'New Notebook' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBeUndefined();
        expect(JSON.stringify(result.data)).not.toContain('undefined');
      }
    });

    it('notebook_get should omit url when baseUrl is undefined', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Work Notes',
          description: null,
          isArchived: false,
          noteCount: 2,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      });

      const tool = createNotebookGetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        user_id: 'user@example.com',
      });

      const result = await tool.execute({
        notebook_id: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBeUndefined();
        expect(JSON.stringify(result.data)).not.toContain('undefined');
      }
    });

    it('notebook_get should omit url from notes when baseUrl is undefined', async () => {
      (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Work Notes',
          description: null,
          isArchived: false,
          noteCount: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          notes: [{ id: 'note-1', title: 'Note 1', visibility: 'private', updated_at: '2024-01-01' }],
        },
      });

      const tool = createNotebookGetTool({
        client: mockApiClient,
        logger: mockLogger,
        config: noBaseUrlConfig,
        user_id: 'user@example.com',
      });

      const result = await tool.execute({
        notebook_id: '123e4567-e89b-12d3-a456-426614174000',
        includeNotes: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBeUndefined();
        expect(result.data.notes).toBeDefined();
        expect(result.data.notes?.[0].url).toBeUndefined();
        expect(JSON.stringify(result.data)).not.toContain('undefined');
      }
    });
  });

  describe('notebook_list tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNotebookListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });
        expect(tool.name).toBe('notebook_list');
      });

      it('should have description', () => {
        const tool = createNotebookListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });
        expect(tool.description).toBeDefined();
        expect(tool.description).toContain('notebook');
      });

      it('should have parameter schema', () => {
        const tool = createNotebookListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });
        expect(tool.parameters).toBeDefined();
      });
    });

    describe('execution', () => {
      it('should list notebooks successfully', async () => {
        const mockNotebooks = {
          notebooks: [
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              name: 'Work Notes',
              description: 'Notes for work',
              isArchived: false,
              noteCount: 5,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
            {
              id: '223e4567-e89b-12d3-a456-426614174001',
              name: 'Personal',
              description: null,
              isArchived: false,
              noteCount: 10,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
          total: 2,
          limit: 50,
          offset: 0,
        };

        (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNotebooks,
        });

        const tool = createNotebookListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.notebooks.length).toBe(2);
          expect(result.data.notebooks[0].name).toBe('Work Notes');
          expect(result.data.notebooks[0].url).toContain(mockNotebooks.notebooks[0].id);
        }
      });

      it('should handle API errors', async () => {
        (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: { status: 500, message: 'Server error' },
        });

        const tool = createNotebookListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({});

        expect(result.success).toBe(false);
      });

      it('should pass pagination parameters', async () => {
        (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: { notebooks: [], total: 0, limit: 10, offset: 5 },
        });

        const tool = createNotebookListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        await tool.execute({ limit: 10, offset: 5 });

        expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('limit=10'), expect.anything());
        expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('offset=5'), expect.anything());
      });
    });
  });

  describe('notebook_create tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNotebookCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });
        expect(tool.name).toBe('notebook_create');
      });
    });

    describe('parameter validation', () => {
      it('should require name', async () => {
        const tool = createNotebookCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({} as NotebookCreateParams);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('name');
        }
      });

      it('should reject too long name', async () => {
        const tool = createNotebookCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({ name: 'a'.repeat(201) });
        expect(result.success).toBe(false);
      });
    });

    describe('execution', () => {
      it('should create notebook successfully', async () => {
        const mockNotebook = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'New Notebook',
          description: 'A test notebook',
          created_at: '2024-01-01T00:00:00Z',
        };

        (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNotebook,
        });

        const tool = createNotebookCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({
          name: 'New Notebook',
          description: 'A test notebook',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.id).toBe(mockNotebook.id);
          expect(result.data.name).toBe(mockNotebook.name);
          expect(result.data.url).toContain(mockNotebook.id);
        }
      });

      it('should sanitize name', async () => {
        (mockApiClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Test Notebook',
            description: null,
            created_at: '2024-01-01T00:00:00Z',
          },
        });

        const tool = createNotebookCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        await tool.execute({ name: 'Test\x00Notebook' });

        expect(mockApiClient.post).toHaveBeenCalledWith(
          '/api/notebooks',
          expect.objectContaining({
            name: 'TestNotebook',
          }),
          expect.anything(),
        );
      });
    });
  });

  describe('notebook_get tool', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createNotebookGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });
        expect(tool.name).toBe('notebook_get');
      });
    });

    describe('parameter validation', () => {
      it('should require valid UUID for notebook_id', async () => {
        const tool = createNotebookGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({ notebook_id: 'invalid' } as NotebookGetParams);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('UUID');
        }
      });
    });

    describe('execution', () => {
      it('should get notebook successfully', async () => {
        const mockNotebook = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Work Notes',
          description: 'Notes for work',
          isArchived: false,
          noteCount: 5,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        };

        (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNotebook,
        });

        const tool = createNotebookGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({
          notebook_id: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.id).toBe(mockNotebook.id);
          expect(result.data.name).toBe(mockNotebook.name);
          expect(result.data.noteCount).toBe(5);
        }
      });

      it('should handle not found', async () => {
        (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Not found' },
        });

        const tool = createNotebookGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({
          notebook_id: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain('not found');
        }
      });

      it('should include notes when requested', async () => {
        const mockNotebook = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Work Notes',
          description: null,
          isArchived: false,
          noteCount: 2,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          notes: [
            { id: 'note-1', title: 'Note 1', visibility: 'private', updated_at: '2024-01-01' },
            { id: 'note-2', title: 'Note 2', visibility: 'public', updated_at: '2024-01-01' },
          ],
        };

        (mockApiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: true,
          data: mockNotebook,
        });

        const tool = createNotebookGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          user_id: 'user@example.com',
        });

        const result = await tool.execute({
          notebook_id: '123e4567-e89b-12d3-a456-426614174000',
          includeNotes: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.notes).toBeDefined();
          expect(result.data.notes?.length).toBe(2);
          expect(result.data.notes?.[0].url).toContain('note-1');
        }

        expect(mockApiClient.get).toHaveBeenCalledWith(expect.stringContaining('expand=notes'), expect.anything());
      });
    });
  });
});
