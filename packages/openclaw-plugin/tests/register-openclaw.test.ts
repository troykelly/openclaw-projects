import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { registerOpenClaw, schemas } from '../src/register-openclaw.js'
import type {
  OpenClawPluginApi,
  ToolDefinition,
  HookHandler,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
  PluginHookAgentEndEvent,
  AgentToolResult,
} from '../src/types/openclaw-api.js'

// Mock fs and child_process for secret resolution
vi.mock('node:fs')
vi.mock('node:child_process')

describe('OpenClaw 2026 API Registration', () => {
  let mockApi: OpenClawPluginApi
  let registeredTools: ToolDefinition[]
  let registeredHooks: Map<string, HookHandler>
  let registeredOnHooks: Map<string, Function>
  let cliCallback: ((ctx: { program: unknown }) => void) | null

  beforeEach(() => {
    registeredTools = []
    registeredHooks = new Map()
    registeredOnHooks = new Map()
    cliCallback = null

    mockApi = {
      config: {
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
        registeredTools.push(tool)
      }),
      registerHook: vi.fn((event: string, handler: HookHandler) => {
        registeredHooks.set(event, handler)
      }),
      on: vi.fn((hookName: string, handler: Function) => {
        registeredOnHooks.set(hookName, handler)
      }),
      registerCli: vi.fn((callback: (ctx: { program: unknown }) => void) => {
        cliCallback = callback
      }),
      registerService: vi.fn(),
      registerGatewayMethod: vi.fn(),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('registration', () => {
    it('should register all 19 tools', async () => {
      await registerOpenClaw(mockApi)

      expect(registeredTools).toHaveLength(19)
      const toolNames = registeredTools.map((t) => t.name)
      expect(toolNames).toContain('memory_recall')
      expect(toolNames).toContain('memory_store')
      expect(toolNames).toContain('memory_forget')
      expect(toolNames).toContain('project_list')
      expect(toolNames).toContain('project_get')
      expect(toolNames).toContain('project_create')
      expect(toolNames).toContain('todo_list')
      expect(toolNames).toContain('todo_create')
      expect(toolNames).toContain('todo_complete')
      expect(toolNames).toContain('contact_search')
      expect(toolNames).toContain('contact_get')
      expect(toolNames).toContain('contact_create')
      expect(toolNames).toContain('sms_send')
      expect(toolNames).toContain('email_send')
      expect(toolNames).toContain('message_search')
      expect(toolNames).toContain('thread_list')
      expect(toolNames).toContain('thread_get')
      expect(toolNames).toContain('relationship_set')
      expect(toolNames).toContain('relationship_query')
    })

    it('should register before_agent_start hook via api.on() when autoRecall is true', async () => {
      await registerOpenClaw(mockApi)

      expect(registeredOnHooks.has('before_agent_start')).toBe(true)
      expect(typeof registeredOnHooks.get('before_agent_start')).toBe('function')
    })

    it('should register agent_end hook via api.on() when autoCapture is true', async () => {
      await registerOpenClaw(mockApi)

      expect(registeredOnHooks.has('agent_end')).toBe(true)
      expect(typeof registeredOnHooks.get('agent_end')).toBe('function')
    })

    it('should NOT use legacy registerHook for hooks', async () => {
      await registerOpenClaw(mockApi)

      // Should NOT register hooks via the legacy registerHook method
      expect(registeredHooks.has('beforeAgentStart')).toBe(false)
      expect(registeredHooks.has('agentEnd')).toBe(false)
    })

    it('should not register hooks when disabled', async () => {
      mockApi.config = {
        ...mockApi.config,
        autoRecall: false,
        autoCapture: false,
      }

      await registerOpenClaw(mockApi)

      expect(registeredOnHooks.has('before_agent_start')).toBe(false)
      expect(registeredOnHooks.has('agent_end')).toBe(false)
    })

    it('should register CLI commands', async () => {
      await registerOpenClaw(mockApi)

      expect(cliCallback).not.toBeNull()
    })

    it('should log registration success', async () => {
      await registerOpenClaw(mockApi)

      expect(mockApi.logger.info).toHaveBeenCalledWith(
        'OpenClaw Projects plugin registered',
        expect.objectContaining({
          toolCount: 19,
        })
      )
    })

    it('should fall back to registerHook if api.on is not available', async () => {
      // Simulate older OpenClaw runtime without api.on
      const legacyApi = { ...mockApi }
      delete (legacyApi as Record<string, unknown>).on

      await registerOpenClaw(legacyApi)

      // Should have fallen back to registerHook
      expect(registeredHooks.has('beforeAgentStart')).toBe(true)
      expect(registeredHooks.has('agentEnd')).toBe(true)
    })
  })

  describe('before_agent_start hook behavior', () => {
    it('should use the user prompt from event for semantic search', async () => {
      const fetchCalls: string[] = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            memories: [
              { id: '1', content: 'User prefers sushi', category: 'preference', score: 0.9 },
            ],
          }),
        }
      }) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext
        ) => Promise<PluginHookBeforeAgentStartResult | void>

        expect(hook).toBeDefined()

        // Call the hook with a specific prompt
        const result = await hook(
          { prompt: 'What are my food preferences?' },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )

        // Result should have prependContext (not injectedContext)
        if (result) {
          expect(result).toHaveProperty('prependContext')
          expect(result).not.toHaveProperty('injectedContext')
        }

        // Verify the search API was called with the user's actual prompt
        const memorySearchCalls = fetchCalls.filter((url) => url.includes('/api/memories/search'))
        expect(memorySearchCalls.length).toBeGreaterThan(0)
        expect(memorySearchCalls[0]).toContain('food+preferences')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should return { prependContext } format, not { injectedContext }', async () => {
      // Create a mock that will intercept the fetch
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          memories: [
            { id: '1', content: 'User prefers dark mode', category: 'preference', score: 0.95 },
          ],
        }),
      }) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext
        ) => Promise<PluginHookBeforeAgentStartResult | void>

        const result = await hook(
          { prompt: 'Tell me about my preferences' },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )

        if (result) {
          expect(result).toHaveProperty('prependContext')
          expect(typeof result.prependContext).toBe('string')
          // Must NOT have injectedContext
          expect(result).not.toHaveProperty('injectedContext')
        }
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should pass the actual prompt to the memory search API', async () => {
      const fetchCalls: string[] = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCalls.push(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [] }),
        }
      }) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext
        ) => Promise<PluginHookBeforeAgentStartResult | void>

        await hook(
          { prompt: 'What are my food preferences?' },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )

        // The API call should contain the user's actual prompt, not 'relevant context for this conversation'
        const memorySearchCalls = fetchCalls.filter((url) => url.includes('/api/memories/search'))
        expect(memorySearchCalls.length).toBeGreaterThan(0)

        const searchUrl = memorySearchCalls[0]
        expect(searchUrl).toContain('food+preferences')
        expect(searchUrl).not.toContain('relevant+context+for+this+conversation')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should handle timeout gracefully', async () => {
      const originalFetch = globalThis.fetch
      // Simulate a very slow response that will exceed the hook timeout
      globalThis.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      ) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext
        ) => Promise<PluginHookBeforeAgentStartResult | void>

        // The hook has a 5s internal timeout. The slow fetch will trigger it.
        const result = await hook(
          { prompt: 'Hello' },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )

        // Should return void/undefined on timeout, not throw
        expect(result).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    }, 15000)

    it('should not throw on hook execution errors', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('before_agent_start') as (
          event: PluginHookBeforeAgentStartEvent,
          ctx: PluginHookAgentContext
        ) => Promise<PluginHookBeforeAgentStartResult | void>

        // Should not throw even when network fails
        const result = await hook(
          { prompt: 'Hello' },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )

        expect(result).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    }, 15000)
  })

  describe('agent_end hook behavior', () => {
    it('should accept the correct event payload shape', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ captured: 1 }),
      })) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('agent_end') as (
          event: PluginHookAgentEndEvent,
          ctx: PluginHookAgentContext
        ) => Promise<void>

        expect(hook).toBeDefined()

        // Should not throw with correct payload
        await expect(
          hook(
            {
              messages: [{ role: 'user', content: 'Hello' }],
              success: true,
              durationMs: 1000,
            },
            { agentId: 'agent-1', sessionKey: 'session-1' }
          )
        ).resolves.not.toThrow()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should not throw on empty messages', async () => {
      await registerOpenClaw(mockApi)

      const hook = registeredOnHooks.get('agent_end') as (
        event: PluginHookAgentEndEvent,
        ctx: PluginHookAgentContext
      ) => Promise<void>

      await expect(
        hook(
          { messages: [], success: true },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )
      ).resolves.not.toThrow()
    })

    it('should call context capture API with conversation data', async () => {
      const fetchCalls: { url: string; body: string }[] = []
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, body: init?.body as string || '' })
        return {
          ok: true,
          status: 200,
          json: async () => ({ captured: 1 }),
        }
      }) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const hook = registeredOnHooks.get('agent_end') as (
          event: PluginHookAgentEndEvent,
          ctx: PluginHookAgentContext
        ) => Promise<void>

        await hook(
          {
            messages: [
              { role: 'user', content: 'Remember I prefer dark mode' },
              { role: 'assistant', content: 'Noted, you prefer dark mode.' },
            ],
            success: true,
            durationMs: 5000,
          },
          { agentId: 'agent-1', sessionKey: 'session-1' }
        )

        // Should have made a capture API call
        const captureCalls = fetchCalls.filter((c) => c.url.includes('/api/context/capture'))
        expect(captureCalls.length).toBeGreaterThan(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('tool definitions', () => {
    it('should have valid JSON Schema for all tools', async () => {
      await registerOpenClaw(mockApi)

      for (const tool of registeredTools) {
        expect(tool.parameters).toBeDefined()
        expect(tool.parameters.type).toBe('object')
        expect(tool.description).toBeDefined()
        expect(tool.description.length).toBeGreaterThan(10)
      }
    })

    it('should have required properties marked correctly', async () => {
      await registerOpenClaw(mockApi)

      const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall')
      expect(memoryRecall?.parameters.required).toContain('query')

      const projectGet = registeredTools.find((t) => t.name === 'project_get')
      expect(projectGet?.parameters.required).toContain('projectId')

      const contactCreate = registeredTools.find((t) => t.name === 'contact_create')
      expect(contactCreate?.parameters.required).toContain('name')

      const relationshipSet = registeredTools.find((t) => t.name === 'relationship_set')
      expect(relationshipSet?.parameters.required).toContain('contact_a')
      expect(relationshipSet?.parameters.required).toContain('contact_b')
      expect(relationshipSet?.parameters.required).toContain('relationship')

      const relationshipQuery = registeredTools.find((t) => t.name === 'relationship_query')
      expect(relationshipQuery?.parameters.required).toContain('contact')
    })

    it('should have executable functions', async () => {
      await registerOpenClaw(mockApi)

      for (const tool of registeredTools) {
        expect(typeof tool.execute).toBe('function')
      }
    })

    it('should have execute functions with correct OpenClaw Gateway signature', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          memories: [{ id: '1', content: 'test', category: 'fact', score: 0.9 }],
        }),
      })) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall')
        expect(memoryRecall).toBeDefined()

        // Call execute with the correct OpenClaw Gateway signature:
        // (toolCallId: string, params: T, signal?: AbortSignal, onUpdate?: (partial: any) => void) => AgentToolResult
        const result = await memoryRecall!.execute(
          'test-tool-call-id',
          { query: 'test query' },
          undefined,
          undefined
        )

        // Result should be AgentToolResult format: { content: [{ type: "text", text: "..." }] }
        expect(result).toHaveProperty('content')
        expect(Array.isArray(result.content)).toBe(true)
        expect(result.content.length).toBeGreaterThan(0)
        expect(result.content[0]).toHaveProperty('type', 'text')
        expect(result.content[0]).toHaveProperty('text')
        expect(typeof result.content[0].text).toBe('string')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should return AgentToolResult format for errors', async () => {
      // First, register with a working fetch to get the plugin set up
      const originalFetch = globalThis.fetch

      // Use a mock config without retries
      mockApi.config = {
        ...mockApi.config,
        maxRetries: 0,  // Disable retries
      }

      // Mock that returns a client error (no retries on 4xx)
      globalThis.fetch = vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad request', message: 'Invalid query' }),
      })) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall')
        expect(memoryRecall).toBeDefined()

        // Call with toolCallId as first argument
        const result = await memoryRecall!.execute(
          'error-test-id',
          { query: 'test' },
          undefined,
          undefined
        )

        // Even errors should return AgentToolResult format
        expect(result).toHaveProperty('content')
        expect(Array.isArray(result.content)).toBe(true)
        expect(result.content[0]).toHaveProperty('type', 'text')
        expect(result.content[0]).toHaveProperty('text')
        // Error text should contain "Error"
        expect(result.content[0].text).toContain('Error')
      } finally {
        globalThis.fetch = originalFetch
      }
    }, 10000)

    it('should NOT receive toolCallId as params (bug that was fixed)', async () => {
      const originalFetch = globalThis.fetch
      let receivedParams: Record<string, unknown> | undefined

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        // Extract query params to verify what was sent
        const urlObj = new URL(url)
        const queryParam = urlObj.searchParams.get('q')
        receivedParams = { query: queryParam }
        return {
          ok: true,
          status: 200,
          json: async () => ({ memories: [] }),
        }
      }) as unknown as typeof fetch

      try {
        await registerOpenClaw(mockApi)

        const memoryRecall = registeredTools.find((t) => t.name === 'memory_recall')
        expect(memoryRecall).toBeDefined()

        // Call with toolCallId as first arg, params as second
        await memoryRecall!.execute(
          'my-tool-call-id',
          { query: 'actual search query' },
          undefined,
          undefined
        )

        // The query should be 'actual search query', NOT 'my-tool-call-id'
        expect(receivedParams?.query).toBe('actual search query')
        expect(receivedParams?.query).not.toBe('my-tool-call-id')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('JSON Schemas export', () => {
    it('should export all tool schemas', () => {
      expect(schemas.memoryRecall).toBeDefined()
      expect(schemas.memoryStore).toBeDefined()
      expect(schemas.memoryForget).toBeDefined()
      expect(schemas.projectList).toBeDefined()
      expect(schemas.projectGet).toBeDefined()
      expect(schemas.projectCreate).toBeDefined()
      expect(schemas.todoList).toBeDefined()
      expect(schemas.todoCreate).toBeDefined()
      expect(schemas.todoComplete).toBeDefined()
      expect(schemas.contactSearch).toBeDefined()
      expect(schemas.contactGet).toBeDefined()
      expect(schemas.contactCreate).toBeDefined()
      expect(schemas.smsSend).toBeDefined()
      expect(schemas.emailSend).toBeDefined()
      expect(schemas.messageSearch).toBeDefined()
      expect(schemas.threadList).toBeDefined()
      expect(schemas.threadGet).toBeDefined()
      expect(schemas.relationshipSet).toBeDefined()
      expect(schemas.relationshipQuery).toBeDefined()
    })

    it('should have valid schema structure', () => {
      for (const schema of Object.values(schemas)) {
        expect(schema.type).toBe('object')
        expect(schema.properties).toBeDefined()
      }
    })
  })

  describe('default export', () => {
    it('should be a function', async () => {
      const { default: defaultExport } = await import('../src/register-openclaw.js')
      expect(typeof defaultExport).toBe('function')
    })

    it('should be the same as registerOpenClaw', async () => {
      const { default: defaultExport, registerOpenClaw: named } = await import(
        '../src/register-openclaw.js'
      )
      expect(defaultExport).toBe(named)
    })
  })
})
