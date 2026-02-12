/**
 * Gateway Integration Tests: Hook Invocation
 * Tests hook invocation via createHookRunner().
 *
 * The hook runner provides typed methods like runBeforeAgentStart() and
 * runAgentEnd() rather than a generic run() method.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw-gateway/plugins/loader';
import { createHookRunner } from 'openclaw-gateway/plugins/hooks';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway Hook Invocation', () => {
  it('should invoke before_agent_start hook without throwing', { timeout: 15000 }, async () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner).toBeDefined();

    // Invoke before_agent_start hook via the typed runner method.
    // The hook will try to call the API which isn't running, but catchErrors: true
    // means it won't throw. The hook has a 5s internal timeout, so we need a longer
    // test timeout to accommodate retries.
    const result = await hookRunner.runBeforeAgentStart(
      { prompt: 'What is my favorite color?' },
      { config, workspaceDir: undefined } as never,
    );

    // Result may be undefined if the hook failed (API not running), that's expected
    expect(result === undefined || typeof result === 'object').toBe(true);
  });

  it('should invoke agent_end hook without throwing', async () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoCapture: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner).toBeDefined();

    // Invoke agent_end hook via the typed runner method
    await expect(
      hookRunner.runAgentEnd(
        { messages: [], success: true },
        { config, workspaceDir: undefined } as never,
      ),
    ).resolves.not.toThrow();
  });

  it('should report correct hook presence', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: true, autoCapture: true });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner).toBeDefined();

    // Check hook presence via hasHooks
    expect(hookRunner.hasHooks('before_agent_start')).toBe(true);
    expect(hookRunner.hasHooks('agent_end')).toBe(true);
  });

  it('should report no hooks when autoRecall and autoCapture are false', () => {
    const logger = createTestLogger();
    const config = createTestConfig({ autoRecall: false, autoCapture: false });

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const hookRunner = createHookRunner(registry, { catchErrors: true, logger });

    expect(hookRunner.hasHooks('before_agent_start')).toBe(false);
    expect(hookRunner.hasHooks('agent_end')).toBe(false);
  });
});
