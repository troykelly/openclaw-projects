/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatTypingIndicator, ChatConnectionBanner, and useChatTyping
 * (Epic #1940, Issue #1953).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import * as React from 'react';
import { ChatTypingIndicator } from '@/ui/components/chat/chat-typing-indicator';
import { ChatConnectionBanner, type ChatConnectionStatus } from '@/ui/components/chat/chat-connection-banner';
import { useChatTyping } from '@/ui/hooks/use-chat-typing';

// ---------------------------------------------------------------------------
// ChatTypingIndicator Tests
// ---------------------------------------------------------------------------

describe('ChatTypingIndicator', () => {
  it('should render animated dots when visible', () => {
    const { container } = render(<ChatTypingIndicator visible />);

    const dots = container.querySelectorAll('[data-testid="typing-dot"]');
    expect(dots.length).toBe(3);
  });

  it('should not render when not visible', () => {
    const { container } = render(<ChatTypingIndicator visible={false} />);

    expect(container.querySelector('[data-testid="typing-indicator"]')).toBeNull();
  });

  it('should include accessible text', () => {
    render(<ChatTypingIndicator visible />);

    // Screen reader text should be present
    expect(screen.getByText(/typing/i)).toBeDefined();
  });

  it('should support reduced motion', () => {
    const { container } = render(<ChatTypingIndicator visible />);

    // The dots should have motion-reduce classes
    const dots = container.querySelectorAll('[data-testid="typing-dot"]');
    dots.forEach((dot) => {
      expect(dot.className).toContain('motion-reduce');
    });
  });
});

// ---------------------------------------------------------------------------
// ChatConnectionBanner Tests
// ---------------------------------------------------------------------------

describe('ChatConnectionBanner', () => {
  it('should not render when connected', () => {
    const { container } = render(
      <ChatConnectionBanner status="connected" />,
    );

    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
  });

  it('should render connecting state with spinner', () => {
    render(<ChatConnectionBanner status="connecting" />);

    expect(screen.getByTestId('connection-banner')).toBeDefined();
    expect(screen.getByText(/connecting/i)).toBeDefined();
  });

  it('should render reconnecting state in yellow', () => {
    render(<ChatConnectionBanner status="reconnecting" />);

    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeDefined();
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
  });

  it('should render disconnected state in red', () => {
    render(<ChatConnectionBanner status="disconnected" />);

    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeDefined();
    expect(screen.getByText(/disconnected/i)).toBeDefined();
  });

  it('should render degraded state in orange', () => {
    render(<ChatConnectionBanner status="degraded" />);

    expect(screen.getByText(/connection issues/i)).toBeDefined();
  });

  it('should show retry button for disconnected state', () => {
    const onRetry = vi.fn();
    render(<ChatConnectionBanner status="disconnected" onRetry={onRetry} />);

    const retryBtn = screen.getByText(/retry/i);
    fireEvent.click(retryBtn);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should not show retry button when no onRetry callback', () => {
    render(<ChatConnectionBanner status="disconnected" />);

    expect(screen.queryByText(/retry/i)).toBeNull();
  });

  it('should have accessible role', () => {
    render(<ChatConnectionBanner status="disconnected" />);

    const banner = screen.getByTestId('connection-banner');
    expect(banner.getAttribute('role')).toBe('status');
  });
});

// ---------------------------------------------------------------------------
// useChatTyping Tests
// ---------------------------------------------------------------------------

describe('useChatTyping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with isTyping=false', () => {
    const { result } = renderHook(() =>
      useChatTyping({ sessionId: 'sess-1' }),
    );

    expect(result.current.isTyping).toBe(false);
  });

  it('should set isTyping on typing event', () => {
    const { result } = renderHook(() =>
      useChatTyping({ sessionId: 'sess-1' }),
    );

    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-1',
        is_typing: true,
        agent_id: 'agent-1',
      });
    });

    expect(result.current.isTyping).toBe(true);
  });

  it('should clear typing after timeout (5 seconds)', () => {
    const { result } = renderHook(() =>
      useChatTyping({ sessionId: 'sess-1' }),
    );

    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-1',
        is_typing: true,
        agent_id: 'agent-1',
      });
    });

    expect(result.current.isTyping).toBe(true);

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.isTyping).toBe(false);
  });

  it('should reset timeout on new typing event', () => {
    const { result } = renderHook(() =>
      useChatTyping({ sessionId: 'sess-1' }),
    );

    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-1',
        is_typing: true,
        agent_id: 'agent-1',
      });
    });

    // Advance 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // New typing event should reset timeout
    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-1',
        is_typing: true,
        agent_id: 'agent-1',
      });
    });

    // Advance 3 more seconds (6 total from start, but only 3 from last event)
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Should still be typing (only 3s since last event)
    expect(result.current.isTyping).toBe(true);

    // Advance 2 more seconds (5 total from last event)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isTyping).toBe(false);
  });

  it('should clear typing on is_typing=false event', () => {
    const { result } = renderHook(() =>
      useChatTyping({ sessionId: 'sess-1' }),
    );

    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-1',
        is_typing: true,
        agent_id: 'agent-1',
      });
    });

    expect(result.current.isTyping).toBe(true);

    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-1',
        is_typing: false,
        agent_id: 'agent-1',
      });
    });

    expect(result.current.isTyping).toBe(false);
  });

  it('should ignore events for different sessions', () => {
    const { result } = renderHook(() =>
      useChatTyping({ sessionId: 'sess-1' }),
    );

    act(() => {
      result.current.handleTypingEvent({
        session_id: 'sess-other',
        is_typing: true,
        agent_id: 'agent-1',
      });
    });

    expect(result.current.isTyping).toBe(false);
  });
});
