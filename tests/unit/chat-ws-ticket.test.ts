/**
 * Unit tests for Chat WebSocket ticket store (#1944).
 *
 * Tests the one-time ticket system used for WebSocket authentication.
 * Pure unit tests — no database or server required.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createTicket,
  consumeTicket,
  getActiveConnectionCount,
  addConnection,
  removeConnection,
  resetTicketStore,
  TICKET_TTL_MS,
  MAX_CONNECTIONS_PER_USER,
} from '../../src/api/chat/ws-ticket-store.ts';

describe('Chat WS Ticket Store (#1944)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTicketStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createTicket', () => {
    it('creates a ticket with expected fields', () => {
      const ticket = createTicket('user@example.com', 'session-123');
      expect(ticket).toBeDefined();
      expect(typeof ticket).toBe('string');
      expect(ticket.length).toBeGreaterThan(0);
    });

    it('creates unique tickets on each call', () => {
      const t1 = createTicket('user@example.com', 'session-123');
      const t2 = createTicket('user@example.com', 'session-123');
      expect(t1).not.toBe(t2);
    });
  });

  describe('consumeTicket', () => {
    it('returns ticket data on first use', () => {
      const ticket = createTicket('user@example.com', 'session-123');
      const result = consumeTicket(ticket);
      expect(result).not.toBeNull();
      expect(result!.userEmail).toBe('user@example.com');
      expect(result!.sessionId).toBe('session-123');
    });

    it('returns null on second use (single-use)', () => {
      const ticket = createTicket('user@example.com', 'session-123');
      consumeTicket(ticket);
      const result = consumeTicket(ticket);
      expect(result).toBeNull();
    });

    it('returns null for unknown ticket', () => {
      const result = consumeTicket('nonexistent-ticket');
      expect(result).toBeNull();
    });

    it('returns null for expired ticket (30s TTL)', () => {
      const ticket = createTicket('user@example.com', 'session-123');
      vi.advanceTimersByTime(TICKET_TTL_MS + 1);
      const result = consumeTicket(ticket);
      expect(result).toBeNull();
    });

    it('succeeds just before TTL expires', () => {
      const ticket = createTicket('user@example.com', 'session-123');
      vi.advanceTimersByTime(TICKET_TTL_MS - 1);
      const result = consumeTicket(ticket);
      expect(result).not.toBeNull();
    });
  });

  describe('connection tracking', () => {
    it('tracks connection count per user', () => {
      expect(getActiveConnectionCount('user@example.com')).toBe(0);
      const id = addConnection('user@example.com');
      expect(getActiveConnectionCount('user@example.com')).toBe(1);
      removeConnection('user@example.com', id);
      expect(getActiveConnectionCount('user@example.com')).toBe(0);
    });

    it('enforces MAX_CONNECTIONS_PER_USER limit', () => {
      for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i++) {
        addConnection('user@example.com');
      }
      expect(getActiveConnectionCount('user@example.com')).toBe(MAX_CONNECTIONS_PER_USER);
      // Should return null when limit exceeded
      const result = addConnection('user@example.com');
      expect(result).toBeNull();
      expect(getActiveConnectionCount('user@example.com')).toBe(MAX_CONNECTIONS_PER_USER);
    });

    it('allows connections from different users independently', () => {
      for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i++) {
        addConnection('user-a@example.com');
      }
      // Different user should still be able to connect
      const id = addConnection('user-b@example.com');
      expect(id).not.toBeNull();
      expect(getActiveConnectionCount('user-b@example.com')).toBe(1);
    });

    it('removes specific connection by ID', () => {
      const id1 = addConnection('user@example.com');
      const id2 = addConnection('user@example.com');
      expect(getActiveConnectionCount('user@example.com')).toBe(2);
      removeConnection('user@example.com', id1!);
      expect(getActiveConnectionCount('user@example.com')).toBe(1);
      removeConnection('user@example.com', id2!);
      expect(getActiveConnectionCount('user@example.com')).toBe(0);
    });
  });
});
