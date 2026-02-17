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
 * Only stubs the methods we actually use (get, post, delete).
 */
function createMockClient(overrides: {
  getResponses?: Record<string, unknown>;
  postResponses?: Record<string, unknown>;
  deleteResponse?: unknown;
} = {}): ApiClient {
  const { getResponses = {}, postResponses = {}, deleteResponse } = overrides;

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
    delete: vi.fn().mockResolvedValue(deleteResponse ?? { success: true, data: {} }),
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
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
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
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'Hello there',
        },
      });

      expect(result.matches.contacts).toContain(contact_id);
      expect(result.linksCreated).toBeGreaterThanOrEqual(1);
    });

    it('should link thread to contact when sender phone matches a contact', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Bob', phone: '+61400000000' },
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
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderPhone: '+61400000000',
          content: 'Hey Bob here',
        },
      });

      expect(result.matches.contacts).toContain(contact_id);
      expect(result.linksCreated).toBeGreaterThanOrEqual(1);
    });

    it('should search both email and phone when both are provided', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com', phone: '+61400000000' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-dual', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          senderPhone: '+61400000000',
          content: 'Hello',
        },
      });

      // Should have searched twice (once for email, once for phone)
      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const contactSearchCalls = getCalls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/contacts'));
      expect(contactSearchCalls.length).toBe(2);

      // But should only create one set of links (deduplicated by ID)
      expect(result.matches.contacts).toHaveLength(1);
      expect(result.matches.contacts).toContain(contact_id);
    });

    it('should skip contact linking when no sender info is provided', async () => {
      const client = createMockClient();

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
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
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
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
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      // Should not crash, just skip contact linking
      expect(result.matches.contacts).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should include user_email in contact search params', async () => {
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: { contacts: [], total: 0 },
          },
        },
      });

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const contactCall = getCalls.find((c: unknown[]) => (c[0] as string).startsWith('/api/contacts'));
      expect(contactCall).toBeDefined();
      expect(contactCall![0]).toContain('user_email=user%40test.com');
    });
  });

  describe('thread link type', () => {
    it('should use url type with thread: URI prefix for thread links', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-thread', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      // Check that the skill-store post uses 'url' type with 'thread:' prefix
      const postCalls = (client.post as ReturnType<typeof vi.fn>).mock.calls;
      const storeCall = postCalls.find((c: unknown[]) => (c[0] as string).startsWith('/api/skill-store'));
      expect(storeCall).toBeDefined();
      const body = storeCall![1] as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      // One of forward/reverse should reference the thread
      const key = body.key as string;
      expect(key).toContain(`thread:${thread_id}`);
    });
  });

  describe('trust gating — content matching requires known sender', () => {
    it('should skip content matching when sender is unknown (no contact match)', async () => {
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
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'stranger@example.com',
          content: 'This message about the tiny home build should not trigger content linking',
        },
      });

      // No contact match, so content matching should be skipped entirely
      expect(result.matches.projects).toHaveLength(0);
      expect(result.matches.todos).toHaveLength(0);
      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const searchCalls = getCalls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/search'));
      expect(searchCalls).toHaveLength(0);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('skipping content matching'),
        expect.anything(),
      );
    });

    it('should skip content matching when no sender info is provided', async () => {
      const client = createMockClient();

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
          content: 'Anonymous message about projects',
        },
      });

      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const searchCalls = getCalls.filter((c: unknown[]) => (c[0] as string).startsWith('/api/search'));
      expect(searchCalls).toHaveLength(0);
    });

    it('should run content matching when sender matches a known contact', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const project_id = '33333333-3333-3333-3333-333333333333';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: project_id,
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
            data: { id: 'link-trusted', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'The timber for the tiny home build is ready',
        },
      });

      expect(result.matches.contacts).toContain(contact_id);
      expect(result.matches.projects).toContain(project_id);
    });
  });

  describe('content -> project matching', () => {
    it('should link thread to project when content matches above threshold', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const project_id = '33333333-3333-3333-3333-333333333333';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: project_id,
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
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'The timber for the tiny home build is ready for pickup',
        },
      });

      expect(result.matches.projects).toContain(project_id);
      expect(result.linksCreated).toBeGreaterThanOrEqual(2); // contact + project
    });

    it('should not link project when score is below threshold', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
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
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-below', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'This should not match',
        },
      });

      expect(result.matches.projects).toHaveLength(0);
    });

    it('should respect custom similarity threshold', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const project_id = '33333333-3333-3333-3333-333333333333';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: project_id,
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
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'Some project related message',
        },
        similarityThreshold: 0.5,
      });

      expect(result.matches.projects).toContain(project_id);
    });
  });

  describe('content -> todo matching', () => {
    it('should link thread to todo when content matches above threshold', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const todoId = '44444444-4444-4444-4444-444444444444';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
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
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'Remember to buy asparagus at the store',
        },
      });

      expect(result.matches.todos).toContain(todoId);
      expect(result.linksCreated).toBeGreaterThanOrEqual(2); // contact + todo
    });
  });

  describe('combined matching', () => {
    it('should match contacts and then content for known senders', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const project_id = '33333333-3333-3333-3333-333333333333';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
          '/api/search': {
            success: true,
            data: {
              results: [
                {
                  id: project_id,
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
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'The kitchen remodel tiles arrived',
        },
      });

      expect(result.matches.contacts).toContain(contact_id);
      expect(result.matches.projects).toContain(project_id);
      expect(result.linksCreated).toBeGreaterThanOrEqual(2);
    });
  });

  describe('content sanitization', () => {
    it('should sanitize content before search (control chars removed)', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
          '/api/search': {
            success: true,
            data: { results: [], search_type: 'semantic', total: 0 },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-sanitize', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
          content: 'Hello\x00\x01\x02World',
        },
      });

      // Search should have been called with sanitized content (no control chars)
      const getCalls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      const searchCall = getCalls.find((c: unknown[]) => (c[0] as string).startsWith('/api/search'));
      expect(searchCall).toBeDefined();
      const searchUrl = searchCall![0] as string;
      expect(searchUrl).not.toContain('\x00');
      expect(searchUrl).not.toContain('\x01');
    });
  });

  describe('failure isolation', () => {
    it('should not crash when contact linking fails and skip content linking (no known sender)', async () => {
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: false,
            error: { status: 500, message: 'Server error', code: 'INTERNAL_ERROR' },
          },
        },
      });

      const result = await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'A task related message',
        },
      });

      // Contact linking failed → no known sender → content matching skipped
      expect(result.matches.contacts).toHaveLength(0);
      expect(result.matches.todos).toHaveLength(0);
      expect(result.matches.projects).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not crash when link creation fails', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
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
        user_id: 'user@test.com',
        message: {
          thread_id,
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
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
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

  describe('rollback handling', () => {
    it('should log partial state when rollback delete fails', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      let postCallCount = 0;
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        // Rollback delete fails
        deleteResponse: { success: false, error: { status: 500, message: 'Delete failed' } },
      });

      // Forward succeeds, reverse fails
      (client.post as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
        if ((path as string).startsWith('/api/skill-store')) {
          postCallCount++;
          if (postCallCount === 1) {
            // Forward link succeeds
            return Promise.resolve({
              success: true,
              data: { id: 'fwd-id', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
            });
          }
          // Reverse link fails
          return Promise.resolve({
            success: false,
            error: { status: 500, message: 'Reverse failed', code: 'INTERNAL_ERROR' },
          });
        }
        return Promise.resolve({ success: true, data: {} });
      });

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id,
          senderEmail: 'alice@example.com',
          content: 'Hello',
        },
      });

      // Should log rollback failure with partial state info
      const errorCalls = (mockLogger.error as ReturnType<typeof vi.fn>).mock.calls;
      const rollbackError = errorCalls.find((c: unknown[]) =>
        (c[0] as string).includes('rollback') && (c[0] as string).includes('partial state'),
      );
      expect(rollbackError).toBeDefined();
    });
  });

  describe('idempotency', () => {
    it('should not create duplicate links on repeated calls', async () => {
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const thread_id = '22222222-2222-2222-2222-222222222222';

      // skill-store upserts by key, so repeated calls should just overwrite
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
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
        user_id: 'user@test.com',
        message: {
          thread_id,
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
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-empty', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
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
      const contact_id = '11111111-1111-1111-1111-111111111111';
      const client = createMockClient({
        getResponses: {
          '/api/contacts': {
            success: true,
            data: {
              contacts: [
                { id: contact_id, display_name: 'Alice', email: 'alice@example.com' },
              ],
              total: 1,
            },
          },
        },
        postResponses: {
          '/api/skill-store/items': {
            success: true,
            data: { id: 'link-ws', skill_id: 'entity-links', collection: 'entity_links', key: 'fwd', data: {}, tags: [], status: 'active' },
          },
        },
      });

      await autoLinkInboundMessage({
        client,
        logger: mockLogger,
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
          senderEmail: 'alice@example.com',
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
        user_id: 'user@test.com',
        message: {
          thread_id: '22222222-2222-2222-2222-222222222222',
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
