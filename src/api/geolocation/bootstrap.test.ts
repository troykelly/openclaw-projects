import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapGeoProviders } from './bootstrap.ts';
import { getProvider, getRegisteredTypes, clearProviders } from './registry.ts';

describe('bootstrapGeoProviders', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('registers the home_assistant provider', () => {
    bootstrapGeoProviders();
    expect(getProvider('home_assistant')).toBeDefined();
    expect(getProvider('home_assistant')!.type).toBe('home_assistant');
  });

  it('registers the mqtt provider', () => {
    bootstrapGeoProviders();
    expect(getProvider('mqtt')).toBeDefined();
    expect(getProvider('mqtt')!.type).toBe('mqtt');
  });

  it('registers the webhook provider', () => {
    bootstrapGeoProviders();
    expect(getProvider('webhook')).toBeDefined();
    expect(getProvider('webhook')!.type).toBe('webhook');
  });

  it('registers all 3 provider types', () => {
    bootstrapGeoProviders();
    const types = getRegisteredTypes();
    expect(types).toHaveLength(3);
    expect(types).toContain('home_assistant');
    expect(types).toContain('mqtt');
    expect(types).toContain('webhook');
  });

  it('is idempotent — calling twice does not throw', () => {
    bootstrapGeoProviders();
    expect(() => bootstrapGeoProviders()).not.toThrow();
    expect(getRegisteredTypes()).toHaveLength(3);
  });

  it('clearProviders empties the registry after bootstrap', () => {
    bootstrapGeoProviders();
    clearProviders();
    expect(getRegisteredTypes()).toEqual([]);
  });
});
