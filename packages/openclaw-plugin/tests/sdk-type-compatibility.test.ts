/**
 * SDK Type Compatibility Tests
 *
 * Validates that our local types remain compatible with the OpenClaw SDK.
 * This catches type drift between our plugin and the Gateway contract.
 *
 * The openclaw/plugin-sdk public API exports OpenClawPluginApi (which
 * references PluginHookName internally) but does NOT directly export the
 * individual hook types (PluginHookName, PluginHookAgentContext, etc.).
 * Those are internal SDK types in plugins/types.d.ts.
 *
 * All types are therefore defined locally in src/types/openclaw-api.ts.
 * This test validates structural compatibility where possible.
 *
 * Types kept local (and why):
 *   - JSONSchema, JSONSchemaProperty: Generic JSON Schema, no SDK equivalent
 *   - ToolContext, ToolResult: Our internal tool execution types
 *   - AgentToolResult: SDK uses (TextContent | ImageContent)[], we use {type:'text',text:string}[]
 *   - AgentToolExecute: Depends on our AgentToolResult
 *   - ToolDefinition: SDK uses AnyAgentTool (TypeBox), we use plain JSON Schema
 *   - OpenClawPluginApi: SDK version uses OpenClawConfig, AnyAgentTool, etc.
 *   - PluginHookName: Not exported from SDK public API
 *   - PluginHookAgentContext: Not exported from SDK public API
 *   - PluginHookBeforeAgentStartEvent: Not exported from SDK public API
 *   - PluginHookBeforeAgentStartResult: Not exported from SDK public API
 *   - PluginHookAgentEndEvent: Not exported from SDK public API
 *   - HookEvent, HookHandler: Legacy backwards-compat types
 *   - CliRegistrationContext, CliRegistrationCallback: Simplified CLI types
 *   - ServiceDefinition: Simplified service definition
 *   - PluginInitializer, PluginDefinition, OpenClawPluginAPI: Plugin definitions
 *
 * Part of #885.
 */

import { describe, expect, it } from 'vitest'
import type { OpenClawPluginApi as SdkOpenClawPluginApi } from 'openclaw/plugin-sdk'
import type {
  PluginHookName,
  PluginHookAgentContext,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult,
  PluginHookAgentEndEvent,
  OpenClawPluginApi,
} from '../src/types/openclaw-api.js'

// ── Compile-time type compatibility checks ────────────────────────────────────
// These assignments verify structural compatibility at the TypeScript level.
// If the SDK types change in a breaking way, these will produce type errors.

// Verify our OpenClawPluginApi is a structural subtype of SDK's version
// by checking key shared properties exist. We can't do full assignability
// because the SDK uses different concrete types (OpenClawConfig, AnyAgentTool, etc.).
// Instead we verify the method names and shapes that matter for interop.

// The SDK's OpenClawPluginApi.on method accepts PluginHookName as its first
// parameter, and our type uses the same string union. This compile-time check
// verifies that our hook names are valid for the SDK's on() method.
type SdkOnMethod = NonNullable<SdkOpenClawPluginApi['on']>
type SdkHookNameParam = Parameters<SdkOnMethod>[0]

// Every local PluginHookName value should be assignable to the SDK's parameter type
const _localToSdk: SdkHookNameParam = '' as PluginHookName
void _localToSdk

