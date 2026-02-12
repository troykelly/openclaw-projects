/**
 * Gateway Integration Tests: Tool Resolution
 * Tests that tool factories produce valid tools when invoked.
 *
 * Tool factories are called with a PluginToolContext and return AnyAgentTool
 * objects with { name, description, execute }.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Tool Resolution', () => {
  it('should produce tools from factories with name and execute', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    // Get tool registrations for our plugin
    const pluginTools = registry.tools.filter((t) => t.pluginId === 'openclaw-projects');
    expect(pluginTools.length).toBeGreaterThan(0);

    // Call each factory with a minimal context to see if tools resolve
    const context = {
      config,
      workspaceDir: undefined,
    };

    for (const toolReg of pluginTools) {
      const result = toolReg.factory(context);
      if (result === null || result === undefined) {
        continue;
      }
      const tools = Array.isArray(result) ? result : [result];
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.execute).toBe('function');
      }
    }
  });

  it('should resolve memory_recall tool with correct shape', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    // Find the memory_recall tool registration
    const memoryRecallReg = registry.tools.find(
      (t) => t.pluginId === 'openclaw-projects' && t.names.includes('memory_recall'),
    );
    expect(memoryRecallReg).toBeDefined();

    const context = { config, workspaceDir: undefined };
    const result = memoryRecallReg!.factory(context);

    const tools = Array.isArray(result) ? result : result ? [result] : [];
    const memoryRecall = tools.find((t) => t.name === 'memory_recall');

    expect(memoryRecall).toBeDefined();
    expect(memoryRecall?.name).toBe('memory_recall');
    expect(typeof memoryRecall?.execute).toBe('function');
  });
});
