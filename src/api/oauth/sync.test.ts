/**
 * Unit tests for OAuth sync job management.
 * Part of Issue #1055.
 */

import { describe, it, expect } from 'vitest';
import { parseIntervalToMs, getContactSyncInterval, SYNC_JOB_KIND, LOCAL_SYNC_FEATURES } from './sync.ts';

describe('parseIntervalToMs', () => {
  it('parses hours', () => {
    expect(parseIntervalToMs('6 hours')).toBe(6 * 60 * 60 * 1000);
    expect(parseIntervalToMs('1 hour')).toBe(60 * 60 * 1000);
    expect(parseIntervalToMs('24 hours')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses minutes', () => {
    expect(parseIntervalToMs('15 minutes')).toBe(15 * 60 * 1000);
    expect(parseIntervalToMs('1 minute')).toBe(60 * 1000);
    expect(parseIntervalToMs('30 minutes')).toBe(30 * 60 * 1000);
  });

  it('parses seconds', () => {
    expect(parseIntervalToMs('30 seconds')).toBe(30 * 1000);
    expect(parseIntervalToMs('1 second')).toBe(1000);
  });

  it('handles whitespace', () => {
    expect(parseIntervalToMs('  6 hours  ')).toBe(6 * 60 * 60 * 1000);
  });

  it('returns default for unparseable input', () => {
    const sixHoursMs = 6 * 60 * 60 * 1000;
    expect(parseIntervalToMs('')).toBe(sixHoursMs);
    expect(parseIntervalToMs('invalid')).toBe(sixHoursMs);
    expect(parseIntervalToMs('6')).toBe(sixHoursMs);
    expect(parseIntervalToMs('hours 6')).toBe(sixHoursMs);
  });
});

describe('getContactSyncInterval', () => {
  const originalEnv = process.env.OAUTH_SYNC_CONTACTS_INTERVAL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OAUTH_SYNC_CONTACTS_INTERVAL = originalEnv;
    } else {
      delete process.env.OAUTH_SYNC_CONTACTS_INTERVAL;
    }
  });

  it('returns env var when set', () => {
    process.env.OAUTH_SYNC_CONTACTS_INTERVAL = '2 hours';
    expect(getContactSyncInterval()).toBe('2 hours');
  });

  it('returns default when env var not set', () => {
    delete process.env.OAUTH_SYNC_CONTACTS_INTERVAL;
    expect(getContactSyncInterval()).toBe('6 hours');
  });
});

describe('constants', () => {
  it('SYNC_JOB_KIND is correct', () => {
    expect(SYNC_JOB_KIND).toBe('oauth.sync.contacts');
  });

  it('LOCAL_SYNC_FEATURES contains only contacts', () => {
    expect(LOCAL_SYNC_FEATURES).toEqual(['contacts']);
  });
});
