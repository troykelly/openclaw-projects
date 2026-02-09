/**
 * Gateway Integration Tests: Tool Resolution
 * Tests resolvePluginTools() to verify tool resolution.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { resolvePluginTools } from 'openclaw/dist/plugins/tools.js';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Tool Resolution', () => {
  it('should resolve all tools via resolvePluginTools()', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const tools = resolvePluginTools(registry);

    expect(tools).toBeDefined();
    expect(tools.size).toBeGreaterThanOrEqual(27);

    // Verify a sample of tools exist
    expect(tools.has('memory_recall')).toBe(true);
    expect(tools.has('memory_store')).toBe(true);
    expect(tools.has('project_list')).toBe(true);
    expect(tools.has('todo_create')).toBe(true);
    expect(tools.has('contact_search')).toBe(true);
  });

  it('should return tool definitions with execute functions', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const tools = resolvePluginTools(registry);

    const memoryRecall = tools.get('memory_recall');
    expect(memoryRecall).toBeDefined();
    expect(memoryRecall?.name).toBe('memory_recall');
    expect(memoryRecall?.execute).toBeDefined();
    expect(typeof memoryRecall?.execute).toBe('function');
  });
});
