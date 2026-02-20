/**
 * Tests for GeoIngestorProcessor — the event processor that converts
 * HA state_changed events into LocationUpdate objects.
 * Issue #1445.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeoIngestorProcessor } from './geo-ingestor-processor.ts';
import { matchesFilter } from '../ha-event-processor.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import type { LocationUpdate } from '../types.ts';

// ---------- helpers ----------

function makeStateChange(
  entityId: string,
  attrs: Record<string, unknown> = {},
  overrides?: Partial<HaStateChange>,
): HaStateChange {
  const domain = entityId.split('.')[0];
  return {
    entity_id: entityId,
    domain,
    old_state: null,
    new_state: 'home',
    old_attributes: {},
    new_attributes: attrs,
    last_changed: '2026-02-20T00:00:00Z',
    last_updated: '2026-02-20T00:00:00Z',
    context: { id: 'ctx-1', parent_id: null, user_id: null },
    ...overrides,
  };
}

describe('GeoIngestorProcessor', () => {
  let processor: GeoIngestorProcessor;
  let onUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onUpdate = vi.fn();
    processor = new GeoIngestorProcessor(onUpdate);
  });

  describe('getConfig', () => {
    it('returns expected config with geo entity filter', () => {
      const config = processor.getConfig();
      expect(config.id).toBe('geo-ingestor');
      expect(config.name).toBe('Geolocation Ingestor');
      expect(config.mode).toBe('individual');
      expect(config.filter.domains).toContain('device_tracker');
      expect(config.filter.domains).toContain('person');
      expect(config.filter.entityPatterns).toContain('sensor.bermuda_*');
    });
  });

  describe('entity filter matches expected domains', () => {
    it('matches device_tracker entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('device_tracker.phone', config.filter)).toBe(true);
    });

    it('matches person entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('person.jane', config.filter)).toBe(true);
    });

    it('matches bermuda sensor entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('sensor.bermuda_jane_area', config.filter)).toBe(true);
    });

    it('rejects light entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('light.kitchen', config.filter)).toBe(false);
    });

    it('rejects non-bermuda sensor entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('sensor.temperature_kitchen', config.filter)).toBe(false);
    });
  });

  describe('onStateChange extracts location payload', () => {
    it('converts device_tracker state change to LocationUpdate', async () => {
      const change = makeStateChange('device_tracker.phone', {
        latitude: -33.8688,
        longitude: 151.2093,
        gps_accuracy: 10,
        friendly_name: 'Phone',
      });

      await processor.onStateChange(change, 'default');

      expect(onUpdate).toHaveBeenCalledOnce();
      const update: LocationUpdate = onUpdate.mock.calls[0][0];
      expect(update.entity_id).toBe('device_tracker.phone');
      expect(update.lat).toBe(-33.8688);
      expect(update.lng).toBe(151.2093);
      expect(update.accuracy_m).toBe(10);
    });

    it('converts person state change to LocationUpdate', async () => {
      const change = makeStateChange('person.jane', {
        latitude: -33.8688,
        longitude: 151.2093,
        gps_accuracy: 5,
      });

      await processor.onStateChange(change, 'default');

      expect(onUpdate).toHaveBeenCalledOnce();
      const update: LocationUpdate = onUpdate.mock.calls[0][0];
      expect(update.entity_id).toBe('person.jane');
      expect(update.lat).toBe(-33.8688);
    });

    it('extracts indoor_zone from bermuda sensor', async () => {
      const change = makeStateChange('sensor.bermuda_jane_area', {
        latitude: -33.8688,
        longitude: 151.2093,
        area_name: 'Living Room',
      });

      await processor.onStateChange(change, 'default');

      expect(onUpdate).toHaveBeenCalledOnce();
      const update: LocationUpdate = onUpdate.mock.calls[0][0];
      expect(update.indoor_zone).toBe('Living Room');
    });

    it('extracts speed, altitude, bearing when present', async () => {
      const change = makeStateChange('device_tracker.phone', {
        latitude: -33.8688,
        longitude: 151.2093,
        speed: 12.5,
        altitude: 100,
        course: 45,
      });

      await processor.onStateChange(change, 'default');

      expect(onUpdate).toHaveBeenCalledOnce();
      const update: LocationUpdate = onUpdate.mock.calls[0][0];
      expect(update.speed_mps).toBe(12.5);
      expect(update.altitude_m).toBe(100);
      expect(update.bearing).toBe(45);
    });

    it('does not call onUpdate when lat/lng missing', async () => {
      const change = makeStateChange('device_tracker.phone', {
        friendly_name: 'Phone',
      });

      await processor.onStateChange(change, 'default');

      expect(onUpdate).not.toHaveBeenCalled();
    });

    // Note: non-geo entity filtering is handled by the router via matchesFilter(),
    // not inside onStateChange(). The processor only receives entities that match
    // its filter config. See "entity filter matches expected domains" tests above.
  });

  describe('lifecycle', () => {
    it('healthCheck returns true', async () => {
      expect(await processor.healthCheck()).toBe(true);
    });

    it('shutdown completes without error', async () => {
      await expect(processor.shutdown()).resolves.toBeUndefined();
    });
  });
});
