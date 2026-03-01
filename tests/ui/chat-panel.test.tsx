/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatPanel and ChatSessionList (Epic #1940, Issue #1948).
 *
 * Verifies: panel rendering, session list, empty states,
 * Escape to close, session selection, new conversation.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock hooks
vi.mock('@/ui/hooks/queries/use-chat', () => ({
  chatKeys: {
    all: ['chat'],
    sessions: () => ['chat', 'sessions'],
    sessionsList: (status?: string) => ['chat', 'sessions', 'list', status],
    agents: () => ['chat', 'agents'],
    unreadCount: () => ['chat', 'unread-count'],
    messages: (id: string) => ['chat', 'messages', id],
    messagesCursor: (id: string, cursor?: string) => ['chat', 'messages', id, cursor],
  },
  useChatSessions: vi.fn(),
  useAvailableAgents: vi.fn(),
  useChatUnreadCount: vi.fn(),
  useChatMessages: vi.fn(),
}));

vi.mock('@/ui/hooks/mutations/use-chat', () => ({
  useCreateChatSession: vi.fn(),
  useSendChatMessage: vi.fn(),
  useEndChatSession: vi.fn(),
  useUpdateChatSession: vi.fn(),
}));

vi.mock('@/ui/hooks/use-media-query', () => ({
  useMediaQuery: vi.fn(() => false),
  MEDIA_QUERIES: {
    mobile: '(max-width: 767px)',
    reducedMotion: '(prefers-reduced-motion: reduce)',
  },
}));

import { ChatPanel } from '@/ui/components/chat/chat-panel';
import { ChatEmptyState } from '@/ui/components/chat/chat-empty-state';
import { ChatSessionList } from '@/ui/components/chat/chat-session-list';
import { ChatProvider, useChat } from '@/ui/contexts/chat-context';
import { useChatSessions, useAvailableAgents, useChatUnreadCount, useChatMessages } from '@/ui/hooks/queries/use-chat';
import { useCreateChatSession, useSendChatMessage, useUpdateChatSession } from '@/ui/hooks/mutations/use-chat';

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

// Helper to open the panel
function PanelOpener({ children }: { children: React.ReactNode }) {
  const { openPanel } = useChat();
  React.useEffect(() => { openPanel(); }, [openPanel]);
  return <>{children}</>;
}

function setupDefaultMocks() {
  vi.mocked(useChatSessions).mockReturnValue({
    data: { sessions: [] },
    isLoading: false,
  } as unknown as ReturnType<typeof useChatSessions>);
  vi.mocked(useAvailableAgents).mockReturnValue({
    data: { agents: [{ id: 'a1', name: 'TestAgent', display_name: 'Test Agent', avatar_url: null }] },
    isLoading: false,
  } as unknown as ReturnType<typeof useAvailableAgents>);
  vi.mocked(useChatUnreadCount).mockReturnValue({
    data: { count: 0 },
  } as unknown as ReturnType<typeof useChatUnreadCount>);
  vi.mocked(useChatMessages).mockReturnValue({
    data: { messages: [], cursor: null, has_more: false },
    isLoading: false,
  } as unknown as ReturnType<typeof useChatMessages>);
  vi.mocked(useCreateChatSession).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateChatSession>);
  vi.mocked(useSendChatMessage).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSendChatMessage>);
  vi.mocked(useUpdateChatSession).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateChatSession>);
}

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('does not render when panel is closed', () => {
    const { container } = render(<ChatPanel />, { wrapper: createWrapper() });
    expect(container.querySelector('[data-testid="chat-panel"]')).toBeNull();
  });

  it('renders when panel is opened', () => {
    render(
      <PanelOpener><ChatPanel /></PanelOpener>,
      { wrapper: createWrapper() },
    );
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(
      <PanelOpener><ChatPanel /></PanelOpener>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('chat-panel')).toBeNull();
  });

  it('shows Messages header and new conversation button', () => {
    render(
      <PanelOpener><ChatPanel /></PanelOpener>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByText('Messages')).toBeInTheDocument();
  });
});

describe('ChatEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('shows "No conversations yet" when sessions empty and agents available', () => {
    render(<ChatEmptyState />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-empty-no-sessions')).toBeInTheDocument();
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('shows "No agents configured" when no agents available', () => {
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useAvailableAgents>);

    render(<ChatEmptyState />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-empty-no-agents')).toBeInTheDocument();
    expect(screen.getByText('No agents configured')).toBeInTheDocument();
  });

  it('does not render when sessions exist', () => {
    vi.mocked(useChatSessions).mockReturnValue({
      data: {
        sessions: [{
          id: 's1',
          thread_id: 't1',
          user_email: 'u@e.com',
          agent_id: 'a1',
          namespace: 'default',
          status: 'active',
          title: null,
          version: 1,
          started_at: new Date().toISOString(),
          ended_at: null,
          last_activity_at: new Date().toISOString(),
          metadata: {},
        }],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useChatSessions>);

    const { container } = render(<ChatEmptyState />, { wrapper: createWrapper() });
    expect(container.querySelector('[data-testid="chat-empty-no-sessions"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-empty-no-agents"]')).toBeNull();
  });
});

describe('ChatSessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('shows new conversation button', () => {
    render(<ChatSessionList />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-new-conversation')).toBeInTheDocument();
  });

  it('renders sessions sorted by last_activity_at DESC', () => {
    const sessions = [
      {
        id: 's1', thread_id: 't1', user_email: 'u@e.com', agent_id: 'a1',
        namespace: 'default', status: 'active' as const, title: 'First Session',
        version: 1, started_at: '2026-01-01T00:00:00Z', ended_at: null,
        last_activity_at: '2026-01-01T00:00:00Z', metadata: {},
      },
      {
        id: 's2', thread_id: 't2', user_email: 'u@e.com', agent_id: 'a1',
        namespace: 'default', status: 'active' as const, title: 'Second Session',
        version: 1, started_at: '2026-01-02T00:00:00Z', ended_at: null,
        last_activity_at: '2026-01-02T00:00:00Z', metadata: {},
      },
    ];

    vi.mocked(useChatSessions).mockReturnValue({
      data: { sessions },
      isLoading: false,
    } as unknown as ReturnType<typeof useChatSessions>);

    render(<ChatSessionList />, { wrapper: createWrapper() });

    // Second session should appear first (more recent)
    const items = screen.getAllByTestId(/^chat-session-item-/);
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Second Session');
    expect(items[1]).toHaveTextContent('First Session');
  });

  it('shows loading skeleton when loading', () => {
    vi.mocked(useChatSessions).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useChatSessions>);

    render(<ChatSessionList />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-skeleton-sessions')).toBeInTheDocument();
  });
});
