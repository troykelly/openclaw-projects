/**
 * Gateway Integration Tests: Hook Registration
 * Tests lifecycle hook registration based on config.
 *
 * The gateway stores typed hooks in registry.typedHooks[] as
 * PluginHookRegistration objects with { pluginId, hookName, handler, priority }.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Hook Registration', () => {
  it('should register before_agent_start hook when autoRecall: true', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    const beforeAgentHooks = registry.typedHooks.filter(
      (h) => h.pluginId === 'openclaw-projects' && h.hookName === 'before_agent_start',
    );
    expect(beforeAgentHooks.length).toBeGreaterThan(0);
    expect(typeof beforeAgentHooks[0].handler).toBe('function');
  });

  it('should register agent_end hook when autoCapture: true', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoCapture: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    const agentEndHooks = registry.typedHooks.filter(
      (h) => h.pluginId === 'openclaw-projects' && h.hookName === 'agent_end',
    );
    expect(agentEndHooks.length).toBeGreaterThan(0);
    expect(typeof agentEndHooks[0].handler).toBe('function');
  });

  it('should register 1 hook when both autoRecall and autoCapture are false', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: false, autoCapture: false });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });

    const pluginHooks = registry.typedHooks.filter(
      (h) => h.pluginId === 'openclaw-projects',
    );
    expect(pluginHooks.length).toBe(1);
  });
});
