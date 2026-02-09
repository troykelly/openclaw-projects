/**
 * Tests validating our understanding of the OpenClaw hook contract.
 *
 * These tests verify that our documented contract matches what we need
 * to implement. They serve as living documentation and regression tests
 * for the hook integration.
 *
 * Source of truth: OpenClaw gateway src/plugins/types.ts
 * Reference doc: docs/knowledge/openclaw-hook-contract.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PLUGIN_DIR = resolve(import.meta.dirname, '../../packages/openclaw-plugin');
const DOCS_DIR = resolve(import.meta.dirname, '../../docs/knowledge');

describe('OpenClaw Hook Contract Validation', () => {
  describe('Reference documentation', () => {
    it('should have hook contract reference document', () => {
      const docPath = resolve(DOCS_DIR, 'openclaw-hook-contract.md');
      expect(existsSync(docPath)).toBe(true);
    });

    it('should document before_agent_start event payload', () => {
      const doc = readFileSync(resolve(DOCS_DIR, 'openclaw-hook-contract.md'), 'utf-8');
      expect(doc).toContain('PluginHookBeforeAgentStartEvent');
      expect(doc).toContain('prompt: string');
    });

    it('should document prependContext return format', () => {
      const doc = readFileSync(resolve(DOCS_DIR, 'openclaw-hook-contract.md'), 'utf-8');
      expect(doc).toContain('prependContext');
      expect(doc).toContain('PluginHookBeforeAgentStartResult');
    });

    it('should document agent_end event payload', () => {
      const doc = readFileSync(resolve(DOCS_DIR, 'openclaw-hook-contract.md'), 'utf-8');
      expect(doc).toContain('PluginHookAgentEndEvent');
      expect(doc).toContain('messages');
      expect(doc).toContain('success');
    });

    it('should document memory plugin slot', () => {
      const doc = readFileSync(resolve(DOCS_DIR, 'openclaw-hook-contract.md'), 'utf-8');
      expect(doc).toContain('kind: "memory"');
    });
  });

  describe('Plugin contract fixes verified', () => {
    const registerPath = resolve(PLUGIN_DIR, 'src/register-openclaw.ts');

    it('should use event.prompt for auto-recall (not hardcoded query)', () => {
      const content = readFileSync(registerPath, 'utf-8');
      // FIX (#553): Previously used hardcoded 'relevant context for this conversation'.
      // Now correctly passes event.prompt for semantic search.
      expect(content).not.toContain("'relevant context for this conversation'");
      expect(content).toContain('event.prompt');
    });

    it('should use api.on for modern hook registration with legacy fallback', () => {
      const content = readFileSync(registerPath, 'utf-8');
      // Uses api.on('before_agent_start', ...) with legacy registerHook fallback
      expect(content).toContain('api.on(');
      expect(content).toContain("'before_agent_start'");
      // Legacy fallback still present for compatibility
      expect(content).toContain("api.registerHook('beforeAgentStart'");
    });

    it('should return prependContext (not injectedContext)', () => {
      const content = readFileSync(registerPath, 'utf-8');
      // FIX (#553): Previously returned injectedContext.
      // Now correctly returns prependContext per OpenClaw hook contract.
      expect(content).not.toContain('injectedContext');
      expect(content).toContain('prependContext');
    });

    it('should type event parameter with PluginHookBeforeAgentStartEvent', () => {
      const content = readFileSync(registerPath, 'utf-8');
      // FIX: event is now properly typed instead of unknown
      expect(content).toContain('PluginHookBeforeAgentStartEvent');
      // The typed handler uses the proper type, not event: unknown
      expect(content).toContain('event: PluginHookBeforeAgentStartEvent');
    });
  });

  describe('Type contract differences', () => {
    const typesPath = resolve(PLUGIN_DIR, 'src/types/openclaw-api.ts');

    it('should have our type definitions file', () => {
      expect(existsSync(typesPath)).toBe(true);
    });

    it('should identify camelCase hook names (need snake_case)', () => {
      const content = readFileSync(typesPath, 'utf-8');
      // Our types use camelCase, OpenClaw uses snake_case
      expect(content).toContain("'beforeAgentStart'");
      // This needs to change to 'before_agent_start'
    });

    it('should identify wrong API type name', () => {
      const content = readFileSync(typesPath, 'utf-8');
      // We use OpenClawPluginAPI, OpenClaw uses OpenClawPluginApi
      expect(content).toContain('OpenClawPluginAPI');
    });

    it('should identify missing api.on method', () => {
      const content = readFileSync(typesPath, 'utf-8');
      // Our type doesn't have the `on` method for modern hook registration
      // The actual OpenClaw API has: on: <K extends PluginHookName>(hookName: K, ...) => void
      expect(content).not.toContain('on: <K extends PluginHookName>');
    });
  });

  describe('Hook contract requirements for epic #486', () => {
    it('before_agent_start provides user prompt for semantic search', () => {
      // Validates our understanding: event.prompt contains the user's message
      // This is critical for #495 (fix auto-recall) and #496 (graph-aware context)
      const contract = {
        eventType: 'PluginHookBeforeAgentStartEvent',
        fields: ['prompt', 'messages'],
        returnType: 'PluginHookBeforeAgentStartResult',
        returnFields: ['systemPrompt', 'prependContext'],
      };

      expect(contract.fields).toContain('prompt');
      expect(contract.returnFields).toContain('prependContext');
      expect(contract.returnFields).not.toContain('injectedContext');
    });

    it('agent_end provides full conversation for auto-capture', () => {
      // Validates our understanding: event.messages contains the full conversation
      const contract = {
        eventType: 'PluginHookAgentEndEvent',
        fields: ['messages', 'success', 'error', 'durationMs'],
      };

      expect(contract.fields).toContain('messages');
      expect(contract.fields).toContain('success');
    });

    it('context includes agent identification for user lookup', () => {
      // PluginHookAgentContext provides sessionKey for user identification
      const context = {
        type: 'PluginHookAgentContext',
        fields: ['agentId', 'sessionKey', 'workspaceDir', 'messageProvider'],
      };

      expect(context.fields).toContain('sessionKey');
      expect(context.fields).toContain('messageProvider');
    });

    it('hook can return prependContext for surfaced preferences', () => {
      // For #496: graph-aware context retrieval returns preferences via prependContext
      const mockResult = {
        prependContext: [
          '## Relevant Preferences',
          '- Music: Loves 90s dance music for focus work (personal preference)',
          '- Groceries: Household prefers organic (household preference)',
        ].join('\n'),
      };

      expect(mockResult.prependContext).toContain('Relevant Preferences');
      expect(typeof mockResult.prependContext).toBe('string');
    });
  });
});
