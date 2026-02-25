/**
 * Unit tests for operation key resolver.
 * Part of API Onboarding feature (#1778).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveOperationKey,
  resolveTagGroupKey,
  deduplicateKeys,
} from '../../../src/api/api-sources/operation-key.ts';

describe('resolveOperationKey', () => {
  it('uses operationId when present', () => {
    const key = resolveOperationKey('GET', '/api/users', 'getDepartures');
    expect(key).toBe('getDepartures');
  });

  it('falls back to METHOD:path when no operationId', () => {
    const key = resolveOperationKey('GET', '/v1/stops/departures');
    expect(key).toBe('GET:/v1/stops/departures');
  });

  it('strips path parameters from fallback key', () => {
    const key = resolveOperationKey('GET', '/v1/stops/{stop_id}/departures');
    expect(key).toBe('GET:/v1/stops/{}/departures');
  });

  it('handles multiple path parameters', () => {
    const key = resolveOperationKey('GET', '/v1/{org}/{repo}/issues');
    expect(key).toBe('GET:/v1/{}/{}/issues');
  });

  it('normalizes method to uppercase', () => {
    const key = resolveOperationKey('get', '/api/users');
    expect(key).toBe('GET:/api/users');
  });

  it('handles POST method', () => {
    const key = resolveOperationKey('POST', '/api/users');
    expect(key).toBe('POST:/api/users');
  });

  it('handles DELETE method', () => {
    const key = resolveOperationKey('DELETE', '/api/users/{id}');
    expect(key).toBe('DELETE:/api/users/{}');
  });

  it('handles PATCH method', () => {
    const key = resolveOperationKey('PATCH', '/api/users/{id}');
    expect(key).toBe('PATCH:/api/users/{}');
  });

  it('handles path without leading slash', () => {
    const key = resolveOperationKey('GET', 'api/users');
    expect(key).toBe('GET:api/users');
  });

  it('handles trailing slash in path', () => {
    const key = resolveOperationKey('GET', '/api/users/');
    expect(key).toBe('GET:/api/users/');
  });
});

describe('resolveTagGroupKey', () => {
  it('returns tag: prefix for a tag name', () => {
    expect(resolveTagGroupKey('realtime')).toBe('tag:realtime');
  });

  it('handles tags with spaces', () => {
    expect(resolveTagGroupKey('User Management')).toBe('tag:User Management');
  });

  it('handles empty tag name', () => {
    expect(resolveTagGroupKey('')).toBe('tag:');
  });
});

describe('deduplicateKeys', () => {
  it('returns unique keys unchanged', () => {
    const keys = ['getDepartures', 'getStops', 'overview'];
    expect(deduplicateKeys(keys)).toEqual(keys);
  });

  it('appends _2 on first collision', () => {
    const keys = ['getDepartures', 'getDepartures'];
    expect(deduplicateKeys(keys)).toEqual(['getDepartures', 'getDepartures_2']);
  });

  it('appends _2, _3 on multiple collisions', () => {
    const keys = ['op', 'op', 'op'];
    expect(deduplicateKeys(keys)).toEqual(['op', 'op_2', 'op_3']);
  });

  it('does not modify non-colliding keys around collisions', () => {
    const keys = ['a', 'b', 'a', 'c', 'b'];
    expect(deduplicateKeys(keys)).toEqual(['a', 'b', 'a_2', 'c', 'b_2']);
  });

  it('handles empty array', () => {
    expect(deduplicateKeys([])).toEqual([]);
  });

  it('handles single element', () => {
    expect(deduplicateKeys(['solo'])).toEqual(['solo']);
  });
});
