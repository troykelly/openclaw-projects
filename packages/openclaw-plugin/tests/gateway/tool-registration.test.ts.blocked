/**
 * Gateway Integration Tests: Tool Registration
 * Tests that all 27 tools are registered correctly via SDK.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { resolvePluginTools } from 'openclaw/dist/plugins/tools.js';
import { createTestLogger, createTestConfig, EXPECTED_TOOLS } from './setup.js';

describe('Gateway Tool Registration', () => {
  it('should register exactly 27 tools', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.tools).toBeDefined();
    expect(plugin?.tools?.length).toBe(27);
  });

  it('should register all expected tool names', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.tools).toBeDefined();

    const toolNames = plugin?.tools ?? [];
    const sortedToolNames = [...toolNames].sort();

    expect(sortedToolNames).toEqual(EXPECTED_TOOLS);
  });

  it('should produce tool factories with name, description, and execute', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const tools = resolvePluginTools(registry);

    expect(tools).toBeDefined();
    expect(tools.size).toBeGreaterThan(0);

    // Check memory_recall tool as example
    const memoryRecallTool = tools.get('memory_recall');
    expect(memoryRecallTool).toBeDefined();
    expect(memoryRecallTool?.name).toBe('memory_recall');
    expect(memoryRecallTool?.description).toBeDefined();
    expect(typeof memoryRecallTool?.description).toBe('string');
    expect(memoryRecallTool?.execute).toBeDefined();
    expect(typeof memoryRecallTool?.execute).toBe('function');
  });

  it('should list all tool names in plugin record', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.tools).toBeDefined();

    const toolNames = plugin?.tools ?? [];

    // Verify each expected tool is listed
    for (const expectedTool of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expectedTool);
    }
  });
});
