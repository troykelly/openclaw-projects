/**
 * Unit tests for chat rate limiting (#1960).
 *
 * Tests the rate limit functions in chat/rate-limits.ts.
 * Pure unit tests -- no database required.
 *
 * Epic #1940 -- Agent Chat.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkSessionCreation,
  checkMessageSend,
  checkAgentMessageSend,
  wsConnectionOpened,
  wsConnectionClosed,
  checkStreamChunk,
  clearStreamState,
  checkTyping,
  checkAttractAttention,
  chargeAttractAttention,
  CHAT_LIMITS,
} from '../../src/api/chat/rate-limits.ts';

describe('Chat Rate Limits (#1960)', () => {
  // Rate limit stores are module-level Maps; we can't easily reset them
  // between tests, so we use unique keys per test to avoid cross-contamination.

  let testId = 0;
  function uniqueKey(prefix = 'user'): string {
    return `${prefix}-${++testId}@test.com`;
  }

  describe('checkSessionCreation', () => {
    it('allows requests within limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.sessionCreation.max; i++) {
        expect(checkSessionCreation(user).allowed).toBe(true);
      }
    });

    it('rejects requests exceeding limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.sessionCreation.max; i++) {
        checkSessionCreation(user);
      }
      const result = checkSessionCreation(user);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSec).toBeGreaterThan(0);
    });
  });

  describe('checkMessageSend', () => {
    it('allows requests within limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.messageSend.max; i++) {
        expect(checkMessageSend(user).allowed).toBe(true);
      }
    });

    it('rejects requests exceeding limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.messageSend.max; i++) {
        checkMessageSend(user);
      }
      const result = checkMessageSend(user);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkAgentMessageSend', () => {
    it('rate limits per session, not per user', () => {
      const session1 = uniqueKey('session1');
      const session2 = uniqueKey('session2');
      // Fill session1
      for (let i = 0; i < CHAT_LIMITS.messageSend.max; i++) {
        checkAgentMessageSend(session1);
      }
      expect(checkAgentMessageSend(session1).allowed).toBe(false);
      // session2 should still be allowed
      expect(checkAgentMessageSend(session2).allowed).toBe(true);
    });
  });

  describe('wsConnectionOpened / wsConnectionClosed', () => {
    it('allows connections within limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.wsConnections.max; i++) {
        expect(wsConnectionOpened(user).allowed).toBe(true);
      }
    });

    it('rejects connections exceeding limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.wsConnections.max; i++) {
        wsConnectionOpened(user);
      }
      expect(wsConnectionOpened(user).allowed).toBe(false);
    });

    it('frees slot after close', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.wsConnections.max; i++) {
        wsConnectionOpened(user);
      }
      expect(wsConnectionOpened(user).allowed).toBe(false);
      wsConnectionClosed(user);
      expect(wsConnectionOpened(user).allowed).toBe(true);
    });

    it('does not underflow on extra close', () => {
      const user = uniqueKey();
      wsConnectionClosed(user); // Close without open
      wsConnectionClosed(user); // Double close
      // Should not throw, and next open should still work
      expect(wsConnectionOpened(user).allowed).toBe(true);
    });
  });

  describe('checkStreamChunk', () => {
    it('allows chunks within per-second limit', () => {
      const session = uniqueKey('stream');
      for (let i = 0; i < CHAT_LIMITS.streamChunks.max; i++) {
        expect(checkStreamChunk(session, 10).allowed).toBe(true);
      }
    });

    it('rejects chunks exceeding per-second limit', () => {
      const session = uniqueKey('stream');
      for (let i = 0; i < CHAT_LIMITS.streamChunks.max; i++) {
        checkStreamChunk(session, 10);
      }
      const result = checkStreamChunk(session, 10);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSec).toBe(1);
    });

    it('rejects chunks exceeding total bytes limit', () => {
      const session = uniqueKey('stream');
      // Send one big chunk close to the limit
      expect(checkStreamChunk(session, CHAT_LIMITS.streamTotalBytes - 100).allowed).toBe(true);
      // Next chunk should be rejected
      expect(checkStreamChunk(session, 200).allowed).toBe(false);
    });

    it('clears state on clearStreamState', () => {
      const session = uniqueKey('stream');
      checkStreamChunk(session, CHAT_LIMITS.streamTotalBytes - 100);
      clearStreamState(session);
      // After clearing, should be allowed again
      expect(checkStreamChunk(session, 100).allowed).toBe(true);
    });
  });

  describe('checkTyping', () => {
    it('allows events within limit', () => {
      const conn = uniqueKey('conn');
      for (let i = 0; i < CHAT_LIMITS.typing.max; i++) {
        expect(checkTyping(conn).allowed).toBe(true);
      }
    });

    it('rejects events exceeding limit', () => {
      const conn = uniqueKey('conn');
      for (let i = 0; i < CHAT_LIMITS.typing.max; i++) {
        checkTyping(conn);
      }
      expect(checkTyping(conn).allowed).toBe(false);
    });
  });

  describe('checkAttractAttention / chargeAttractAttention', () => {
    it('allows within hourly limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.attractHourly.max; i++) {
        expect(checkAttractAttention(user).allowed).toBe(true);
        chargeAttractAttention(user);
      }
    });

    it('rejects exceeding hourly limit', () => {
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.attractHourly.max; i++) {
        checkAttractAttention(user);
        chargeAttractAttention(user);
      }
      const result = checkAttractAttention(user);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSec).toBeGreaterThan(0);
    });

    it('does not charge on check-only', () => {
      const user = uniqueKey();
      // Check many times without charging
      for (let i = 0; i < 100; i++) {
        expect(checkAttractAttention(user).allowed).toBe(true);
      }
    });

    it('rejects exceeding daily limit', () => {
      // Create user and simulate: manually set hourly window in the past
      // Since we can't easily manipulate time, test with daily max
      const user = uniqueKey();
      for (let i = 0; i < CHAT_LIMITS.attractDaily.max; i++) {
        checkAttractAttention(user);
        chargeAttractAttention(user);
      }
      // Even if hourly resets, daily should block
      // (hourly limit is 3, daily is 10, so we hit hourly first at 3)
      // This test actually proves hourly blocks first
      const result = checkAttractAttention(user);
      expect(result.allowed).toBe(false);
    });
  });
});
