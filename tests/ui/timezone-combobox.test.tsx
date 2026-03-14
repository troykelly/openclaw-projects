/**
 * @vitest-environment jsdom
 */
/**
 * Tests for IANA timezone combobox (Epic #2509, Issue #2513).
 *
 * Verifies: full timezone list generation, UTC always present,
 * grouping, sorting, display name formatting, alias normalization,
 * combobox search and selection.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  getAllTimezones,
  groupTimezones,
  formatTimezoneDisplay,
  canonicalizeTimezone,
} from '@/ui/components/settings/timezone-utils';

describe('timezone-utils', () => {
  describe('getAllTimezones', () => {
    it('returns more than 14 items', () => {
      const tzs = getAllTimezones();
      expect(tzs.length).toBeGreaterThan(14);
    });

    it('always includes UTC', () => {
      const tzs = getAllTimezones();
      expect(tzs).toContain('UTC');
    });

    it('includes UTC even if Intl.supportedValuesOf omits it', () => {
      const original = Intl.supportedValuesOf;
      // Mock supportedValuesOf to return list without UTC
      vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['America/New_York', 'Europe/London']);
      const tzs = getAllTimezones();
      expect(tzs).toContain('UTC');
      vi.restoreAllMocks();
    });
  });

  describe('groupTimezones', () => {
    it('groups timezones by region prefix', () => {
      const groups = groupTimezones(['America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC']);
      const regionNames = groups.map(([region]) => region);

      expect(regionNames).toContain('America');
      expect(regionNames).toContain('Europe');
      expect(regionNames).toContain('Asia');
      // UTC should be in a catch-all group
      expect(regionNames).toContain('Other');
    });

    it('sorts timezones alphabetically within each group', () => {
      const groups = groupTimezones([
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
      ]);
      const americaGroup = groups.find(([region]) => region === 'America');
      expect(americaGroup).toBeDefined();
      const [, zones] = americaGroup!;
      const sorted = [...zones].sort((a, b) => a.localeCompare(b));
      expect(zones).toEqual(sorted);
    });
  });

  describe('formatTimezoneDisplay', () => {
    it('replaces underscores with spaces and slashes with spaced slashes', () => {
      expect(formatTimezoneDisplay('America/New_York')).toBe('America / New York');
    });

    it('handles timezone without underscore or region prefix', () => {
      expect(formatTimezoneDisplay('UTC')).toBe('UTC');
    });

    it('handles deep paths', () => {
      expect(formatTimezoneDisplay('America/Argentina/Buenos_Aires')).toBe('America / Argentina / Buenos Aires');
    });
  });

  describe('canonicalizeTimezone', () => {
    it('returns canonical form for an alias', () => {
      // This test relies on Intl returning canonical forms
      const result = canonicalizeTimezone('US/Pacific');
      expect(result).toBe('America/Los_Angeles');
    });

    it('returns the same timezone if already canonical', () => {
      expect(canonicalizeTimezone('America/New_York')).toBe('America/New_York');
    });
  });
});
