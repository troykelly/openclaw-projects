/**
 * Gateway Integration Tests: CLI Registration
 * Tests CLI command registration.
 *
 * The gateway stores CLI registrars in registry.cliRegistrars[] as
 * PluginCliRegistration objects with { pluginId, register, commands, source }.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig, findPlugin } from './setup.js';

describe('Gateway CLI Registration', () => {
  it('should register CLI commands', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    // The plugin record tracks CLI command names in plugin.cliCommands[]
    expect(plugin?.cliCommands).toBeDefined();
  });

  it('should have CLI registrar function', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    // Get CLI registrations for our plugin
    const pluginCli = registry.cliRegistrars.filter(
      (c) => c.pluginId === 'openclaw-projects',
    );
    expect(pluginCli.length).toBeGreaterThan(0);
    expect(typeof pluginCli[0].register).toBe('function');
  });
});
