/**
 * Tests for HA event processor plugin interface and matchesFilter utility.
 * Issue #1441.
 */

import { describe, it, expect } from 'vitest';
import { matchesFilter } from './ha-event-processor.ts';
import type { HaEntityFilter } from './ha-event-processor.ts';

describe('matchesFilter', () => {
  describe('domain allow list', () => {
    it('matches entity in allowed domain', () => {
      const filter: HaEntityFilter = { domains: ['device_tracker'] };
      expect(matchesFilter('device_tracker.phone', filter)).toBe(true);
    });

    it('matches entity in second allowed domain', () => {
      const filter: HaEntityFilter = { domains: ['person', 'device_tracker'] };
      expect(matchesFilter('device_tracker.phone', filter)).toBe(true);
      expect(matchesFilter('person.jane', filter)).toBe(true);
    });

    it('rejects entity not in allowed domain', () => {
      const filter: HaEntityFilter = { domains: ['device_tracker'] };
      expect(matchesFilter('light.living_room', filter)).toBe(false);
    });

    it('rejects entity when domain list is empty', () => {
      const filter: HaEntityFilter = { domains: [] };
      expect(matchesFilter('device_tracker.phone', filter)).toBe(false);
    });
  });

  describe('domain exclude list', () => {
    it('rejects entity in excluded domain', () => {
      const filter: HaEntityFilter = { excludeDomains: ['light'] };
      expect(matchesFilter('light.living_room', filter)).toBe(false);
    });

    it('allows entity not in excluded domain', () => {
      const filter: HaEntityFilter = { excludeDomains: ['light'] };
      expect(matchesFilter('device_tracker.phone', filter)).toBe(true);
    });

    it('exclude takes precedence over include', () => {
      const filter: HaEntityFilter = {
        domains: ['light', 'device_tracker'],
        excludeDomains: ['light'],
      };
      expect(matchesFilter('light.living_room', filter)).toBe(false);
      expect(matchesFilter('device_tracker.phone', filter)).toBe(true);
    });
  });

  describe('glob patterns', () => {
    it('matches entity with wildcard pattern', () => {
      const filter: HaEntityFilter = { entityPatterns: ['sensor.bermuda_*'] };
      expect(matchesFilter('sensor.bermuda_jane_area', filter)).toBe(true);
    });

    it('rejects entity not matching pattern', () => {
      const filter: HaEntityFilter = { entityPatterns: ['sensor.bermuda_*'] };
      expect(matchesFilter('sensor.temperature_kitchen', filter)).toBe(false);
    });

    it('matches with multiple patterns (OR logic)', () => {
      const filter: HaEntityFilter = {
        entityPatterns: ['sensor.bermuda_*', 'binary_sensor.motion_*'],
      };
      expect(matchesFilter('sensor.bermuda_bob_area', filter)).toBe(true);
      expect(matchesFilter('binary_sensor.motion_hallway', filter)).toBe(true);
      expect(matchesFilter('sensor.temperature', filter)).toBe(false);
    });

    it('matches with question mark wildcard', () => {
      const filter: HaEntityFilter = { entityPatterns: ['sensor.temp_?'] };
      expect(matchesFilter('sensor.temp_1', filter)).toBe(true);
      expect(matchesFilter('sensor.temp_12', filter)).toBe(false);
    });
  });

  describe('exact entity IDs', () => {
    it('matches exact entity ID', () => {
      const filter: HaEntityFilter = {
        entityIds: ['device_tracker.phone', 'person.jane'],
      };
      expect(matchesFilter('device_tracker.phone', filter)).toBe(true);
      expect(matchesFilter('person.jane', filter)).toBe(true);
    });

    it('rejects entity not in ID list', () => {
      const filter: HaEntityFilter = {
        entityIds: ['device_tracker.phone'],
      };
      expect(matchesFilter('device_tracker.tablet', filter)).toBe(false);
    });
  });

  describe('combinations', () => {
    it('matches when domain matches but no patterns/IDs specified', () => {
      const filter: HaEntityFilter = { domains: ['person'] };
      expect(matchesFilter('person.jane', filter)).toBe(true);
    });

    it('matches when pattern matches but no domains specified', () => {
      const filter: HaEntityFilter = {
        entityPatterns: ['sensor.bermuda_*'],
      };
      expect(matchesFilter('sensor.bermuda_jane_area', filter)).toBe(true);
    });

    it('matches when either domain OR pattern OR entityId matches', () => {
      const filter: HaEntityFilter = {
        domains: ['person'],
        entityPatterns: ['sensor.bermuda_*'],
        entityIds: ['device_tracker.special_phone'],
      };
      // Matches via domain
      expect(matchesFilter('person.jane', filter)).toBe(true);
      // Matches via pattern
      expect(matchesFilter('sensor.bermuda_bob_area', filter)).toBe(true);
      // Matches via exact ID
      expect(matchesFilter('device_tracker.special_phone', filter)).toBe(true);
      // Matches none
      expect(matchesFilter('light.kitchen', filter)).toBe(false);
    });

    it('excludeDomains still vetoes domain match', () => {
      const filter: HaEntityFilter = {
        domains: ['person', 'sensor'],
        excludeDomains: ['sensor'],
        entityPatterns: ['sensor.bermuda_*'],
      };
      // person matches via domain
      expect(matchesFilter('person.jane', filter)).toBe(true);
      // sensor.bermuda_* excluded by excludeDomains even though domain and pattern match
      expect(matchesFilter('sensor.bermuda_bob', filter)).toBe(false);
    });
  });

  describe('empty / no filter', () => {
    it('matches everything when filter is empty object', () => {
      const filter: HaEntityFilter = {};
      expect(matchesFilter('device_tracker.phone', filter)).toBe(true);
      expect(matchesFilter('light.kitchen', filter)).toBe(true);
    });

    it('matches everything when all arrays are undefined', () => {
      const filter: HaEntityFilter = {
        domains: undefined,
        excludeDomains: undefined,
        entityPatterns: undefined,
        entityIds: undefined,
      };
      expect(matchesFilter('anything.entity', filter)).toBe(true);
    });
  });
});
