/**
 * Unit tests for chat session expiry (#1961).
 *
 * Tests the isSessionExpired logic. The pg_cron job and
 * expireSessionIfIdle (which requires a DB) are integration-tested.
 *
 * Epic #1940 — Agent Chat.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isSessionExpired, SESSION_EXPIRY } from '../../src/api/chat/session-expiry.ts';

describe('Chat Session Expiry (#1961)', () => {
  beforeEach(() => {
    // Clear any env override
    delete process.env.CHAT_SESSION_EXPIRY_HOURS;
  });

  describe('isSessionExpired', () => {
    it('returns false for a recently active session', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
      expect(isSessionExpired(fiveMinutesAgo)).toBe(false);
    });

    it('returns true for a session idle beyond default threshold (24h)', () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3_600_000);
      expect(isSessionExpired(twentyFiveHoursAgo)).toBe(true);
    });

    it('returns false for a session just under the threshold', () => {
      const twentyThreeHoursAgo = new Date(Date.now() - 23 * 3_600_000);
      expect(isSessionExpired(twentyThreeHoursAgo)).toBe(false);
    });

    it('accepts string timestamps', () => {
      const oldDate = new Date(Date.now() - 48 * 3_600_000).toISOString();
      expect(isSessionExpired(oldDate)).toBe(true);
    });

    it('respects CHAT_SESSION_EXPIRY_HOURS env var', () => {
      process.env.CHAT_SESSION_EXPIRY_HOURS = '1';
      const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
      expect(isSessionExpired(twoHoursAgo)).toBe(true);
    });

    it('uses default when env var is invalid', () => {
      process.env.CHAT_SESSION_EXPIRY_HOURS = 'not-a-number';
      const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000);
      expect(isSessionExpired(fiveHoursAgo)).toBe(false); // 5h < 24h default
    });
  });

  describe('SESSION_EXPIRY', () => {
    it('has correct default hours', () => {
      expect(SESSION_EXPIRY.defaultHours).toBe(24);
    });

    it('getExpiryMs returns correct default', () => {
      expect(SESSION_EXPIRY.getExpiryMs()).toBe(24 * 3_600_000);
    });

    it('getExpiryMs respects env override', () => {
      process.env.CHAT_SESSION_EXPIRY_HOURS = '12';
      expect(SESSION_EXPIRY.getExpiryMs()).toBe(12 * 3_600_000);
    });
  });
});
