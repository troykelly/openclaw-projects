/**
 * Tests for todo_search tool.
 * Verifies semantic work item search functionality.
 * Geo-contextual ranking tests added in Issue #1218.
 *
 * Part of Issue #1216.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTodoSearchTool, type TodoSearchParams } from '../../src/tools/todo-search.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

vi.mock('../../src/utils/nominatim.js', () => ({
  reverseGeocode: vi.fn(),
}));

describe('todo_search tool', () => {
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
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.name).toBe('todo_search');
    });

    it('should have description', () => {
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    });

    it('should have parameter schema', () => {
      const tool = createTodoSearchTool({
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
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({} as TodoSearchParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('query');
      }
    });

    it('should reject empty query', async () => {
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: '' });
      expect(result.success).toBe(false);
    });

    it('should reject query over 1000 characters', async () => {
      const tool = createTodoSearchTool({
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
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 51 });
      expect(result.success).toBe(false);
    });

    it('should reject limit below 1', async () => {
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 0 });
      expect(result.success).toBe(false);
    });

    it('should accept valid kind filter', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', kind: 'task' });
      expect(mockGet).toHaveBeenCalled();
    });

    it('should reject invalid kind', async () => {
      const tool = createTodoSearchTool({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({
        query: 'test',
        kind: 'invalid' as TodoSearchParams['kind'],
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

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'geolocation memory' });

      expect(mockGet).toHaveBeenCalledTimes(1);
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('/api/search');
      expect(callUrl).toContain('types=work_item');
      expect(callUrl).toContain('semantic=true');
      expect(callUrl).toContain('q=geolocation+memory');
      expect(callUrl).toContain('user_email=agent-1');
    });

    it('should scope search results to the userId (user_email)', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'user@example.com',
      });

      await tool.execute({ query: 'shopping list' });

      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('user_email=user%40example.com');
    });

    it('should return formatted results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'abc-123',
              title: 'Fix geolocation bug',
              snippet: 'Handle edge case in GPS coordinates',
              score: 0.85,
              type: 'work_item',
              metadata: { kind: 'task', status: 'open' },
            },
            {
              id: 'def-456',
              title: 'Add location memory storage',
              snippet: 'Store user location preferences',
              score: 0.72,
              type: 'work_item',
              metadata: { kind: 'issue', status: 'in_progress' },
            },
          ],
          search_type: 'hybrid',
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'geolocation memory' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(2);
        expect(result.data.details.results[0].title).toBe('Fix geolocation bug');
        expect(result.data.details.results[0].kind).toBe('task');
        expect(result.data.details.results[1].title).toBe('Add location memory storage');
        expect(result.data.content).toContain('Fix geolocation bug');
        expect(result.data.content).toContain('[task]');
        expect(result.data.content).toContain('(open)');
      }
    });

    it('should return empty message when no results', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'nonexistent item xyz' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content).toBe('No matching work items found.');
        expect(result.data.details.count).toBe(0);
      }
    });

    it('should filter results by kind', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'abc-123',
              title: 'Restaurant booking feature',
              snippet: '',
              score: 0.8,
              type: 'work_item',
              metadata: { kind: 'task', status: 'open' },
            },
            {
              id: 'def-456',
              title: 'Restaurant Finder Project',
              snippet: '',
              score: 0.7,
              type: 'work_item',
              metadata: { kind: 'project', status: 'active' },
            },
          ],
          search_type: 'hybrid',
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'restaurant', kind: 'task' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(1);
        expect(result.data.details.results[0].kind).toBe('task');
      }
    });

    it('should filter results by status', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'abc-123',
              title: 'Active task',
              snippet: '',
              score: 0.8,
              type: 'work_item',
              metadata: { kind: 'task', status: 'open' },
            },
            {
              id: 'def-456',
              title: 'Completed task',
              snippet: '',
              score: 0.7,
              type: 'work_item',
              metadata: { kind: 'task', status: 'completed' },
            },
          ],
          search_type: 'text',
          total: 2,
        },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'task', status: 'open' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(1);
        expect(result.data.details.results[0].status).toBe('open');
      }
    });

    it('should handle API errors gracefully', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 500, message: 'Internal server error', code: 'SERVER_ERROR' },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
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

      const tool = createTodoSearchTool({
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

      const tool = createTodoSearchTool({
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

    it('should pass limit to API when no filters', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 25 });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=25');
    });

    it('should over-fetch by 3x when kind filter is applied', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 10, kind: 'task' });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=30'); // 10 * 3 = 30
    });

    it('should over-fetch by 3x when status filter is applied', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 10, status: 'open' });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=30'); // 10 * 3 = 30
    });

    it('should cap over-fetch limit at 50', async () => {
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 25, kind: 'task' });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=50'); // min(25 * 3, 50) = 50
    });

    it('should truncate filtered results to requested limit', async () => {
      const mockResults = Array.from({ length: 30 }, (_, i) => ({
        id: `id-${i}`,
        title: `Task ${i}`,
        snippet: '',
        score: 0.9 - i * 0.01,
        type: 'work_item',
        metadata: { kind: 'task', status: 'open' },
      }));

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: mockResults, search_type: 'text', total: 30 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        userId: 'agent-1',
      });

      const result = await tool.execute({ query: 'test', limit: 5, kind: 'task' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details.count).toBe(5);
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

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'restaurants', location: { lat: -37.8136, lng: 144.9631 } });

      expect(mockReverseGeocode).toHaveBeenCalledWith(-37.8136, 144.9631, 'http://nominatim:8080');
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('restaurants+near+Melbourne');
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

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig, // no nominatimUrl
        userId: 'agent-1',
      });

      await tool.execute({ query: 'restaurants', location: { lat: -37.8136, lng: 144.9631 } });

      expect(mockReverseGeocode).not.toHaveBeenCalled();
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('q=restaurants');
      expect(callUrl).not.toContain('near');
    });

    it('should fall back to original query when reverse geocode returns null', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      const mockReverseGeocode = vi.mocked(reverseGeocode);
      mockReverseGeocode.mockResolvedValue(null);

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'restaurants', location: { lat: -37.8136, lng: 144.9631 } });

      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('q=restaurants');
      expect(callUrl).not.toContain('near');
    });

    it('should fall back to original query when placeLabel is empty', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      const mockReverseGeocode = vi.mocked(reverseGeocode);
      mockReverseGeocode.mockResolvedValue({ address: '123 Main St', placeLabel: '' });

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'restaurants', location: { lat: -37.8136, lng: 144.9631 } });

      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('q=restaurants');
      expect(callUrl).not.toContain('near');
    });

    it('should over-fetch by 3x when location is provided', async () => {
      const { reverseGeocode } = await import('../../src/utils/nominatim.js');
      const mockReverseGeocode = vi.mocked(reverseGeocode);
      mockReverseGeocode.mockResolvedValue({ address: 'Sydney', placeLabel: 'Sydney' });

      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: { results: [], search_type: 'text', total: 0 },
      });
      const client = { ...mockApiClient, get: mockGet };

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', limit: 10, location: { lat: -33.8688, lng: 151.2093 } });
      const callUrl = mockGet.mock.calls[0][0] as string;
      expect(callUrl).toContain('limit=30'); // 10 * 3 = 30
    });

    it('should validate location lat/lng ranges', async () => {
      const tool = createTodoSearchTool({
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

      const tool = createTodoSearchTool({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: geoConfig,
        userId: 'agent-1',
      });

      await tool.execute({ query: 'test', location: { lat: 0, lng: 0 } });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'todo_search invoked',
        expect.objectContaining({ hasLocation: true }),
      );
    });
  });
});
