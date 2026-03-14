/**
 * Tests for Symphony WebSocket Feed Hub
 * Issue #2205 — WebSocket Feed (Authenticated, Namespace-Scoped)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  SymphonyFeedHub,
  AUTH_TIMEOUT_MS,
  type SymphonyFeedEvent,
  type JwtVerifier,
  type NamespaceResolver,
} from './feed-hub.ts';

/** Mock socket state tracker. */
interface MockSocketState {
  socket: import('ws').WebSocket;
  emitter: EventEmitter;
  sentMessages: string[];
  getClosed: () => { code?: number; reason?: string } | null;
}

/** Minimal WebSocket mock with EventEmitter for on/close/send. */
function createMockSocket(): MockSocketState {
  const emitter = new EventEmitter();
  const sentMessages: string[] = [];
  let closed: { code?: number; reason?: string } | null = null;

  const socket = {
    readyState: 1, // OPEN
    on: (event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
    },
    send: (data: string) => {
      sentMessages.push(data);
    },
    close: (code?: number, reason?: string) => {
      closed = { code, reason };
      (socket as { readyState: number }).readyState = 3; // CLOSED
      emitter.emit('close');
    },
  } as unknown as import('ws').WebSocket;

  return { socket, emitter, sentMessages, getClosed: () => closed };
}

function createVerifier(opts?: { shouldFail?: boolean; sub?: string; exp?: number }): JwtVerifier {
  return async (_token: string) => {
    if (opts?.shouldFail) throw new Error('Invalid token');
    return {
      sub: opts?.sub ?? 'user@example.com',
      exp: opts?.exp ?? Math.floor(Date.now() / 1000) + 3600,
    };
  };
}

function createResolver(namespaces?: string[]): NamespaceResolver {
  return async (_email: string) => namespaces ?? ['ns-default'];
}

