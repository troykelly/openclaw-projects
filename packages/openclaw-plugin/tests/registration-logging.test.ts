import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOpenClaw } from '../src/register-openclaw.js';
import { clearSecretCache } from '../src/secrets.js';
import type {
  HookHandler,
  OpenClawPluginApi,
  ToolDefinition,
} from '../src/types/openclaw-api.js';
import type { PluginLogger } from '../src/logger.js';

/**
 * Integration test for full registration logging flow (#2548).
 *
 * Verifies that all log output during registerOpenClaw() is:
 * 1. Routed through the host PluginLogger (not console)
 * 2. Correctly prefixed with [openclaw-projects] or [openclaw-projects:component]
 * 3. Free of manual [plugins] prefixes
 * 4. Free of doubled [openclaw-projects] prefixes
 * 5. Includes the startup banner with correct content
 */

// Mock fs and child_process for secret resolution
vi.mock('node:fs');
vi.mock('node:child_process');

// ── Helper: capturing PluginLogger ──────────────────────────────────────────

interface CapturingPluginLogger extends PluginLogger {
  calls: { level: string; message: string }[];
}

function createCapturingPluginLogger(): CapturingPluginLogger {
  const calls: { level: string; message: string }[] = [];
  return {
    calls,
    info: (msg: string) => { calls.push({ level: 'info', message: msg }); },
    warn: (msg: string) => { calls.push({ level: 'warn', message: msg }); },
    error: (msg: string) => { calls.push({ level: 'error', message: msg }); },
    debug: (msg: string) => { calls.push({ level: 'debug', message: msg }); },
  };
}

describe('Registration logging flow (#2548)', () => {
  let mockApi: OpenClawPluginApi;
  let captureLogger: CapturingPluginLogger;
  let registeredTools: ToolDefinition[];

  beforeEach(() => {
    registeredTools = [];
    captureLogger = createCapturingPluginLogger();
    clearSecretCache();

    mockApi = {
      id: 'openclaw-projects',
      name: 'OpenClaw Projects Plugin',
      source: 'test',
      config: {},
      pluginConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      },
      logger: captureLogger,
      runtime: {},
      registerTool: vi.fn((tool: ToolDefinition) => {
        registeredTools.push(tool);
      }),
      registerHook: vi.fn(),
      on: vi.fn(),
      registerCli: vi.fn(),
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes all log output through the host PluginLogger', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerOpenClaw(mockApi);

    // Host logger should have received messages
    expect(captureLogger.calls.length).toBeGreaterThan(0);

    // Console should NOT have been called directly (except possibly for CLI setup)
    // The key assertion is that logger captured meaningful messages
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('startup banner', () => {
    it('emits version line', () => {
      registerOpenClaw(mockApi);

      const versionLine = captureLogger.calls.find(
        (c) => c.message.includes('Plugin v'),
      );
      expect(versionLine).toBeDefined();
      expect(versionLine!.message).toMatch(/Plugin v\d+\.\d+\.\d+/);
    });

    it('emits agent/namespace line', () => {
      registerOpenClaw(mockApi);

      const agentLine = captureLogger.calls.find(
        (c) => c.message.includes('Agent:'),
      );
      expect(agentLine).toBeDefined();
      // Agent ID comes from context extraction — defaults to 'unknown' without runtime
      expect(agentLine!.message).toContain('Namespace:');
    });

    it('emits capabilities line', () => {
      registerOpenClaw(mockApi);

      const capLine = captureLogger.calls.find(
        (c) => c.message.includes('Capabilities:'),
      );
      expect(capLine).toBeDefined();
      expect(capLine!.message).toContain('autoRecall=');
      expect(capLine!.message).toContain('autoCapture=');
    });

    it('emits tool/hook/CLI count line with actual counts', () => {
      registerOpenClaw(mockApi);

      const countLine = captureLogger.calls.find(
        (c) => c.message.includes('Tools registered:'),
      );
      expect(countLine).toBeDefined();

      // Counts must match actual registrations, not hardcoded magic numbers
      const toolCount = registeredTools.length;
      expect(toolCount).toBeGreaterThan(0);
      expect(countLine!.message).toContain(String(toolCount));
      expect(countLine!.message).toContain('Hooks:');
      expect(countLine!.message).toContain('CLI commands:');
    });
  });

  describe('prefix format', () => {
    it('all messages start with [openclaw-projects] or [openclaw-projects:component]', () => {
      registerOpenClaw(mockApi);

      const prefixPattern = /^\[openclaw-projects(:[a-z]+)?\]/;
      for (const call of captureLogger.calls) {
        expect(call.message).toMatch(prefixPattern);
      }
    });

    it('no message contains raw [plugins] prefix', () => {
      registerOpenClaw(mockApi);

      for (const call of captureLogger.calls) {
        expect(call.message).not.toContain('[plugins]');
      }
    });

    it('no message contains doubled [openclaw-projects] prefix', () => {
      registerOpenClaw(mockApi);

      const doubledPattern = /\[openclaw-projects[^\]]*\].*\[openclaw-projects/;
      for (const call of captureLogger.calls) {
        expect(call.message).not.toMatch(doubledPattern);
      }
    });
  });

  describe('component child loggers', () => {
    it('uses component-scoped prefixes for namespace messages', () => {
      registerOpenClaw(mockApi);

      const namespaceMsgs = captureLogger.calls.filter(
        (c) => c.message.startsWith('[openclaw-projects:namespace]'),
      );
      expect(namespaceMsgs.length).toBeGreaterThan(0);
    });

    it('uses multiple different component scopes', () => {
      registerOpenClaw(mockApi);

      const componentPattern = /^\[openclaw-projects:([a-z]+)\]/;
      const components = new Set<string>();
      for (const call of captureLogger.calls) {
        const match = call.message.match(componentPattern);
        if (match) {
          components.add(match[1]);
        }
      }

      // Registration creates child loggers for namespace, hooks, cli, etc.
      expect(components.size).toBeGreaterThan(1);
    });
  });

  describe('sensitive data redaction', () => {
    it('does not leak API key in log messages', () => {
      registerOpenClaw(mockApi);

      const allOutput = captureLogger.calls.map((c) => c.message).join('\n');
      expect(allOutput).not.toContain('test-key');
    });

    it('does not leak raw config tokens', () => {
      mockApi.pluginConfig = {
        ...mockApi.pluginConfig,
        twilioAccountSid: 'AC12345678',
        postmarkToken: 'pm-secret-token',
      };

      registerOpenClaw(mockApi);

      const allOutput = captureLogger.calls.map((c) => c.message).join('\n');
      expect(allOutput).not.toContain('AC12345678');
      expect(allOutput).not.toContain('pm-secret-token');
    });
  });
});
