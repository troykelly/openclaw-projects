/**
 * Natural language parser for recurrence patterns.
 * Part of Issue #217.
 */

import type { NaturalLanguageParseResult } from './types.ts';

// Weekday mappings
const WEEKDAY_MAP: Record<string, string> = {
  sunday: 'SU',
  sun: 'SU',
  monday: 'MO',
  mon: 'MO',
  tuesday: 'TU',
  tue: 'TU',
  tues: 'TU',
  wednesday: 'WE',
  wed: 'WE',
  thursday: 'TH',
  thu: 'TH',
  thur: 'TH',
  thurs: 'TH',
  friday: 'FR',
  fri: 'FR',
  saturday: 'SA',
  sat: 'SA',
};

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR'];
const WEEKEND = ['SA', 'SU'];

interface ParsedComponents {
  freq?: string;
  interval?: number;
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  byHour?: number;
  byMinute?: number;
  until?: Date;
  count?: number;
}

/**
 * Parse time from natural language (e.g., "9am", "2:30pm", "14:00")
 */
function parseTime(text: string): { hour: number; minute: number } | null {
  // Match patterns like "9am", "9:30am", "14:00", "2pm", "10:30 am"
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hour !== 12) {
    hour += 12;
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

/**
 * Parse ordinal numbers (1st, 2nd, 3rd, etc.)
 */
function parseOrdinal(text: string): number | null {
  const match = text.match(/(\d+)(?:st|nd|rd|th)?/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 31) return num;
  }
  return null;
}

/**
 * Parse natural language recurrence into RRULE components
 */
function parseNaturalToComponents(input: string): ParsedComponents | null {
  const text = input.toLowerCase().trim();
  const components: ParsedComponents = {};

  // Check for weekday patterns FIRST (before "every week")
  if (text.includes('weekday') || text.includes('weekdays')) {
    components.freq = 'WEEKLY';
    components.byDay = WEEKDAYS;
  }

  // Check for weekend patterns FIRST (before "every week")
  else if (text.includes('weekend') || text.includes('weekends')) {
    components.freq = 'WEEKLY';
    components.byDay = WEEKEND;
  }

  // Check for "every day" / "daily"
  else if (text.includes('every day') || text.includes('daily')) {
    components.freq = 'DAILY';
  }

  // Check for "every week" / "weekly"
  else if (text.includes('every week') || text.includes('weekly')) {
    components.freq = 'WEEKLY';
  }

  // Check for "every month" / "monthly"
  else if (text.includes('every month') || text.includes('monthly')) {
    components.freq = 'MONTHLY';
  }

  // Check for "every year" / "yearly" / "annually"
  else if (text.includes('every year') || text.includes('yearly') || text.includes('annually')) {
    components.freq = 'YEARLY';
  }

  // Check for specific days of the week
  else if (text.match(/every\s+(?:mon|tue|wed|thu|fri|sat|sun)/i)) {
    components.freq = 'WEEKLY';
    components.byDay = [];

    // Extract all mentioned days
    for (const [name, code] of Object.entries(WEEKDAY_MAP)) {
      if (text.includes(name)) {
        if (!components.byDay.includes(code)) {
          components.byDay.push(code);
        }
      }
    }
  }

  // Check for "every N days/weeks/months"
  const intervalMatch = text.match(/every\s+(\d+)\s*(day|week|month|year)s?/i);
  if (intervalMatch) {
    components.interval = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase();
    if (unit.startsWith('day')) components.freq = 'DAILY';
    else if (unit.startsWith('week')) components.freq = 'WEEKLY';
    else if (unit.startsWith('month')) components.freq = 'MONTHLY';
    else if (unit.startsWith('year')) components.freq = 'YEARLY';
  }

  // Check for "first/last/Nth of the month"
  const monthDayMatch = text.match(/(first|last|1st|2nd|3rd|\d+(?:st|nd|rd|th)?)\s+(?:of\s+)?(?:the\s+)?(?:every\s+)?month/i);
  if (monthDayMatch) {
    components.freq = 'MONTHLY';
    const daySpec = monthDayMatch[1].toLowerCase();
    if (daySpec === 'first' || daySpec === '1st') {
      components.byMonthDay = [1];
    } else if (daySpec === 'last') {
      components.byMonthDay = [-1];
    } else {
      const day = parseOrdinal(daySpec);
      if (day) {
        components.byMonthDay = [day];
      }
    }
  }

  // Parse time if present
  const timePatterns = [/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i, /(\d{1,2}:\d{2})\s*(?:am|pm)?/i, /(\d{1,2}\s*(?:am|pm))/i];

  for (const pattern of timePatterns) {
    const timeMatch = text.match(pattern);
    if (timeMatch) {
      const parsed = parseTime(timeMatch[1]);
      if (parsed) {
        components.byHour = parsed.hour;
        components.byMinute = parsed.minute;
        break;
      }
    }
  }

  // Check for "morning" / "evening" defaults
  if (!components.byHour) {
    if (text.includes('morning')) {
      components.byHour = 9;
      components.byMinute = 0;
    } else if (text.includes('evening')) {
      components.byHour = 18;
      components.byMinute = 0;
    } else if (text.includes('night')) {
      components.byHour = 21;
      components.byMinute = 0;
    } else if (text.includes('noon') || text.includes('midday')) {
      components.byHour = 12;
      components.byMinute = 0;
    }
  }

  // If we have any frequency, return the components
  if (components.freq) {
    return components;
  }

  return null;
}

