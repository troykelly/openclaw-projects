/** @vitest-environment node */
/**
 * Unit tests for visible_agent_ids validation logic (Issue #2424).
 *
 * These are pure logic tests — no database required.
 * DB-level integration tests live in the integration project.
 */
import { describe, it, expect } from 'vitest';

/**
 * Reimplementation of the validation logic from PATCH /settings
 * for isolated testing without a running server.
 */
function validateVisibleAgentIds(
  raw: unknown,
): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'visible_agent_ids must be an array or null' };
  }
  if (raw.length > 50) {
    return { ok: false, error: 'visible_agent_ids must not exceed 50 entries' };
  }
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return { ok: false, error: 'visible_agent_ids entries must be strings' };
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 255) {
      return { ok: false, error: 'Each visible_agent_ids entry must not exceed 255 characters' };
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
  }
  return { ok: true, value: cleaned };
}

/**
 * Check if default_agent_id is valid given visible_agent_ids.
 */
function isDefaultInVisible(
  defaultId: string | null,
  visibleIds: string[] | null,
): boolean {
  if (defaultId === null) return true;
  if (visibleIds === null) return true; // null = all visible
  return visibleIds.includes(defaultId);
}

describe('visible_agent_ids validation', () => {
  it('accepts null (all visible)', () => {
    const result = validateVisibleAgentIds(null);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('accepts valid array', () => {
    const result = validateVisibleAgentIds(['agent-a', 'agent-b']);
    expect(result).toEqual({ ok: true, value: ['agent-a', 'agent-b'] });
  });

  it('deduplicates entries', () => {
    const result = validateVisibleAgentIds(['agent-a', 'agent-a', 'agent-b']);
    expect(result).toEqual({ ok: true, value: ['agent-a', 'agent-b'] });
  });

  it('strips empty strings', () => {
    const result = validateVisibleAgentIds(['agent-a', '', '  ', 'agent-b']);
    expect(result).toEqual({ ok: true, value: ['agent-a', 'agent-b'] });
  });

  it('trims whitespace', () => {
    const result = validateVisibleAgentIds(['  agent-a  ', 'agent-b']);
    expect(result).toEqual({ ok: true, value: ['agent-a', 'agent-b'] });
  });

  it('rejects non-array', () => {
    const result = validateVisibleAgentIds('not-an-array');
    expect(result.ok).toBe(false);
  });

  it('rejects entries exceeding 255 chars', () => {
    const longId = 'a'.repeat(256);
    const result = validateVisibleAgentIds([longId]);
    expect(result.ok).toBe(false);
  });

  it('rejects more than 50 entries', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `agent-${i}`);
    const result = validateVisibleAgentIds(ids);
    expect(result.ok).toBe(false);
  });

  it('rejects non-string entries', () => {
    const result = validateVisibleAgentIds(['agent-a', 123]);
    expect(result.ok).toBe(false);
  });

  it('accepts empty array', () => {
    const result = validateVisibleAgentIds([]);
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe('default_agent_id ∈ visible_agent_ids cross-validation', () => {
  it('allows null default with any visible list', () => {
    expect(isDefaultInVisible(null, ['agent-a'])).toBe(true);
    expect(isDefaultInVisible(null, null)).toBe(true);
  });

  it('allows any default when visible is null (all visible)', () => {
    expect(isDefaultInVisible('agent-x', null)).toBe(true);
  });

  it('allows default that is in visible list', () => {
    expect(isDefaultInVisible('agent-a', ['agent-a', 'agent-b'])).toBe(true);
  });

  it('rejects default not in visible list', () => {
    expect(isDefaultInVisible('agent-c', ['agent-a', 'agent-b'])).toBe(false);
  });

  it('rejects default with empty visible list', () => {
    expect(isDefaultInVisible('agent-a', [])).toBe(false);
  });
});
