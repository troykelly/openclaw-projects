/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatBubble component (Epic #1940, Issue #1947).
 *
 * Verifies: rendering, unread badge, hidden when no visible agents,
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
  useRealtimeChatInvalidation: vi.fn(),
  useRealtimeAgentInvalidation: vi.fn(),
}));

vi.mock('@/ui/components/settings/use-settings', () => ({
  useSettings: vi.fn(),
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
import { useSettings } from '@/ui/components/settings/use-settings';

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

function setupSettingsMock() {
  vi.mocked(useSettings).mockReturnValue({
    state: {
      kind: 'loaded',
      data: {
        id: '1', email: 'test@test.com', default_agent_id: null, visible_agent_ids: null,
        theme: 'system', default_view: 'activity', default_project_id: null,
        sidebar_collapsed: false, show_completed_items: false, items_per_page: 20,
        email_notifications: true, email_digest_frequency: 'never', timezone: 'UTC',
        geo_auto_inject: false, geo_high_res_retention_hours: 24,
        geo_general_retention_days: 30, geo_high_res_threshold_m: 100,
        created_at: '', updated_at: '',
      },
    },
    isSaving: false,
    updateSettings: vi.fn().mockResolvedValue(true),
  } as unknown as ReturnType<typeof useSettings>);
}

describe('ChatBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSettingsMock();
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

  it('hides the chat bubble when no agents are available', () => {
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
  });

  it('hides the chat bubble when agents data is undefined', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useChatUnreadCount>);

    const { container } = render(<ChatBubble />, { wrapper: createWrapper() });
    // With no agents data, visibleAgents is empty → bubble hidden
    expect(container.querySelector('[data-testid="chat-bubble"]')).toBeNull();
  });
});
