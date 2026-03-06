/**
 * Contract tests for toAgentToolResult (#2230).
 *
 * Validates that toAgentToolResult ALWAYS produces well-formed AgentToolResult
 * objects regardless of what tool handlers return. Uses the same Zod schema
 * used at runtime, so test failures here mean runtime failures are impossible.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AgentToolResultSchema,
  toAgentToolResult,
} from '../src/register-openclaw.js';

describe('AgentToolResultSchema is exported and validates correctly', () => {
  it('accepts a well-formed AgentToolResult', () => {
    const good = { content: [{ type: 'text' as const, text: 'hello' }] };
    expect(() => AgentToolResultSchema.parse(good)).not.toThrow();
  });

  it('rejects a content block with missing text', () => {
    const bad = { content: [{ type: 'text' }] };
    expect(() => AgentToolResultSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('rejects a content block with empty text', () => {
    const bad = { content: [{ type: 'text', text: '' }] };
    expect(() => AgentToolResultSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('rejects empty content array', () => {
    const bad = { content: [] };
    expect(() => AgentToolResultSchema.parse(bad)).toThrow(z.ZodError);
  });
});

describe('toAgentToolResult contract: per-family fixtures (#2230)', () => {
  // Category A: Structured data WITHOUT content field (the crash scenario)
  const structuredFixtures: Array<{ name: string; data: Record<string, unknown> }> = [
    {
      name: 'note_create',
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'My Note',
        notebook_id: null,
        visibility: 'private',
        created_at: '2026-03-06T00:00:00Z',
      },
    },
    {
      name: 'notebook_list',
      data: {
        notebooks: [
          { id: 'nb-1', name: 'Work', description: null, is_archived: false, note_count: 3 },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      },
    },
    {
      name: 'note_search (no content)',
      data: {
        notes: [{ id: 'n-1', title: 'Found', snippet: 'some text', score: 0.95 }],
        total: 1,
      },
    },
    {
      name: 'skill_store_get',
      data: {
        id: 'sk-1',
        collection: 'tools',
        key: 'greeting',
        value: { template: 'Hello {{name}}' },
        metadata: { version: 2 },
      },
    },
    {
      name: 'terminal_session_start',
      data: {
        session_id: 'sess-abc',
        connection_id: 'conn-1',
        status: 'active',
        created_at: '2026-03-06T00:00:00Z',
      },
    },
    {
      name: 'entity_link_set',
      data: {
        id: 'link-1',
        source_type: 'contact',
        source_id: 'c-1',
        target_type: 'project',
        target_id: 'p-1',
      },
    },
    {
      name: 'api_get',
      data: {
        id: 'api-1',
        name: 'Weather API',
        base_url: 'https://api.weather.com',
        status: 'active',
      },
    },
  ];

  // Category B: Hybrid data WITH content field
  const hybridFixtures: Array<{ name: string; data: Record<string, unknown> }> = [
    {
      name: 'contact_search',
      data: {
        content: '- John Doe <john@example.com>',
        details: {
          contacts: [{ id: 'c-1', name: 'John Doe', email: 'john@example.com' }],
          total: 1,
          user_id: 'u-1',
        },
      },
    },
    {
      name: 'todo_list',
      data: {
        content: '- [ ] Buy milk\n- [x] Call mom',
        details: {
          todos: [
            { id: 't-1', title: 'Buy milk', completed: false },
            { id: 't-2', title: 'Call mom', completed: true },
          ],
          total: 2,
          user_id: 'u-1',
        },
      },
    },
    {
      name: 'memory_store',
      data: {
        content: 'Stored memory [preference]: "loves coffee"',
        details: {
          id: 'm-1',
          category: 'preference',
          importance: 7,
          tags: ['food'],
          user_id: 'u-1',
        },
      },
    },
    {
      name: 'context_search',
      data: {
        content: 'Found 3 results across notes, todos, and contacts',
        details: {
          count: 3,
          results: [{ type: 'note', id: 'n-1', title: 'Coffee notes', score: 0.9 }],
          user_id: 'u-1',
        },
      },
    },
    {
      name: 'dev_prompt_get',
      data: {
        content: '# System Prompt\nYou are a helpful assistant.',
        details: {
          prompt_key: 'system',
          title: 'System Prompt',
          category: 'system',
          is_system: true,
          rendered: true,
        },
      },
    },
  ];

  describe('structured data (no content field) — the original crash scenario', () => {
    it.each(structuredFixtures)('$name produces valid AgentToolResult', ({ data }) => {
      const result = toAgentToolResult({ success: true, data } as any);
      expect(() => AgentToolResultSchema.parse(result)).not.toThrow();
      // The text should be the JSON-serialized data
      expect(result.content[0].text).toBe(JSON.stringify(data));
    });
  });

  describe('hybrid data (with content field)', () => {
    it.each(hybridFixtures)('$name produces valid AgentToolResult', ({ data }) => {
      const result = toAgentToolResult({ success: true, data } as any);
      expect(() => AgentToolResultSchema.parse(result)).not.toThrow();
      // The text should use the content field directly
      expect(result.content[0].text).toBe(data.content);
    });
  });
});
