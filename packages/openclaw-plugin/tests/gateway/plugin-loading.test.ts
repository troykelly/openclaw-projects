/**
 * Gateway Integration Tests: Plugin Loading
 * Tests plugin discovery, loading, and status reporting via SDK.
 */

import { describe, it, expect } from 'vitest';
// Import from actual openclaw bundled file via vitest alias
// The function is exported but minified (as 't'), so we import the whole module
import * as openclawLoader from 'openclaw/dist/plugins/loader.js';
import { createTestLogger, createTestConfig } from './setup.js';

// Extract the loader function (exported as minified name 't')
const loadOpenClawPlugins = (openclawLoader as any).loadOpenClawPlugins || (openclawLoader as any).t;

describe('Gateway Plugin Loading', () => {
  it('should load plugin via loadOpenClawPlugins() with load.paths', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    expect(registry).toBeDefined();
    expect(registry.plugins).toBeDefined();
    expect(registry.plugins.size).toBeGreaterThan(0);

    const plugin = registry.plugins.get('openclaw-projects');
    expect(plugin).toBeDefined();
  });

  it('should have status "loaded" with correct origin and kind', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.diagnostics).toBeDefined();
    expect(plugin?.diagnostics?.length ?? 0).toBe(0);
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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
    expect(plugin?.diagnostics).toBeDefined();
    expect(plugin?.diagnostics && plugin.diagnostics.length > 0).toBe(true);
  });

  it('should be disabled when plugins.enabled: false', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ enabled: false });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    // Plugin should not be loaded or should be disabled
    expect(plugin === undefined || plugin.enabled === false).toBe(true);
  });

  it('should be disabled when slots.memory is set to a different plugin', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      slots: { memory: 'some-other-memory-plugin' },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    // Plugin with kind "memory" should be disabled if not in the memory slot
    expect(plugin === undefined || plugin.enabled === false).toBe(true);
  });
});
