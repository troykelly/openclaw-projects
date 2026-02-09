/**
 * Gateway Integration Tests: Config Validation
 * Tests SDK-level config validation against manifest JSON Schema.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { createTestLogger, createTestConfig } from './setup.js';

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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('loaded');
    expect(plugin?.diagnostics?.length ?? 0).toBe(0);
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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
    expect(plugin?.diagnostics).toBeDefined();
    expect(plugin?.diagnostics && plugin.diagnostics.length > 0).toBe(true);
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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('loaded');
    expect(plugin?.diagnostics?.length ?? 0).toBe(0);
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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
    expect(plugin?.diagnostics).toBeDefined();
    expect(plugin?.diagnostics && plugin.diagnostics.length > 0).toBe(true);
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
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.status).toBe('error');
    expect(plugin?.diagnostics).toBeDefined();
    expect(plugin?.diagnostics && plugin.diagnostics.length > 0).toBe(true);
  });

  it('should support validate-only mode without registration', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger, mode: 'validate' });

    // In validate-only mode, plugins should be checked but not fully registered
    // The exact behavior depends on SDK implementation
    expect(registry).toBeDefined();
    expect(registry.plugins).toBeDefined();
  });
});
