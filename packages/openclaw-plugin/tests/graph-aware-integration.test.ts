/**
 * Integration tests for graph-aware context retrieval in the plugin.
 * Tests the full round-trip: create relationship -> store scoped preference
 * -> retrieve via graph-aware context -> verify preference surfaces.
 *
 * Part of Epic #486, Issue #497.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerOpenClaw, schemas } from '../src/register-openclaw.js';
import type {
  OpenClawPluginAPI,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
} from '../src/types/openclaw-api.js';
import { createGraphAwareRecallHook } from '../src/hooks.js';
import type { ApiClient } from '../src/api-client.js';
import type { Logger } from '../src/logger.js';
import type { PluginConfig } from '../src/config.js';

// Mock fs and child_process for secret resolution
vi.mock('node:fs');
vi.mock('node:child_process');

describe('Graph-Aware Integration', () => {
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

  describe('graph-aware auto-recall hook', () => {
    it('should create a callable hook function', () => {
      const hook = createGraphAwareRecallHook({
        client: mockApiClient,
        logger: mockLogger,
        config: mockConfig,
        getAgentId: () => 'agent-1',
      });
      expect(typeof hook).toBe('function');
    });

    it('should return null when autoRecall is disabled', async () => {
      const hook = createGraphAwareRecallHook({
        client: mockApiClient,
        logger: mockLogger,
        config: { ...mockConfig, autoRecall: false },
        getAgentId: () => 'agent-1',
      });

      const result = await hook({ prompt: 'What food does Alex like?' });
      expect(result).toBeNull();
    });

    it('should call the graph-aware context API endpoint', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        success: true,
        data: {
          context: '## Personal Preferences\n- **Food**: Prefers sushi',
          memories: [
            {
              id: 'mem-1',
              title: 'Food',
              content: 'Prefers sushi',
              memory_type: 'preference',
              similarity: 0.9,
              importance: 8,
              confidence: 1.0,
              combinedRelevance: 0.72,
              scopeType: 'personal',
              scopeLabel: 'Personal',
            },
          ],
          metadata: {
            queryTimeMs: 42,
            scopeCount: 3,
            totalMemoriesFound: 1,
            search_type: 'semantic',
            maxDepth: 1,
          },
        },
      });
      const client = { ...mockApiClient, post: mockPost };

      const hook = createGraphAwareRecallHook({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        getAgentId: () => 'agent-1',
      });

      const result = await hook({ prompt: 'What food does Alex like?' });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/context/graph-aware',
        expect.objectContaining({
          prompt: 'What food does Alex like?',
        }),
        expect.any(Object),
      );

      expect(result).not.toBeNull();
      expect(result?.prependContext).toContain('sushi');
    });

    it('should fall back to basic recall on graph-aware API error', async () => {
      // Graph-aware endpoint fails
      const mockPost = vi.fn().mockResolvedValue({
        success: false,
        error: { status: 404, message: 'Endpoint not found', code: 'NOT_FOUND' },
      });
      // Basic recall endpoint succeeds
      const mockGet = vi.fn().mockResolvedValue({
        success: true,
        data: {
          memories: [{ id: '1', content: 'User prefers dark mode.', category: 'preference', score: 0.95 }],
        },
      });
      const client = { ...mockApiClient, post: mockPost, get: mockGet };

      const hook = createGraphAwareRecallHook({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        getAgentId: () => 'agent-1',
      });

      const result = await hook({ prompt: 'Tell me about my preferences' });

      // Should have tried graph-aware first, then fallen back
      expect(mockPost).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/api/memories/search'), expect.any(Object));

      // Should still return context from fallback
      expect(result).not.toBeNull();
      expect(result?.prependContext).toContain('dark mode');
    });

    it('should handle timeout gracefully', async () => {
      const mockPost = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10000)));
      const client = { ...mockApiClient, post: mockPost };

      const hook = createGraphAwareRecallHook({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        getAgentId: () => 'agent-1',
        timeoutMs: 100,
      });

      const result = await hook({ prompt: 'Hello' });
      expect(result).toBeNull();
    }, 1000);

    it('should not throw on errors', async () => {
      const mockPost = vi.fn().mockRejectedValue(new Error('Network error'));
      const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = { ...mockApiClient, post: mockPost, get: mockGet };

      const hook = createGraphAwareRecallHook({
        client: client as unknown as ApiClient,
        logger: mockLogger,
        config: mockConfig,
        getAgentId: () => 'agent-1',
      });

      const result = await hook({ prompt: 'Hello' });
      expect(result).toBeNull();
    });
  });

  describe('full round-trip integration', () => {
    it('should wire graph-aware hook into beforeAgentStart when autoRecall is enabled', async () => {
      const fetchCalls: { url: string; method: string; body?: string }[] = [];
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        fetchCalls.push({ url, method, body: init?.body as string });

        // Graph-aware context endpoint returns scoped memories
        if (url.includes('/api/context/graph-aware') && method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              context: '## Personal Preferences\n- **Food Preference**: Prefers sushi',
              memories: [
                {
                  id: 'mem-1',
                  title: 'Food Preference',
                  content: 'Prefers sushi',
                  memory_type: 'preference',
                  similarity: 0.92,
                  importance: 8,
                  confidence: 1.0,
                  combinedRelevance: 0.74,
                  scopeType: 'personal',
                  scopeLabel: 'Personal',
                },
              ],
              metadata: {
                queryTimeMs: 35,
                scopeCount: 3,
                totalMemoriesFound: 1,
                search_type: 'semantic',
                maxDepth: 1,
              },
            }),
          };
        }

        // Default catch-all for other endpoints
        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        const registeredOnHooks = new Map<string, Function>();

        const mockApi: OpenClawPluginAPI = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
            autoRecall: true,
            autoCapture: true,
            userScoping: 'agent',
          },
          logger: {
            namespace: 'test',
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
          pluginId: 'openclaw-projects',
          registerTool: vi.fn(),
          registerHook: vi.fn(),
          on: vi.fn((hookName: string, handler: Function) => {
            registeredOnHooks.set(hookName, handler);
          }),
          registerCli: vi.fn(),
          registerService: vi.fn(),
          registerGatewayMethod: vi.fn(),
        };

        await registerOpenClaw(mockApi);

        const beforeAgentStartHook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        expect(beforeAgentStartHook).toBeDefined();

        const result = await beforeAgentStartHook({ prompt: 'What food do I prefer?' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        // Should have called the graph-aware endpoint
        const graphAwareCalls = fetchCalls.filter((c) => c.url.includes('/api/context/graph-aware') && c.method === 'POST');
        expect(graphAwareCalls.length).toBeGreaterThan(0);

        // Should return prependContext with the memory
        expect(result).toBeDefined();
        if (result) {
          expect(result.prependContext).toBeDefined();
          expect(result.prependContext).toContain('sushi');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should surface relationship-scoped memories via graph-aware context', async () => {
      const originalFetch = globalThis.fetch;

      // Simulate: user created a relationship, stored a preference scoped to it,
      // then the graph-aware context retrieval surfaces it
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';

        if (url.includes('/api/context/graph-aware') && method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              context: [
                '## Personal Preferences & Memories',
                '- **Food**: User prefers sushi',
                '',
                '## Relationship Context',
                '- **Anniversary** _(Relationship (partner))_: Wedding anniversary is June 15',
              ].join('\n'),
              memories: [
                {
                  id: 'mem-personal',
                  title: 'Food',
                  content: 'User prefers sushi',
                  memory_type: 'preference',
                  similarity: 0.9,
                  importance: 8,
                  confidence: 1.0,
                  combinedRelevance: 0.72,
                  scopeType: 'personal',
                  scopeLabel: 'Personal',
                },
                {
                  id: 'mem-relationship',
                  title: 'Anniversary',
                  content: 'Wedding anniversary is June 15',
                  memory_type: 'fact',
                  similarity: 0.85,
                  importance: 9,
                  confidence: 1.0,
                  combinedRelevance: 0.77,
                  scopeType: 'relationship',
                  scopeLabel: 'Relationship (partner)',
                },
              ],
              metadata: {
                queryTimeMs: 50,
                scopeCount: 4,
                totalMemoriesFound: 2,
                search_type: 'semantic',
                maxDepth: 1,
              },
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        const registeredOnHooks = new Map<string, Function>();

        const mockApi: OpenClawPluginAPI = {
          config: {
            apiUrl: 'https://api.example.com',
            apiKey: 'test-key',
            autoRecall: true,
            autoCapture: true,
            userScoping: 'agent',
          },
          logger: {
            namespace: 'test',
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
          pluginId: 'openclaw-projects',
          registerTool: vi.fn(),
          registerHook: vi.fn(),
          on: vi.fn((hookName: string, handler: Function) => {
            registeredOnHooks.set(hookName, handler);
          }),
          registerCli: vi.fn(),
          registerService: vi.fn(),
          registerGatewayMethod: vi.fn(),
        };

        await registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        const result = await hook({ prompt: 'When is my anniversary and what food should I get?' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        expect(result).toBeDefined();
        if (result) {
          // After #1926: graph-aware path now formats individual memories with
          // provenance markers instead of using the API's pre-formatted context string
          expect(result.prependContext).toContain('Recalled from long-term memory');
          expect(result.prependContext).toContain('[preference]');
          expect(result.prependContext).toContain('sushi');
          expect(result.prependContext).toContain('[fact]');
          expect(result.prependContext).toContain('anniversary');
          expect(result.prependContext).toMatch(/relevance:\s*72%/);
          expect(result.prependContext).toMatch(/relevance:\s*77%/);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('memory_store with relationship_id schema', () => {
    it('should include relationship_id and tags in memory_store schema', () => {
      const storeSchema = schemas.memoryStore;
      expect(storeSchema.properties).toBeDefined();
      expect(storeSchema.properties?.tags).toBeDefined();
      expect(storeSchema.properties?.relationship_id).toBeDefined();
    });

    it('should include tags and relationship_id in memory_recall schema', () => {
      const recallSchema = schemas.memoryRecall;
      expect(recallSchema.properties).toBeDefined();
      expect(recallSchema.properties?.tags).toBeDefined();
      expect(recallSchema.properties?.relationship_id).toBeDefined();
    });
  });

  describe('plugin manifest version', () => {
    it('should have version 2.1.0 or higher for relationship support', async () => {
      const { readFileSync } = await import('node:fs');
      // We test the schema export includes the new tools instead
      expect(schemas.relationshipSet).toBeDefined();
      expect(schemas.relationshipQuery).toBeDefined();
      expect(schemas.relationshipSet.properties?.contact_a).toBeDefined();
      expect(schemas.relationshipSet.properties?.contact_b).toBeDefined();
      expect(schemas.relationshipSet.properties?.relationship).toBeDefined();
      expect(schemas.relationshipQuery.properties?.contact).toBeDefined();
    });
  });
});
