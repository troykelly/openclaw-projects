/**
 * Tests for phone number utilities.
 * Part of Issue #202.
 */

import { describe, it, expect } from 'vitest';
import { normalizePhoneNumber, getLocalNumber, formatPhoneForDisplay, createSmsThreadKey } from '../../src/api/twilio/phone-utils.ts';

describe('Phone Utils', () => {
  describe('normalizePhoneNumber', () => {
    it('returns E.164 number unchanged', () => {
      expect(normalizePhoneNumber('+14155551234')).toBe('+14155551234');
    });

    it('adds + to numbers starting with country code', () => {
      expect(normalizePhoneNumber('14155551234')).toBe('+14155551234');
    });

    it('adds +1 to 10-digit US numbers', () => {
      expect(normalizePhoneNumber('4155551234')).toBe('+14155551234');
    });

    it('strips non-digit characters', () => {
      expect(normalizePhoneNumber('(415) 555-1234')).toBe('+14155551234');
      expect(normalizePhoneNumber('415.555.1234')).toBe('+14155551234');
      expect(normalizePhoneNumber('415 555 1234')).toBe('+14155551234');
    });

    it('handles international numbers with +', () => {
      expect(normalizePhoneNumber('+447911123456')).toBe('+447911123456');
    });

    it('removes leading zeros', () => {
      expect(normalizePhoneNumber('00447911123456')).toBe('+447911123456');
    });

    it('uses custom default country code', () => {
      expect(normalizePhoneNumber('7911123456', '44')).toBe('+447911123456');
    });
  });

  describe('getLocalNumber', () => {
    it('removes +1 from US numbers', () => {
      expect(getLocalNumber('+14155551234')).toBe('4155551234');
    });

    it('returns digits for international numbers', () => {
      expect(getLocalNumber('+447911123456')).toBe('447911123456');
    });
  });

  describe('formatPhoneForDisplay', () => {
    it('formats US numbers nicely', () => {
      expect(formatPhoneForDisplay('+14155551234')).toBe('+1 (415) 555-1234');
    });

    it('formats international numbers with spaces', () => {
      const result = formatPhoneForDisplay('+447911123456');
      expect(result).toBe('+447 911 123 456');
    });
  });

  describe('createSmsThreadKey', () => {
    it('creates consistent key regardless of direction', () => {
      const key1 = createSmsThreadKey('+14155551234', '+14155556789');
      const key2 = createSmsThreadKey('+14155556789', '+14155551234');
      expect(key1).toBe(key2);
    });

    it('includes sms prefix', () => {
      const key = createSmsThreadKey('+14155551234', '+14155556789');
      expect(key).toMatch(/^sms:/);
    });

    it('includes both phone numbers', () => {
      const key = createSmsThreadKey('+14155551234', '+14155556789');
      expect(key).toContain('+14155551234');
      expect(key).toContain('+14155556789');
    });
  });
});
