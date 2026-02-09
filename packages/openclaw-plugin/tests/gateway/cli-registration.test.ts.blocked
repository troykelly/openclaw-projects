/**
 * Gateway Integration Tests: CLI Registration
 * Tests CLI command registration.
 */

import { describe, it, expect } from 'vitest';
import { loadOpenClawPlugins } from 'openclaw/dist/plugins/loader.js';
import { createTestLogger, createTestConfig } from './setup.js';

describe('Gateway CLI Registration', () => {
  it('should register CLI commands', () => {
    const logger = createTestLogger();
    const config = createTestConfig();

    const registry = loadOpenClawPlugins({ config, cache: false, logger });
    const plugin = registry.plugins.get('openclaw-projects');

    expect(plugin).toBeDefined();
    expect(plugin?.cli).toBeDefined();

    // CLI registrar should be present
    const cli = plugin?.cli;
    expect(cli).toBeDefined();
  });
});
