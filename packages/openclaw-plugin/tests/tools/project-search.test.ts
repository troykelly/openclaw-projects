/**
 * Tests for project_search tool.
 * Verifies semantic project search functionality.
 * Geo-contextual ranking tests added in Issue #1218.
 *
 * Part of Issue #1217.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createProjectSearchTool, type ProjectSearchParams } from '../../src/tools/project-search.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

vi.mock('../../src/utils/nominatim.js', () => ({
  reverseGeocode: vi.fn(),
}));

describe('project_search tool', () => {
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

  describe('tool metadata', () => {
    it('should have correct name', () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.name).toBe('project_search');
    });

    it('should have description', () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('parameter validation', () => {
    it('should require query parameter', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({} as ProjectSearchParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('query');
      }
    });

    it('should reject empty query', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should reject query over 1000 characters', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const longQuery = 'a'.repeat(1001);
      const result = await tool.execute({ query: longQuery });
      expect(result.success).toBe(false);
    });

    it('should reject limit above 50', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 51 });
      expect(result.success).toBe(false);
    });

    it('should reject limit below 1', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 0 });
      expect(result.success).toBe(false);
    });

    it('should accept valid status filter', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', status: 'active' });
      expect(mockGet).toHaveBeenCalled();
    });

    it('should reject invalid status', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        query: 'test',
        status: 'invalid' as ProjectSearchParams['status'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('API interaction', () => {
    it('should call /api/search with types=work_item, semantic=true, and user_email', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'hybrid', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'home renovation' });

      expect(mockGet).toHaveBeenCalledTimes(1);
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('/api/search');
      expect(callUrl).toContain('types=work_item');
      expect(callUrl).toContain('semantic=true');
      expect(callUrl).toContain('q=home+renovation');
      expect(callUrl).toContain('user_email=agent-1');
    });

    it('should scope search results to the userId (user_email)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'user@example.com',
      });

      await tool.execute({ query: 'my projects' });

      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('user_email=user%40example.com');
    });

    it('should filter results to only kind=project', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'proj-1',
              title: 'Home Renovation',
              snippet: 'Kitchen remodel project',
              score: 0.9,
              type: 'work_item',
              metadata: { kind: 'project', status: 'active' },
            },
            {
              id: 'task-1',
              title: 'Buy paint for renovation',
              snippet: 'Get paint samples',
              score: 0.85,
              type: 'work_item',
              metadata: { kind: 'task', status: 'open' },
            },
            {
              id: 'proj-2',
              title: 'Garden Redesign',
              snippet: 'Landscape project',
              score: 0.7,
              type: 'work_item',
              metadata: { kind: 'project', status: 'active' },
            },
          ],
          search_type: 'hybrid',
          total: 3,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'renovation' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(2);
        expect(result.data.details.results.every((r) => r.kind === 'project')).toBe(true);
      }
    });

    it('should return formatted results with project details', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'proj-1',
              title: 'Home Renovation',
              snippet: 'Kitchen remodel and bathroom update',
              score: 0.92,
              type: 'work_item',
              metadata: { kind: 'project', status: 'active' },
            },
            {
              id: 'proj-2',
              title: 'Garden Redesign',
              snippet: 'Complete landscape overhaul',
              score: 0.78,
              type: 'work_item',
              metadata: { kind: 'project', status: 'completed' },
            },
          ],
          search_type: 'hybrid',
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'home improvement' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(2);
        expect(result.data.details.results[0].title).toBe('Home Renovation');
        expect(result.data.details.results[0].status).toBe('active');
        expect(result.data.details.results[1].title).toBe('Garden Redesign');
        expect(result.data.content).toContain('Home Renovation');
        expect(result.data.content).toContain('(active)');
        expect(result.data.content).toContain('(completed)');
      }
    });

    it('should return empty message when no projects found', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'nonexistent project xyz' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('No matching projects found.');
        expect(result.data.details.count).toBe(0);
      }
    });

    it('should filter results by status', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'proj-1',
              title: 'Active Project',
              snippet: '',
              score: 0.8,
              type: 'work_item',
              metadata: { kind: 'project', status: 'active' },
            },
            {
              id: 'proj-2',
              title: 'Completed Project',
              snippet: '',
              score: 0.7,
              type: 'work_item',
              metadata: { kind: 'project', status: 'completed' },
            },
            {
              id: 'proj-3',
              title: 'Archived Project',
              snippet: '',
              score: 0.6,
              type: 'work_item',
              metadata: { kind: 'project', status: 'archived' },
            },
          ],
          search_type: 'text',
          total: 3,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'project', status: 'active' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(1);
        expect(result.data.details.results[0].status).toBe('active');
      }
    });

    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Internal server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Internal server error');
      }
    });

    it('should handle network errors gracefully', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Network timeout'));
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(false);
    });

    it('should sanitize control characters from query', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test\x00\x01query' });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).not.toContain('\x00');
      expect(callUrl).not.toContain('\x01');
    });

    it('should over-fetch by 3x since kind=project filter is always applied', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 10 });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=30'); // 10 * 3 = 30 (always over-fetch since we filter to kind=project)
    });

    it('should cap over-fetch limit at 50', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 25 });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=50'); // min(25 * 3, 50) = 50
    });

    it('should truncate filtered results to requested limit', async () => {
      const mockResults = Array.from({ length: 30 }, (_, i) => ({
        id: `proj-${i}`,
        title: `Project ${i}`,
        snippet: '',
        score: 0.9 - i * 0.01,
        type: 'work_item',
        metadata: { kind: 'project', status: 'active' },
      }));

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: mockResults, search_type: 'text', total: 30 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 5 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(5);
      }
    });

    it('should return empty when all results are non-project kinds', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'task-1',
              title: 'Some task',
              snippet: '',
              score: 0.9,
              type: 'work_item',
              metadata: { kind: 'task', status: 'open' },
            },
            {
              id: 'epic-1',
              title: 'Some epic',
              snippet: '',
              score: 0.8,
              type: 'work_item',
              metadata: { kind: 'epic', status: 'active' },
            },
          ],
          search_type: 'hybrid',
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'something' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('No matching projects found.');
        expect(result.data.details.count).toBe(0);
      }
    });
  });

  describe('geo-contextual ranking (Issue #1218)', () => {
    const geoConfig: PluginConfig = {
      ...mockConfig,
      nominatimUrl: 'http://nominatim:8080',
    };

    it('should augment query with place label when location and nominatimUrl provided', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      const mockReverseGeocode = vi.mocked(reverseGeocode);
      mockReverseGeocode.mockResolvedValue({ address: '123 Main St, Melbourne', placeLabel: 'Melbourne' });

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'hybrid', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'renovation', location: { lat: -37.8136, lng: 144.9631 } });

      expect(mockReverseGeocode).toHaveBeenCalledWith(-37.8136, 144.9631, 'http://nominatim:8080');
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('renovation+near+Melbourne');
    });

    it('should not augment query when nominatimUrl is not configured', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      const mockReverseGeocode = vi.mocked(reverseGeocode);
      mockReverseGeocode.mockClear();

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig, // no nominatimUrl
        userId: 'agent-1',
      });

      await tool.execute({ query: 'renovation', location: { lat: -37.8136, lng: 144.9631 } });

      expect(mockReverseGeocode).not.toHaveBeenCalled();
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('q=renovation');
      expect(callUrl).not.toContain('near');
    });

    it('should fall back to original query when reverse geocode returns null', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      vi.mocked(reverseGeocode).mockResolvedValue(null);

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'renovation', location: { lat: -37.8136, lng: 144.9631 } });

      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('q=renovation');
      expect(callUrl).not.toContain('near');
    });

    it('should fall back to original query when placeLabel is empty', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      vi.mocked(reverseGeocode).mockResolvedValue({ address: '123 Main St', placeLabel: '' });

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'renovation', location: { lat: -37.8136, lng: 144.9631 } });

      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('q=renovation');
      expect(callUrl).not.toContain('near');
    });

    it('should validate location lat/lng ranges', async () => {
      const tool = createProjectSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', location: { lat: 91, lng: 0 } });
      expect(result.success).toBe(false);
    });

    it('should log hasLocation when location is provided', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      vi.mocked(reverseGeocode).mockResolvedValue(null);

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createProjectSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', location: { lat: 0, lng: 0 } });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'project_search invoked',
        expect.objectContaining({ hasLocation: true }),
      );
    });
  });
});
