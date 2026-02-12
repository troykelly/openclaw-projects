/**
 * Gateway Integration Tests: Plugin Loading
 * Tests plugin discovery, loading, and status reporting via the real Gateway loader.
 *
 * Uses loadOpenClawPlugins() from the gateway source to validate our plugin
 * integrates correctly with the Gateway's plugin discovery and loading pipeline.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig, findPlugin } from './setup.js';

describe('Gateway Plugin Loading', () => {
  it('should load plugin via loadOpenClawPlugins() with load.paths', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    expect(registry).toBeDefined();
    expect(registry.plugins).toBeDefined();
    expect(registry.plugins.length).toBeGreaterThan(0);

    const plugin = findPlugin(registry, 'openclaw-projects');
    expect(plugin).toBeDefined();
  });

  it('should have status "loaded" with correct origin and kind', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('loaded');
    expect(plugin?.enabled).toBe(true);
    expect(plugin?.origin).toBe('config');
    expect(plugin?.kind).toBe('memory');
  });

  it('should have no error diagnostics with valid config', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('loaded');
    // No error-level diagnostics for this plugin
    const pluginErrors = registry.diagnostics.filter(
      (d) => d.level === 'error' && d.pluginId === 'openclaw-projects',
    );
    expect(pluginErrors.length).toBe(0);
  });

  it('should have error status for missing required apiUrl', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      entries: {
        'openclaw-projects': {
          enabled: true,
          config: {
            // Missing apiUrl - required field
          },
        },
      },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
  });

  it('should be disabled when plugins.enabled is false', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ enabled: false });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    // Plugin should not be loaded or should be disabled
    expect(plugin === undefined || plugin.enabled === false).toBe(true);
  });

  it('should be disabled when slots.memory is set to a different plugin', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      slots: { memory: 'some-other-memory-plugin' },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    // Plugin with kind "memory" should be disabled if not in the memory slot
    expect(plugin === undefined || plugin.enabled === false).toBe(true);
  });
});
