/**
 * Tests for project management tools.
 * Covers project_list, project_get, and project_create.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createProjectListTool,
  createProjectGetTool,
  createProjectCreateTool,
  type ProjectListParams,
  type ProjectGetParams,
  type ProjectCreateParams,
} from '../../src/tools/projects.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('project tools', () => {
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

  describe('project_list', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createProjectListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.name).toBe('project_list');
      });

      it('should have description', () => {
        const tool = createProjectListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });

    describe('parameter validation', () => {
      it('should accept no parameters', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { projects: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({});
        expect(mockGet).toHaveBeenCalled();
        expect(result.success).toBe(true);
      });

      it('should accept valid status filter', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { projects: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ status: 'active' });
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('status=active'), expect.any(Object));
      });

      it('should reject invalid status', async () => {
        const tool = createProjectListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({
          status: 'invalid' as ProjectListParams['status'],
        });
        expect(result.success).toBe(false);
      });

      it('should accept limit within range', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { projects: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ limit: 50 });
        expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('limit=50'), expect.any(Object));
      });

      it('should reject limit above 100', async () => {
        const tool = createProjectListTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ limit: 101 });
        expect(result.success).toBe(false);
      });
    });

    describe('response formatting', () => {
      it('should format projects as markdown list', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            projects: [
              { id: 'p1', name: 'Project A', status: 'active', description: 'First project' },
              { id: 'p2', name: 'Project B', status: 'completed', description: 'Second project' },
            ],
            total: 2,
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Project A');
          expect(result.data.content).toContain('active');
          expect(result.data.content).toContain('Project B');
          expect(result.data.details.total).toBe(2);
        }
      });

      it('should handle empty results', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: { projects: [], total: 0 },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectListTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({});

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('No projects found');
        }
      });
    });
  });

  describe('project_get', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createProjectGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.name).toBe('project_get');
      });
    });

    describe('parameter validation', () => {
      it('should require id parameter', async () => {
        const tool = createProjectGetTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({} as ProjectGetParams);
        expect(result.success).toBe(false);
      });

      it('should validate UUID format', async () => {
        const tool = createProjectGetTool({
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
          data: { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Test Project' },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectGetTool({
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
      it('should return project details', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: true,
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Test Project',
            status: 'active',
            description: 'A test project',
            createdAt: '2024-01-01T00:00:00Z',
          },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectGetTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ id: '123e4567-e89b-12d3-a456-426614174000' });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toContain('Test Project');
          expect(result.data.details.project.name).toBe('Test Project');
        }
      });

      it('should handle not found', async () => {
        const mockGet = vi.fn().mockResolvedValue({
          success: false,
          error: { status: 404, message: 'Project not found', code: 'NOT_FOUND' },
        });
        const client = { ...mockApiClient, get: mockGet };

        const tool = createProjectGetTool({
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

  describe('project_create', () => {
    describe('tool metadata', () => {
      it('should have correct name', () => {
        const tool = createProjectCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });
        expect(tool.name).toBe('project_create');
      });
    });

    describe('parameter validation', () => {
      it('should require name parameter', async () => {
        const tool = createProjectCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({} as ProjectCreateParams);
        expect(result.success).toBe(false);
      });

      it('should reject empty name', async () => {
        const tool = createProjectCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: '' });
        expect(result.success).toBe(false);
      });

      it('should reject name over 200 characters', async () => {
        const tool = createProjectCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: 'a'.repeat(201) });
        expect(result.success).toBe(false);
      });

      it('should reject description over 2000 characters', async () => {
        const tool = createProjectCreateTool({
          client: mockApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({
          name: 'Test',
          description: 'a'.repeat(2001),
        });
        expect(result.success).toBe(false);
      });
    });

    describe('API interaction', () => {
      it('should call POST /api/work-items with correct body', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', name: 'New Project' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createProjectCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ name: 'New Project', description: 'A new project' });

        expect(mockPost).toHaveBeenCalledWith(
          '/api/work-items',
          expect.objectContaining({
            title: 'New Project',
            description: 'A new project',
            type: 'project',
          }),
          expect.objectContaining({ userId: 'agent-1' }),
        );
      });
    });

    describe('response', () => {
      it('should return new project ID', async () => {
        const mockPost = vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'new-123', title: 'New Project' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createProjectCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        const result = await tool.execute({ name: 'New Project' });

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
          data: { id: 'new-123', title: 'Test Project' },
        });
        const client = { ...mockApiClient, post: mockPost };

        const tool = createProjectCreateTool({
          client: client as unknown as ApiClient,
          logger: mockLogger,
          config: mockConfig,
          userId: 'agent-1',
        });

        await tool.execute({ name: '<script>alert("xss")</script>Test Project' });

        expect(mockPost).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            title: 'Test Project',
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

      const tool = createProjectListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({});
      expect(result.success).toBe(false);
    });

    it('should handle network errors', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({});
      expect(result.success).toBe(false);
    });
  });

  describe('user scoping', () => {
    it('should include userId in all API calls', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { projects: [], total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectListTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'custom-user',
      });

      await tool.execute({});

      expect(mockGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'custom-user' }));
    });
  });
});
