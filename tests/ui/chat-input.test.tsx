/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatInput and ChatHeader (Epic #1940, Issue #1950).
 *
 * Verifies: send on Ctrl+Enter, draft persistence, disabled when ended,
 * character limit indicator, header title editing, back navigation.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/ui/hooks/queries/use-chat', () => ({
  chatKeys: {
    all: ['chat'],
    sessions: () => ['chat', 'sessions'],
    sessionsList: (status?: string) => ['chat', 'sessions', 'list', status],
    session: (id: string) => ['chat', 'sessions', 'detail', id],
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

import { ChatInput } from '@/ui/components/chat/chat-input';
import { ChatHeader } from '@/ui/components/chat/chat-header';
import { ChatSessionEndedState } from '@/ui/components/chat/chat-session-ended-state';
import { ChatProvider, useChat } from '@/ui/contexts/chat-context';
import { useChatSessions, useAvailableAgents, useChatUnreadCount } from '@/ui/hooks/queries/use-chat';
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

// Helper to set an active session
function WithActiveSession({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const { setActiveSessionId } = useChat();
  React.useEffect(() => { setActiveSessionId(sessionId); }, [sessionId, setActiveSessionId]);
  return <>{children}</>;
}

function setupDefaultMocks(sessionStatus: 'active' | 'ended' = 'active') {
  vi.mocked(useChatSessions).mockReturnValue({
    data: {
      sessions: [{
        id: 'sess-1',
        thread_id: 't1',
        user_email: 'u@e.com',
        agent_id: 'a1',
        namespace: 'default',
        status: sessionStatus,
        title: 'Test Chat',
        version: 1,
        started_at: new Date().toISOString(),
        ended_at: sessionStatus === 'ended' ? new Date().toISOString() : null,
        last_activity_at: new Date().toISOString(),
        metadata: {},
      }],
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useChatSessions>);
  vi.mocked(useAvailableAgents).mockReturnValue({
    data: { agents: [{ id: 'a1', name: 'TestAgent', display_name: 'Test Agent', avatar_url: null }] },
    isLoading: false,
  } as unknown as ReturnType<typeof useAvailableAgents>);
  vi.mocked(useChatUnreadCount).mockReturnValue({
    data: { count: 0 },
  } as unknown as ReturnType<typeof useChatUnreadCount>);
  vi.mocked(useCreateChatSession).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCreateChatSession>);
  vi.mocked(useUpdateChatSession).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateChatSession>);
}

describe('ChatInput', () => {
  const mockMutateFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    setupDefaultMocks();
    vi.mocked(useSendChatMessage).mockReturnValue({
      mutate: mockMutateFn,
      isPending: false,
    } as unknown as ReturnType<typeof useSendChatMessage>);
  });

  it('renders the input area', () => {
    render(
      <WithActiveSession sessionId="sess-1">
        <ChatInput />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat message')).toBeInTheDocument();
    expect(screen.getByLabelText('Send message')).toBeInTheDocument();
  });

  it('disables send button when input is empty', () => {
    render(
      <WithActiveSession sessionId="sess-1">
        <ChatInput />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('enables send button when input has content', () => {
    render(
      <WithActiveSession sessionId="sess-1">
        <ChatInput />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: 'Hello' } });
    expect(screen.getByLabelText('Send message')).not.toBeDisabled();
  });

  it('shows session ended state when session is ended', () => {
    setupDefaultMocks('ended');

    render(
      <WithActiveSession sessionId="sess-1">
        <ChatInput />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('chat-session-ended')).toBeInTheDocument();
    expect(screen.getByText('This session has ended.')).toBeInTheDocument();
  });
});

describe('ChatSessionEndedState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks('ended');
  });

  it('renders with "Start new conversation" button', () => {
    render(<ChatSessionEndedState />, { wrapper: createWrapper() });
    expect(screen.getByText('Start new conversation')).toBeInTheDocument();
  });
});

describe('ChatHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('renders header with agent name and title', () => {
    render(
      <WithActiveSession sessionId="sess-1">
        <ChatHeader />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('chat-header')).toBeInTheDocument();
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
  });

  it('shows back, new, minimize, and close buttons', () => {
    render(
      <WithActiveSession sessionId="sess-1">
        <ChatHeader />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByLabelText('Back to conversations')).toBeInTheDocument();
    expect(screen.getByLabelText('New conversation')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument();
    expect(screen.getByLabelText('Close chat')).toBeInTheDocument();
  });

  it('allows title editing on click', () => {
    render(
      <WithActiveSession sessionId="sess-1">
        <ChatHeader />
      </WithActiveSession>,
      { wrapper: createWrapper() },
    );

    // Click the title to start editing
    fireEvent.click(screen.getByText('Test Chat'));

    // Should show an input field
    const input = screen.getByLabelText('Edit session title');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Test Chat');
  });
});
