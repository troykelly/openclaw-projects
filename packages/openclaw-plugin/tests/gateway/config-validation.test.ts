/**
 * Gateway Integration Tests: Config Validation
 * Tests that the Gateway loader validates plugin config against the JSON Schema
 * defined in openclaw.plugin.json.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig, findPlugin } from './setup.js';

describe('Gateway Config Validation', () => {
  it('should pass validation with minimal valid config (apiUrl only)', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      entries: {
        'openclaw-projects': {
          enabled: true,
          config: {
            apiUrl: 'http://localhost:3000',
          },
        },
      },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('loaded');
  });

  it('should reject config missing required apiUrl field', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      entries: {
        'openclaw-projects': {
          enabled: true,
          config: {
            // Missing apiUrl
            apiKey: 'test-key',
          },
        },
      },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
    const errors = registry.diagnostics.filter(
      (d) => d.level === 'error' && d.pluginId === 'openclaw-projects',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept optional config fields when provided', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      entries: {
        'openclaw-projects': {
          enabled: true,
          config: {
            apiUrl: 'http://localhost:3000',
            apiKey: 'test-key',
            autoRecall: false,
            autoCapture: false,
            timeout: 10000,
            maxRetries: 2,
            debug: true,
          },
        },
      },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('loaded');
  });

  it('should reject config with invalid types', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      entries: {
        'openclaw-projects': {
          enabled: true,
          config: {
            apiUrl: 'http://localhost:3000',
            autoRecall: 'not-a-boolean', // Should be boolean
          },
        },
      },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
  });

  it('should reject config with values outside allowed ranges', () => {
    const logger = createTestLogger();
    const config = createTestConfig({
      entries: {
        'openclaw-projects': {
          enabled: true,
          config: {
            apiUrl: 'http://localhost:3000',
            maxRetries: 100, // Maximum is 5
          },
        },
      },
    });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
  });

  it('should support validate-only mode without full registration', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger, mode: 'validate' });

    expect(registry).toBeDefined();
    expect(registry.plugins).toBeDefined();

    const plugin = findPlugin(registry, 'openclaw-projects');
    expect(plugin).toBeDefined();
    // In validate mode, plugin is discovered and config-checked but register() is NOT called
    // so no tools/hooks/services are registered
    expect(plugin?.toolNames.length).toBe(0);
  });
});
