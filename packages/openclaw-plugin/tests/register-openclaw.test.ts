import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { registerOpenClaw, schemas } from '../src/register-openclaw.js'
import type { OpenClawPluginAPI, ToolDefinition, HookHandler } from '../src/types/openclaw-api.js'

// Mock fs and child_process for secret resolution
vi.mock('node:fs')
vi.mock('node:child_process')

describe('OpenClaw 2026 API Registration', () => {
  let mockApi: OpenClawPluginAPI
  let registeredTools: ToolDefinition[]
  let registeredHooks: Map<string, HookHandler>
  let cliCallback: ((ctx: { program: unknown }) => void) | null

  beforeEach(() => {
    registeredTools = []
    registeredHooks = new Map()
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
    it('should register all 15 tools', async () => {
      await registerOpenClaw(mockApi)

      expect(registeredTools).toHaveLength(15)
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
    })

    it('should register beforeAgentStart hook when autoRecall is true', async () => {
      await registerOpenClaw(mockApi)

      expect(registeredHooks.has('beforeAgentStart')).toBe(true)
    })

    it('should register agentEnd hook when autoCapture is true', async () => {
      await registerOpenClaw(mockApi)

      expect(registeredHooks.has('agentEnd')).toBe(true)
    })

    it('should not register hooks when disabled', async () => {
      mockApi.config = {
        ...mockApi.config,
        autoRecall: false,
        autoCapture: false,
      }

      await registerOpenClaw(mockApi)

      expect(registeredHooks.has('beforeAgentStart')).toBe(false)
      expect(registeredHooks.has('agentEnd')).toBe(false)
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
          toolCount: 15,
        })
      )
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
    })

    it('should have executable functions', async () => {
      await registerOpenClaw(mockApi)

      for (const tool of registeredTools) {
        expect(typeof tool.execute).toBe('function')
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
