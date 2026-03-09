/**
 * Verify that the rrule CJS package can be imported and used correctly.
 * Regression test for Issue #2307 — Node 25 ESM mode breaks named imports
 * from CJS packages without an exports map.
 */
import { describe, it, expect } from 'vitest';

describe('rrule ESM compatibility (#2307)', () => {
  it('imports rrule default export and destructures RRule', async () => {
    const rruleModule = await import('rrule');
    const { RRule } = rruleModule.default ?? rruleModule;
    expect(RRule).toBeDefined();
    expect(typeof RRule.fromString).toBe('function');
  });

  it('recurrence service exports load correctly', async () => {
    const mod = await import('../../src/api/recurrence/service.ts');
    expect(mod.parseRRule).toBeDefined();
    expect(mod.getNextOccurrence).toBeDefined();
    expect(mod.getNextOccurrences).toBeDefined();
  });

  it('parseRRule works with a daily rule', async () => {
    const { parseRRule } = await import('../../src/api/recurrence/service.ts');
    const rule = parseRRule('FREQ=DAILY');
    expect(rule).toBeDefined();
    expect(rule.options.freq).toBe(3); // RRule.DAILY = 3
  });

  it('barrel export from recurrence/index.ts loads all exports', async () => {
    const mod = await import('../../src/api/recurrence/index.ts');
    expect(mod.parseRRule).toBeDefined();
    expect(mod.describeRrule).toBeDefined();
    expect(mod.getRecurrenceInfo).toBeDefined();
    expect(mod.getInstances).toBeDefined();
  });
});
