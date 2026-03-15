/**
 * Unit tests for timezone-aware date formatting utilities.
 * @see Issue #2517
 */
import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatShortDate,
  formatTime,
  formatDateTime,
  formatDateSeparator,
} from '../../../src/ui/lib/date-format';

describe('date-format utilities (#2517)', () => {
  // Use a fixed date: 2026-03-14T10:30:00Z (Saturday)
  const fixedDate = new Date('2026-03-14T10:30:00Z');

  describe('formatDate', () => {
    it('formats with explicit timezone', () => {
      // In UTC, this is Mar 14, 2026
      const result = formatDate(fixedDate, 'UTC');
      expect(result).toContain('Mar');
      expect(result).toContain('14');
      expect(result).toContain('2026');
    });

    it('handles timezone offset correctly', () => {
      // In Pacific/Auckland (UTC+13 in March), 10:30 UTC = 23:30 same day
      const utcResult = formatDate(fixedDate, 'UTC');
      // Both should show Mar 14
      expect(utcResult).toContain('14');

      // In Pacific/Kiritimati (UTC+14), 10:30 UTC = next day
      const result = formatDate(fixedDate, 'Pacific/Kiritimati');
      // This should show Mar 15 (next day due to +14 offset)
      expect(result).toContain('15');
    });

    it('accepts ISO string input', () => {
      const result = formatDate('2026-03-14T10:30:00Z', 'UTC');
      expect(result).toContain('14');
    });

    it('returns empty string for invalid date', () => {
      expect(formatDate('not-a-date')).toBe('');
      expect(formatDate(NaN)).toBe('');
    });

    it('accepts custom options', () => {
      const result = formatDate(fixedDate, 'UTC', { weekday: 'long' });
      expect(result).toContain('Saturday');
    });
  });

  describe('formatShortDate', () => {
    it('excludes year by default', () => {
      const result = formatShortDate(fixedDate, 'UTC');
      expect(result).toContain('Mar');
      expect(result).toContain('14');
      // Short date should not include the year
      expect(result).not.toContain('2026');
    });
  });

  describe('formatTime', () => {
    it('formats time with timezone', () => {
      const result = formatTime(fixedDate, 'UTC');
      expect(result).toContain('10');
      expect(result).toContain('30');
    });

    it('adjusts time for different timezone', () => {
      // UTC+5:45 (Asia/Kathmandu)
      const result = formatTime(fixedDate, 'Asia/Kathmandu');
      // 10:30 UTC + 5:45 = 16:15
      expect(result).toContain('15');
    });
  });

  describe('formatDateTime', () => {
    it('includes both date and time', () => {
      const result = formatDateTime(fixedDate, 'UTC');
      expect(result).toContain('Mar');
      expect(result).toContain('14');
      expect(result).toContain('10');
      expect(result).toContain('30');
    });
  });

  describe('formatDateSeparator', () => {
    it('returns "Today" for current date', () => {
      const now = new Date();
      const result = formatDateSeparator(now);
      expect(result).toBe('Today');
    });

    it('returns "Yesterday" for previous date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const result = formatDateSeparator(yesterday);
      expect(result).toBe('Yesterday');
    });

    it('returns weekday name for dates within 7 days', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const result = formatDateSeparator(threeDaysAgo);
      // Should be a weekday name
      expect(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']).toContain(result);
    });

    it('returns full date for older dates', () => {
      const result = formatDateSeparator(new Date('2025-01-01T12:00:00Z'));
      expect(result).toContain('January');
      expect(result).toContain('2025');
    });
  });
});
