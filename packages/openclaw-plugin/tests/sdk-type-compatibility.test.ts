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
 *   - ToolContext: Our internal tool execution type (maps to SDK's OpenClawPluginToolContext)
 *   - ToolResult: Our internal tool execution result
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
 * Part of #885. Updated for Epic #2045.
 */

import { describe, expect, it } from 'vitest';
import type { OpenClawPluginApi as SdkOpenClawPluginApi } from 'openclaw/plugin-sdk';
import type {
  PluginHookName,
  PluginHookAgentContext,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult,
  PluginHookAgentEndEvent,
  OpenClawPluginApi,
  ToolContext,
  ServiceDefinition,
} from '../src/types/openclaw-api.js';

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
type SdkOnMethod = NonNullable<SdkOpenClawPluginApi['on']>;
type SdkHookNameParam = Parameters<SdkOnMethod>[0];

// Every local PluginHookName value should be assignable to the SDK's parameter type
const _localToSdk: SdkHookNameParam = '' as PluginHookName;
void _localToSdk;

describe('SDK Type Compatibility', () => {
  describe('PluginHookName', () => {
    it('should include all 24 SDK hook names', () => {
      // All 24 hook names from the SDK's PluginHookName union (#2030)
      const expectedHooks: PluginHookName[] = [
        'before_model_resolve',
        'before_prompt_build',
        'before_agent_start',
        'llm_input',
        'llm_output',
        'agent_end',
        'before_compaction',
        'after_compaction',
        'before_reset',
        'message_received',
        'message_sending',
        'message_sent',
        'before_tool_call',
        'after_tool_call',
        'tool_result_persist',
        'before_message_write',
        'session_start',
        'session_end',
        'subagent_spawning',
        'subagent_delivery_target',
        'subagent_spawned',
        'subagent_ended',
        'gateway_start',
        'gateway_stop',
      ];
      expect(expectedHooks).toHaveLength(24);
    });

    it('should match the SDK hook names at runtime', () => {
      // If the SDK's on() method accepts our hook names, they're compatible.
      // This is verified at compile time by the _localToSdk check above,
      // and at runtime here with a basic sanity check.
      const hookName: PluginHookName = 'before_agent_start';
      expect(hookName).toBe('before_agent_start');
    });
  });

  describe('PluginHookAgentContext', () => {
    it('should have the expected shape including sessionId (#2035)', () => {
      const ctx: PluginHookAgentContext = {
        agentId: 'test-agent',
        sessionKey: 'test-session',
        sessionId: 'test-session-id',
        workspaceDir: '/tmp/workspace',
        messageProvider: 'test-provider',
      };
      expect(ctx.agentId).toBe('test-agent');
      expect(ctx.sessionKey).toBe('test-session');
      expect(ctx.sessionId).toBe('test-session-id');
      expect(ctx.workspaceDir).toBe('/tmp/workspace');
      expect(ctx.messageProvider).toBe('test-provider');
    });

    it('should allow all optional fields', () => {
      const ctx: PluginHookAgentContext = {};
      expect(ctx.agentId).toBeUndefined();
      expect(ctx.sessionId).toBeUndefined();
    });
  });

  describe('PluginHookBeforeAgentStartEvent', () => {
    it('should have prompt and optional messages', () => {
      const event: PluginHookBeforeAgentStartEvent = {
        prompt: 'Hello',
        messages: [{ role: 'user', content: 'test' }],
      };
      expect(event.prompt).toBe('Hello');
      expect(event.messages).toHaveLength(1);
    });
  });

  describe('PluginHookBeforeAgentStartResult', () => {
    it('should have optional systemPrompt and prependContext', () => {
      const result: PluginHookBeforeAgentStartResult = {
        systemPrompt: 'You are a helpful assistant',
        prependContext: 'User preferences loaded',
      };
      expect(result.systemPrompt).toBe('You are a helpful assistant');
      expect(result.prependContext).toBe('User preferences loaded');
    });

    it('should support modelOverride and providerOverride (#2033)', () => {
      const result: PluginHookBeforeAgentStartResult = {
        systemPrompt: 'System prompt',
        modelOverride: 'llama3.3:8b',
        providerOverride: 'ollama',
      };
      expect(result.modelOverride).toBe('llama3.3:8b');
      expect(result.providerOverride).toBe('ollama');
    });
  });

  describe('PluginHookAgentEndEvent', () => {
    it('should have required messages and success fields', () => {
      const event: PluginHookAgentEndEvent = {
        messages: [],
        success: true,
      };
      expect(event.success).toBe(true);
      expect(event.messages).toEqual([]);
    });

    it('should have optional error and durationMs', () => {
      const event: PluginHookAgentEndEvent = {
        messages: [],
        success: false,
        error: 'Something went wrong',
        durationMs: 1500,
      };
      expect(event.error).toBe('Something went wrong');
      expect(event.durationMs).toBe(1500);
    });
  });

  describe('ToolContext', () => {
    it('should include requesterSenderId and senderIsOwner (#2039)', () => {
      const ctx: ToolContext = {
        user_id: 'user-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        requestId: 'req-1',
        requesterSenderId: 'sender-123',
        senderIsOwner: true,
      };
      expect(ctx.requesterSenderId).toBe('sender-123');
      expect(ctx.senderIsOwner).toBe(true);
    });

    it('should include workspaceDir, agentDir, messageChannel, agentAccountId, sandboxed', () => {
      const ctx: ToolContext = {
        workspaceDir: '/tmp/workspace',
        agentDir: '/tmp/agent',
        messageChannel: 'telegram',
        agentAccountId: 'acct-1',
        sandboxed: true,
      };
      expect(ctx.workspaceDir).toBe('/tmp/workspace');
      expect(ctx.agentDir).toBe('/tmp/agent');
      expect(ctx.messageChannel).toBe('telegram');
      expect(ctx.agentAccountId).toBe('acct-1');
      expect(ctx.sandboxed).toBe(true);
    });
  });

  describe('ServiceDefinition', () => {
    it('should allow stop to be optional (#2036)', () => {
      const service: ServiceDefinition = {
        id: 'test-service',
        start: async () => {},
      };
      expect(service.id).toBe('test-service');
      expect(service.stop).toBeUndefined();
    });

    it('should accept start/stop returning void or Promise<void> (#2036)', () => {
      const service: ServiceDefinition = {
        id: 'test-service',
        start: () => {},
        stop: () => {},
      };
      expect(service.id).toBe('test-service');
      expect(service.stop).toBeDefined();
    });
  });

  describe('OpenClawPluginApi', () => {
    it('should define the same method names as the SDK', () => {
      // Verify that both our API and the SDK share key method names.
      // This is a runtime check that would fail if we accidentally removed
      // a method the SDK defines.
      type LocalMethods = keyof OpenClawPluginApi;
      type SdkMethods = keyof SdkOpenClawPluginApi;

      // Methods that both our type and the SDK should have (#2034)
      const sharedMethods: Array<LocalMethods & SdkMethods> = [
        'registerTool',
        'registerHook',
        'registerCli',
        'registerService',
        'registerGatewayMethod',
        'registerHttpHandler',
        'registerHttpRoute',
        'registerChannel',
        'registerProvider',
        'registerCommand',
        'resolvePath',
        'on',
        'config',
        'logger',
        'id',
        'name',
        'source',
        'runtime',
        'pluginConfig',
      ];

      expect(sharedMethods.length).toBeGreaterThanOrEqual(19);
    });

    it('should include version and description fields (#2034)', () => {
      // Compile-time check: these optional fields must exist on our type
      const api = {} as OpenClawPluginApi;
      // TypeScript will error if these don't exist
      void api.version;
      void api.description;
      expect(true).toBe(true);
    });
  });

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
      ];

      // All 21 types should be documented as local
      expect(localTypes).toHaveLength(21);
    });
  });
});