/**
 * Convert parsed components to RRULE string
 */
function componentsToRrule(components: ParsedComponents): string {
  const parts: string[] = [];

  if (components.freq) {
    parts.push(`FREQ=${components.freq}`);
  }

  if (components.interval && components.interval > 1) {
    parts.push(`INTERVAL=${components.interval}`);
  }

  if (components.byDay && components.byDay.length > 0) {
    parts.push(`BYDAY=${components.byDay.join(',')}`);
  }

  if (components.byMonthDay && components.byMonthDay.length > 0) {
    parts.push(`BYMONTHDAY=${components.byMonthDay.join(',')}`);
  }

  if (components.byMonth && components.byMonth.length > 0) {
    parts.push(`BYMONTH=${components.byMonth.join(',')}`);
  }

  if (components.byHour !== undefined) {
    parts.push(`BYHOUR=${components.byHour}`);
  }

  if (components.byMinute !== undefined) {
    parts.push(`BYMINUTE=${components.byMinute}`);
  }

  if (components.until) {
    parts.push(`UNTIL=${components.until.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
  }

  if (components.count) {
    parts.push(`COUNT=${components.count}`);
  }

  return `RRULE:${parts.join(';')}`;
}

/**
 * Parse natural language into recurrence information
 */
export function parseNaturalLanguage(input: string): NaturalLanguageParseResult {
  const text = input.toLowerCase().trim();

  // Check for non-recurring patterns first
  const nonRecurringPatterns = [
    /^tomorrow/i,
    /^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /^on\s+\d{1,2}\/\d{1,2}/i,
    /^(in\s+)?\d+\s+(minute|hour|day)s?\s*(from\s+now)?$/i,
  ];

  for (const pattern of nonRecurringPatterns) {
    if (pattern.test(text)) {
      return {
        rrule: null,
        single_date: null, // Would need date parsing for actual implementation
        is_recurring: false,
        description: `Single occurrence: ${input}`,
      };
    }
  }

  // Try to parse as recurring
  const components = parseNaturalToComponents(text);

  if (components) {
    const rrule = componentsToRrule(components);
    return {
      rrule,
      single_date: null,
      is_recurring: true,
      description: describeRrule(rrule),
    };
  }

  // Unable to parse
  return {
    rrule: null,
    single_date: null,
    is_recurring: false,
    description: 'Unable to parse recurrence pattern',
  };
}

/**
 * Generate a human-readable description of an RRULE
 */
export function describeRrule(rrule: string): string {
  const rule = rrule.replace(/^RRULE:/, '');
  const parts = new Map<string, string>();

  for (const part of rule.split(';')) {
    const [key, value] = part.split('=');
    if (key && value) {
      parts.set(key, value);
    }
  }

  const descriptions: string[] = [];
  const freq = parts.get('FREQ');
  const interval = parseInt(parts.get('INTERVAL') || '1', 10);
  const byDay = parts.get('BYDAY')?.split(',') || [];
  const byMonthDay = parts.get('BYMONTHDAY')?.split(',').map(Number) || [];
  const byHour = parts.get('BYHOUR');
  const byMinute = parts.get('BYMINUTE');

  // Frequency description
  if (freq === 'DAILY') {
    descriptions.push(interval === 1 ? 'Every day' : `Every ${interval} days`);
  } else if (freq === 'WEEKLY') {
    if (byDay.length === 5 && byDay.every((d) => WEEKDAYS.includes(d))) {
      descriptions.push('Every weekday');
    } else if (byDay.length === 2 && byDay.every((d) => WEEKEND.includes(d))) {
      descriptions.push('Every weekend');
    } else if (byDay.length > 0) {
      const dayNames = byDay.map(dayCodeToName).join(', ');
      descriptions.push(`Every ${dayNames}`);
    } else {
      descriptions.push(interval === 1 ? 'Every week' : `Every ${interval} weeks`);
    }
  } else if (freq === 'MONTHLY') {
    if (byMonthDay.length > 0) {
      const dayStr = byMonthDay.map((d) => (d === -1 ? 'last day' : `${d}${ordinalSuffix(d)}`)).join(', ');
      descriptions.push(`On the ${dayStr} of every month`);
    } else {
      descriptions.push(interval === 1 ? 'Every month' : `Every ${interval} months`);
    }
  } else if (freq === 'YEARLY') {
    descriptions.push(interval === 1 ? 'Every year' : `Every ${interval} years`);
  }

  // Time description
  if (byHour !== undefined) {
    const hour = parseInt(byHour, 10);
    const minute = parseInt(byMinute || '0', 10);
    const timeStr = formatTime(hour, minute);
    descriptions.push(`at ${timeStr}`);
  }

  return descriptions.join(' ');
}

function dayCodeToName(code: string): string {
  const names: Record<string, string> = {
    SU: 'Sunday',
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
  };
  return names[code] || code;
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return minute === 0 ? `${h} ${ampm}` : `${h}:${m} ${ampm}`;
}
