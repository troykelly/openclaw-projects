/**
 * Unit tests for chat OpenAPI specification (#1963).
 *
 * Verifies that all chat endpoints are documented in the OpenAPI spec.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect } from 'vitest';
import { chatPaths } from '../../src/api/openapi/paths/chat.ts';

describe('Chat OpenAPI Specification (#1963)', () => {
  const spec = chatPaths();

  it('has Chat tag', () => {
    expect(spec.tags).toEqual([
      { name: 'Chat', description: 'Agent chat session and message management' },
    ]);
  });

  it('defines ChatSession and ChatMessage schemas', () => {
    expect(spec.schemas).toHaveProperty('ChatSession');
    expect(spec.schemas).toHaveProperty('ChatMessage');
  });

  describe('paths coverage', () => {
    const paths = Object.keys(spec.paths);

    it('includes all expected paths', () => {
      const expected = [
        '/chat/sessions',
        '/chat/sessions/{id}',
        '/chat/sessions/{id}/end',
        '/chat/sessions/{id}/messages',
        '/chat/ws/ticket',
        '/chat/sessions/{id}/stream',
        '/chat/sessions/{id}/agent-message',
        '/notifications/agent',
        '/push/subscribe',
        '/chat/data',
      ];
      for (const path of expected) {
        expect(paths, `Missing path: ${path}`).toContain(path);
      }
    });

    it('POST /chat/sessions includes 429 response', () => {
      const post = spec.paths['/chat/sessions']?.post;
      expect(post).toBeDefined();
      expect(post.responses).toHaveProperty('429');
    });

    it('POST /chat/sessions/{id}/messages includes 429 response', () => {
      const post = spec.paths['/chat/sessions/{id}/messages']?.post;
      expect(post).toBeDefined();
      expect(post.responses).toHaveProperty('429');
    });

    it('POST /chat/sessions/{id}/stream has X-Stream-Secret header', () => {
      const post = spec.paths['/chat/sessions/{id}/stream']?.post;
      expect(post).toBeDefined();
      const headers = post.parameters?.filter(
        (p: { name: string }) => p.name === 'X-Stream-Secret',
      );
      expect(headers).toHaveLength(1);
    });

    it('POST /chat/sessions/{id}/agent-message has X-Stream-Secret header', () => {
      const post = spec.paths['/chat/sessions/{id}/agent-message']?.post;
      expect(post).toBeDefined();
      const headers = post.parameters?.filter(
        (p: { name: string }) => p.name === 'X-Stream-Secret',
      );
      expect(headers).toHaveLength(1);
    });

    it('POST /notifications/agent has X-User-Email header', () => {
      const post = spec.paths['/notifications/agent']?.post;
      expect(post).toBeDefined();
      const headers = post.parameters?.filter(
        (p: { name: string }) => p.name === 'X-User-Email',
      );
      expect(headers).toHaveLength(1);
    });

    it('DELETE /chat/data is documented', () => {
      const del = spec.paths['/chat/data']?.delete;
      expect(del).toBeDefined();
      expect(del.operationId).toBe('deleteAllChatData');
    });

    it('DELETE /chat/sessions/{id} is documented', () => {
      const del = spec.paths['/chat/sessions/{id}']?.delete;
      expect(del).toBeDefined();
      expect(del.operationId).toBe('deleteChatSession');
    });

    it('all endpoints have operationId', () => {
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, any>)) {
          expect(op.operationId, `${method.toUpperCase()} ${path} missing operationId`).toBeDefined();
        }
      }
    });

    it('all endpoints have tags', () => {
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, any>)) {
          expect(op.tags?.length, `${method.toUpperCase()} ${path} missing tags`).toBeGreaterThan(0);
        }
      }
    });
  });
});
