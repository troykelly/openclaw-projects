/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatAgentSelector component (Epic #2153, Issue #2160).
 *
 * Verifies: agent status badge rendering and graceful fallback.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/ui/hooks/queries/use-chat', () => ({
  chatKeys: {
    all: ['chat'],
    agents: () => ['chat', 'agents'],
  },
  useAvailableAgents: vi.fn(),
}));

vi.mock('@/ui/components/realtime/realtime-context', () => ({
  useRealtimeOptional: vi.fn(() => null),
}));

import { ChatAgentSelector } from '@/ui/components/chat/chat-agent-selector';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('ChatAgentSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders AgentStatusBadge for each agent with status', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: {
        agents: [
          { id: 'a1', name: 'Agent1', display_name: 'Agent One', avatar_url: null, status: 'online' },
          { id: 'a2', name: 'Agent2', display_name: 'Agent Two', avatar_url: null, status: 'busy' },
        ],
      },
    } as ReturnType<typeof useAvailableAgents>);

    render(
      <ChatAgentSelector value="a1" onChange={vi.fn()} />,
      { wrapper: createWrapper() },
    );

    // Should have status badges (role="status")
    const badges = screen.getAllByRole('status');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('does not crash when status field is absent', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: {
        agents: [
          { id: 'a1', name: 'Agent1', display_name: 'Agent One', avatar_url: null },
          { id: 'a2', name: 'Agent2', display_name: 'Agent Two', avatar_url: null },
        ],
      },
    } as ReturnType<typeof useAvailableAgents>);

    expect(() => {
      render(
        <ChatAgentSelector value="a1" onChange={vi.fn()} />,
        { wrapper: createWrapper() },
      );
    }).not.toThrow();
  });

  it('returns null when only one agent', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: {
        agents: [
          { id: 'a1', name: 'Agent1', display_name: 'Agent One', avatar_url: null, status: 'online' },
        ],
      },
    } as ReturnType<typeof useAvailableAgents>);

    const { container } = render(
      <ChatAgentSelector value="a1" onChange={vi.fn()} />,
      { wrapper: createWrapper() },
    );
    expect(container.querySelector('[data-testid="chat-agent-selector"]')).toBeNull();
  });
});
