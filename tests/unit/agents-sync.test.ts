/**
 * Unit tests for agent sync validation (#2151).
 *
 * Tests the validateAgentSyncBody function in api/agents/routes.ts.
 * Pure unit tests -- no database required.
 */

import { describe, it, expect } from 'vitest';
import { validateAgentSyncBody } from '../../src/api/agents/routes.ts';

describe('validateAgentSyncBody (#2151)', () => {
  it('accepts valid body with agents and default_id', () => {
    const result = validateAgentSyncBody({
      agents: [
        { id: 'agent-1', name: 'Agent One' },
        { id: 'agent-2', name: 'Agent Two' },
      ],
      default_id: 'agent-1',
    });

    expect(result).toEqual({
      agents: [
        { id: 'agent-1', display_name: 'Agent One', avatar_url: null, is_default: true },
        { id: 'agent-2', display_name: 'Agent Two', avatar_url: null, is_default: false },
      ],
      default_id: 'agent-1',
    });
  });

  it('rejects body without agents array', () => {
    expect(() => validateAgentSyncBody({})).toThrow();
    expect(() => validateAgentSyncBody({ agents: 'not-array' })).toThrow();
    expect(() => validateAgentSyncBody(null)).toThrow();
    expect(() => validateAgentSyncBody(undefined)).toThrow();
  });

  it('filters out agents with empty id', () => {
    const result = validateAgentSyncBody({
      agents: [
        { id: 'agent-1' },
        { id: '' },
        { id: '  ' },
        { id: 'agent-2' },
      ],
    });

    expect(result.agents).toHaveLength(2);
    expect(result.agents.map((a) => a.id)).toEqual(['agent-1', 'agent-2']);
  });

  it('handles missing default_id (returns null)', () => {
    const result = validateAgentSyncBody({
      agents: [{ id: 'agent-1' }],
    });

    expect(result.default_id).toBeNull();
    expect(result.agents[0].is_default).toBe(false);
  });

  it('maps identity.name to display_name', () => {
    const result = validateAgentSyncBody({
      agents: [
        { id: 'agent-1', identity: { name: 'Friendly Agent' } },
      ],
    });

    expect(result.agents[0].display_name).toBe('Friendly Agent');
  });

  it('maps identity.avatarUrl to avatar_url', () => {
    const result = validateAgentSyncBody({
      agents: [
        { id: 'agent-1', identity: { avatarUrl: 'https://example.com/avatar.png' } },
      ],
    });

    expect(result.agents[0].avatar_url).toBe('https://example.com/avatar.png');
  });

  it('maps both identity fields together', () => {
    const result = validateAgentSyncBody({
      agents: [
        {
          id: 'agent-1',
          identity: {
            name: 'Helper Bot',
            avatarUrl: 'https://example.com/bot.png',
            emoji: '🤖',
            theme: 'dark',
          },
        },
      ],
    });

    expect(result.agents[0]).toEqual({
      id: 'agent-1',
      display_name: 'Helper Bot',
      avatar_url: 'https://example.com/bot.png',
      is_default: false,
    });
  });

  it('uses name as display_name fallback when identity.name is absent', () => {
    const result = validateAgentSyncBody({
      agents: [
        { id: 'agent-1', name: 'Fallback Name' },
      ],
    });

    expect(result.agents[0].display_name).toBe('Fallback Name');
  });

  it('prefers identity.name over name', () => {
    const result = validateAgentSyncBody({
      agents: [
        { id: 'agent-1', name: 'Short', identity: { name: 'Full Display Name' } },
      ],
    });

    expect(result.agents[0].display_name).toBe('Full Display Name');
  });
});
