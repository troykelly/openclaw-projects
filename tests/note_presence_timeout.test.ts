/**
 * Tests for configurable presence timeout.
 * Part of Issue #698.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getPresenceTimeoutMinutes } from '../src/api/notes/presence.ts';

describe('Note Presence Timeout Configuration (Issue #698)', () => {
  const originalEnv = process.env.NOTE_PRESENCE_TIMEOUT_MINUTES;

  afterEach(() => {
    // Restore original env value
    if (originalEnv === undefined) {
      delete process.env.NOTE_PRESENCE_TIMEOUT_MINUTES;
    } else {
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = originalEnv;
    }
    vi.restoreAllMocks();
  });

  describe('getPresenceTimeoutMinutes', () => {
    it('returns default value (5) when env var is not set', () => {
      delete process.env.NOTE_PRESENCE_TIMEOUT_MINUTES;
      expect(getPresenceTimeoutMinutes()).toBe(5);
    });

    it('returns configured value from env var', () => {
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '10';
      expect(getPresenceTimeoutMinutes()).toBe(10);
    });

    it('returns default value for invalid (non-numeric) env var', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = 'invalid';

      expect(getPresenceTimeoutMinutes()).toBe(5);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid NOTE_PRESENCE_TIMEOUT_MINUTES'));
    });

    it('clamps value to minimum (1 minute)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '0';

      expect(getPresenceTimeoutMinutes()).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('out of range'));
    });

    it('clamps value to maximum (60 minutes)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '120';

      expect(getPresenceTimeoutMinutes()).toBe(60);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('out of range'));
    });

    it('accepts values at lower boundary (1)', () => {
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '1';
      expect(getPresenceTimeoutMinutes()).toBe(1);
    });

    it('accepts values at upper boundary (60)', () => {
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '60';
      expect(getPresenceTimeoutMinutes()).toBe(60);
    });

    it('handles negative values', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '-5';

      expect(getPresenceTimeoutMinutes()).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('out of range'));
    });

    it('handles empty string', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '';

      // Empty string is falsy, so should return default
      expect(getPresenceTimeoutMinutes()).toBe(5);
    });

    it('handles whitespace-only string', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NOTE_PRESENCE_TIMEOUT_MINUTES = '   ';

      expect(getPresenceTimeoutMinutes()).toBe(5);
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
