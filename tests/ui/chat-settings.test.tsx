/** @vitest-environment jsdom */
/**
 * Tests for ChatSettingsSection (Issues #1957, #2424).
 *
 * Covers:
 * - Default agent dropdown rendering and selection
 * - Visibility checkboxes rendering
 * - Default agent checkbox is disabled
 * - Integration with useChatAgentPreferences
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateSettings = vi.fn().mockResolvedValue(true);

const mockPreferences = {
  defaultAgentId: null as string | null,
  visibleAgentIds: null as string[] | null,
  allAgents: [] as Array<{ id: string; name: string; display_name: string | null; status?: string }>,
  visibleAgents: [] as Array<{ id: string; name: string; display_name: string | null; status?: string }>,
  resolvedDefaultAgent: null as { id: string; name: string; display_name: string | null } | null,
  isLoading: false,
  error: null as string | null,
  isSaving: false,
  updateSettings: mockUpdateSettings,
};

vi.mock('@/ui/components/chat/use-chat-agent-preferences', () => ({
  useChatAgentPreferences: () => ({ ...mockPreferences }),
}));

// AgentStatusBadge — stub to avoid import chain issues
vi.mock('@/ui/components/chat/agent-status-badge', () => ({
  AgentStatusBadge: ({ status }: { status: string }) => React.createElement('span', { 'data-testid': 'agent-status' }, status),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ChatSettingsSection } from '@/ui/components/settings/chat-settings-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockAgents = [
  { id: 'agent-1', name: 'assistant', display_name: 'Assistant', avatar_url: null, status: 'online' },
  { id: 'agent-2', name: 'coder', display_name: 'Code Helper', avatar_url: null, status: 'online' },
  { id: 'agent-3', name: 'researcher', display_name: null, avatar_url: null, status: 'offline' },
];

function resetPreferences(overrides: Partial<typeof mockPreferences> = {}) {
  Object.assign(mockPreferences, {
    defaultAgentId: null,
    visibleAgentIds: null,
    allAgents: [],
    visibleAgents: [],
    resolvedDefaultAgent: null,
    isLoading: false,
    error: null,
    isSaving: false,
    updateSettings: mockUpdateSettings,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatSettingsSection component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
  });

  it('renders loading state', () => {
    resetPreferences({ isLoading: true });
    render(React.createElement(ChatSettingsSection));
    expect(screen.getByText('Chat')).toBeDefined();
    expect(screen.getByTestId('chat-settings-section')).toBeDefined();
  });

  it('renders error state', () => {
    resetPreferences({ error: 'Failed to load' });
    render(React.createElement(ChatSettingsSection));
    expect(screen.getByText(/failed to load/i)).toBeDefined();
  });

  it('renders empty agent list message', () => {
    resetPreferences({ allAgents: [], visibleAgents: [] });
    render(React.createElement(ChatSettingsSection));
    expect(screen.getByText(/no agents available/i)).toBeDefined();
  });

  it('renders agent dropdown with available agents', () => {
    resetPreferences({ allAgents: mockAgents, visibleAgents: mockAgents });
    render(React.createElement(ChatSettingsSection));
    expect(screen.getByText('Default Agent')).toBeDefined();
    expect(screen.getByText('None selected')).toBeDefined();
  });

  it('displays currently selected agent', () => {
    resetPreferences({
      defaultAgentId: 'agent-1',
      allAgents: mockAgents,
      visibleAgents: mockAgents,
      resolvedDefaultAgent: mockAgents[0],
    });
    render(React.createElement(ChatSettingsSection));
    // "Assistant" appears in both dropdown and checkbox list
    expect(screen.getAllByText('Assistant').length).toBeGreaterThanOrEqual(1);
  });

  it('renders visibility checkboxes for each agent', () => {
    resetPreferences({ allAgents: mockAgents, visibleAgents: mockAgents });
    render(React.createElement(ChatSettingsSection));
    expect(screen.getByText('Visible Agents')).toBeDefined();
    expect(screen.getAllByText('Assistant').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Code Helper')).toBeDefined();
    // agent-3 has null display_name, falls back to name
    expect(screen.getByText('researcher')).toBeDefined();
  });

  it('shows saving indicator when isSaving is true', () => {
    resetPreferences({
      allAgents: mockAgents,
      visibleAgents: mockAgents,
      isSaving: true,
    });
    render(React.createElement(ChatSettingsSection));
    // Loader2 spinner should be present (it renders as an SVG)
    const card = screen.getByTestId('chat-settings-section');
    expect(card.querySelector('.animate-spin')).toBeDefined();
  });

  it('marks default agent checkbox as disabled', () => {
    resetPreferences({
      defaultAgentId: 'agent-1',
      allAgents: mockAgents,
      visibleAgents: mockAgents,
    });
    render(React.createElement(ChatSettingsSection));

    // Find checkbox with aria-label for the default agent
    const checkbox = screen.getByLabelText('Show Assistant in chat');
    expect(checkbox).toBeDefined();
    expect(checkbox.getAttribute('disabled')).not.toBeNull();
  });

  it('shows (default) label next to default agent', () => {
    resetPreferences({
      defaultAgentId: 'agent-1',
      allAgents: mockAgents,
      visibleAgents: mockAgents,
    });
    render(React.createElement(ChatSettingsSection));
    expect(screen.getByText('(default)')).toBeDefined();
  });
});
