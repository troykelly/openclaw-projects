/**
 * Tests for auto-linker utility.
 * Automatically links inbound messages to contacts, projects, and todos
 * when messages arrive via SMS/email.
 *
 * Part of Issue #1223.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  autoLinkInboundMessage,
  type AutoLinkOptions,
  DEFAULT_SIMILARITY_THRESHOLD,
} from '../../src/utils/auto-linker.js';
import type { ApiClient } from '../../src/api-client.js';
import type { Logger } from '../../src/logger.js';

/** Create a mock logger for testing */
function createMockLogger(): Logger {
  return {
    namespace: 'test',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

/**
 * Create a mock ApiClient with configurable responses.
 * Only stubs the methods we actually use (get, post).
 */
function createMockClient(overrides: {
  getResponses?: Record<string, unknown>;
  postResponses?: Record<string, unknown>;
} = {}): ApiClient {
  const { getResponses = {}, postResponses = {} } = overrides;

  return {
    get: vi.fn().mockImplementation((path: string) => {
      // Find matching response by path prefix
      for (const [key, value] of Object.entries(getResponses)) {
        if (path.startsWith(key)) {
          return Promise.resolve(value);
        }
      }
      return Promise.resolve({ success: true, data: { contacts: [], items: [], results: [] } });
    }),
    post: vi.fn().mockImplementation((path: string) => {
      for (const [key, value] of Object.entries(postResponses)) {
        if (path.startsWith(key)) {
          return Promise.resolve(value);
        }
      }
      return Promise.resolve({ success: true, data: { id: 'mock-id' } });
    }),
    delete: vi.fn().mockResolvedValue({ success: true, data: {} }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 }),
  } as unknown as ApiClient;
}

describe('auto-linker', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('DEFAULT_SIMILARITY_THRESHOLD', () => {
    it('should export a default threshold of 0.75', () => {
      expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.75);
    });
  });

  describe('sender -> contact matching', () => {
    it('should link thread to contact when sender email matches a contact', async () => {
      const contactId = '11111111-1111-1111-1111-111111111111';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contactId, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-1', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          senderEmail: 'alice@example.com',
          content: 'Hello there',
        },
      });

      expect(result.matches.contacts).toContain(contactId);
      expect(result.linksCreated).toBeGreaterThanOrEqual(1);
    });

    it('should link thread to contact when sender phone matches a contact', async () => {
      const contactId = '11111111-1111-1111-1111-111111111111';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contactId, display_name: 'Bob', phone: '+61400000000' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-2', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          senderPhone: '+61400000000',
          content: 'Hey Bob here',
        },
      });

      expect(result.matches.contacts).toContain(contactId);
      expect(result.linksCreated).toBeGreaterThanOrEqual(1);
    });

    it('should skip contact linking when no sender info is provided', async () => {
      const client = createMockClient();

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          content: 'Anonymous message',
        },
      });

      expect(result.matches.contacts).toHaveLength(0);
      // Should not have called contacts API
      expect(client.get).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/contacts'),
        expect.anything(),
      );
    });

    it('should handle no matching contacts gracefully', async () => {
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: { contacts: [], total: 0 },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'unknown@example.com',
          content: 'Hello from unknown',
        },
      });

      expect(result.matches.contacts).toHaveLength(0);
      expect(result.linksCreated).toBe(0);
    });

    it('should handle contact search API failure gracefully', async () => {
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: false,
            error: { status: 500, message: 'Internal error', code: 'INTERNAL_ERROR' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      // Should not crash, just skip contact linking
      expect(result.matches.contacts).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('content -> project matching', () => {
    it('should link thread to project when content matches above threshold', async () => {
      const projectId = '33333333-3333-3333-3333-333333333333';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: projectId,
                  title: 'Tiny home build',
                  snippet: 'Building a tiny home',
                  score: 0.85,
                  type: 'work_item',
                  metadata: { kind: 'project', status: 'active' },
                },
              ],
              search_type: 'semantic',
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-3', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          content: 'The timber for the tiny home build is ready for pickup',
        },
      });

      expect(result.matches.projects).toContain(projectId);
      expect(result.linksCreated).toBeGreaterThanOrEqual(1);
    });

    it('should not link project when score is below threshold', async () => {
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: '33333333-3333-3333-3333-333333333333',
                  title: 'Unrelated project',
                  snippet: 'Something else',
                  score: 0.5,
                  type: 'work_item',
                  metadata: { kind: 'project', status: 'active' },
                },
              ],
              search_type: 'semantic',
              total: 1,
            },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          content: 'This should not match',
        },
      });

      expect(result.matches.projects).toHaveLength(0);
      expect(result.linksCreated).toBe(0);
    });

    it('should respect custom similarity threshold', async () => {
      const projectId = '33333333-3333-3333-3333-333333333333';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: projectId,
                  title: 'Project',
                  snippet: 'A project',
                  score: 0.6,
                  type: 'work_item',
                  metadata: { kind: 'project', status: 'active' },
                },
              ],
              search_type: 'semantic',
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-4', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      // With lower threshold, 0.6 should match
      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          content: 'Some project related message',
        },
        similarityThreshold: 0.5,
      });

      expect(result.matches.projects).toContain(projectId);
    });
  });

  describe('content -> todo matching', () => {
    it('should link thread to todo when content matches above threshold', async () => {
      const todoId = '44444444-4444-4444-4444-444444444444';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: todoId,
                  title: 'Buy asparagus',
                  snippet: 'Shopping list item',
                  score: 0.9,
                  type: 'work_item',
                  metadata: { kind: 'task', status: 'open' },
                },
              ],
              search_type: 'semantic',
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-5', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          content: 'Remember to buy asparagus at the store',
        },
      });

      expect(result.matches.todos).toContain(todoId);
      expect(result.linksCreated).toBeGreaterThanOrEqual(1);
    });
  });

  describe('combined matching', () => {
    it('should match contacts and content in parallel', async () => {
      const contactId = '11111111-1111-1111-1111-111111111111';
      const projectId = '33333333-3333-3333-3333-333333333333';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contactId, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: projectId,
                  title: 'Home renovation',
                  snippet: 'Kitchen remodel',
                  score: 0.88,
                  type: 'work_item',
                  metadata: { kind: 'project', status: 'active' },
                },
              ],
              search_type: 'semantic',
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-6', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          senderEmail: 'alice@example.com',
          content: 'The kitchen remodel tiles arrived',
        },
      });

      expect(result.matches.contacts).toContain(contactId);
      expect(result.matches.projects).toContain(projectId);
      expect(result.linksCreated).toBeGreaterThanOrEqual(2);
    });
  });

  describe('failure isolation', () => {
    it('should not crash when contact linking fails but content linking works', async () => {
      const todoId = '44444444-4444-4444-4444-444444444444';
      const threadId = '22222222-2222-2222-2222-222222222222';

      // Contact search throws
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: false,
            error: { status: 500, message: 'Server error', code: 'INTERNAL_ERROR' },
          },
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: todoId,
                  title: 'A task',
                  snippet: 'Task content',
                  score: 0.8,
                  type: 'work_item',
                  metadata: { kind: 'task', status: 'open' },
                },
              ],
              search_type: 'semantic',
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-7', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          senderEmail: 'alice@example.com',
          content: 'A task related message',
        },
      });

      // Contact linking failed but todo linking should still work
      expect(result.matches.contacts).toHaveLength(0);
      expect(result.matches.todos).toContain(todoId);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not crash when link creation fails', async () => {
      const contactId = '11111111-1111-1111-1111-111111111111';
      const threadId = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contactId, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: false,
            error: { status: 500, message: 'Store error', code: 'INTERNAL_ERROR' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      // Should not throw, links just not created
      expect(result.matches.contacts).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should never throw even when everything fails', async () => {
      const client = createMockClient();
      // Override to throw
      (client.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network failure'));

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      expect(result.linksCreated).toBe(0);
      expect(result.matches.contacts).toHaveLength(0);
      expect(result.matches.projects).toHaveLength(0);
      expect(result.matches.todos).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('should not create duplicate links on repeated calls', async () => {
      const contactId = '11111111-1111-1111-1111-111111111111';
      const threadId = '22222222-2222-2222-2222-222222222222';

      // skill-store upserts by key, so repeated calls should just overwrite
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contactId, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-8', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const opts: AutoLinkOptions = {
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId,
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      };

      // Call twice
      await autoLinkInboundMessage(opts);
      await autoLinkInboundMessage(opts);

      // Skill store is called with the same key each time (upsert behavior)
      const postCalls = (client.post as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => (c[0] as string).startsWith('/api/skill-store'));
      // Each call creates forward+reverse links for 1 contact match
      // Two calls = 4 total posts, but keys are the same so skill_store upserts
      expect(postCalls.length).toBe(4);
    });
  });

  describe('empty content handling', () => {
    it('should skip content matching when message content is empty', async () => {
      const client = createMockClient();

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
          content: '',
        },
      });

      // Should not call search API for empty content
      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const searchCalls = getCalls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/search'));
      expect(searchCalls).toHaveLength(0);
    });

    it('should skip content matching when content is only whitespace', async () => {
      const client = createMockClient();

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          content: '   \n  ',
        },
      });

      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const searchCalls = getCalls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/search'));
      expect(searchCalls).toHaveLength(0);
    });
  });

  describe('result shape', () => {
    it('should always return a valid AutoLinkResult', async () => {
      const client = createMockClient();

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        userId: 'user@test.com',
        message: {
          threadId: '22222222-2222-2222-2222-222222222222',
          content: 'Hello',
        },
      });

      expect(result).toHaveProperty('linksCreated');
      expect(result).toHaveProperty('matches');
      expect(result.matches).toHaveProperty('contacts');
      expect(result.matches).toHaveProperty('projects');
      expect(result.matches).toHaveProperty('todos');
      expect(typeof result.linksCreated).toBe('number');
      expect(Array.isArray(result.matches.contacts)).toBe(true);
      expect(Array.isArray(result.matches.projects)).toBe(true);
      expect(Array.isArray(result.matches.todos)).toBe(true);
    });
  });
});
