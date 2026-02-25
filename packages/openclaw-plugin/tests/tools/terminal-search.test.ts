/**
 * Tests for terminal search and annotation tools.
 * Covers terminal_search and terminal_annotate.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createTerminalSearchTool,
  createTerminalAnnotateTool,
  type TerminalSearchParams,
  type TerminalAnnotateParams,
} from '../../src/tools/terminal-search.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('terminal search tools', () => {
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

  const options = {
    client: mockApiClient,
    logger: mockLogger,
    config: mockConfig,
    user_id: 'agent-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== terminal_search ====================

  describe('terminal_search', () => {
    it('should have correct name and description', () => {
      const tool = createTerminalSearchTool(options);
      expect(tool.name).toBe('terminal_search');
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should require query parameter', async () => {
      const tool = createTerminalSearchTool(options);
      const result = await tool.execute({} as TerminalSearchParams);
      expect(result.success).toBe(false);
    });

    it('should reject empty query', async () => {
      const tool = createTerminalSearchTool(options);
      const result = await tool.execute({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should search with all filter parameters', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          entries: [
            {
              id: 'e1',
              session_id: 's1',
              kind: 'command',
              content: 'nginx -s reload',
              similarity: 0.92,
              captured_at: '2026-02-25T10:00:00Z',
              session: { id: 's1', tmux_session_name: 'deploy' },
              connection: { id: 'c1', name: 'prod-web', host: '10.0.0.1' },
            },
          ],
          total: 1,
        },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSearchTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        query: 'nginx configuration',
        connection_id: '123e4567-e89b-12d3-a456-426614174000',
        session_id: '223e4567-e89b-12d3-a456-426614174000',
        kind: 'command',
        tags: 'production',
        host: 'prod-web',
        session_name: 'deploy',
        date_from: '2026-02-01',
        date_to: '2026-02-28',
        limit: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('[command]');
        expect(result.data.content).toContain('nginx -s reload');
        expect(result.data.content).toContain('deploy');
        expect(result.data.content).toContain('prod-web');
        expect(result.data.content).toContain('92% match');
        expect(result.data.details.entries).toHaveLength(1);
        expect(result.data.details.total).toBe(1);
      }

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/search',
        expect.objectContaining({
          query: 'nginx configuration',
          connection_id: '123e4567-e89b-12d3-a456-426614174000',
          session_id: '223e4567-e89b-12d3-a456-426614174000',
          kind: 'command',
          tags: ['production'],
          host: 'prod-web',
          session_name: 'deploy',
          date_from: '2026-02-01',
          date_to: '2026-02-28',
          limit: 5,
        }),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should handle empty results', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { entries: [], total: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSearchTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ query: 'nonexistent' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('No matching terminal entries found');
      }
    });

    it('should validate connection_id UUID', async () => {
      const tool = createTerminalSearchTool(options);
      const result = await tool.execute({ query: 'test', connection_id: 'not-uuid' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('UUID');
      }
    });

    it('should validate session_id UUID', async () => {
      const tool = createTerminalSearchTool(options);
      const result = await tool.execute({ query: 'test', session_id: 'not-uuid' });
      expect(result.success).toBe(false);
    });

    it('should validate date_from format', async () => {
      const tool = createTerminalSearchTool(options);
      const result = await tool.execute({ query: 'test', date_from: 'not-a-date' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('YYYY-MM-DD');
      }
    });

    it('should validate date_to format', async () => {
      const tool = createTerminalSearchTool(options);
      const result = await tool.execute({ query: 'test', date_to: '13/25/2026' });
      expect(result.success).toBe(false);
    });

    it('should truncate long content in display', async () => {
      const longContent = 'x'.repeat(300);
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          entries: [{ id: 'e1', session_id: 's1', kind: 'output', content: longContent, captured_at: '2026-02-25T10:00:00Z' }],
          total: 1,
        },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSearchTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('...');
        // The full content is in details but display is truncated
        expect(result.data.details.entries[0].content).toHaveLength(300);
      }
    });

    it('should handle API errors', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Internal error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSearchTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(false);
    });

    it('should default limit to 10', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { entries: [], total: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSearchTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({ query: 'test' });
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 10 }),
        expect.any(Object),
      );
    });
  });

  // ==================== terminal_annotate ====================

  describe('terminal_annotate', () => {
    it('should have correct name and description', () => {
      const tool = createTerminalAnnotateTool(options);
      expect(tool.name).toBe('terminal_annotate');
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should require session_id and content', async () => {
      const tool = createTerminalAnnotateTool(options);
      const result = await tool.execute({} as TerminalAnnotateParams);
      expect(result.success).toBe(false);
    });

    it('should validate session_id UUID', async () => {
      const tool = createTerminalAnnotateTool(options);
      const result = await tool.execute({ session_id: 'not-uuid', content: 'test note' });
      expect(result.success).toBe(false);
    });

    it('should create annotation', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'entry-1' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalAnnotateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'Deployed v2.5 to production. All health checks passing.',
        tags: 'deployment,v2.5',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toContain('Annotation added');
        expect(result.data.content).toContain('entry-1');
        expect(result.data.details.entry_id).toBe('entry-1');
        expect(result.data.details.session_id).toBe('123e4567-e89b-12d3-a456-426614174000');
      }

      expect(mockPost).toHaveBeenCalledWith(
        '/api/terminal/sessions/123e4567-e89b-12d3-a456-426614174000/annotate',
        expect.objectContaining({
          content: 'Deployed v2.5 to production. All health checks passing.',
          tags: ['deployment', 'v2.5'],
        }),
        expect.objectContaining({ user_id: 'agent-1' }),
      );
    });

    it('should strip HTML from content', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'entry-1' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalAnnotateTool({ ...options, client: client as unknown as ApiClient });

      await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        content: '<script>alert("xss")</script>Clean note',
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ content: 'Clean note' }),
        expect.any(Object),
      );
    });

    it('should reject empty content after sanitization', async () => {
      const tool = createTerminalAnnotateTool(options);
      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        content: '<script>alert("xss")</script>',
      });
      expect(result.success).toBe(false);
    });

    it('should handle not found', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Not found', code: 'NOT_FOUND' },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalAnnotateTool({ ...options, client: client as unknown as ApiClient });

      const result = await tool.execute({
        session_id: '123e4567-e89b-12d3-a456-426614174000',
        content: 'Test annotation',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });
  });

  describe('user scoping', () => {
    it('should include user_id in all API calls', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: { entries: [], total: 0 },
      });
      const client = { ...mockApiClient, post: mockPost };
      const tool = createTerminalSearchTool({
        ...options,
        client: client as unknown as ApiClient,
        user_id: 'custom-user',
      });

      await tool.execute({ query: 'test' });
      expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.objectContaining({ user_id: 'custom-user' }));
    });
  });
});
