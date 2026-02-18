/**
 * Tests for natural language recurrence parser.
 * Part of Issue #217.
 */

import { describe, it, expect } from 'vitest';
import { parseNaturalLanguage, describeRrule } from '../../src/api/recurrence/parser.ts';

describe('Natural Language Parser', () => {
  describe('Daily Patterns', () => {
    it('parses "every day"', () => {
      const result = parseNaturalLanguage('every day');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=DAILY');
    });

    it('parses "daily"', () => {
      const result = parseNaturalLanguage('daily');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=DAILY');
    });

    it('parses "every day at 9am"', () => {
      const result = parseNaturalLanguage('every day at 9am');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=DAILY');
      expect(result.rrule).toContain('BYHOUR=9');
      expect(result.rrule).toContain('BYMINUTE=0');
    });

    it('parses "every 2 days"', () => {
      const result = parseNaturalLanguage('every 2 days');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=DAILY');
      expect(result.rrule).toContain('INTERVAL=2');
    });
  });

  describe('Weekly Patterns', () => {
    it('parses "every week"', () => {
      const result = parseNaturalLanguage('every week');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
    });

    it('parses "weekly"', () => {
      const result = parseNaturalLanguage('weekly');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
    });

    it('parses "every Monday"', () => {
      const result = parseNaturalLanguage('every Monday');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
      expect(result.rrule).toContain('BYDAY=MO');
    });

    it('parses "every Monday and Friday"', () => {
      const result = parseNaturalLanguage('every Monday and Friday');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
      expect(result.rrule).toMatch(/BYDAY=.*MO/);
      expect(result.rrule).toMatch(/BYDAY=.*FR/);
    });

    it('parses "every weekday"', () => {
      const result = parseNaturalLanguage('every weekday');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
      expect(result.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
    });

    it('parses "weekdays at 9am"', () => {
      const result = parseNaturalLanguage('weekdays at 9am');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
      expect(result.rrule).toContain('BYDAY=MO,TU,WE,TH,FR');
      expect(result.rrule).toContain('BYHOUR=9');
    });

    it('parses "every weekend"', () => {
      const result = parseNaturalLanguage('every weekend');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
      expect(result.rrule).toContain('BYDAY=SA,SU');
    });

    it('parses "every 2 weeks"', () => {
      const result = parseNaturalLanguage('every 2 weeks');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=WEEKLY');
      expect(result.rrule).toContain('INTERVAL=2');
    });
  });

  describe('Monthly Patterns', () => {
    it('parses "every month"', () => {
      const result = parseNaturalLanguage('every month');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=MONTHLY');
    });

    it('parses "monthly"', () => {
      const result = parseNaturalLanguage('monthly');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=MONTHLY');
    });

    it('parses "first of every month"', () => {
      const result = parseNaturalLanguage('first of every month');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=MONTHLY');
      expect(result.rrule).toContain('BYMONTHDAY=1');
    });

    it('parses "1st of the month"', () => {
      const result = parseNaturalLanguage('1st of the month');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=MONTHLY');
      expect(result.rrule).toContain('BYMONTHDAY=1');
    });

    it('parses "last of the month"', () => {
      const result = parseNaturalLanguage('last of the month');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=MONTHLY');
      expect(result.rrule).toContain('BYMONTHDAY=-1');
    });

    it('parses "15th of every month"', () => {
      const result = parseNaturalLanguage('15th of every month');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=MONTHLY');
      expect(result.rrule).toContain('BYMONTHDAY=15');
    });
  });

  describe('Yearly Patterns', () => {
    it('parses "every year"', () => {
      const result = parseNaturalLanguage('every year');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=YEARLY');
    });

    it('parses "yearly"', () => {
      const result = parseNaturalLanguage('yearly');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=YEARLY');
    });

    it('parses "annually"', () => {
      const result = parseNaturalLanguage('annually');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=YEARLY');
    });
  });

  describe('Time Patterns', () => {
    it('parses "at 9am"', () => {
      const result = parseNaturalLanguage('every day at 9am');
      expect(result.rrule).toContain('BYHOUR=9');
      expect(result.rrule).toContain('BYMINUTE=0');
    });

    it('parses "at 2:30pm"', () => {
      const result = parseNaturalLanguage('every day at 2:30pm');
      expect(result.rrule).toContain('BYHOUR=14');
      expect(result.rrule).toContain('BYMINUTE=30');
    });

    it('parses "at 14:00"', () => {
      const result = parseNaturalLanguage('every day at 14:00');
      expect(result.rrule).toContain('BYHOUR=14');
      expect(result.rrule).toContain('BYMINUTE=0');
    });

    it('parses "morning"', () => {
      const result = parseNaturalLanguage('every day morning');
      expect(result.rrule).toContain('BYHOUR=9');
    });

    it('parses "evening"', () => {
      const result = parseNaturalLanguage('every day evening');
      expect(result.rrule).toContain('BYHOUR=18');
    });
  });

  describe('Non-Recurring Patterns', () => {
    it('identifies "tomorrow" as non-recurring', () => {
      const result = parseNaturalLanguage('tomorrow');
      expect(result.is_recurring).toBe(false);
      expect(result.rrule).toBeNull();
    });

    it('identifies "next Monday" as non-recurring', () => {
      const result = parseNaturalLanguage('next Monday');
      expect(result.is_recurring).toBe(false);
      expect(result.rrule).toBeNull();
    });

    it('identifies "in 2 days" as non-recurring', () => {
      const result = parseNaturalLanguage('in 2 days');
      expect(result.is_recurring).toBe(false);
      expect(result.rrule).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string', () => {
      const result = parseNaturalLanguage('');
      expect(result.is_recurring).toBe(false);
    });

    it('handles unparseable text', () => {
      const result = parseNaturalLanguage('random text here');
      expect(result.is_recurring).toBe(false);
    });

    it('is case insensitive', () => {
      const result = parseNaturalLanguage('EVERY DAY');
      expect(result.is_recurring).toBe(true);
      expect(result.rrule).toContain('FREQ=DAILY');
    });
  });
});

describe('RRULE Description', () => {
  it('describes daily rule', () => {
    const desc = describeRrule('RRULE:FREQ=DAILY');
    expect(desc).toContain('Every day');
  });

  it('describes daily rule with time', () => {
    const desc = describeRrule('RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0');
    expect(desc).toContain('Every day');
    expect(desc).toContain('9');
    expect(desc).toContain('AM');
  });

  it('describes weekly rule', () => {
    const desc = describeRrule('RRULE:FREQ=WEEKLY');
    expect(desc).toContain('Every week');
  });

  it('describes weekly rule with specific days', () => {
    const desc = describeRrule('RRULE:FREQ=WEEKLY;BYDAY=MO,FR');
    expect(desc).toContain('Monday');
    expect(desc).toContain('Friday');
  });

  it('describes weekdays', () => {
    const desc = describeRrule('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(desc).toContain('weekday');
  });

  it('describes weekend', () => {
    const desc = describeRrule('RRULE:FREQ=WEEKLY;BYDAY=SA,SU');
    expect(desc).toContain('weekend');
  });

  it('describes monthly rule', () => {
    const desc = describeRrule('RRULE:FREQ=MONTHLY');
    expect(desc).toContain('Every month');
  });

  it('describes monthly rule with day', () => {
    const desc = describeRrule('RRULE:FREQ=MONTHLY;BYMONTHDAY=1');
    expect(desc).toContain('1st');
    expect(desc).toContain('month');
  });

  it('describes interval', () => {
    const desc = describeRrule('RRULE:FREQ=DAILY;INTERVAL=2');
    expect(desc).toContain('Every 2 days');
  });
});
