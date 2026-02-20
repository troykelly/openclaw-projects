/**
 * Tests for HA entity tier resolver.
 *
 * Covers default domain/pattern mappings, priority-based evaluation,
 * per-namespace database overrides, caching, and batch resolution.
 *
 * Issue #1451, Epic #1440.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityTier, TierRule } from './ha-entity-tiers.ts';
import { EntityTierResolver } from './ha-entity-tiers.ts';

// ---------- helpers ----------

function makeLoader(rules: TierRule[] = []) {
  return vi.fn().mockResolvedValue(rules);
}

// ---------- tests ----------

describe('EntityTierResolver', () => {
  describe('default domain classification', () => {
    let resolver: EntityTierResolver;

    beforeEach(() => {
      resolver = new EntityTierResolver();
    });

    it('classifies ignore-tier domains', async () => {
      const ignoreDomains = [
        'geo_location',
        'update',
        'image',
        'button',
        'number',
        'select',
        'text',
        'input_number',
        'input_select',
        'input_text',
        'scene',
        'script',
        'automation',
        'group',
        'zone',
      ];

      for (const domain of ignoreDomains) {
        const result = await resolver.resolve(`${domain}.test_entity`, 'default');
        expect(result.tier).toBe('ignore');
        expect(result.source).toBe('default');
      }
    });

    it('classifies geo-tier domains', async () => {
      const geoDomains = ['device_tracker', 'person'];

      for (const domain of geoDomains) {
        const result = await resolver.resolve(`${domain}.test_entity`, 'default');
        expect(result.tier).toBe('geo');
        expect(result.source).toBe('default');
      }
    });

    it('classifies triage-tier domains', async () => {
      const triageDomains = ['light', 'switch', 'binary_sensor', 'climate', 'media_player', 'lock', 'cover', 'fan', 'vacuum', 'input_boolean'];

      for (const domain of triageDomains) {
        const result = await resolver.resolve(`${domain}.test_entity`, 'default');
        expect(result.tier).toBe('triage');
        expect(result.source).toBe('default');
      }
    });

    it('classifies escalate-tier domains', async () => {
      const result = await resolver.resolve('alarm_control_panel.home', 'default');
      expect(result.tier).toBe('escalate');
      expect(result.source).toBe('default');
    });

    it('classifies unknown domains as log_only', async () => {
      const result = await resolver.resolve('weather.home', 'default');
      expect(result.tier).toBe('log_only');
      expect(result.source).toBe('default');
    });
  });

  describe('default pattern classification', () => {
    let resolver: EntityTierResolver;

    beforeEach(() => {
      resolver = new EntityTierResolver();
    });

    it('classifies battery sensors as log_only', async () => {
      const result = await resolver.resolve('sensor.phone_battery', 'default');
      expect(result.tier).toBe('log_only');
    });

    it('classifies battery_level sensors as log_only', async () => {
      const result = await resolver.resolve('sensor.phone_battery_level', 'default');
      expect(result.tier).toBe('log_only');
    });

    it('classifies linkquality sensors as log_only', async () => {
      const result = await resolver.resolve('sensor.zigbee_linkquality', 'default');
      expect(result.tier).toBe('log_only');
    });

    it('classifies signal_strength sensors as log_only', async () => {
      const result = await resolver.resolve('sensor.wifi_signal_strength', 'default');
      expect(result.tier).toBe('log_only');
    });

    it('classifies rssi sensors as log_only', async () => {
      const result = await resolver.resolve('sensor.ble_rssi', 'default');
      expect(result.tier).toBe('log_only');
    });

    it('classifies water_leak sensors as escalate', async () => {
      const result = await resolver.resolve('sensor.kitchen_water_leak', 'default');
      expect(result.tier).toBe('escalate');
    });

    it('classifies binary_sensor water_leak as escalate', async () => {
      const result = await resolver.resolve('binary_sensor.bathroom_water_leak', 'default');
      expect(result.tier).toBe('escalate');
    });

    it('classifies smoke sensors as escalate', async () => {
      const result = await resolver.resolve('sensor.hallway_smoke_detector', 'default');
      expect(result.tier).toBe('escalate');
    });

    it('classifies gas sensors as escalate', async () => {
      const result = await resolver.resolve('sensor.kitchen_gas_detector', 'default');
      expect(result.tier).toBe('escalate');
    });

    it('classifies binary_sensor smoke as escalate', async () => {
      const result = await resolver.resolve('binary_sensor.smoke_alarm', 'default');
      expect(result.tier).toBe('escalate');
    });
  });

  describe('database override rules', () => {
    it('entity_id rule overrides domain default', async () => {
      const loader = makeLoader([{ tier: 'ignore', entity_id: 'light.test_light', priority: 0 }]);
      const resolver = new EntityTierResolver({ loader });

      const result = await resolver.resolve('light.test_light', 'default');
      expect(result.tier).toBe('ignore');
      expect(result.source).toBe('entity_id');
    });

    it('entity_pattern rule overrides domain default', async () => {
      const loader = makeLoader([{ tier: 'escalate', entity_pattern: 'light.security_*', priority: 0 }]);
      const resolver = new EntityTierResolver({ loader });

      const result = await resolver.resolve('light.security_floodlight', 'default');
      expect(result.tier).toBe('escalate');
      expect(result.source).toBe('pattern');
    });

    it('domain rule from DB overrides hardcoded default', async () => {
      const loader = makeLoader([{ tier: 'ignore', domain: 'weather', priority: 0 }]);
      const resolver = new EntityTierResolver({ loader });

      const result = await resolver.resolve('weather.home', 'default');
      expect(result.tier).toBe('ignore');
      expect(result.source).toBe('domain');
    });

    it('entity_id has highest precedence over pattern and domain', async () => {
      const loader = makeLoader([
        { tier: 'escalate', domain: 'light', priority: 0 },
        { tier: 'log_only', entity_pattern: 'light.security_*', priority: 5 },
        { tier: 'ignore', entity_id: 'light.security_floodlight', priority: 0 },
      ]);
      const resolver = new EntityTierResolver({ loader });

      const result = await resolver.resolve('light.security_floodlight', 'default');
      expect(result.tier).toBe('ignore');
      expect(result.source).toBe('entity_id');
    });

    it('pattern has precedence over domain rule', async () => {
      const loader = makeLoader([
        { tier: 'escalate', domain: 'light', priority: 0 },
        { tier: 'log_only', entity_pattern: 'light.test_*', priority: 5 },
      ]);
      const resolver = new EntityTierResolver({ loader });

      const result = await resolver.resolve('light.test_lamp', 'default');
      expect(result.tier).toBe('log_only');
      expect(result.source).toBe('pattern');
    });

    it('higher priority pattern wins over lower priority', async () => {
      const loader = makeLoader([
        { tier: 'log_only', entity_pattern: 'sensor.*', priority: 1 },
        { tier: 'escalate', entity_pattern: 'sensor.critical_*', priority: 10 },
      ]);
      const resolver = new EntityTierResolver({ loader });

      // The higher-priority pattern should win because rules are sorted by priority desc
      const result = await resolver.resolve('sensor.critical_temp', 'default');
      expect(result.tier).toBe('escalate');
      expect(result.source).toBe('pattern');
    });
  });

  describe('namespace isolation', () => {
    it('loads rules per namespace', async () => {
      const loader = vi
        .fn()
        .mockResolvedValueOnce([{ tier: 'ignore' as EntityTier, entity_id: 'light.kitchen', priority: 0 }])
        .mockResolvedValueOnce([{ tier: 'escalate' as EntityTier, entity_id: 'light.kitchen', priority: 0 }]);

      const resolver = new EntityTierResolver({ loader });

      const resultA = await resolver.resolve('light.kitchen', 'tenant-a');
      const resultB = await resolver.resolve('light.kitchen', 'tenant-b');

      expect(resultA.tier).toBe('ignore');
      expect(resultB.tier).toBe('escalate');
      expect(loader).toHaveBeenCalledWith('tenant-a');
      expect(loader).toHaveBeenCalledWith('tenant-b');
    });
  });

  describe('caching', () => {
    it('caches rules within TTL', async () => {
      const loader = makeLoader([{ tier: 'ignore', entity_id: 'light.kitchen', priority: 0 }]);
      const resolver = new EntityTierResolver({ loader, cacheTtlMs: 60_000 });

      await resolver.resolve('light.kitchen', 'default');
      await resolver.resolve('light.kitchen', 'default');

      // Loader should only be called once due to caching
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('reloads rules after TTL expires', async () => {
      vi.useFakeTimers();
      try {
        const loader = makeLoader([{ tier: 'ignore', entity_id: 'light.kitchen', priority: 0 }]);
        const resolver = new EntityTierResolver({ loader, cacheTtlMs: 1000 });

        await resolver.resolve('light.kitchen', 'default');
        expect(loader).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1500);

        await resolver.resolve('light.kitchen', 'default');
        expect(loader).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('invalidate() clears cache for specific namespace', async () => {
      const loader = makeLoader([{ tier: 'ignore', entity_id: 'light.kitchen', priority: 0 }]);
      const resolver = new EntityTierResolver({ loader, cacheTtlMs: 60_000 });

      await resolver.resolve('light.kitchen', 'default');
      expect(loader).toHaveBeenCalledTimes(1);

      resolver.invalidate('default');

      await resolver.resolve('light.kitchen', 'default');
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it('invalidate() without namespace clears all caches', async () => {
      const loader = makeLoader([]);
      const resolver = new EntityTierResolver({ loader, cacheTtlMs: 60_000 });

      await resolver.resolve('light.kitchen', 'tenant-a');
      await resolver.resolve('light.kitchen', 'tenant-b');
      expect(loader).toHaveBeenCalledTimes(2);

      resolver.invalidate();

      await resolver.resolve('light.kitchen', 'tenant-a');
      await resolver.resolve('light.kitchen', 'tenant-b');
      expect(loader).toHaveBeenCalledTimes(4);
    });
  });

  describe('resolveBatch', () => {
    it('resolves multiple entities in a single call', async () => {
      const resolver = new EntityTierResolver();
      const entityIds = ['light.living_room', 'device_tracker.phone', 'alarm_control_panel.home', 'automation.morning', 'sensor.phone_battery'];

      const results = await resolver.resolveBatch(entityIds, 'default');

      expect(results.get('light.living_room')?.tier).toBe('triage');
      expect(results.get('device_tracker.phone')?.tier).toBe('geo');
      expect(results.get('alarm_control_panel.home')?.tier).toBe('escalate');
      expect(results.get('automation.morning')?.tier).toBe('ignore');
      expect(results.get('sensor.phone_battery')?.tier).toBe('log_only');
    });

    it('loads DB rules only once for a batch', async () => {
      const loader = makeLoader([]);
      const resolver = new EntityTierResolver({ loader });

      await resolver.resolveBatch(['light.a', 'light.b', 'light.c'], 'default');

      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('applies DB overrides in batch mode', async () => {
      const loader = makeLoader([{ tier: 'escalate', entity_id: 'light.security', priority: 0 }]);
      const resolver = new EntityTierResolver({ loader });

      const results = await resolver.resolveBatch(['light.security', 'light.kitchen'], 'default');

      expect(results.get('light.security')?.tier).toBe('escalate');
      expect(results.get('light.security')?.source).toBe('entity_id');
      expect(results.get('light.kitchen')?.tier).toBe('triage');
      expect(results.get('light.kitchen')?.source).toBe('default');
    });
  });

  describe('no loader (defaults only)', () => {
    it('works without a loader', async () => {
      const resolver = new EntityTierResolver();

      const result = await resolver.resolve('light.kitchen', 'default');
      expect(result.tier).toBe('triage');
      expect(result.source).toBe('default');
    });
  });

  describe('edge cases', () => {
    it('handles entity_id with no dot (just domain)', async () => {
      const resolver = new EntityTierResolver();
      // Unusual but possible — extractDomain returns the whole string
      const result = await resolver.resolve('nodomain', 'default');
      expect(result.tier).toBe('log_only');
      expect(result.source).toBe('default');
    });

    it('handles empty entity list in resolveBatch', async () => {
      const resolver = new EntityTierResolver();
      const results = await resolver.resolveBatch([], 'default');
      expect(results.size).toBe(0);
    });

    it('signal sensor pattern matches log_only', async () => {
      const resolver = new EntityTierResolver();
      const result = await resolver.resolve('sensor.zwave_signal', 'default');
      expect(result.tier).toBe('log_only');
    });
  });
});
