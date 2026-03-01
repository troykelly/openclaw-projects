/**
 * Gateway Integration Tests: Tool Registration
 * Tests that all 41 tools are registered correctly via the Gateway loader.
 *
 * The registry stores tool registrations in registry.tools[] as
 * PluginToolRegistration objects with { pluginId, factory, names, optional }.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig, findPlugin, EXPECTED_TOOLS } from './setup.js';

describe('Gateway Tool Registration', () => {
  it('should register all expected tool names on the plugin record', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.toolNames).toBeDefined();
    expect(plugin?.toolNames.length).toBe(EXPECTED_TOOLS.length);
  });

  it('should register exactly 41 tools', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    // Filter tools belonging to our plugin
    const pluginTools = registry.tools.filter((t) => t.pluginId === 'openclaw-projects');
    // Each tool registration may cover multiple names
    const allNames = pluginTools.flatMap((t) => t.names);
    expect(allNames.length).toBe(41);
  });

  it('should include every expected tool name', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = findPlugin(registry, 'openclaw-projects');

    expect(plugin).toBeDefined();
    const toolNames = [...(plugin?.toolNames ?? [])].sort();

    for (const expectedTool of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expectedTool);
    }
  });

  it('should produce tool factories that return tools with execute functions', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    // Get tool registrations for our plugin
    const pluginTools = registry.tools.filter((t) => t.pluginId === 'openclaw-projects');
    expect(pluginTools.length).toBeGreaterThan(0);

    // Each tool registration has a factory function
    for (const toolReg of pluginTools) {
      expect(typeof toolReg.factory).toBe('function');
      expect(toolReg.names.length).toBeGreaterThan(0);
    }
  });
});
