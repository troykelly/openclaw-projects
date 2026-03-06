/**
 * Tests for toAgentToolResult conversion (#2220, #2228).
 *
 * Verifies that tool results with different data shapes are always
 * converted to well-formed AgentToolResult objects (content field
 * must never contain undefined text).
 */

import { describe, expect, it } from 'vitest';

// toAgentToolResult is not currently exported — we import it once it is.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { toAgentToolResult } from '../src/register-openclaw.js';

describe('toAgentToolResult (#2220, #2228)', () => {
  it('converts a standard ToolResult with data.content', () => {
    const result = {
      success: true,
      data: { content: 'Note created successfully' },
    };
    const agent = toAgentToolResult(result);
    expect(agent.content).toHaveLength(1);
    expect(agent.content[0].type).toBe('text');
    expect(agent.content[0].text).toBe('Note created successfully');
  });

  it('converts an error result to well-formed AgentToolResult', () => {
    const result = {
      success: false,
      error: 'Failed to create note',
    };
    const agent = toAgentToolResult(result);
    expect(agent.content).toHaveLength(1);
    expect(agent.content[0].text).toBe('Error: Failed to create note');
    expect(agent.isError).toBe(true);
  });

  it('converts an error result with undefined error to a fallback message', () => {
    const result = { success: false } as { success: boolean; error?: string };
    const agent = toAgentToolResult(result);
    expect(agent.content[0].text).toBe('Error: An unexpected error occurred');
    expect(agent.isError).toBe(true);
  });

  it('handles note-tool-shaped success data (no .content field) without undefined text (#2220)', () => {
    // NoteCreateSuccess: { success: true, data: { id, title, ... } }
    const result = {
      success: true,
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'My Note',
        notebook_id: null,
        visibility: 'private',
        created_at: '2026-03-06T00:00:00Z',
      },
    };
    const agent = toAgentToolResult(result as any);
    expect(agent.content).toHaveLength(1);
    expect(agent.content[0].text).toBeDefined();
    expect(typeof agent.content[0].text).toBe('string');
    expect(agent.content[0].text.length).toBeGreaterThan(0);
    // Should contain the data as JSON
    expect(JSON.parse(agent.content[0].text)).toEqual(result.data);
  });

  it('handles success result with data but content is not a string', () => {
    const result = {
      success: true,
      data: { content: 42, other: 'field' },
    };
    const agent = toAgentToolResult(result as any);
    expect(agent.content[0].text).toBeDefined();
    expect(typeof agent.content[0].text).toBe('string');
  });

  it('never produces content with undefined text', () => {
    // Exhaustive edge cases
    const cases = [
      { success: true, data: {} },
      { success: true, data: { id: 'x' } },
      { success: true, data: { content: undefined } },
      { success: true, data: { content: null } },
      { success: false },
      { success: false, error: '' },
    ];

    for (const result of cases) {
      const agent = toAgentToolResult(result as any);
      for (const block of agent.content) {
        expect(block.text).toBeDefined();
        expect(typeof block.text).toBe('string');
      }
    }
  });

  it('survives data with circular references without crashing (#2228)', () => {
    const circular: Record<string, unknown> = { id: 'circ' };
    circular.self = circular;
    const result = { success: true, data: circular };
    const agent = toAgentToolResult(result as any);
    expect(agent.content).toHaveLength(1);
    expect(typeof agent.content[0].text).toBe('string');
    expect(agent.content[0].text.length).toBeGreaterThan(0);
  });
});
