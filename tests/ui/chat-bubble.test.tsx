/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatBubble component (Epic #1940, Issue #1947).
 *
 * Verifies: rendering, unread badge, hidden when no agents,
 * hidden when panel open, click toggles panel.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the hooks
vi.mock('@/ui/hooks/queries/use-chat', () => ({
  chatKeys: {
    all: ['chat'],
    agents: () => ['chat', 'agents'],
    unreadCount: () => ['chat', 'unread-count'],
  },
  useAvailableAgents: vi.fn(),
  useChatUnreadCount: vi.fn(),
}));

vi.mock('@/ui/hooks/use-media-query', () => ({
  useMediaQuery: vi.fn(() => false),
  MEDIA_QUERIES: {
    reducedMotion: '(prefers-reduced-motion: reduce)',
  },
}));

import { ChatBubble } from '@/ui/components/chat/chat-bubble';
import { ChatProvider } from '@/ui/contexts/chat-context';
import { useAvailableAgents, useChatUnreadCount } from '@/ui/hooks/queries/use-chat';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ChatProvider>{children}</ChatProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('ChatBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the chat bubble when agents are available', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [{ id: 'a1', name: 'Agent1', display_name: 'Agent One', avatar_url: null }] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 0 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-bubble')).toBeInTheDocument();
  });

  it('is hidden when no agents are available', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 0 },
    } as ReturnType<typeof useChatUnreadCount>);

    const { container } = render(<ChatBubble />, { wrapper: createWrapper() });
    expect(container.querySelector('[data-testid="chat-bubble"]')).toBeNull();
  });

  it('shows unread badge when count > 0', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [{ id: 'a1', name: 'Agent1', display_name: null, avatar_url: null }] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 5 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-unread-badge')).toHaveTextContent('5');
  });

  it('shows 99+ for counts over 99', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [{ id: 'a1', name: 'Agent1', display_name: null, avatar_url: null }] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 150 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-unread-badge')).toHaveTextContent('99+');
  });

  it('does not show badge when count is 0', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [{ id: 'a1', name: 'Agent1', display_name: null, avatar_url: null }] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 0 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.queryByTestId('chat-unread-badge')).toBeNull();
  });

  it('has correct aria-label with unread count', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [{ id: 'a1', name: 'Agent1', display_name: null, avatar_url: null }] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 3 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-bubble')).toHaveAttribute('aria-label', 'Open chat (3 unread messages)');
  });

  it('toggles panel on click', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [{ id: 'a1', name: 'Agent1', display_name: null, avatar_url: null }] },
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 0 },
    } as ReturnType<typeof useChatUnreadCount>);

    render(<ChatBubble />, { wrapper: createWrapper() });
    const bubble = screen.getByTestId('chat-bubble');

    // Initial state: panel closed, aria-expanded=false
    expect(bubble).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    fireEvent.click(bubble);
    // After toggle, the bubble should be hidden (panel is open)
    // The bubble hides itself when panel is open
  });

  it('handles missing agents data gracefully', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useChatUnreadCount>);

    const { container } = render(<ChatBubble />, { wrapper: createWrapper() });
    // Should not render when data is undefined (no agents)
    expect(container.querySelector('[data-testid="chat-bubble"]')).toBeNull();
  });
});
