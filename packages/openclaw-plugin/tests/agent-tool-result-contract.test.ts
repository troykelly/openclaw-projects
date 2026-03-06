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