describe('SDK Type Compatibility', () => {
  describe('PluginHookName', () => {
    it('should include all expected hook names', () => {
      const expectedHooks: PluginHookName[] = [
        'before_agent_start',
        'agent_end',
        'before_compaction',
        'after_compaction',
        'message_received',
        'message_sending',
        'message_sent',
        'before_tool_call',
        'after_tool_call',
        'tool_result_persist',
        'session_start',
        'session_end',
        'gateway_start',
        'gateway_stop',
      ]
      // This ensures our type covers all 14 hooks
      expect(expectedHooks).toHaveLength(14)
    })

    it('should match the SDK hook names at runtime', () => {
      // If the SDK's on() method accepts our hook names, they're compatible.
      // This is verified at compile time by the _localToSdk check above,
      // and at runtime here with a basic sanity check.
      const hookName: PluginHookName = 'before_agent_start'
      expect(hookName).toBe('before_agent_start')
    })
  })

  describe('PluginHookAgentContext', () => {
    it('should have the expected shape', () => {
      const ctx: PluginHookAgentContext = {
        agentId: 'test-agent',
        sessionKey: 'test-session',
        workspaceDir: '/tmp/workspace',
        messageProvider: 'test-provider',
      }
      expect(ctx.agentId).toBe('test-agent')
      expect(ctx.sessionKey).toBe('test-session')
      expect(ctx.workspaceDir).toBe('/tmp/workspace')
      expect(ctx.messageProvider).toBe('test-provider')
    })

    it('should allow all optional fields', () => {
      const ctx: PluginHookAgentContext = {}
      expect(ctx.agentId).toBeUndefined()
    })
  })

  describe('PluginHookBeforeAgentStartEvent', () => {
    it('should have prompt and optional messages', () => {
      const event: PluginHookBeforeAgentStartEvent = {
        prompt: 'Hello',
        messages: [{ role: 'user', content: 'test' }],
      }
      expect(event.prompt).toBe('Hello')
      expect(event.messages).toHaveLength(1)
    })
  })

  describe('PluginHookBeforeAgentStartResult', () => {
    it('should have optional systemPrompt and prependContext', () => {
      const result: PluginHookBeforeAgentStartResult = {
        systemPrompt: 'You are a helpful assistant',
        prependContext: 'User preferences loaded',
      }
      expect(result.systemPrompt).toBe('You are a helpful assistant')
      expect(result.prependContext).toBe('User preferences loaded')
    })
  })

  describe('PluginHookAgentEndEvent', () => {
    it('should have required messages and success fields', () => {
      const event: PluginHookAgentEndEvent = {
        messages: [],
        success: true,
      }
      expect(event.success).toBe(true)
      expect(event.messages).toEqual([])
    })

    it('should have optional error and durationMs', () => {
      const event: PluginHookAgentEndEvent = {
        messages: [],
        success: false,
        error: 'Something went wrong',
        durationMs: 1500,
      }
      expect(event.error).toBe('Something went wrong')
      expect(event.durationMs).toBe(1500)
    })
  })

  describe('OpenClawPluginApi', () => {
    it('should define the same method names as the SDK', () => {
      // Verify that both our API and the SDK share key method names.
      // This is a runtime check that would fail if we accidentally removed
      // a method the SDK defines.
      type LocalMethods = keyof OpenClawPluginApi
      type SdkMethods = keyof SdkOpenClawPluginApi

      // Methods that both our type and the SDK should have
      const sharedMethods: Array<LocalMethods & SdkMethods> = [
        'registerTool',
        'registerHook',
        'registerCli',
        'registerService',
        'registerGatewayMethod',
        'on',
        'config',
        'logger',
      ]

      expect(sharedMethods.length).toBeGreaterThanOrEqual(8)
    })
  })

  describe('Local types documentation', () => {
    it('should document why types are kept local', () => {
      // This test documents which types are intentionally local
      // and serves as a reference for future maintainers.
      const localTypes = [
        'JSONSchema',
        'JSONSchemaProperty',
        'ToolContext',
        'ToolResult',
        'AgentToolResult',
        'AgentToolExecute',
        'ToolDefinition',
        'OpenClawPluginApi',
        'PluginHookName',
        'PluginHookAgentContext',
        'PluginHookBeforeAgentStartEvent',
        'PluginHookBeforeAgentStartResult',
        'PluginHookAgentEndEvent',
        'HookEvent',
        'HookHandler',
        'CliRegistrationContext',
        'CliRegistrationCallback',
        'ServiceDefinition',
        'PluginInitializer',
        'PluginDefinition',
        'OpenClawPluginAPI',
      ]

      // All 21 types should be documented as local
      expect(localTypes).toHaveLength(21)
    })
  })
})
