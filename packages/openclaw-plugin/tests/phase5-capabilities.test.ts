/**
 * Phase 5: SDK capability implementations tests.
 *
 * #2050 — before_prompt_build hook for enhanced auto-recall
 * #2051 — llm_input/llm_output hooks for token usage analytics
 * #2052 — before_reset hook for session data archival
 * #2053 — Owner-gated tool access via before_tool_call
 * #2054 — Slash commands via api.registerCommand()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOpenClaw } from '../src/register-openclaw.js';
import { clearSecretCache } from '../src/secrets.js';
import type {
  CommandReplyPayload,
  HookHandler,
  OpenClawPluginApi,
  PluginHookAgentContext,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookBeforeResetEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
  ToolDefinition,
} from '../src/types/openclaw-api.js';

// Mock fs and child_process for secret resolution
vi.mock('node:fs');
vi.mock('node:child_process');

describe('Phase 5: SDK Capability Implementations', () => {
  let mockApi: OpenClawPluginApi;
  let registeredTools: ToolDefinition[];
  let registeredHooks: Map<string, HookHandler>;
  let registeredOnHooks: Map<string, Function>;
  let registeredCommands: Array<Record<string, unknown>>;

  beforeEach(() => {
    registeredTools = [];
    registeredHooks = new Map();
    registeredOnHooks = new Map();
    registeredCommands = [];
    clearSecretCache();

    mockApi = {
      config: {},
      pluginConfig: {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      },
      logger: {
        namespace: 'test',
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      pluginId: 'openclaw-projects',
      registerTool: vi.fn((tool: ToolDefinition) => {
        registeredTools.push(tool);
      }),
      registerHook: vi.fn((event: string, handler: HookHandler) => {
        registeredHooks.set(event, handler);
      }),
      on: vi.fn((hookName: string, handler: Function) => {
        registeredOnHooks.set(hookName, handler);
      }),
      registerCli: vi.fn(),
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
      registerCommand: vi.fn((cmd: Record<string, unknown>) => {
        registeredCommands.push(cmd);
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── #2050: before_prompt_build hook ──────────────────────────────────

  describe('#2050 — before_prompt_build hook for enhanced auto-recall', () => {
    it('should register before_prompt_build hook when autoRecall is enabled', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_prompt_build')).toBe(true);
      expect(typeof registeredOnHooks.get('before_prompt_build')).toBe('function');
    });

    it('should NOT register before_prompt_build when autoRecall is disabled', () => {
      mockApi.pluginConfig = {
        ...mockApi.pluginConfig,
        autoRecall: false,
      };

      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_prompt_build')).toBe(false);
    });

    it('should use messages for enriched context search', async () => {
      const fetchCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            memories: [{ id: '1', content: 'User likes coffee', category: 'preference', score: 0.9 }],
          }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_prompt_build') as (
          event: PluginHookBeforePromptBuildEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforePromptBuildResult | undefined>;

        const result = await hook(
          {
            prompt: 'What drinks do I like?',
            messages: [
              { role: 'user', content: 'I was thinking about my morning routine' },
              { role: 'assistant', content: 'Sure, I can help with that.' },
              { role: 'user', content: 'What drinks do I like?' },
            ],
          },
          { agentId: 'agent-1', sessionKey: 'session-1' },
        );

        // Should have made a memory search call
        const memorySearchCalls = fetchCalls.filter((url) => url.includes('/memories/search'));
        expect(memorySearchCalls.length).toBeGreaterThan(0);

        // The search query should contain content from messages (enriched)
        const searchUrl = memorySearchCalls[0];
        expect(searchUrl).toContain('morning+routine');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should return prependContext when memories are found', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          memories: [{ id: '1', content: 'User prefers dark mode', category: 'preference', score: 0.95 }],
        }),
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_prompt_build') as (
          event: PluginHookBeforePromptBuildEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforePromptBuildResult | undefined>;

        const result = await hook(
          { prompt: 'What are my UI preferences?' },
          { agentId: 'agent-1', sessionKey: 'session-1' },
        );

        if (result) {
          expect(result).toHaveProperty('prependContext');
          expect(typeof result.prependContext).toBe('string');
          expect(result.prependContext).toContain('dark mode');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should handle errors gracefully without throwing', { timeout: 15000 }, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_prompt_build') as (
          event: PluginHookBeforePromptBuildEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforePromptBuildResult | undefined>;

        // Should not throw
        const result = await hook(
          { prompt: 'test prompt' },
          { agentId: 'agent-1', sessionKey: 'session-1' },
        );

        expect(result).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should fall back gracefully when messages are empty', async () => {
      const fetchCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_prompt_build') as (
          event: PluginHookBeforePromptBuildEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforePromptBuildResult | undefined>;

        await hook(
          { prompt: 'hello', messages: [] },
          { agentId: 'agent-1', sessionKey: 'session-1' },
        );

        // Should still make a search call with just the prompt
        const memorySearchCalls = fetchCalls.filter((url) => url.includes('/memories/search'));
        expect(memorySearchCalls.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── #2051: llm_input/llm_output hooks ──────────────────────────────

  describe('#2051 — llm_input/llm_output hooks for token usage analytics', () => {
    it('should register llm_input hook', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('llm_input')).toBe(true);
      expect(typeof registeredOnHooks.get('llm_input')).toBe('function');
    });

    it('should register llm_output hook', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('llm_output')).toBe(true);
      expect(typeof registeredOnHooks.get('llm_output')).toBe('function');
    });

    it('llm_input handler should log audit info without throwing', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('llm_input') as (
        event: PluginHookLlmInputEvent,
        ctx: PluginHookAgentContext,
      ) => Promise<void>;

      // Should not throw
      await handler(
        {
          runId: 'run-123',
          sessionId: 'session-456',
          provider: 'openai',
          model: 'gpt-4',
          messageCount: 5,
          timestamp: Date.now(),
        },
        { agentId: 'agent-1', sessionKey: 'session-1' },
      );

      expect(mockApi.logger.debug).toHaveBeenCalledWith(
        'llm_input audit',
        expect.objectContaining({
          runId: 'run-123',
          provider: 'openai',
          model: 'gpt-4',
        }),
      );
    });

    it('llm_output handler should log token usage', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const handler = registeredOnHooks.get('llm_output') as (
          event: PluginHookLlmOutputEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<void>;

        await handler(
          {
            runId: 'run-123',
            sessionId: 'session-456',
            provider: 'anthropic',
            model: 'claude-3',
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
            },
            durationMs: 2000,
          },
          { agentId: 'agent-1', sessionKey: 'session-1' },
        );

        expect(mockApi.logger.debug).toHaveBeenCalledWith(
          'llm_output token usage',
          expect.objectContaining({
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('llm_output handler should handle missing usage gracefully', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('llm_output') as (
        event: PluginHookLlmOutputEvent,
        ctx: PluginHookAgentContext,
      ) => Promise<void>;

      // Should not throw when no usage data
      await handler(
        { runId: 'run-123' },
        { agentId: 'agent-1', sessionKey: 'session-1' },
      );

      expect(mockApi.logger.debug).toHaveBeenCalledWith('llm_output: no usage data available');
    });

    it('llm_input handler should be non-fatal on error', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('llm_input') as (
        event: PluginHookLlmInputEvent,
        ctx: PluginHookAgentContext,
      ) => Promise<void>;

      // Override debug AFTER registration to only affect the handler call
      (mockApi.logger.debug as ReturnType<typeof vi.fn>).mockImplementation((...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0] === 'llm_input audit') {
          throw new Error('Simulated debug error');
        }
      });

      // Should not throw
      await handler(
        { runId: 'run-fail', provider: 'test' },
        { agentId: 'agent-1', sessionKey: 'session-1' },
      );

      expect(mockApi.logger.warn).toHaveBeenCalledWith(
        'llm_input hook error',
        expect.objectContaining({ error: 'Simulated debug error' }),
      );
    });
  });

  // ── #2052: before_reset hook ──────────────────────────────────

  describe('#2052 — before_reset hook for session data archival', () => {
    it('should register before_reset hook when autoCapture is enabled', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_reset')).toBe(true);
      expect(typeof registeredOnHooks.get('before_reset')).toBe('function');
    });

    it('should NOT register before_reset hook when autoCapture is disabled', () => {
      mockApi.pluginConfig = {
        ...mockApi.pluginConfig,
        autoCapture: false,
      };

      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_reset')).toBe(false);
    });

    it('should archive session messages on reset', async () => {
      const fetchCalls: Array<{ url: string; body: string }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, body: init?.body as string ?? '' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ captured: 2 }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const handler = registeredOnHooks.get('before_reset') as (
          event: PluginHookBeforeResetEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<void>;

        await handler(
          {
            sessionId: 'session-reset-1',
            messages: [
              { role: 'user', content: 'Hello' },
              { role: 'assistant', content: 'Hi there!' },
            ],
          },
          { agentId: 'agent-1', sessionKey: 'session-reset-1' },
        );

        // Should have posted to capture endpoint
        const captureCalls = fetchCalls.filter((c) => c.url.includes('/context/capture'));
        expect(captureCalls.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should skip capture when no messages are available', async () => {
      const fetchCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        return { ok: true, status: 200, json: async () => ({}) };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const handler = registeredOnHooks.get('before_reset') as (
          event: PluginHookBeforeResetEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<void>;

        await handler(
          { sessionId: 'session-empty', messages: [] },
          { agentId: 'agent-1', sessionKey: 'session-empty' },
        );

        // Should NOT have called capture
        const captureCalls = fetchCalls.filter((c) => c.includes('/context/capture'));
        expect(captureCalls).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should deduplicate: skip if session already captured by agent_end', async () => {
      const fetchCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ captured: 1, memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        // First trigger agent_end for the session
        const agentEndHandler = registeredOnHooks.get('agent_end') as Function;
        await agentEndHandler(
          { messages: [{ role: 'user', content: 'bye' }], success: true },
          { agentId: 'agent-1', sessionKey: 'session-dedup' },
        );

        // Now trigger before_reset for the same session
        const beforeResetHandler = registeredOnHooks.get('before_reset') as (
          event: PluginHookBeforeResetEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<void>;

        await beforeResetHandler(
          {
            sessionId: 'session-dedup',
            messages: [{ role: 'user', content: 'bye' }],
          },
          { agentId: 'agent-1', sessionKey: 'session-dedup', sessionId: 'session-dedup' },
        );

        // Verify dedup log was called
        expect(mockApi.logger.debug).toHaveBeenCalledWith(
          'before_reset: session already captured, skipping',
          expect.objectContaining({ sessionId: 'session-dedup' }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should be non-fatal on error', { timeout: 15000 }, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down')) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const handler = registeredOnHooks.get('before_reset') as (
          event: PluginHookBeforeResetEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<void>;

        // Should not throw
        await handler(
          {
            sessionId: 'session-err',
            messages: [{ role: 'user', content: 'test' }],
          },
          { agentId: 'agent-1', sessionKey: 'session-err' },
        );

        // Verify no exception propagated
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── #2053: Owner-gated tool access ──────────────────────────────────

  describe('#2053 — Owner-gated tool access via before_tool_call', () => {
    it('should register before_tool_call hook', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_tool_call')).toBe(true);
      expect(typeof registeredOnHooks.get('before_tool_call')).toBe('function');
    });

    it('should allow owner access to gated tools', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'memory_forget' },
        { senderIsOwner: true, requesterSenderId: 'user-1' },
      );

      // Should not block (undefined = allow)
      expect(result).toBeUndefined();
    });

    it('should block non-owner access to memory_forget', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'memory_forget' },
        { senderIsOwner: false, requesterSenderId: 'user-2' },
      );

      expect(result).toBeDefined();
      expect(result?.blocked).toBe(true);
      expect(result?.error).toContain('Access denied');
      expect(result?.error).toContain('memory_forget');
    });

    it('should block non-owner access to api_remove', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'api_remove' },
        { senderIsOwner: false, requesterSenderId: 'user-3' },
      );

      expect(result).toBeDefined();
      expect(result?.blocked).toBe(true);
    });

    it('should block non-owner access to api_restore', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'api_restore' },
        { senderIsOwner: false, requesterSenderId: 'user-4' },
      );

      expect(result?.blocked).toBe(true);
    });

    it('should block non-owner access to api_credential_manage', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'api_credential_manage' },
        { senderIsOwner: false },
      );

      expect(result?.blocked).toBe(true);
    });

    it('should allow non-gated tools for non-owners', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'memory_recall' },
        { senderIsOwner: false, requesterSenderId: 'user-5' },
      );

      // Non-gated tool: should allow
      expect(result).toBeUndefined();
    });

    it('should treat undefined senderIsOwner as owner (backwards compat)', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { toolName: 'memory_forget' },
        { requesterSenderId: 'user-6' },
      );

      // undefined senderIsOwner = owner
      expect(result).toBeUndefined();
    });

    it('should log requesterSenderId on all gated tool invocations', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      await handler(
        { toolName: 'memory_forget' },
        { senderIsOwner: true, requesterSenderId: 'user-logged' },
      );

      expect(mockApi.logger.debug).toHaveBeenCalledWith(
        'Owner-gated tool invocation',
        expect.objectContaining({
          toolName: 'memory_forget',
          requesterSenderId: 'user-logged',
          senderIsOwner: true,
        }),
      );
    });

    it('should handle toolName from event.name field as fallback', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      const result = await handler(
        { name: 'memory_forget' },
        { senderIsOwner: false },
      );

      expect(result?.blocked).toBe(true);
    });
  });

  // ── #2054: Slash commands via registerCommand() ──────────────────────

  describe('#2054 — Slash commands via api.registerCommand()', () => {
    it('should register /remember, /forget, /recall commands', () => {
      registerOpenClaw(mockApi);

      expect(registeredCommands).toHaveLength(3);
      const names = registeredCommands.map((c) => c.name);
      expect(names).toContain('remember');
      expect(names).toContain('forget');
      expect(names).toContain('recall');
    });

    it('/remember command should require no auth', () => {
      registerOpenClaw(mockApi);

      const rememberCmd = registeredCommands.find((c) => c.name === 'remember');
      expect(rememberCmd?.requireAuth).toBe(false);
    });

    it('/forget command should require auth', () => {
      registerOpenClaw(mockApi);

      const forgetCmd = registeredCommands.find((c) => c.name === 'forget');
      expect(forgetCmd?.requireAuth).toBe(true);
    });

    it('/recall command should require no auth', () => {
      registerOpenClaw(mockApi);

      const recallCmd = registeredCommands.find((c) => c.name === 'recall');
      expect(recallCmd?.requireAuth).toBe(false);
    });

    it('/remember handler should store a memory', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'mem-1', content: 'stored' }),
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const rememberCmd = registeredCommands.find((c) => c.name === 'remember');
        const handler = rememberCmd?.handler as (args: { input: string }) => Promise<CommandReplyPayload>;

        const result = await handler({ input: 'I like pizza' });
        expect(result.success).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('/recall handler should search memories', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          memories: [{ id: '1', content: 'User likes pizza', category: 'preference', score: 0.9 }],
        }),
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const recallCmd = registeredCommands.find((c) => c.name === 'recall');
        const handler = recallCmd?.handler as (args: { input: string }) => Promise<CommandReplyPayload>;

        const result = await handler({ input: 'pizza' });
        expect(result.success).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('/forget handler should handle UUID input as memory_id', async () => {
      const fetchCalls: Array<{ url: string; body: string }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, body: init?.body as string ?? '' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ deleted: true, memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const forgetCmd = registeredCommands.find((c) => c.name === 'forget');
        const handler = forgetCmd?.handler as (args: { input: string }) => Promise<CommandReplyPayload>;

        const result = await handler({ input: '550e8400-e29b-41d4-a716-446655440000' });
        expect(result.success).toBe(true);

        // Should have included memory_id in the request
        const deleteCalls = fetchCalls.filter((c) => c.url.includes('/memories'));
        expect(deleteCalls.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('/forget handler should handle text input as query', async () => {
      const fetchCalls: Array<{ url: string; body: string }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, body: init?.body as string ?? '' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ deleted: true, memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const forgetCmd = registeredCommands.find((c) => c.name === 'forget');
        const handler = forgetCmd?.handler as (args: { input: string }) => Promise<CommandReplyPayload>;

        const result = await handler({ input: 'old pizza memory' });
        expect(result.success).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should gracefully handle registerCommand not available', () => {
      // Remove registerCommand from the API
      const apiWithoutCmd = { ...mockApi };
      delete (apiWithoutCmd as Record<string, unknown>).registerCommand;

      registerOpenClaw(apiWithoutCmd);

      // Should not have registered any commands, but should not throw
      expect(registeredCommands).toHaveLength(0);
    });

    it('command handler should return error on failure', { timeout: 15000 }, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API down')) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const recallCmd = registeredCommands.find((c) => c.name === 'recall');
        const handler = recallCmd?.handler as (args: { input: string }) => Promise<CommandReplyPayload>;

        const result = await handler({ input: 'test' });
        expect(result.success).toBe(false);
        expect(result.text).toContain('Error');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── Cross-cutting: Hook registration coexistence ──────────────────────

  describe('Hook registration coexistence', () => {
    it('should register all new hooks alongside existing hooks', () => {
      registerOpenClaw(mockApi);

      // Existing hooks (review fix #5: before_prompt_build supersedes before_agent_start)
      expect(registeredOnHooks.has('before_prompt_build')).toBe(true);
      expect(registeredOnHooks.has('agent_end')).toBe(true);
      expect(registeredOnHooks.has('message_received')).toBe(true);

      // before_agent_start is NOT registered when before_prompt_build succeeds
      expect(registeredOnHooks.has('before_agent_start')).toBe(false);

      // New Phase 5 hooks
      expect(registeredOnHooks.has('llm_input')).toBe(true);
      expect(registeredOnHooks.has('llm_output')).toBe(true);
      expect(registeredOnHooks.has('before_reset')).toBe(true);
      expect(registeredOnHooks.has('before_tool_call')).toBe(true);
    });

    it('all new hooks should be non-fatal', { timeout: 15000 }, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Always fails')) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        // Call each new hook and verify none throw
        const hooks = ['before_prompt_build', 'llm_input', 'llm_output', 'before_reset', 'before_tool_call'] as const;
        for (const hookName of hooks) {
          const handler = registeredOnHooks.get(hookName) as Function;
          if (handler) {
            // Should not throw
            await handler(
              { prompt: 'test', messages: [], toolName: 'memory_recall' },
              { agentId: 'agent-1', sessionKey: 'session-1' },
            );
          }
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── Review test gaps ──────────────────────────────────────────────────

  describe('Review test gaps', () => {
    it('/forget command should enforce owner-authorization parity with tool gating', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ deleted: true }),
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const forgetCmd = registeredCommands.find((c) => c.name === 'forget');
        const handler = forgetCmd?.handler as (args: { input: string; context?: Record<string, unknown> }) => Promise<CommandReplyPayload>;

        // Non-owner should be blocked
        const blockedResult = await handler({
          input: 'old memory',
          context: { senderIsOwner: false, requesterSenderId: 'non-owner-user' },
        });
        expect(blockedResult.success).toBe(false);
        expect(blockedResult.text).toContain('Access denied');

        // Owner should be allowed
        const allowedResult = await handler({
          input: 'old memory',
          context: { senderIsOwner: true, requesterSenderId: 'owner-user' },
        });
        expect(allowedResult.success).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('dedup should work when before_reset runs BEFORE agent_end', async () => {
      const fetchCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ captured: 1, memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        // First trigger before_reset
        const beforeResetHandler = registeredOnHooks.get('before_reset') as Function;
        await beforeResetHandler(
          {
            sessionId: 'session-order-test',
            messages: [{ role: 'user', content: 'hello' }],
          },
          { agentId: 'agent-1', sessionKey: 'session-order-test', sessionId: 'session-order-test' },
        );

        // Count capture calls so far
        const captureCallsBefore = fetchCalls.filter((url) => url.includes('/context/capture')).length;

        // Now trigger agent_end for the same session
        const agentEndHandler = registeredOnHooks.get('agent_end') as Function;
        await agentEndHandler(
          { messages: [{ role: 'user', content: 'hello' }], success: true },
          { agentId: 'agent-1', sessionKey: 'session-order-test', sessionId: 'session-order-test' },
        );

        // Should NOT have made another capture call (dedup)
        const captureCallsAfter = fetchCalls.filter((url) => url.includes('/context/capture')).length;
        expect(captureCallsAfter).toBe(captureCallsBefore);

        // Verify dedup log
        expect(mockApi.logger.debug).toHaveBeenCalledWith(
          'agent_end: session already captured by before_reset, skipping',
          expect.objectContaining({ sessionId: 'session-order-test' }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('dedup should NOT mark session as captured when agent_end capture fails', { timeout: 15000 }, async () => {
      let captureCallCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/context/capture')) {
          captureCallCount++;
          if (captureCallCount === 1) {
            // First capture (from agent_end) fails
            throw new Error('Capture API down');
          }
          // Second capture (from before_reset) succeeds
          return {
            ok: true,
            status: 200,
            json: async () => ({ captured: 1 }),
          };
        }
        // Other calls (graph-aware, memories/search) return empty
        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [], context: null, metadata: {} }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        // Trigger agent_end — capture fails
        const agentEndHandler = registeredOnHooks.get('agent_end') as Function;
        await agentEndHandler(
          { messages: [{ role: 'user', content: 'test' }], success: true },
          { agentId: 'agent-1', sessionKey: 'session-fail-test', sessionId: 'session-fail-test' },
        );

        // Now trigger before_reset — should NOT be skipped because agent_end failed
        const beforeResetHandler = registeredOnHooks.get('before_reset') as Function;
        await beforeResetHandler(
          {
            sessionId: 'session-fail-test',
            messages: [{ role: 'user', content: 'test' }],
          },
          { agentId: 'agent-1', sessionKey: 'session-fail-test', sessionId: 'session-fail-test' },
        );

        // before_reset should have attempted capture (not deduped)
        expect(captureCallCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('only ONE of before_prompt_build/before_agent_start should be registered (not both)', () => {
      registerOpenClaw(mockApi);

      // When api.on is available, only before_prompt_build is registered
      expect(registeredOnHooks.has('before_prompt_build')).toBe(true);
      expect(registeredOnHooks.has('before_agent_start')).toBe(false);

      // Neither should be in legacy hooks
      expect(registeredHooks.has('before_agent_start')).toBe(false);
    });

    it('legacy SDK path: owner gating should use registerHook when api.on is missing', () => {
      const legacyApi = { ...mockApi };
      delete (legacyApi as Record<string, unknown>).on;

      registerOpenClaw(legacyApi);

      // Should have registered via legacy registerHook
      expect(registeredHooks.has('before_tool_call')).toBe(true);
    });

    it('legacy SDK path: owner gating handler should not throw when ctx is undefined', async () => {
      const legacyApi = { ...mockApi };
      delete (legacyApi as Record<string, unknown>).on;

      registerOpenClaw(legacyApi);

      // Legacy registerHook handlers are single-arg — ctx will be undefined
      const handler = registeredHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;
      expect(handler).toBeDefined();

      // Invoke with a gated tool and NO ctx arg — should not throw
      const result = await handler({ toolName: 'memory_forget' });
      expect(result).toBeUndefined(); // allowed through with warning

      expect(mockApi.logger.warn).toHaveBeenCalledWith(
        'Owner-gated tool invoked without context — defaulting to allow (legacy SDK path)',
        expect.objectContaining({ toolName: 'memory_forget' }),
      );
    });

    it('owner gate should warn when senderIsOwner is undefined', async () => {
      registerOpenClaw(mockApi);

      const handler = registeredOnHooks.get('before_tool_call') as (
        event: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | void>;

      await handler(
        { toolName: 'memory_forget' },
        { requesterSenderId: 'user-no-owner-flag' },
      );

      expect(mockApi.logger.warn).toHaveBeenCalledWith(
        'Owner-gated tool invoked without senderIsOwner trust signal — defaulting to allow',
        expect.objectContaining({
          toolName: 'memory_forget',
          requesterSenderId: 'user-no-owner-flag',
        }),
      );
    });
  });
});
