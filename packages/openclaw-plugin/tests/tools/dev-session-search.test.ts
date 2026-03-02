/**
 * Tests for dev session search tool.
 * Issue #1987 — Dev session semantic search.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createDevSessionSearchTool,
  type DevSessionSearchParams,
} from '../../src/tools/dev-session-search.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';
import type { PluginConfig } from '../../src/config.js';

describe('dev_session_search tool', () => {
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

  it('should have correct name and description', () => {
    const tool = createDevSessionSearchTool(options);
    expect(tool.name).toBe('dev_session_search');
    expect(tool.description).toContain('semantic');
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it('should reject empty query', async () => {
    const tool = createDevSessionSearchTool(options);
    const result = await tool.execute({ query: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing query', async () => {
    const tool = createDevSessionSearchTool(options);
    const result = await tool.execute({} as DevSessionSearchParams);
    expect(result.success).toBe(false);
  });

  it('should reject query with only control characters', async () => {
    const tool = createDevSessionSearchTool(options);
    const result = await tool.execute({ query: '\x00\x01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('empty');
    }
  });

  it('should search successfully with results', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 'ds-1',
            session_name: 'fix-auth-bug',
            status: 'completed',
            node: 'dev-01',
            task_summary: 'Fix token refresh race condition',
            completion_summary: 'Fixed with retry backoff',
            branch: 'issue/123-auth-fix',
            similarity: 0.92,
          },
        ],
        total: 1,
        search_mode: 'hybrid',
      },
    });
    const client = { ...mockApiClient, get: mockGet };
    const tool = createDevSessionSearchTool({ ...options, client: client as unknown as ApiClient });

    const result = await tool.execute({ query: 'authentication bug' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details.sessions).toHaveLength(1);
      expect(result.data.details.sessions[0].id).toBe('ds-1');
      expect(result.data.content).toContain('fix-auth-bug');
      expect(result.data.content).toContain('92% match');
    }
  });

  it('should return empty results message when no matches', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    });
    const client = { ...mockApiClient, get: mockGet };
    const tool = createDevSessionSearchTool({ ...options, client: client as unknown as ApiClient });

    const result = await tool.execute({ query: 'nonexistent topic' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toContain('No matching');
      expect(result.data.details.total).toBe(0);
    }
  });

  it('should handle API errors gracefully', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      success: false,
      error: { status: 500, code: 'INTERNAL', message: 'Database error' },
    });
    const client = { ...mockApiClient, get: mockGet };
    const tool = createDevSessionSearchTool({ ...options, client: client as unknown as ApiClient });

    const result = await tool.execute({ query: 'test query' });
    expect(result.success).toBe(false);
  });

  it('should pass status filter to API', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    });
    const client = { ...mockApiClient, get: mockGet };
    const tool = createDevSessionSearchTool({ ...options, client: client as unknown as ApiClient });

    await tool.execute({ query: 'test', status: 'completed', limit: 5 });

    expect(mockGet).toHaveBeenCalledTimes(1);
    const callUrl = mockGet.mock.calls[0][0] as string;
    expect(callUrl).toContain('q=test');
    expect(callUrl).toContain('status=completed');
    expect(callUrl).toContain('limit=5');
  });

  it('should handle network errors', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
    const client = { ...mockApiClient, get: mockGet };
    const tool = createDevSessionSearchTool({ ...options, client: client as unknown as ApiClient });

    const result = await tool.execute({ query: 'test' });
    expect(result.success).toBe(false);
  });

  it('should format results with repo and branch info', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 'ds-2',
            session_name: 'search-feature',
            status: 'active',
            node: 'dev-02',
            repo_org: 'myorg',
            repo_name: 'myrepo',
            branch: 'feature/search',
            task_summary: 'Implement search feature with embeddings',
            completion_summary: null,
            similarity: 0.85,
          },
        ],
        total: 1,
      },
    });
    const client = { ...mockApiClient, get: mockGet };
    const tool = createDevSessionSearchTool({ ...options, client: client as unknown as ApiClient });

    const result = await tool.execute({ query: 'search' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toContain('repo: myorg/myrepo');
      expect(result.data.content).toContain('branch: feature/search');
    }
  });
});
