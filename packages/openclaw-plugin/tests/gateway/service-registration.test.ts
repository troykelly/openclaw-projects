/**
 * Gateway Integration Tests: Service Registration
 * Tests notification service registration.
 *
 * The gateway stores services in registry.services[] as
 * PluginServiceRegistration objects with { pluginId, service, source }.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig, findPlugin } from './setup.js';

describe('Gateway Service Registration', () => {
  it('should register at least one service', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    // The plugin record tracks service names in plugin.services[]
    expect(plugin?.services).toBeDefined();
    expect(plugin?.services.length).toBeGreaterThan(0);
  });

  it('should register service with start and stop methods', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    // Get service registrations for our plugin
    const pluginServices = registry.services.filter(
      (s) => s.pluginId === 'openclaw-projects',
    );
    expect(pluginServices.length).toBeGreaterThan(0);

    const service = pluginServices[0].service;
    expect(service).toBeDefined();
    expect(service.id).toBeDefined();
    expect(typeof service.start).toBe('function');
    expect(typeof service.stop).toBe('function');
  });
});
