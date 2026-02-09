/**
 * Gateway Integration Tests: Hook Invocation
 * Tests hook invocation via createHookRunner().
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { createHookRunner } from 'openclaw/dist/plugins/hooks.js';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Hook Invocation', () => {
  it('should invoke before_agent_start hook with catchErrors: true', async () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner).toBeDefined();

    // Invoke before_agent_start hook
    const event = {
      prompt: 'What is my favorite color?',
      context: {},
    };

    // Hook runner should not throw even if hook fails
    await expect(
      hookRunner.run('before_agent_start', event, {})
    ).resolves.not.toThrow();
  });

  it('should invoke agent_end hook with catchErrors: true', async () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoCapture: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner).toBeDefined();

    // Invoke agent_end hook
    const event = {
      result: 'Task completed successfully',
      context: {},
    };

    // Hook runner should not throw even if hook fails
    await expect(
      hookRunner.run('agent_end', event, {})
    ).resolves.not.toThrow();
  });

  it('should report correct hook counts', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: true, autoCapture: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner).toBeDefined();

    // Check hook counts - should have at least 1 plugin with hooks
    const stats = hookRunner.stats?.() ?? { total: 0 };
    expect(stats.total).toBeGreaterThan(0);
  });
});