describe('SymphonyFeedHub', () => {
  let hub: SymphonyFeedHub;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    if (hub) await hub.shutdown();
    vi.useRealTimers();
  });

  describe('handleConnection', () => {
    it('authenticates via header token immediately', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(['ns-1', 'ns-2']),
      });

      const { socket, sentMessages } = createMockSocket();

      await hub.handleConnection(socket, 'valid-jwt');

      expect(hub.getAuthenticatedCount()).toBe(1);
      expect(sentMessages.length).toBe(1);
      const authMsg = JSON.parse(sentMessages[0]);
      expect(authMsg.type).toBe('auth_success');
      expect(authMsg.data.namespaces).toEqual(['ns-1', 'ns-2']);
    });

    it('rejects invalid header token', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier({ shouldFail: true }),
        resolveNamespaces: createResolver(),
      });

      const mock = createMockSocket();

      await hub.handleConnection(mock.socket, 'bad-jwt');

      expect(hub.getAuthenticatedCount()).toBe(0);
      expect(mock.getClosed()).not.toBeNull();
      expect(mock.getClosed()!.code).toBe(4001);
    });

    it('authenticates via first-message handshake', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(['ns-a']),
      });

      const { socket, emitter, sentMessages } = createMockSocket();

      await hub.handleConnection(socket);

      expect(hub.getAuthenticatedCount()).toBe(0);

      // Simulate client sending auth message
      emitter.emit('message', JSON.stringify({ type: 'auth', token: 'my-jwt' }));

      // Allow async auth to complete
      await vi.advanceTimersByTimeAsync(50);

      expect(hub.getAuthenticatedCount()).toBe(1);
      // Should have sent auth_success
      const authMsgs = sentMessages.filter(m => JSON.parse(m).type === 'auth_success');
      expect(authMsgs.length).toBe(1);
    });

    it('disconnects after 5s auth timeout', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(),
      });

      const mock = createMockSocket();

      await hub.handleConnection(mock.socket);

      expect(hub.getConnectionCount()).toBe(1);

      // Advance past auth timeout
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 100);

      expect(mock.getClosed()).not.toBeNull();
      expect(mock.getClosed()!.code).toBe(4001);
    });

    it('sends auth_timeout message before closing on auth timeout', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(),
      });

      const mock = createMockSocket();

      await hub.handleConnection(mock.socket);

      // Advance past auth timeout
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 100);

      // Should have sent auth_timeout message before closing
      const authTimeoutMsgs = mock.sentMessages.filter(
        m => JSON.parse(m).type === 'auth_timeout',
      );
      expect(authTimeoutMsgs.length).toBe(1);
      expect(JSON.parse(authTimeoutMsgs[0]).error).toBe('Authentication timeout');
    });
  });

  describe('emitEvent', () => {
    it('sends event only to connections with matching namespace', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(['ns-allowed']),
      });

      const { socket: s1, sentMessages: msgs1 } = createMockSocket();
      const { socket: s2, sentMessages: msgs2 } = createMockSocket();

      // Both authenticate, get ns-allowed
      await hub.handleConnection(s1, 'jwt-1');
      await hub.handleConnection(s2, 'jwt-2');

      const event: SymphonyFeedEvent = {
        type: 'symphony:run_state_changed',
        data: { run_id: 'run-1', state: 'running' },
        timestamp: new Date().toISOString(),
        namespace: 'ns-allowed',
      };

      const sent = hub.emitEvent(event);
      expect(sent).toBe(2);

      // Event from a different namespace — should not be delivered
      const otherEvent: SymphonyFeedEvent = {
        type: 'symphony:run_failed',
        data: { run_id: 'run-2' },
        timestamp: new Date().toISOString(),
        namespace: 'ns-other',
      };

      const otherSent = hub.emitEvent(otherEvent);
      expect(otherSent).toBe(0);
    });

    it('does not send to unauthenticated connections', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(['ns-1']),
      });

      const { socket } = createMockSocket();

      // Don't pass header token — connection is pending auth
      await hub.handleConnection(socket);

      const event: SymphonyFeedEvent = {
        type: 'symphony:run_state_changed',
        data: {},
        timestamp: new Date().toISOString(),
        namespace: 'ns-1',
      };

      const sent = hub.emitEvent(event);
      expect(sent).toBe(0);
    });
  });

  describe('token refresh', () => {
    it('handles auth_refresh message from client', async () => {
      const newExp = Math.floor(Date.now() / 1000) + 7200;
      let callCount = 0;
      const verifier: JwtVerifier = async () => {
        callCount++;
        return {
          sub: 'user@example.com',
          exp: callCount === 1 ? Math.floor(Date.now() / 1000) + 60 : newExp,
        };
      };

      hub = new SymphonyFeedHub({
        verifyJwt: verifier,
        resolveNamespaces: createResolver(['ns-1']),
      });

      const { socket, emitter, sentMessages } = createMockSocket();

      await hub.handleConnection(socket, 'initial-jwt');

      // Send refresh
      emitter.emit('message', JSON.stringify({
        type: 'auth_refresh',
        token: 'new-jwt',
      }));

      await vi.advanceTimersByTimeAsync(50);

      const refreshMsgs = sentMessages.filter(m => JSON.parse(m).type === 'auth_refreshed');
      expect(refreshMsgs.length).toBe(1);
      const refreshData = JSON.parse(refreshMsgs[0]);
      expect(refreshData.data.namespaces).toEqual(['ns-1']);
    });

    it('rejects auth_refresh with mismatched user', async () => {
      let callCount = 0;
      const verifier: JwtVerifier = async () => {
        callCount++;
        return {
          sub: callCount === 1 ? 'user@example.com' : 'other@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        };
      };

      hub = new SymphonyFeedHub({
        verifyJwt: verifier,
        resolveNamespaces: createResolver(['ns-1']),
      });

      const { socket, emitter, sentMessages } = createMockSocket();

      await hub.handleConnection(socket, 'jwt-1');

      emitter.emit('message', JSON.stringify({
        type: 'auth_refresh',
        token: 'jwt-other-user',
      }));

      await vi.advanceTimersByTimeAsync(50);

      const errorMsgs = sentMessages.filter(m => JSON.parse(m).type === 'auth_error');
      expect(errorMsgs.length).toBe(1);
      expect(JSON.parse(errorMsgs[0]).error).toContain('mismatch');
    });

    it('treats auth_refresh as initial auth when not yet authenticated', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(['ns-fresh']),
      });

      const { socket, emitter, sentMessages } = createMockSocket();

      // No header token — pending auth
      await hub.handleConnection(socket);
      expect(hub.getAuthenticatedCount()).toBe(0);

      // Send auth_refresh instead of auth
      emitter.emit('message', JSON.stringify({
        type: 'auth_refresh',
        token: 'my-jwt',
      }));

      await vi.advanceTimersByTimeAsync(50);

      // Should be treated as initial auth
      expect(hub.getAuthenticatedCount()).toBe(1);
      const authMsgs = sentMessages.filter(m => JSON.parse(m).type === 'auth_success');
      expect(authMsgs.length).toBe(1);
    });

    it('rejects concurrent auth_refresh requests', async () => {
      let resolveSecond: (() => void) | null = null;
      let callCount = 0;
      const slowVerifier: JwtVerifier = async () => {
        callCount++;
        if (callCount === 2) {
          // Block second verification
          await new Promise<void>((resolve) => { resolveSecond = resolve; });
        }
        return {
          sub: 'user@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        };
      };

      hub = new SymphonyFeedHub({
        verifyJwt: slowVerifier,
        resolveNamespaces: createResolver(['ns-1']),
      });

      const { socket, emitter, sentMessages } = createMockSocket();
      await hub.handleConnection(socket, 'jwt-1');

      // Send first refresh (will block)
      emitter.emit('message', JSON.stringify({
        type: 'auth_refresh',
        token: 'jwt-refresh-1',
      }));

      await vi.advanceTimersByTimeAsync(10);

      // Send second refresh while first is in progress
      emitter.emit('message', JSON.stringify({
        type: 'auth_refresh',
        token: 'jwt-refresh-2',
      }));

      await vi.advanceTimersByTimeAsync(10);

      // Second should be rejected
      const errorMsgs = sentMessages.filter(m => JSON.parse(m).type === 'auth_error');
      expect(errorMsgs.length).toBe(1);
      expect(JSON.parse(errorMsgs[0]).error).toContain('already in progress');

      // Clean up
      if (resolveSecond) resolveSecond();
      await vi.advanceTimersByTimeAsync(50);
    });
  });

  describe('namespace scoping on every message', () => {
    it('stops sending events when namespace is removed after refresh', async () => {
      let namespaces = ['ns-1', 'ns-2'];
      const resolver: NamespaceResolver = async () => namespaces;

      let callCount = 0;
      const verifier: JwtVerifier = async () => {
        callCount++;
        return {
          sub: 'user@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        };
      };

      hub = new SymphonyFeedHub({
        verifyJwt: verifier,
        resolveNamespaces: resolver,
      });

      const { socket, emitter, sentMessages } = createMockSocket();

      await hub.handleConnection(socket, 'jwt');

      // Events to ns-2 should be received
      let sent = hub.emitEvent({
        type: 'symphony:run_state_changed',
        data: {},
        timestamp: new Date().toISOString(),
        namespace: 'ns-2',
      });
      expect(sent).toBe(1);

      // Simulate namespace revocation
      namespaces = ['ns-1']; // ns-2 removed

      // Trigger refresh via auth_refresh
      emitter.emit('message', JSON.stringify({
        type: 'auth_refresh',
        token: 'new-jwt',
      }));
      await vi.advanceTimersByTimeAsync(50);

      // Now events to ns-2 should NOT be received
      sent = hub.emitEvent({
        type: 'symphony:run_state_changed',
        data: {},
        timestamp: new Date().toISOString(),
        namespace: 'ns-2',
      });
      expect(sent).toBe(0);

      // But ns-1 events should still work
      sent = hub.emitEvent({
        type: 'symphony:run_state_changed',
        data: {},
        timestamp: new Date().toISOString(),
        namespace: 'ns-1',
      });
      expect(sent).toBe(1);
    });
  });

  describe('connection cleanup', () => {
    it('removes connection on socket close', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(),
      });

      const { socket, emitter } = createMockSocket();

      await hub.handleConnection(socket, 'jwt');
      expect(hub.getConnectionCount()).toBe(1);

      emitter.emit('close');
      expect(hub.getConnectionCount()).toBe(0);
    });

    it('removes connection on socket error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(),
      });

      const { socket, emitter } = createMockSocket();

      await hub.handleConnection(socket, 'jwt');
      expect(hub.getConnectionCount()).toBe(1);

      emitter.emit('error', new Error('test error'));
      expect(hub.getConnectionCount()).toBe(0);

      errorSpy.mockRestore();
    });
  });

  describe('getAuthenticatedCount / getConnectionCount', () => {
    it('correctly tracks connection counts', async () => {
      hub = new SymphonyFeedHub({
        verifyJwt: createVerifier(),
        resolveNamespaces: createResolver(),
      });

      expect(hub.getConnectionCount()).toBe(0);
      expect(hub.getAuthenticatedCount()).toBe(0);

      const { socket: s1 } = createMockSocket();
      const { socket: s2 } = createMockSocket();

      // s1 with auth, s2 without
      await hub.handleConnection(s1, 'jwt-1');
      await hub.handleConnection(s2);

      expect(hub.getConnectionCount()).toBe(2);
      expect(hub.getAuthenticatedCount()).toBe(1);
    });
  });
});
