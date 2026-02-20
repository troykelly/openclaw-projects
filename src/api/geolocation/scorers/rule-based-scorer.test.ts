/**
 * Tests for rule-based observation scorer.
 *
 * Covers base domain scores, binary_sensor device class overrides,
 * temporal modifiers, uncommon state modifiers, scene detection,
 * tier overrides (escalate/log_only), and batch scoring.
 *
 * Issue #1453, Epic #1440.
 */

import { describe, expect, it } from 'vitest';
import type { EntityTier } from '../ha-entity-tiers.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import type { ObservationContext, TimeBucket } from '../ha-observation-scorer.ts';
import { RuleBasedScorer } from './rule-based-scorer.ts';

// ---------- helpers ----------

function makeChange(entityId: string, newState: string = 'on', attrs: Record<string, unknown> = {}, oldState: string | null = null): HaStateChange {
  const domain = entityId.split('.')[0];
  return {
    entity_id: entityId,
    domain,
    old_state: oldState,
    new_state: newState,
    old_attributes: {},
    new_attributes: attrs,
    last_changed: '2026-02-20T10:00:00Z',
    last_updated: '2026-02-20T10:00:00Z',
    context: { id: 'ctx-1', parent_id: null, user_id: null },
  };
}

function makeContext(timeBucket: TimeBucket = 'afternoon', dayOfWeek: string = 'wednesday', isWeekend: boolean = false): ObservationContext {
  return { day_of_week: dayOfWeek, time_bucket: timeBucket, is_weekend: isWeekend };
}

// ---------- tests ----------

