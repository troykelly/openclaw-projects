import { describe, expect, it } from 'vitest';

/**
 * Tests for the startup banner (#2539, #2547).
 *
 * TDD: These tests are written FIRST. They should FAIL until the
 * implementation in startup.ts is created.
 *
 * Agent IDs and namespace names are operational identifiers, NOT sensitive
 * data — they are intentionally logged for debugging.
 */

import { emitStartupBanner } from '../src/startup.js';
import type { Logger } from '../src/logger.js';

// ── Helper: create a capturing logger ───────────────────────────────────────

function createCapturingLogger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  const capture = (msg: string) => { messages.push(msg); };
  return {
    messages,
    info: capture,
    warn: capture,
    error: capture,
    debug: capture,
    child: () => createCapturingLogger(),
  };
}

// ── emitStartupBanner ───────────────────────────────────────────────────────

describe('emitStartupBanner', () => {
  const baseConfig = {
    agentId: 'troy',
    namespace: { default: 'default', recall: ['default', 'shared'] },
    autoRecall: true,
    autoCapture: true,
    twilioAccountSid: 'AC1234',
    postmarkToken: 'pm-token',
  };

  const baseSummary = {
    toolCount: 52,
    hookCount: 2,
    cliCount: 3,
  };

  it('logs plugin version line', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    const versionLine = logger.messages.find((m) => m.includes('Plugin v'));
    expect(versionLine).toBeDefined();
    // Version should match package.json pattern (e.g. 0.0.60)
    expect(versionLine).toMatch(/Plugin v\d+\.\d+\.\d+/);
  });

  it('logs agent ID and namespace info', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    const agentLine = logger.messages.find((m) => m.includes('Agent:'));
    expect(agentLine).toBeDefined();
    expect(agentLine).toContain('troy');
    expect(agentLine).toContain('default');
    expect(agentLine).toContain('shared');
  });

  it('logs capability flags reflecting config', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    const capLine = logger.messages.find((m) => m.includes('Capabilities:'));
    expect(capLine).toBeDefined();
    expect(capLine).toContain('autoRecall=true');
    expect(capLine).toContain('autoCapture=true');
    expect(capLine).toContain('twilio=configured');
    expect(capLine).toContain('postmark=configured');
  });

  it('logs capabilities as not configured when absent', () => {
    const logger = createCapturingLogger();
    const configNoCaps = {
      ...baseConfig,
      autoRecall: false,
      autoCapture: false,
      twilioAccountSid: undefined,
      postmarkToken: undefined,
    };
    emitStartupBanner(logger, configNoCaps, baseSummary);
    const capLine = logger.messages.find((m) => m.includes('Capabilities:'));
    expect(capLine).toBeDefined();
    expect(capLine).toContain('autoRecall=false');
    expect(capLine).toContain('autoCapture=false');
    expect(capLine).toContain('twilio=not configured');
    expect(capLine).toContain('postmark=not configured');
  });

  it('logs correct registration counts from summary', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    const countLine = logger.messages.find((m) => m.includes('Tools registered:'));
    expect(countLine).toBeDefined();
    expect(countLine).toContain('52');
    expect(countLine).toContain('Hooks:');
    expect(countLine).toContain('2');
    expect(countLine).toContain('CLI commands:');
    expect(countLine).toContain('3');
  });

  it('counts are derived from provided summary, not hardcoded', () => {
    const logger = createCapturingLogger();
    const customSummary = { toolCount: 10, hookCount: 5, cliCount: 1 };
    emitStartupBanner(logger, baseConfig, customSummary);
    const countLine = logger.messages.find((m) => m.includes('Tools registered:'));
    expect(countLine).toContain('10');
    expect(countLine).toContain('5');
    expect(countLine).toContain('1');
  });

  it('uses the provided logger (not console)', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    // Should have logged 4 lines
    expect(logger.messages.length).toBe(4);
  });

  it('does not log sensitive config values', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    const allOutput = logger.messages.join('\n');
    // Should NOT contain actual tokens/sids
    expect(allOutput).not.toContain('AC1234');
    expect(allOutput).not.toContain('pm-token');
  });

  it('handles missing/undefined config values gracefully', () => {
    const logger = createCapturingLogger();
    const minimalConfig = {};
    const minimalSummary = { toolCount: 0, hookCount: 0, cliCount: 0 };
    // Should not throw
    emitStartupBanner(logger, minimalConfig, minimalSummary);
    expect(logger.messages.length).toBe(4);
  });

  it('agent IDs and namespace names are logged (operational identifiers)', () => {
    const logger = createCapturingLogger();
    emitStartupBanner(logger, baseConfig, baseSummary);
    const allOutput = logger.messages.join('\n');
    expect(allOutput).toContain('troy');
    expect(allOutput).toContain('default');
  });
});
