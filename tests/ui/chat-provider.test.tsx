/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatProvider context (Epic #1940, Issue #1947).
 *
 * Verifies: panel open/close, active session management,
 * draft persistence in sessionStorage, and deep link handling.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatProvider, useChat } from '@/ui/contexts/chat-context';

// Test consumer component that exposes the context values
function ChatConsumer() {
  const {
    activeSessionId,
    setActiveSessionId,
    isPanelOpen,
    openPanel,
    closePanel,
    togglePanel,
    getDraft,
    setDraft,
    clearDraft,
  } = useChat();

  return (
    <div>
      <span data-testid="active-session">{activeSessionId ?? 'none'}</span>
      <span data-testid="panel-open">{String(isPanelOpen)}</span>
      <button data-testid="open" onClick={openPanel}>Open</button>
      <button data-testid="close" onClick={closePanel}>Close</button>
      <button data-testid="toggle" onClick={togglePanel}>Toggle</button>
      <button data-testid="set-session" onClick={() => setActiveSessionId('sess-1')}>Set Session</button>
      <button data-testid="clear-session" onClick={() => setActiveSessionId(null)}>Clear Session</button>
      <button data-testid="set-draft" onClick={() => setDraft('sess-1', 'hello draft')}>Set Draft</button>
      <button data-testid="clear-draft" onClick={() => clearDraft('sess-1')}>Clear Draft</button>
      <span data-testid="draft">{getDraft('sess-1')}</span>
    </div>
  );
}

function createWrapper(initialRoute = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('ChatProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('starts with panel closed and no active session', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper() },
    );

    expect(screen.getByTestId('panel-open').textContent).toBe('false');
    expect(screen.getByTestId('active-session').textContent).toBe('none');
  });

  it('opens and closes the panel', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('open'));
    expect(screen.getByTestId('panel-open').textContent).toBe('true');

    fireEvent.click(screen.getByTestId('close'));
    expect(screen.getByTestId('panel-open').textContent).toBe('false');
  });

  it('toggles the panel', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('panel-open').textContent).toBe('true');

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('panel-open').textContent).toBe('false');
  });

  it('sets and clears active session ID', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByTestId('set-session'));
    expect(screen.getByTestId('active-session').textContent).toBe('sess-1');

    fireEvent.click(screen.getByTestId('clear-session'));
    expect(screen.getByTestId('active-session').textContent).toBe('none');
  });

  it('persists and retrieves drafts in sessionStorage', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper() },
    );

    // Initially empty
    expect(sessionStorage.getItem('openclaw-chat-draft-sess-1')).toBeNull();

    // Set a draft — writes to sessionStorage
    fireEvent.click(screen.getByTestId('set-draft'));
    expect(sessionStorage.getItem('openclaw-chat-draft-sess-1')).toBe('hello draft');

    // Force re-render via a state change so getDraft reads the new value
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('draft').textContent).toBe('hello draft');

    // Clear the draft
    fireEvent.click(screen.getByTestId('clear-draft'));
    expect(sessionStorage.getItem('openclaw-chat-draft-sess-1')).toBeNull();

    // Force re-render again
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('draft').textContent).toBe('');
  });

  it('handles deep link via ?chat= query param with valid UUID', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper('/?chat=a1b2c3d4-e5f6-7890-abcd-ef1234567890') },
    );

    expect(screen.getByTestId('active-session').textContent).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(screen.getByTestId('panel-open').textContent).toBe('true');
  });

  it('ignores deep link with non-UUID ?chat= param', () => {
    render(
      <ChatProvider><ChatConsumer /></ChatProvider>,
      { wrapper: createWrapper('/?chat=../../malicious-path') },
    );

    expect(screen.getByTestId('active-session').textContent).toBe('none');
    expect(screen.getByTestId('panel-open').textContent).toBe('false');
  });

  it('throws when useChat is used outside ChatProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<ChatConsumer />, { wrapper: createWrapper() });
    }).toThrow('useChat must be used within a ChatProvider');

    consoleSpy.mockRestore();
  });
});