describe('RuleBasedScorer', () => {
  const scorer = new RuleBasedScorer();

  describe('scorer identity', () => {
    it('has the correct id', () => {
      expect(scorer.id).toBe('rule-based');
    });
  });

  describe('domain base scores', () => {
    const ctx = makeContext();

    it('alarm_control_panel gets base score 9', () => {
      const change = makeChange('alarm_control_panel.home', 'armed_away');
      // alarm_control_panel is escalate tier in real usage, but test triage tier for base score
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(9);
    });

    it('lock gets base score 7', () => {
      const change = makeChange('lock.front_door', 'locked');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(7);
    });

    it('cover gets base score 5', () => {
      const change = makeChange('cover.garage', 'open');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(5);
    });

    it('climate gets base score 4', () => {
      const change = makeChange('climate.living_room', 'heat');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(4);
    });

    it('light gets base score 3', () => {
      const change = makeChange('light.kitchen', 'on');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(3);
    });

    it('switch gets base score 3', () => {
      const change = makeChange('switch.pump', 'on');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(3);
    });

    it('media_player gets base score 2', () => {
      const change = makeChange('media_player.tv', 'playing');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(2);
    });

    it('fan gets base score 2', () => {
      const change = makeChange('fan.bedroom', 'on');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(2);
    });

    it('vacuum gets base score 2', () => {
      const change = makeChange('vacuum.roborock', 'cleaning');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(2);
    });

    it('input_boolean gets base score 1', () => {
      const change = makeChange('input_boolean.guest_mode', 'on');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(1);
    });

    it('unknown domain defaults to base score 1', () => {
      const change = makeChange('custom_domain.thing', 'active');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(1);
    });
  });

  describe('binary_sensor device class overrides', () => {
    const ctx = makeContext();

    it('motion sensor gets base score 2', () => {
      const change = makeChange('binary_sensor.hallway_motion', 'on', {
        device_class: 'motion',
      });
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(2);
    });

    it('door sensor gets base score 5', () => {
      const change = makeChange('binary_sensor.front_door', 'on', {
        device_class: 'door',
      });
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(5);
    });

    it('window sensor gets base score 5', () => {
      const change = makeChange('binary_sensor.bedroom_window', 'on', {
        device_class: 'window',
      });
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(5);
    });

    it('garage_door sensor gets base score 6', () => {
      const change = makeChange('binary_sensor.garage', 'on', {
        device_class: 'garage_door',
      });
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(6);
    });

    it('smoke sensor gets base score 9', () => {
      const change = makeChange('binary_sensor.kitchen_smoke', 'on', {
        device_class: 'smoke',
      });
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(9);
    });

    it('binary_sensor without device_class uses domain default (3)', () => {
      const change = makeChange('binary_sensor.generic', 'on');
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(3);
    });

    it('binary_sensor with unknown device_class uses domain default (3)', () => {
      const change = makeChange('binary_sensor.generic', 'on', {
        device_class: 'unknown_class',
      });
      const result = scorer.score(change, ctx, 'triage');
      expect(result.score_breakdown.base).toBe(3);
    });
  });

  describe('unusual time modifier (+2)', () => {
    it('lock activity at night gets +2', () => {
      const ctx = makeContext('night');
      const change = makeChange('lock.front_door', 'unlocked');
      const result = scorer.score(change, ctx, 'triage');

      const timeModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'unusual time of day');
      expect(timeModifier).toBeDefined();
      expect(timeModifier!.delta).toBe(2);
    });

    it('lock activity at night_late gets +2', () => {
      const ctx = makeContext('night_late');
      const change = makeChange('lock.front_door', 'unlocked');
      const result = scorer.score(change, ctx, 'triage');

      const timeModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'unusual time of day');
      expect(timeModifier).toBeDefined();
      expect(timeModifier!.delta).toBe(2);
    });

    it('lock activity in afternoon gets no time modifier', () => {
      const ctx = makeContext('afternoon');
      const change = makeChange('lock.front_door', 'unlocked');
      const result = scorer.score(change, ctx, 'triage');

      const timeModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'unusual time of day');
      expect(timeModifier).toBeUndefined();
    });

    it('light activity at night gets +2', () => {
      const ctx = makeContext('night');
      const change = makeChange('light.bedroom', 'on');
      const result = scorer.score(change, ctx, 'triage');

      const timeModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'unusual time of day');
      expect(timeModifier).toBeDefined();
      expect(timeModifier!.delta).toBe(2);
    });

    it('cover activity at night gets +2', () => {
      const ctx = makeContext('night');
      const change = makeChange('cover.garage', 'open');
      const result = scorer.score(change, ctx, 'triage');

      const timeModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'unusual time of day');
      expect(timeModifier).toBeDefined();
    });

    it('media_player has no unusual time mapping', () => {
      const ctx = makeContext('night');
      const change = makeChange('media_player.tv', 'playing');
      const result = scorer.score(change, ctx, 'triage');

      const timeModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'unusual time of day');
      expect(timeModifier).toBeUndefined();
    });
  });

  describe('uncommon state modifier (+1)', () => {
    it('lock unlocked gets +1', () => {
      const ctx = makeContext();
      const change = makeChange('lock.front_door', 'unlocked');
      const result = scorer.score(change, ctx, 'triage');

      const stateModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'uncommon state transition');
      expect(stateModifier).toBeDefined();
      expect(stateModifier!.delta).toBe(1);
    });

    it('lock jammed gets +1', () => {
      const ctx = makeContext();
      const change = makeChange('lock.front_door', 'jammed');
      const result = scorer.score(change, ctx, 'triage');

      const stateModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'uncommon state transition');
      expect(stateModifier).toBeDefined();
    });

    it('lock locked does not get uncommon state modifier', () => {
      const ctx = makeContext();
      const change = makeChange('lock.front_door', 'locked');
      const result = scorer.score(change, ctx, 'triage');

      const stateModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'uncommon state transition');
      expect(stateModifier).toBeUndefined();
    });

    it('alarm triggered gets +1', () => {
      const ctx = makeContext();
      const change = makeChange('alarm_control_panel.home', 'triggered');
      const result = scorer.score(change, ctx, 'triage');

      const stateModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'uncommon state transition');
      expect(stateModifier).toBeDefined();
    });

    it('cover open gets +1', () => {
      const ctx = makeContext();
      const change = makeChange('cover.garage', 'open');
      const result = scorer.score(change, ctx, 'triage');

      const stateModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'uncommon state transition');
      expect(stateModifier).toBeDefined();
    });

    it('binary_sensor on gets +1', () => {
      const ctx = makeContext();
      const change = makeChange('binary_sensor.motion', 'on', {
        device_class: 'motion',
      });
      const result = scorer.score(change, ctx, 'triage');

      const stateModifier = result.score_breakdown.modifiers.find((m) => m.reason === 'uncommon state transition');
      expect(stateModifier).toBeDefined();
    });
  });

  describe('combined modifiers', () => {
    it('lock unlocked at night gets both modifiers (+3 total)', () => {
      const ctx = makeContext('night');
      const change = makeChange('lock.front_door', 'unlocked');
      const result = scorer.score(change, ctx, 'triage');

      // Base: 7, +2 unusual time, +1 uncommon state = 10
      expect(result.score_breakdown.base).toBe(7);
      expect(result.score_breakdown.modifiers).toHaveLength(2);
      expect(result.score).toBe(10);
    });

    it('score is clamped to 10', () => {
      const ctx = makeContext('night');
      // alarm_control_panel with base 9 + time +2 + state +1 = 12, clamped to 10
      const change = makeChange('alarm_control_panel.home', 'triggered');
      const result = scorer.score(change, ctx, 'triage');

      expect(result.score).toBeLessThanOrEqual(10);
    });

    it('score is never negative', () => {
      const ctx = makeContext();
      const change = makeChange('input_boolean.test', 'off');
      const result = scorer.score(change, ctx, 'triage');

      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('tier overrides', () => {
    const ctx = makeContext();

    it('escalate tier always returns score 10', () => {
      const change = makeChange('sensor.water_leak', 'on');
      const result = scorer.score(change, ctx, 'escalate');

      expect(result.score).toBe(10);
      expect(result.score_breakdown.base).toBe(10);
    });

    it('log_only tier always returns score 0', () => {
      const change = makeChange('sensor.battery', '85');
      const result = scorer.score(change, ctx, 'log_only');

      expect(result.score).toBe(0);
      expect(result.score_breakdown.base).toBe(0);
    });

    it('ignore tier returns score 0', () => {
      const change = makeChange('automation.morning', 'on');
      const result = scorer.score(change, ctx, 'ignore');

      expect(result.score).toBe(0);
    });

    it('geo tier returns score 0', () => {
      const change = makeChange('device_tracker.phone', 'home');
      const result = scorer.score(change, ctx, 'geo');

      expect(result.score).toBe(0);
    });
  });

  describe('scene detection', () => {
    it('detects bedtime scene in evening', () => {
      const ctx = makeContext('evening');
      const changes = [
        makeChange('light.living_room', 'off'),
        makeChange('light.kitchen', 'off'),
        makeChange('lock.front_door', 'locked'),
        makeChange('media_player.tv', 'off'),
      ];

      const tiers = new Map<string, EntityTier>([
        ['light.living_room', 'triage'],
        ['light.kitchen', 'triage'],
        ['lock.front_door', 'triage'],
        ['media_player.tv', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scenes).toContain('bedtime');
    });

    it('detects morning_routine scene in morning_early', () => {
      const ctx = makeContext('morning_early');
      const changes = [makeChange('light.kitchen', 'on'), makeChange('cover.living_room', 'open'), makeChange('media_player.speaker', 'playing')];

      const tiers = new Map<string, EntityTier>([
        ['light.kitchen', 'triage'],
        ['cover.living_room', 'triage'],
        ['media_player.speaker', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scenes).toContain('morning_routine');
    });

    it('detects leaving_home scene in morning', () => {
      const ctx = makeContext('morning');
      const changes = [makeChange('lock.front_door', 'locked'), makeChange('light.hallway', 'off'), makeChange('alarm_control_panel.home', 'armed_away')];

      const tiers = new Map<string, EntityTier>([
        ['lock.front_door', 'triage'],
        ['light.hallway', 'triage'],
        ['alarm_control_panel.home', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scenes).toContain('leaving_home');
    });

    it('detects arriving_home scene in evening', () => {
      const ctx = makeContext('evening');
      const changes = [makeChange('lock.front_door', 'unlocked'), makeChange('light.hallway', 'on'), makeChange('alarm_control_panel.home', 'disarmed')];

      const tiers = new Map<string, EntityTier>([
        ['lock.front_door', 'triage'],
        ['light.hallway', 'triage'],
        ['alarm_control_panel.home', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scenes).toContain('arriving_home');
    });

    it('does not detect scene with too few indicators', () => {
      const ctx = makeContext('evening');
      const changes = [
        makeChange('light.living_room', 'off'),
        // Only 1 indicator — bedtime needs 2
      ];

      const tiers = new Map<string, EntityTier>([['light.living_room', 'triage']]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scenes).not.toContain('bedtime');
    });

    it('does not detect scene in wrong time bucket', () => {
      const ctx = makeContext('morning'); // morning, not evening/night_late for bedtime
      const changes = [makeChange('light.living_room', 'off'), makeChange('lock.front_door', 'locked'), makeChange('media_player.tv', 'off')];

      const tiers = new Map<string, EntityTier>([
        ['light.living_room', 'triage'],
        ['lock.front_door', 'triage'],
        ['media_player.tv', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scenes).not.toContain('bedtime');
    });

    it('tags scored observations with detected scene label', () => {
      const ctx = makeContext('evening');
      const changes = [makeChange('light.living_room', 'off'), makeChange('lock.front_door', 'locked')];

      const tiers = new Map<string, EntityTier>([
        ['light.living_room', 'triage'],
        ['lock.front_door', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      // Both changes are part of the bedtime scene
      const lightObs = result.scored.find((s) => s.change.entity_id === 'light.living_room');
      expect(lightObs?.scene_label).toBe('bedtime');
    });
  });

  describe('batch scoring', () => {
    it('scores all changes individually', () => {
      const ctx = makeContext();
      const changes = [makeChange('light.kitchen', 'on'), makeChange('lock.front_door', 'locked'), makeChange('sensor.temperature', '22.5')];

      const tiers = new Map<string, EntityTier>([
        ['light.kitchen', 'triage'],
        ['lock.front_door', 'triage'],
        ['sensor.temperature', 'log_only'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored).toHaveLength(3);
    });

    it('filters triaged observations (score >= 4)', () => {
      const ctx = makeContext();
      const changes = [
        makeChange('light.kitchen', 'on'), // base 3, no modifiers = 3 (below threshold)
        makeChange('lock.front_door', 'locked'), // base 7 = 7 (above threshold)
        makeChange('cover.garage', 'open'), // base 5 + uncommon state +1 = 6 (above threshold)
      ];

      const tiers = new Map<string, EntityTier>([
        ['light.kitchen', 'triage'],
        ['lock.front_door', 'triage'],
        ['cover.garage', 'triage'],
      ]);

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.triaged.length).toBeGreaterThanOrEqual(2);
      for (const t of result.triaged) {
        expect(t.score).toBeGreaterThanOrEqual(4);
      }
    });

    it('defaults missing tiers to log_only', () => {
      const ctx = makeContext();
      const changes = [makeChange('sensor.unknown', '42')];

      // Empty tiers map — entity not found
      const tiers = new Map<string, EntityTier>();

      const result = scorer.scoreBatch(changes, ctx, tiers);

      expect(result.scored[0].score).toBe(0);
    });

    it('handles empty batch', () => {
      const ctx = makeContext();
      const tiers = new Map<string, EntityTier>();

      const result = scorer.scoreBatch([], ctx, tiers);

      expect(result.scored).toHaveLength(0);
      expect(result.triaged).toHaveLength(0);
      expect(result.scenes).toHaveLength(0);
    });
  });

  describe('score breakdown', () => {
    it('includes base, modifiers, and final in breakdown', () => {
      const ctx = makeContext('night');
      const change = makeChange('lock.front_door', 'unlocked');
      const result = scorer.score(change, ctx, 'triage');

      expect(result.score_breakdown).toHaveProperty('base');
      expect(result.score_breakdown).toHaveProperty('modifiers');
      expect(result.score_breakdown).toHaveProperty('final');
      expect(result.score_breakdown.final).toBe(result.score);
    });

    it('escalate tier breakdown shows base 10', () => {
      const ctx = makeContext();
      const change = makeChange('sensor.water_leak', 'on');
      const result = scorer.score(change, ctx, 'escalate');

      expect(result.score_breakdown.base).toBe(10);
      expect(result.score_breakdown.final).toBe(10);
    });
  });
});
