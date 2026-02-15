import { describe, it, expect, beforeEach } from 'vitest';
import { registerProvider, getProvider, getRegisteredTypes, clearProviders } from './registry.ts';
import type { GeoProviderPlugin, ProviderConfig, Connection } from './types.ts';

/** Create a minimal stub plugin for testing. */
function createStubPlugin(type: GeoProviderPlugin['type']): GeoProviderPlugin {
  return {
    type,
    validateConfig: (config: unknown) => ({ ok: true, value: config as ProviderConfig }),
    verify: async () => ({ success: true, message: 'ok', entities: [] }),
    discoverEntities: async () => [],
    connect: async (): Promise<Connection> => ({
      disconnect: async () => {},
      addEntities: () => {},
      removeEntities: () => {},
      isConnected: () => true,
    }),
  };
}

describe('registry', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('registers and retrieves a provider plugin', () => {
    const plugin = createStubPlugin('home_assistant');
    registerProvider(plugin);
    expect(getProvider('home_assistant')).toBe(plugin);
  });

  it('returns undefined for an unregistered type', () => {
    expect(getProvider('mqtt')).toBeUndefined();
  });

  it('lists all registered types', () => {
    registerProvider(createStubPlugin('home_assistant'));
    registerProvider(createStubPlugin('mqtt'));
    const types = getRegisteredTypes();
    expect(types).toContain('home_assistant');
    expect(types).toContain('mqtt');
    expect(types).toHaveLength(2);
  });

  it('throws when registering a duplicate type', () => {
    registerProvider(createStubPlugin('webhook'));
    expect(() => registerProvider(createStubPlugin('webhook'))).toThrow(
      'Provider already registered for type: webhook',
    );
  });

  it('returns empty list when no providers registered', () => {
    expect(getRegisteredTypes()).toEqual([]);
  });

  it('clearProviders removes all registrations', () => {
    registerProvider(createStubPlugin('home_assistant'));
    registerProvider(createStubPlugin('mqtt'));
    clearProviders();
    expect(getRegisteredTypes()).toEqual([]);
    expect(getProvider('home_assistant')).toBeUndefined();
  });
});
