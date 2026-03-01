import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOpenClaw, schemas } from '../src/register-openclaw.js';
import { clearSecretCache } from '../src/secrets.js';
import type {
  HookHandler,
  OpenClawPluginApi,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult,
  ToolDefinition,
} from '../src/types/openclaw-api.js';

// Mock fs and child_process for secret resolution
vi.mock('node:fs');
vi.mock('node:child_process');

describe('OpenClaw 2026 API Registration', () => {
  let mockApi: OpenClawPluginApi;
  let registeredTools: ToolDefinition[];
  let registeredHooks: Map<string, HookHandler>;
  let registeredOnHooks: Map<string, Function>;
  let cliCallback: ((ctx: { program: unknown }) => void) | null;

  beforeEach(() => {
    registeredTools = [];
    registeredHooks = new Map();
    registeredOnHooks = new Map();
    cliCallback = null;
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
      registerCli: vi.fn((callback: (ctx: { program: unknown }) => void) => {
        cliCallback = callback;
      }),
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registration', () => {
    it('should register all 96 tools', () => {
      registerOpenClaw(mockApi);

      expect(registeredTools).toHaveLength(96);
      const toolNames = registeredTools.map((t) => t.name);
      expect(toolNames).toContain('memory_recall');
      expect(toolNames).toContain('memory_store');
      expect(toolNames).toContain('memory_forget');
      expect(toolNames).toContain('project_list');
      expect(toolNames).toContain('project_get');
      expect(toolNames).toContain('project_create');
      expect(toolNames).toContain('todo_list');
      expect(toolNames).toContain('todo_create');
      expect(toolNames).toContain('todo_complete');
      expect(toolNames).toContain('todo_search');
      expect(toolNames).toContain('project_search');
      expect(toolNames).toContain('context_search');
      expect(toolNames).toContain('contact_search');
      expect(toolNames).toContain('contact_get');
      expect(toolNames).toContain('contact_create');
      expect(toolNames).toContain('sms_send');
      expect(toolNames).toContain('email_send');
      expect(toolNames).toContain('message_search');
      expect(toolNames).toContain('thread_list');
      expect(toolNames).toContain('thread_get');
      expect(toolNames).toContain('relationship_set');
      expect(toolNames).toContain('relationship_query');
      expect(toolNames).toContain('file_share');
      expect(toolNames).toContain('skill_store_put');
      expect(toolNames).toContain('skill_store_get');
      expect(toolNames).toContain('skill_store_list');
      expect(toolNames).toContain('skill_store_delete');
      expect(toolNames).toContain('skill_store_search');
      expect(toolNames).toContain('skill_store_collections');
      expect(toolNames).toContain('skill_store_aggregate');
      expect(toolNames).toContain('links_set');
      expect(toolNames).toContain('links_query');
      expect(toolNames).toContain('links_remove');
      // Issue #1536: Namespace management tools
      expect(toolNames).toContain('namespace_list');
      expect(toolNames).toContain('namespace_create');
      expect(toolNames).toContain('namespace_grant');
      expect(toolNames).toContain('namespace_members');
      expect(toolNames).toContain('namespace_revoke');
      // Issue #1921: Note tools
      expect(toolNames).toContain('note_create');
      expect(toolNames).toContain('note_get');
      expect(toolNames).toContain('note_update');
      expect(toolNames).toContain('note_delete');
      expect(toolNames).toContain('note_search');
      // Issue #1921: Notebook tools
      expect(toolNames).toContain('notebook_list');
      expect(toolNames).toContain('notebook_create');
      expect(toolNames).toContain('notebook_get');
    });

    it('should mark 61 tools as optional', () => {
      registerOpenClaw(mockApi);

      const optionalTools = registeredTools.filter((t) => t.optional === true);
      expect(optionalTools).toHaveLength(61);

      // Verify non-optional core tools are NOT marked optional
      const coreToolNames = ['memory_recall', 'memory_store', 'memory_forget', 'project_list', 'todo_list', 'todo_create'];
      for (const coreName of coreToolNames) {
        const tool = registeredTools.find((t) => t.name === coreName);
        expect(tool?.optional).not.toBe(true);
      }
    });

    it('should assign group to optional tools', () => {
      registerOpenClaw(mockApi);

      const optionalTools = registeredTools.filter((t) => t.optional === true);
      // Every optional tool must have a group
      for (const tool of optionalTools) {
        expect(tool.group).toBeDefined();
        expect(typeof tool.group).toBe('string');
        expect(tool.group!.length).toBeGreaterThan(0);
      }
    });

    it('should register before_agent_start hook via api.on() when autoRecall is true', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_agent_start')).toBe(true);
      expect(typeof registeredOnHooks.get('before_agent_start')).toBe('function');
    });

    it('should register agent_end hook via api.on() when autoCapture is true', () => {
      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('agent_end')).toBe(true);
      expect(typeof registeredOnHooks.get('agent_end')).toBe('function');
    });

    it('should NOT use legacy registerHook for hooks', () => {
      registerOpenClaw(mockApi);

      // Should NOT register hooks via the legacy registerHook method
      expect(registeredHooks.has('beforeAgentStart')).toBe(false);
      expect(registeredHooks.has('agentEnd')).toBe(false);
    });

    it('should not register hooks when disabled', () => {
      mockApi.pluginConfig = {
        ...mockApi.pluginConfig,
        autoRecall: false,
        autoCapture: false,
      };

      registerOpenClaw(mockApi);

      expect(registeredOnHooks.has('before_agent_start')).toBe(false);
      expect(registeredOnHooks.has('agent_end')).toBe(false);
    });

    it('should register CLI commands', () => {
      registerOpenClaw(mockApi);

      expect(cliCallback).not.toBeNull();
    });

    it('should log registration success', () => {
      registerOpenClaw(mockApi);

      expect(mockApi.logger.info).toHaveBeenCalledWith(
        'OpenClaw Projects plugin registered',
        expect.objectContaining({
          toolCount: 96,
        }),
      );
    });

    it('should fall back to registerHook if api.on is not available', () => {
      // Simulate older OpenClaw runtime without api.on
      const legacyApi = { ...mockApi };
      delete (legacyApi as Record<string, unknown>).on;

      registerOpenClaw(legacyApi);

      // Should have fallen back to registerHook
      expect(registeredHooks.has('beforeAgentStart')).toBe(true);
      expect(registeredHooks.has('agentEnd')).toBe(true);
    });
  });

  describe('before_agent_start hook behavior', () => {
    it('should use the user prompt from event for semantic search', async () => {
      const fetchCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            memories: [{ id: '1', content: 'User prefers sushi', category: 'preference', score: 0.9 }],
          }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        expect(hook).toBeDefined();

        // Call the hook with a specific prompt
        const result = await hook({ prompt: 'What are my food preferences?' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        // Result should have prependContext (not injectedContext)
        if (result) {
          expect(result).toHaveProperty('prependContext');
          expect(result).not.toHaveProperty('injectedContext');
        }

        // Verify the search API was called with the user's actual prompt
        const memorySearchCalls = fetchCalls.filter((url) => url.includes('/api/memories/search'));
        expect(memorySearchCalls.length).toBeGreaterThan(0);
        expect(memorySearchCalls[0]).toContain('food+preferences');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should return { prependContext } format, not { injectedContext }', async () => {
      // Create a mock that will intercept the fetch
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

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        const result = await hook({ prompt: 'Tell me about my preferences' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        if (result) {
          expect(result).toHaveProperty('prependContext');
          expect(typeof result.prependContext).toBe('string');
          // Must NOT have injectedContext
          expect(result).not.toHaveProperty('injectedContext');
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should pass the actual prompt to the memory search API', async () => {
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

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        await hook({ prompt: 'What are my food preferences?' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        // The API call should contain the user's actual prompt, not 'relevant context for this conversation'
        const memorySearchCalls = fetchCalls.filter((url) => url.includes('/api/memories/search'));
        expect(memorySearchCalls.length).toBeGreaterThan(0);

        const searchUrl = memorySearchCalls[0];
        expect(searchUrl).toContain('food+preferences');
        expect(searchUrl).not.toContain('relevant+context+for+this+conversation');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should handle timeout gracefully', async () => {
      const originalFetch = globalThis.fetch;
      // Simulate a very slow response that will exceed the hook timeout
      globalThis.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 60000))) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        // The hook has a 5s internal timeout. The slow fetch will trigger it.
        const result = await hook({ prompt: 'Hello' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        // Should return void/undefined on timeout, not throw
        expect(result).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, 15000);

    it('should not throw on hook execution errors', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext,
        ) => Promise<PluginHookBeforeAgentStartResult | undefined>;

        // Should not throw even when network fails
        const result = await hook({ prompt: 'Hello' }, { agentId: 'agent-1', sessionKey: 'session-1' });

        expect(result).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, 15000);
  });

  describe('agent_end hook behavior', () => {
    it('should accept the correct event payload shape', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ captured: 1 }),
      })) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('agent_end') as (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void>;

        expect(hook).toBeDefined();

        // Should not throw with correct payload
        await expect(
          hook(
            {
              messages: [{ role: 'user', content: 'Hello' }],
              success: true,
              durationMs: 1000,
            },
            { agentId: 'agent-1', sessionKey: 'session-1' },
          ),
        ).resolves.not.toThrow();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should not throw on empty messages', async () => {
      registerOpenClaw(mockApi);

      const hook = registeredOnHooks.get('agent_end') as (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void>;

      await expect(hook({ messages: [], success: true }, { agentId: 'agent-1', sessionKey: 'session-1' })).resolves.not.toThrow();
    });

    it('should call context capture API with conversation data', async () => {
      const fetchCalls: { url: string; body: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, body: (init?.body as string) || '' });
        return {
          ok: true,
          status: 200,
          json: async () => ({ captured: 1 }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const hook = registeredOnHooks.get('agent_end') as (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void>;

        await hook(
          {
            messages: [
              { role: 'user', content: 'Remember I prefer dark mode' },
              { role: 'assistant', content: 'Noted, you prefer dark mode.' },
            ],
            success: true,
            durationMs: 5000,
          },
          { agentId: 'agent-1', sessionKey: 'session-1' },
        );

        // Should have made a capture API call
        const captureCalls = fetchCalls.filter((c) => c.url.includes('/api/context/capture'));
        expect(captureCalls.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('tool definitions', () => {
    it('should have valid JSON Schema for all tools', () => {
      registerOpenClaw(mockApi);

      for (const tool of registeredTools) {
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe('object');
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });

    it('should have required properties marked correctly', () => {
      registerOpenClaw(mockApi);

      const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall');
      expect(memoryRecall?.parameters.required).toContain('query');

      const projectGet = registeredTools.find((t) => t.name === 'project_get');
      expect(projectGet?.parameters.required).toContain('project_id');

      const contactCreate = registeredTools.find((t) => t.name === 'contact_create');
      // contact_create has no strict required fields (accepts display_name OR given_name/family_name)
      expect(contactCreate?.parameters.properties).toHaveProperty('display_name');

      const relationshipSet = registeredTools.find((t) => t.name === 'relationship_set');
      expect(relationshipSet?.parameters.required).toContain('contact_a');
      expect(relationshipSet?.parameters.required).toContain('contact_b');
      expect(relationshipSet?.parameters.required).toContain('relationship');

      const relationshipQuery = registeredTools.find((t) => t.name === 'relationship_query');
      expect(relationshipQuery?.parameters.required).toContain('contact');
    });

    it('should have executable functions', () => {
      registerOpenClaw(mockApi);

      for (const tool of registeredTools) {
        expect(typeof tool.execute).toBe('function');
      }
    });

    it('should have execute functions with correct OpenClaw Gateway signature', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          memories: [{ id: '1', content: 'test', category: 'fact', score: 0.9 }],
        }),
      })) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall');
        expect(memoryRecall).toBeDefined();

        // Call execute with the correct OpenClaw Gateway signature:
        // (toolCallId: string, params: T, signal?: AbortSignal, onUpdate?: (partial: any) => void) => AgentToolResult
        const result = await memoryRecall!.execute('test-tool-call-id', { query: 'test query' }, undefined, undefined);

        // Result should be AgentToolResult format: { content: [{ type: "text", text: "..." }] }
        expect(result).toHaveProperty('content');
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0]).toHaveProperty('type', 'text');
        expect(result.content[0]).toHaveProperty('text');
        expect(typeof result.content[0].text).toBe('string');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should return AgentToolResult format for errors', async () => {
      // First, register with a working fetch to get the plugin set up
      const originalFetch = globalThis.fetch;

      // Use a mock config without retries
      mockApi.pluginConfig = {
        ...mockApi.pluginConfig,
        maxRetries: 0, // Disable retries
      };

      // Mock that returns a client error (no retries on 4xx)
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad request', message: 'Invalid query' }),
      })) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall');
        expect(memoryRecall).toBeDefined();

        // Call with toolCallId as first argument
        const result = await memoryRecall!.execute('error-test-id', { query: 'test' }, undefined, undefined);

        // Even errors should return AgentToolResult format
        expect(result).toHaveProperty('content');
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0]).toHaveProperty('type', 'text');
        expect(result.content[0]).toHaveProperty('text');
        // Error text should contain "Error"
        expect(result.content[0].text).toContain('Error');
      } finally {
        globalThis.fetch = originalFetch;
      }
    }, 10000);

    it('should NOT receive toolCallId as params (bug that was fixed)', async () => {
      const originalFetch = globalThis.fetch;
      let receivedParams: Record<string, unknown> | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        // Extract query params to verify what was sent
        const urlObj = new URL(url);
        const queryParam = urlObj.searchParams.get('q');
        receivedParams = { query: queryParam };
        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [] }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall');
        expect(memoryRecall).toBeDefined();

        // Call with toolCallId as first arg, params as second
        await memoryRecall!.execute('my-tool-call-id', { query: 'actual search query' }, undefined, undefined);

        // The query should be 'actual search query', NOT 'my-tool-call-id'
        expect(receivedParams?.query).toBe('actual search query');
        expect(receivedParams?.query).not.toBe('my-tool-call-id');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('CLI status command error handling', () => {
    /**
     * Helper to extract the registered status action from the CLI callback.
     * Creates a separate mock command per registered command name so that
     * later .action() calls don't overwrite the status action.
     */
    function extractStatusAction(): () => Promise<void> {
      expect(cliCallback).not.toBeNull();

      const actions = new Map<string, () => Promise<void>>();
      const mockProgram = {
        command: vi.fn((name: string) => {
          const cmd = {
            description: vi.fn().mockReturnThis(),
            action: vi.fn((fn: () => Promise<void>) => {
              actions.set(name, fn);
              return cmd;
            }),
            argument: vi.fn().mockReturnThis(),
            option: vi.fn().mockReturnThis(),
          };
          return cmd;
        }),
      };

      cliCallback!({ program: mockProgram });
      const statusAction = actions.get('status');
      expect(statusAction).toBeDefined();
      return statusAction!;
    }

    it('should use console.error (not console.log) for API errors', async () => {
      const originalFetch = globalThis.fetch;
      // Return a non-OK response so apiClient.get returns {success: false}
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ message: 'Service Unavailable' }),
      }) as unknown as typeof fetch;

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        mockApi.pluginConfig = { ...mockApi.pluginConfig, maxRetries: 0 };
        registerOpenClaw(mockApi);

        const statusAction = extractStatusAction();
        await statusAction();

        // console.error should be called with the status error (from our fix)
        const errorCalls = errorSpy.mock.calls;
        const statusErrorCall = errorCalls.find((args) => args.some((arg) => typeof arg === 'string' && arg.includes('Plugin Status')));
        expect(statusErrorCall).toBeDefined();

        // console.log should NOT be called with error output
        const logCalls = logSpy.mock.calls;
        const hasStatusErrorInLog = logCalls.some((args) =>
          args.some((arg) => typeof arg === 'string' && arg.includes('Plugin Status') && arg.includes('Error')),
        );
        expect(hasStatusErrorInLog).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
        errorSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('should include error details in status error output', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({ message: 'Service Unavailable' }),
      }) as unknown as typeof fetch;

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        mockApi.pluginConfig = { ...mockApi.pluginConfig, maxRetries: 0 };
        registerOpenClaw(mockApi);

        const statusAction = extractStatusAction();
        await statusAction();

        // Find the Plugin Status error call and check it includes details
        const errorCalls = errorSpy.mock.calls;
        const statusErrorCall = errorCalls.find((args) => args.some((arg) => typeof arg === 'string' && arg.includes('Plugin Status')));
        expect(statusErrorCall).toBeDefined();

        const statusMessage = statusErrorCall!.join(' ');
        expect(statusMessage).toContain('Service Unavailable');
      } finally {
        globalThis.fetch = originalFetch;
        errorSpy.mockRestore();
      }
    });

    it('should include error message when catch block is reached', async () => {
      const originalFetch = globalThis.fetch;
      // Make fetch reject to trigger the catch block
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      try {
        mockApi.pluginConfig = { ...mockApi.pluginConfig, maxRetries: 0 };
        registerOpenClaw(mockApi);

        const statusAction = extractStatusAction();
        await statusAction();

        // All error output should contain the error details
        const allErrorOutput = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
        expect(allErrorOutput).toContain('ECONNREFUSED');
      } finally {
        globalThis.fetch = originalFetch;
        errorSpy.mockRestore();
      }
    });
  });

  describe('JSON Schemas export', () => {
    it('should export all tool schemas', () => {
      expect(schemas.memoryRecall).toBeDefined();
      expect(schemas.memoryStore).toBeDefined();
      expect(schemas.memoryForget).toBeDefined();
      expect(schemas.projectList).toBeDefined();
      expect(schemas.projectGet).toBeDefined();
      expect(schemas.projectCreate).toBeDefined();
      expect(schemas.todoList).toBeDefined();
      expect(schemas.todoCreate).toBeDefined();
      expect(schemas.todoComplete).toBeDefined();
      expect(schemas.todoSearch).toBeDefined();
      expect(schemas.projectSearch).toBeDefined();
      expect(schemas.contactSearch).toBeDefined();
      expect(schemas.contactGet).toBeDefined();
      expect(schemas.contactCreate).toBeDefined();
      expect(schemas.smsSend).toBeDefined();
      expect(schemas.emailSend).toBeDefined();
      expect(schemas.messageSearch).toBeDefined();
      expect(schemas.threadList).toBeDefined();
      expect(schemas.threadGet).toBeDefined();
      expect(schemas.relationshipSet).toBeDefined();
      expect(schemas.relationshipQuery).toBeDefined();
    });

    it('should have valid schema structure', () => {
      for (const schema of Object.values(schemas)) {
        expect(schema.type).toBe('object');
        expect(schema.properties).toBeDefined();
      }
    });
  });

  describe('synchronous registration', () => {
    it('should NOT return a Promise (not thenable)', () => {
      const result = registerOpenClaw(mockApi);
      // The return value must NOT be a Promise or thenable
      // OpenClaw's loader checks: if (result && typeof result.then === "function")
      // and logs a warning if true, meaning async registration is ignored
      expect(result).not.toBeInstanceOf(Promise);
      if (result !== undefined && result !== null) {
        expect(typeof (result as Record<string, unknown>).then).not.toBe('function');
      }
    });

    it('should register all tools synchronously during register() call', () => {
      registerOpenClaw(mockApi);
      // All tools must be registered by the time register() returns
      expect(registeredTools).toHaveLength(96);
    });

    it('should register hooks synchronously during register() call', () => {
      registerOpenClaw(mockApi);
      // Hooks must be registered by the time register() returns
      expect(registeredOnHooks.has('before_agent_start')).toBe(true);
      expect(registeredOnHooks.has('agent_end')).toBe(true);
    });

    it('should register CLI commands synchronously during register() call', () => {
      registerOpenClaw(mockApi);
      // CLI must be registered by the time register() returns
      expect(cliCallback).not.toBeNull();
    });
  });

  describe('pluginConfig vs config resolution', () => {
    it('should prefer api.pluginConfig over api.config', () => {
      // Simulate real Gateway: api.config is the full gateway config,
      // api.pluginConfig is the plugin-specific config
      mockApi.config = { gateway: { port: 8080 }, plugins: {} };
      mockApi.pluginConfig = {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      };

      registerOpenClaw(mockApi);

      // Should succeed — reads pluginConfig, not the full gateway config
      expect(registeredTools).toHaveLength(96);
    });

    it('should fall back to api.config when api.pluginConfig is undefined', () => {
      // Simulate older SDK or test environment that puts config in api.config
      mockApi.pluginConfig = undefined;
      mockApi.config = {
        apiUrl: 'https://api.example.com',
        apiKey: 'test-key',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      };

      registerOpenClaw(mockApi);

      // Should succeed via fallback
      expect(registeredTools).toHaveLength(96);
    });
  });

  describe('graceful error handling on config failures', () => {
    it('should not throw when config validation fails (ZodError)', () => {
      // Provide invalid config that will fail Zod validation
      mockApi.pluginConfig = { invalid: 'not a valid config' };

      // Must not throw — should return gracefully
      expect(() => registerOpenClaw(mockApi)).not.toThrow();
    });

    it('should log a human-readable error when config validation fails', () => {
      // Missing required fields will produce ZodError
      mockApi.pluginConfig = { apiUrl: 'not-a-url' };

      registerOpenClaw(mockApi);

      expect(mockApi.logger.error).toHaveBeenCalled();
      const errorCall = vi.mocked(mockApi.logger.error).mock.calls[0];
      expect(errorCall[0]).toContain('Invalid plugin configuration');
    });

    it('should not register any tools when config validation fails', () => {
      mockApi.pluginConfig = { invalid: 'bad config' };

      registerOpenClaw(mockApi);

      expect(registeredTools).toHaveLength(0);
    });

    it('should not throw when secret resolution fails', () => {
      // Provide valid raw config but with a command that will fail
      mockApi.pluginConfig = {
        apiUrl: 'https://api.example.com',
        apiKeyCommand: 'nonexistent-command-that-will-fail',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      };

      // Must not throw — should return gracefully
      expect(() => registerOpenClaw(mockApi)).not.toThrow();
    });

    it('should log an actionable error when secret resolution fails', () => {
      mockApi.pluginConfig = {
        apiUrl: 'https://api.example.com',
        apiKeyCommand: 'nonexistent-command-that-will-fail',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      };

      registerOpenClaw(mockApi);

      expect(mockApi.logger.error).toHaveBeenCalled();
      const errorCall = vi.mocked(mockApi.logger.error).mock.calls[0];
      expect(errorCall[0]).toContain('Failed to resolve');
    });

    it('should not register any tools when secret resolution fails', () => {
      mockApi.pluginConfig = {
        apiUrl: 'https://api.example.com',
        apiKeyCommand: 'nonexistent-command-that-will-fail',
        autoRecall: true,
        autoCapture: true,
        userScoping: 'agent',
      };

      registerOpenClaw(mockApi);

      expect(registeredTools).toHaveLength(0);
    });
  });

  describe('inline handler fixes (#1169, #1171, #1177)', () => {
    it('email_send should call /api/postmark/email/send, not /api/email/messages/send (#1177)', async () => {
      const fetchCalls: { url: string; method: string; body: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, method: init?.method || 'GET', body: (init?.body as string) || '' });
        return {
          ok: true,
          status: 202,
          json: async () => ({
            message_id: 'MSG-TEST-1177',
            thread_id: 'TH-TEST-1177',
            status: 'queued',
          }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const emailSend = registeredTools.find((t) => t.name === 'email_send');
        expect(emailSend).toBeDefined();

        const result = await emailSend!.execute('test-id', {
          to: 'recipient@example.com',
          subject: 'Test Subject',
          body: 'Test email body',
        }, undefined, undefined);

        // Should call /api/postmark/email/send (not /api/email/messages/send)
        const emailCalls = fetchCalls.filter((c) => c.url.includes('/email/'));
        expect(emailCalls.length).toBeGreaterThan(0);
        expect(emailCalls[0].url).toContain('/api/postmark/email/send');
        expect(emailCalls[0].url).not.toContain('/api/email/messages/send');

        // Result should be successful
        expect(result.content[0].text).toContain('MSG-TEST-1177');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });


    it('todo_list should use completed boolean, not status string (#1171)', async () => {
      const fetchCalls: { url: string; method: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, method: init?.method || 'GET' });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: '1', title: 'Test todo', status: 'open', completed: false }],
            total: 1,
          }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const todoList = registeredTools.find((t) => t.name === 'todo_list');
        expect(todoList).toBeDefined();

        // Call with no completed param (should NOT send status=pending)
        await todoList!.execute('test-id', {}, undefined, undefined);

        const workItemCalls = fetchCalls.filter((c) => c.url.includes('/api/work-items'));
        expect(workItemCalls.length).toBeGreaterThan(0);
        const url = workItemCalls[0].url;

        // Should NOT contain status=pending (the old buggy default)
        expect(url).not.toContain('status=pending');
        // Should contain kind=task (renamed from item_type per #1901)
        expect(url).toContain('kind=task');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('todo_list should send status=active when completed=false (#1171)', async () => {
      const fetchCalls: { url: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push({ url });
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const todoList = registeredTools.find((t) => t.name === 'todo_list');
        await todoList!.execute('test-id', { completed: false }, undefined, undefined);

        const workItemCalls = fetchCalls.filter((c) => c.url.includes('/api/work-items'));
        expect(workItemCalls.length).toBeGreaterThan(0);
        expect(workItemCalls[0].url).toContain('status=active');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('todo_list should send status=completed when completed=true (#1171)', async () => {
      const fetchCalls: { url: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push({ url });
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0 }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const todoList = registeredTools.find((t) => t.name === 'todo_list');
        await todoList!.execute('test-id', { completed: true }, undefined, undefined);

        const workItemCalls = fetchCalls.filter((c) => c.url.includes('/api/work-items'));
        expect(workItemCalls.length).toBeGreaterThan(0);
        expect(workItemCalls[0].url).toContain('status=completed');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('todo_list schema should have completed boolean, not status enum', () => {
      expect(schemas.todoList.properties).toHaveProperty('completed');
      expect(schemas.todoList.properties.completed.type).toBe('boolean');
      expect(schemas.todoList.properties).not.toHaveProperty('status');
    });

    it('relationship_query should use /api/contacts/:id/relationships endpoint (#1169)', async () => {
      const testUuid = '12345678-1234-1234-1234-123456789abc';
      const fetchCalls: { url: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push({ url });
        if (url.includes(`/api/contacts/${testUuid}/relationships`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              contact_id: testUuid,
              contact_name: 'Test Contact',
              related_contacts: [],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const relQuery = registeredTools.find((t) => t.name === 'relationship_query');
        expect(relQuery).toBeDefined();

        // Call with a UUID
        await relQuery!.execute('test-id', { contact: testUuid }, undefined, undefined);

        // Should call /api/contacts/<uuid>/relationships, NOT /api/relationships?contact_id=<uuid>
        const relCalls = fetchCalls.filter((c) => c.url.includes('/relationships'));
        expect(relCalls.length).toBeGreaterThan(0);
        expect(relCalls[0].url).toContain(`/api/contacts/${testUuid}/relationships`);
        expect(relCalls[0].url).not.toContain('contact_id=');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('relationship_query should resolve name to UUID via contact search (#1169)', async () => {
      const fetchCalls: { url: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push({ url });
        if (url.includes('/api/contacts?') || url.includes('/api/contacts%3F')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              contacts: [{ id: 'resolved-uuid-456', display_name: 'John Doe' }],
            }),
          };
        }
        if (url.includes('/api/contacts/resolved-uuid-456/relationships')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              contact_id: 'resolved-uuid-456',
              contact_name: 'John Doe',
              related_contacts: [
                {
                  contact_id: 'other-789',
                  contact_name: 'Jane Doe',
                  contact_kind: 'person',
                  relationship_id: 'rel-1',
                  relationship_type_name: 'partner',
                  relationship_type_label: 'Partner',
                  is_directional: false,
                  notes: null,
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const relQuery = registeredTools.find((t) => t.name === 'relationship_query');
        const result = await relQuery!.execute('test-id', { contact: 'John Doe' }, undefined, undefined);

        // Should have searched contacts first (name is not a UUID)
        const contactSearchCalls = fetchCalls.filter((c) => c.url.includes('/api/contacts?'));
        expect(contactSearchCalls.length).toBeGreaterThan(0);
        expect(contactSearchCalls[0].url).toContain('search=John');

        // Then should have called graph traversal with the resolved UUID
        const relCalls = fetchCalls.filter((c) => c.url.includes('/api/contacts/resolved-uuid-456/relationships'));
        expect(relCalls.length).toBe(1);

        // Result should contain formatted relationships
        expect(result.content[0].text).toContain('Partner');
        expect(result.content[0].text).toContain('Jane Doe');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('project_search registered handler should delegate to factory and return results (#1217)', async () => {
      const fetchCalls: { url: string }[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push({ url });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                id: 'proj-1',
                title: 'Home Renovation',
                snippet: 'Kitchen remodel',
                score: 0.9,
                type: 'work_item',
                metadata: { kind: 'project', status: 'active' },
              },
              {
                id: 'task-1',
                title: 'Buy paint',
                snippet: 'Get supplies',
                score: 0.8,
                type: 'work_item',
                metadata: { kind: 'task', status: 'open' },
              },
            ],
            search_type: 'hybrid',
            total: 2,
          }),
        };
      }) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const projectSearch = registeredTools.find((t) => t.name === 'project_search');
        expect(projectSearch).toBeDefined();

        const result = await projectSearch!.execute('test-id', { query: 'renovation' }, undefined, undefined);

        // Should call the search API
        const searchCalls = fetchCalls.filter((c) => c.url.includes('/api/search'));
        expect(searchCalls.length).toBeGreaterThan(0);
        expect(searchCalls[0].url).toContain('types=work_item');
        expect(searchCalls[0].url).toContain('semantic=true');

        // Result should be AgentToolResult format with only project results (task filtered out)
        expect(result.content[0].text).toContain('Home Renovation');
        expect(result.content[0].text).not.toContain('Buy paint');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('project_search registered handler should validate params via Zod (#1217)', async () => {
      registerOpenClaw(mockApi);

      const projectSearch = registeredTools.find((t) => t.name === 'project_search');
      expect(projectSearch).toBeDefined();

      // Empty query should fail validation
      const result = await projectSearch!.execute('test-id', { query: '' }, undefined, undefined);
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('memory_forget candidate list (#1798)', () => {
    it('should include full UUIDs in candidate list, not truncated 8-char IDs', async () => {
      const originalFetch = globalThis.fetch;
      const fullUuid1 = '12345678-1234-1234-1234-123456789012';
      const fullUuid2 = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';

      // Mock fetch to return multiple low-confidence matches (triggers candidate list path)
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { id: fullUuid1, content: 'First memory content', similarity: 0.75 },
            { id: fullUuid2, content: 'Second memory content', similarity: 0.65 },
          ],
        }),
      })) as unknown as typeof fetch;

      try {
        registerOpenClaw(mockApi);

        const memoryForget = registeredTools.find((t) => t.name === 'memory_forget');
        expect(memoryForget).toBeDefined();

        const result = await memoryForget!.execute('test-id', { query: 'test query' }, undefined, undefined);

        // The candidate list text should contain FULL UUIDs so agents can use them for deletion
        expect(result.content[0].text).toContain(fullUuid1);
        expect(result.content[0].text).toContain(fullUuid2);
        // Should NOT contain only the truncated 8-char prefix
        expect(result.content[0].text).not.toMatch(/\[12345678\]/);
        expect(result.content[0].text).not.toMatch(/\[abcdefab\]/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('default export', () => {
    it('should be a function', async () => {
      const { default: defaultExport } = await import('../src/register-openclaw.js');
      expect(typeof defaultExport).toBe('function');
    });

    it('should be the same as registerOpenClaw', async () => {
      const { default: defaultExport, registerOpenClaw: named } = await import('../src/register-openclaw.js');
      expect(defaultExport).toBe(named);
    });
  });
});
