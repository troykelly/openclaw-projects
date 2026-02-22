import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IdentityCache } from './identity-cache.ts';

describe('IdentityCache (#1580)', () => {
  let cache: IdentityCache<string>;

  beforeEach(() => {
    cache = new IdentityCache<string>(100); // 100ms TTL for fast tests
  });

  it('stores and retrieves values', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('expires entries after TTL', async () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 150));
    expect(cache.get('key')).toBeUndefined();
  });

  it('invalidates specific keys', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
  });

  it('clears all entries', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('prunes expired entries', async () => {
    cache.set('fresh', 'yes');
    cache.set('stale', 'yes');

    // Wait for stale to expire
    await new Promise((r) => setTimeout(r, 150));

    // Add a fresh entry after stale has expired
    cache.set('new', 'yes');

    cache.prune();
    // 'fresh' and 'stale' expired, only 'new' remains
    expect(cache.get('stale')).toBeUndefined();
    expect(cache.get('new')).toBe('yes');
  });
});
