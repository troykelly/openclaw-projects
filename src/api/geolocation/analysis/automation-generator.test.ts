/**
 * Tests for AutomationGenerator.
 * Issue #1464, Epic #1440.
 */

import { describe, it, expect } from 'vitest';

import { AutomationGenerator, type HaRoutine, type HaAutomationSuggestion } from './automation-generator.ts';

// ---------- helpers ----------

function makeRoutine(overrides?: Partial<HaRoutine>): HaRoutine {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    key: 'bedtime:22:monday,tuesday',
    title: 'Evening Bedtime',
    description: 'Detected bedtime pattern',
    confidence: 0.85,
    status: 'confirmed',
    time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 15 },
    days: ['monday', 'tuesday'],
    sequence: [
      { entity_id: 'light.bedroom', domain: 'light', to_state: 'off', offset_minutes: 0 },
      { entity_id: 'lock.front_door', domain: 'lock', to_state: 'locked', offset_minutes: 2 },
      { entity_id: 'switch.hall', domain: 'switch', to_state: 'off', offset_minutes: 3 },
    ],
    ...overrides,
  };
}

// ---------- tests ----------

describe('AutomationGenerator', () => {
  const generator = new AutomationGenerator();

  describe('generate()', () => {
    it('generates automation for a confirmed routine with sufficient confidence', () => {
      const routine = makeRoutine();
      const result = generator.generate(routine);

      expect(result).not.toBeNull();
      const suggestion = result as HaAutomationSuggestion;

      expect(suggestion.trigger_entity).toBe('light.bedroom');
      expect(suggestion.action_entities).toEqual(['lock.front_door', 'switch.hall']);
      expect(suggestion.yaml).toBeTruthy();
      expect(suggestion.description).toContain('Evening Bedtime');
      expect(suggestion.confidence_note).toContain('85%');
    });

    it('returns null for non-confirmed routine', () => {
      const routine = makeRoutine({ status: 'tentative' });
      expect(generator.generate(routine)).toBeNull();
    });

    it('returns null for rejected routine', () => {
      const routine = makeRoutine({ status: 'rejected' });
      expect(generator.generate(routine)).toBeNull();
    });

    it('returns null for archived routine', () => {
      const routine = makeRoutine({ status: 'archived' });
      expect(generator.generate(routine)).toBeNull();
    });

    it('returns null for confidence below 0.7', () => {
      const routine = makeRoutine({ confidence: 0.6 });
      expect(generator.generate(routine)).toBeNull();
    });

    it('returns null for exactly 0.69 confidence', () => {
      const routine = makeRoutine({ confidence: 0.69 });
      expect(generator.generate(routine)).toBeNull();
    });

    it('generates for exactly 0.7 confidence', () => {
      const routine = makeRoutine({ confidence: 0.7 });
      const result = generator.generate(routine);
      expect(result).not.toBeNull();
    });

    it('returns null for routine with only 1 entity (no action possible)', () => {
      const routine = makeRoutine({
        sequence: [
          { entity_id: 'light.bedroom', domain: 'light', to_state: 'off', offset_minutes: 0 },
        ],
      });
      expect(generator.generate(routine)).toBeNull();
    });

    it('returns null for routine with >5 action entities', () => {
      const sequence = Array.from({ length: 7 }, (_, i) => ({
        entity_id: `light.room_${i}`,
        domain: 'light',
        to_state: 'off',
        offset_minutes: i * 2,
      }));
      // 7 entities = 1 trigger + 6 actions > MAX_ACTION_ENTITIES (5)
      const routine = makeRoutine({ sequence });
      expect(generator.generate(routine)).toBeNull();
    });

    it('generates for exactly 5 action entities (6 total)', () => {
      const sequence = Array.from({ length: 6 }, (_, i) => ({
        entity_id: `light.room_${i}`,
        domain: 'light',
        to_state: 'off',
        offset_minutes: i * 2,
      }));
      // 6 entities = 1 trigger + 5 actions = exactly at limit
      const routine = makeRoutine({ sequence });
      const result = generator.generate(routine);
      expect(result).not.toBeNull();
      expect(result!.action_entities).toHaveLength(5);
    });

    it('returns null for empty sequence', () => {
      const routine = makeRoutine({ sequence: [] });
      expect(generator.generate(routine)).toBeNull();
    });
  });

  describe('YAML output', () => {
    it('contains alias matching routine title', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('alias: "Evening Bedtime"');
    });

    it('contains description when provided', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('description: "Detected bedtime pattern"');
    });

    it('omits description when null', () => {
      const result = generator.generate(makeRoutine({ description: null }))!;
      expect(result.yaml).not.toContain('description:');
    });

    it('contains state trigger for first entity', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('platform: state');
      expect(result.yaml).toContain('entity_id: light.bedroom');
      expect(result.yaml).toContain('to: "off"');
    });

    it('contains time condition with start and end hours', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('condition: time');
      expect(result.yaml).toContain('after: "22:00:00"');
      expect(result.yaml).toContain('before: "23:00:00"');
    });

    it('contains weekday condition for non-everyday routines', () => {
      const result = generator.generate(makeRoutine({ days: ['monday', 'friday'] }))!;
      expect(result.yaml).toContain('weekday:');
      expect(result.yaml).toContain('- mon');
      expect(result.yaml).toContain('- fri');
    });

    it('omits weekday condition for everyday routines', () => {
      const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const result = generator.generate(makeRoutine({ days: allDays }))!;
      expect(result.yaml).not.toContain('weekday:');
    });

    it('contains action services for subsequent entities', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('service: lock.lock');
      expect(result.yaml).toContain('entity_id: lock.front_door');
      expect(result.yaml).toContain('service: switch.turn_off');
      expect(result.yaml).toContain('entity_id: switch.hall');
    });

    it('includes offset comment for delayed actions', () => {
      const result = generator.generate(makeRoutine())!;
      // lock.front_door has offset_minutes: 2
      expect(result.yaml).toContain('# Offset: ~2 minute(s) after trigger');
    });

    it('omits offset comment for zero-offset actions', () => {
      const routine = makeRoutine({
        sequence: [
          { entity_id: 'light.bedroom', domain: 'light', to_state: 'off', offset_minutes: 0 },
          { entity_id: 'switch.hall', domain: 'switch', to_state: 'off', offset_minutes: 0 },
        ],
      });
      const result = generator.generate(routine)!;
      expect(result.yaml).not.toContain('# Offset');
    });

    it('contains mode: single', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('mode: single');
    });

    it('generates id from routine key', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.yaml).toContain('id: "auto_bedtime_22_monday_tuesday"');
    });
  });

  describe('domain → service mapping', () => {
    function testServiceMapping(domain: string, toState: string, expectedService: string): void {
      const routine = makeRoutine({
        sequence: [
          { entity_id: 'trigger.entity', domain: 'light', to_state: 'off', offset_minutes: 0 },
          { entity_id: `${domain}.test`, domain, to_state: toState, offset_minutes: 1 },
        ],
      });
      const result = generator.generate(routine)!;
      expect(result.yaml).toContain(`service: ${expectedService}`);
    }

    it('maps light off → light.turn_off', () => {
      testServiceMapping('light', 'off', 'light.turn_off');
    });

    it('maps light on → light.turn_on', () => {
      testServiceMapping('light', 'on', 'light.turn_on');
    });

    it('maps switch off → switch.turn_off', () => {
      testServiceMapping('switch', 'off', 'switch.turn_off');
    });

    it('maps lock locked → lock.lock', () => {
      testServiceMapping('lock', 'locked', 'lock.lock');
    });

    it('maps lock unlocked → lock.unlock', () => {
      testServiceMapping('lock', 'unlocked', 'lock.unlock');
    });

    it('maps cover closed → cover.close_cover', () => {
      testServiceMapping('cover', 'closed', 'cover.close_cover');
    });

    it('maps cover open → cover.open_cover', () => {
      testServiceMapping('cover', 'open', 'cover.open_cover');
    });

    it('maps climate → climate.set_hvac_mode', () => {
      testServiceMapping('climate', 'heat', 'climate.set_hvac_mode');
    });

    it('maps fan off → fan.turn_off', () => {
      testServiceMapping('fan', 'off', 'fan.turn_off');
    });

    it('maps fan on → fan.turn_on', () => {
      testServiceMapping('fan', 'on', 'fan.turn_on');
    });

    it('maps media_player off → media_player.turn_off', () => {
      testServiceMapping('media_player', 'off', 'media_player.turn_off');
    });

    it('maps alarm_control_panel armed_away → alarm_arm_away', () => {
      testServiceMapping('alarm_control_panel', 'armed_away', 'alarm_control_panel.alarm_arm_away');
    });

    it('maps alarm_control_panel armed_home → alarm_arm_home', () => {
      testServiceMapping('alarm_control_panel', 'armed_home', 'alarm_control_panel.alarm_arm_home');
    });

    it('maps alarm_control_panel armed_night → alarm_arm_night', () => {
      testServiceMapping('alarm_control_panel', 'armed_night', 'alarm_control_panel.alarm_arm_night');
    });

    it('maps alarm_control_panel disarmed → alarm_disarm', () => {
      testServiceMapping('alarm_control_panel', 'disarmed', 'alarm_control_panel.alarm_disarm');
    });

    it('maps unknown domain off → homeassistant.turn_off', () => {
      testServiceMapping('unknown_thing', 'off', 'homeassistant.turn_off');
    });

    it('maps unknown domain on → homeassistant.turn_on', () => {
      testServiceMapping('unknown_thing', 'on', 'homeassistant.turn_on');
    });
  });

  describe('description and confidence note', () => {
    it('description includes trigger entity and action entities', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.description).toContain('light.bedroom');
      expect(result.description).toContain('lock.front_door');
      expect(result.description).toContain('switch.hall');
    });

    it('description includes time range', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.description).toContain('22:00:00');
      expect(result.description).toContain('23:00:00');
    });

    it('description says "every day" for all days', () => {
      const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const result = generator.generate(makeRoutine({ days: allDays }))!;
      expect(result.description).toContain('every day');
    });

    it('confidence note includes percentage', () => {
      const result = generator.generate(makeRoutine({ confidence: 0.92 }))!;
      expect(result.confidence_note).toContain('92%');
    });

    it('confidence note includes routine key', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.confidence_note).toContain('bedtime:22:monday,tuesday');
    });

    it('confidence note includes review recommendation', () => {
      const result = generator.generate(makeRoutine())!;
      expect(result.confidence_note).toContain('Review before enabling');
    });
  });

  describe('YAML escaping', () => {
    it('escapes double quotes in title', () => {
      const result = generator.generate(makeRoutine({ title: 'My "Special" Routine' }))!;
      expect(result.yaml).toContain('alias: "My \\"Special\\" Routine"');
    });

    it('escapes backslashes in description', () => {
      const result = generator.generate(makeRoutine({ description: 'Path: C:\\Users\\test' }))!;
      expect(result.yaml).toContain('description: "Path: C:\\\\Users\\\\test"');
    });
  });
});
