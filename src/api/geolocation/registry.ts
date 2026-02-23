/**
 * Geolocation provider plugin registry.
 * Part of Issue #1244.
 */

import type { GeoProviderPlugin, GeoProviderType } from './types.ts';

const providers = new Map<GeoProviderType, GeoProviderPlugin>();

/** Register a provider plugin. Throws if a plugin for this type is already registered. */
export function registerProvider(plugin: GeoProviderPlugin): void {
  if (providers.has(plugin.type)) {
    throw new Error(`Provider already registered for type: ${plugin.type}`);
  }
  providers.set(plugin.type, plugin);
}

/** Check whether a provider for the given type is already registered. */
export function isRegistered(type: GeoProviderType): boolean {
  return providers.has(type);
}

/** Get a registered provider plugin by type, or undefined if not registered. */
export function getProvider(type: GeoProviderType): GeoProviderPlugin | undefined {
  return providers.get(type);
}

/** Get all registered provider types. */
export function getRegisteredTypes(): GeoProviderType[] {
  return [...providers.keys()];
}

/** Clear all registered providers (for testing). */
export function clearProviders(): void {
  providers.clear();
}
