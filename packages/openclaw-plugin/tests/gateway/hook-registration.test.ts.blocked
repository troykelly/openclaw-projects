/**
 * Gateway Integration Tests: Hook Registration
 * Tests lifecycle hook registration based on config.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Hook Registration', () => {
  it('should register before_agent_start hook when autoRecall: true', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.hooks).toBeDefined();

    const hooks = plugin?.hooks ?? {};
    expect(hooks.before_agent_start).toBeDefined();
    expect(typeof hooks.before_agent_start).toBe('function');
  });

  it('should register agent_end hook when autoCapture: true', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoCapture: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.hooks).toBeDefined();

    const hooks = plugin?.hooks ?? {};
    expect(hooks.agent_end).toBeDefined();
    expect(typeof hooks.agent_end).toBe('function');
  });

  it('should not register hooks when both autoRecall and autoCapture are false', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: false, autoCapture: false });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();

    const hooks = plugin?.hooks ?? {};
    expect(hooks.before_agent_start).toBeUndefined();
    expect(hooks.agent_end).toBeUndefined();
  });
});
