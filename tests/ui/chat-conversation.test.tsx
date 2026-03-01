/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatConversation, ChatMessageBubble, and ChatMessageStatus
 * (Epic #1940, Issue #1949).
 *
 * Verifies: message rendering, user/agent bubble alignment,
 * date separators, message status indicators.
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

import { ChatMessageBubble } from '@/ui/components/chat/chat-message-bubble';
import { ChatMessageStatus } from '@/ui/components/chat/chat-message-status';
import { ChatNewMessagesPill } from '@/ui/components/chat/chat-new-messages-pill';
import { ChatConversation } from '@/ui/components/chat/chat-conversation';
import { ChatProvider } from '@/ui/contexts/chat-context';
import { useChatMessages, useChatSessions, useAvailableAgents, useChatUnreadCount } from '@/ui/hooks/queries/use-chat';
import { useCreateChatSession, useSendChatMessage, useUpdateChatSession } from '@/ui/hooks/mutations/use-chat';
import type { ChatMessage } from '@/ui/lib/api-types';

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

describe('ChatMessageBubble', () => {
  it('renders user message right-aligned with primary color', () => {
    const msg: ChatMessage = {
      id: 'm1',
      thread_id: 't1',
      direction: 'outbound',
      body: 'Hello from user',
      status: 'delivered',
      content_type: 'text/plain',
      idempotency_key: null,
      agent_run_id: null,
      received_at: new Date().toISOString(),
      updated_at: null,
    };

    render(<ChatMessageBubble message={msg} />, { wrapper: createWrapper() });
    const bubble = screen.getByTestId('chat-message-m1');
    expect(bubble).toHaveTextContent('Hello from user');
    // User messages should have justify-end class
    expect(bubble.className).toContain('justify-end');
  });

  it('renders agent message left-aligned with avatar', () => {
    const msg: ChatMessage = {
      id: 'm2',
      thread_id: 't1',
      direction: 'inbound',
      body: 'Hello from agent',
      status: 'delivered',
      content_type: 'text/plain',
      idempotency_key: null,
      agent_run_id: null,
      received_at: new Date().toISOString(),
      updated_at: null,
    };

    render(<ChatMessageBubble message={msg} />, { wrapper: createWrapper() });
    const bubble = screen.getByTestId('chat-message-m2');
    expect(bubble).toHaveTextContent('Hello from agent');
    // Agent messages should have justify-start class
    expect(bubble.className).toContain('justify-start');
  });

  it('renders empty body gracefully', () => {
    const msg: ChatMessage = {
      id: 'm3',
      thread_id: 't1',
      direction: 'outbound',
      body: null,
      status: 'delivered',
      content_type: 'text/plain',
      idempotency_key: null,
      agent_run_id: null,
      received_at: new Date().toISOString(),
      updated_at: null,
    };

    render(<ChatMessageBubble message={msg} />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-message-m3')).toBeInTheDocument();
  });
});

describe('ChatMessageStatus', () => {
  it('renders spinner for pending status', () => {
    render(<ChatMessageStatus status="pending" />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('Sending')).toBeInTheDocument();
  });

  it('renders spinner for streaming status', () => {
    render(<ChatMessageStatus status="streaming" />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('Sending')).toBeInTheDocument();
  });

  it('renders check for delivered status', () => {
    render(<ChatMessageStatus status="delivered" />, { wrapper: createWrapper() });
    expect(screen.getByLabelText('Delivered')).toBeInTheDocument();
  });

  it('renders retry button for failed status', () => {
    const onRetry = vi.fn();
    render(<ChatMessageStatus status="failed" onRetry={onRetry} />, { wrapper: createWrapper() });
    const retryBtn = screen.getByLabelText('Message failed, click to retry');
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent('Retry');
  });
});

describe('ChatNewMessagesPill', () => {
  it('renders with correct count', () => {
    render(
      <ChatNewMessagesPill count={3} onClick={vi.fn()} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByTestId('chat-new-messages-pill')).toHaveTextContent('3 new messages');
  });

  it('renders singular form for 1 message', () => {
    render(
      <ChatNewMessagesPill count={1} onClick={vi.fn()} />,
      { wrapper: createWrapper() },
    );
    expect(screen.getByTestId('chat-new-messages-pill')).toHaveTextContent('1 new message');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();

    render(
      <ChatNewMessagesPill count={2} onClick={onClick} />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('chat-new-messages-pill'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('ChatConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useChatSessions).mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useChatSessions>);
    vi.mocked(useAvailableAgents).mockReturnValue({
      data: { agents: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useAvailableAgents>);
    vi.mocked(useChatUnreadCount).mockReturnValue({
      data: { count: 0 },
    } as unknown as ReturnType<typeof useChatUnreadCount>);
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
  });

  it('shows empty message when no messages', () => {
    vi.mocked(useChatMessages).mockReturnValue({
      data: { messages: [], cursor: null, has_more: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useChatMessages>);

    render(<ChatConversation />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-no-messages')).toBeInTheDocument();
  });

  it('renders messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1', thread_id: 't1', direction: 'outbound', body: 'Hi agent',
        status: 'delivered', content_type: 'text/plain', idempotency_key: null,
        agent_run_id: null, received_at: '2026-03-01T10:00:00Z', updated_at: null,
      },
      {
        id: 'm2', thread_id: 't1', direction: 'inbound', body: 'Hello user',
        status: 'delivered', content_type: 'text/plain', idempotency_key: null,
        agent_run_id: null, received_at: '2026-03-01T10:01:00Z', updated_at: null,
      },
    ];

    vi.mocked(useChatMessages).mockReturnValue({
      data: { messages, cursor: null, has_more: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useChatMessages>);

    render(<ChatConversation />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-conversation')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-m1')).toHaveTextContent('Hi agent');
    expect(screen.getByTestId('chat-message-m2')).toHaveTextContent('Hello user');
  });

  it('shows date separators between messages on different days', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1', thread_id: 't1', direction: 'outbound', body: 'Message 1',
        status: 'delivered', content_type: 'text/plain', idempotency_key: null,
        agent_run_id: null, received_at: '2026-02-28T10:00:00Z', updated_at: null,
      },
      {
        id: 'm2', thread_id: 't1', direction: 'inbound', body: 'Message 2',
        status: 'delivered', content_type: 'text/plain', idempotency_key: null,
        agent_run_id: null, received_at: '2026-03-01T10:00:00Z', updated_at: null,
      },
    ];

    vi.mocked(useChatMessages).mockReturnValue({
      data: { messages, cursor: null, has_more: false },
      isLoading: false,
    } as unknown as ReturnType<typeof useChatMessages>);

    render(<ChatConversation />, { wrapper: createWrapper() });
    // Both messages should have date separators
    const separators = screen.getAllByRole('separator');
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });

  it('shows skeleton while loading', () => {
    vi.mocked(useChatMessages).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useChatMessages>);

    render(<ChatConversation />, { wrapper: createWrapper() });
    expect(screen.getByTestId('chat-skeleton-messages')).toBeInTheDocument();
  });
});
