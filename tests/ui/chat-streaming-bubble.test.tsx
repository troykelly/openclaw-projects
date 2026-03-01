/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatMessageBubble streaming mode (Epic #1940, Issue #1951).
 *
 * Validates progressive text rendering, cursor animation,
 * streaming status display, and interruption handling.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { ChatMessageBubble } from '@/ui/components/chat/chat-message-bubble';
import type { ChatMessage } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    thread_id: 'thread-1',
    direction: 'inbound',
    body: 'Hello World',
    status: 'delivered',
    content_type: 'text/plain',
    idempotency_key: null,
    agent_run_id: null,
    received_at: '2026-03-01T10:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatMessageBubble streaming mode', () => {
  it('should render streaming content when streamContent is provided', () => {
    const msg = makeMessage({ body: null, status: 'streaming' });

    render(
      <ChatMessageBubble
        message={msg}
        streamContent="Streaming text..."
        streamState="streaming"
      />,
    );

    expect(screen.getByText('Streaming text...')).toBeDefined();
  });

  it('should show cursor animation during streaming', () => {
    const msg = makeMessage({ body: null, status: 'streaming' });

    const { container } = render(
      <ChatMessageBubble
        message={msg}
        streamContent="Hello"
        streamState="streaming"
      />,
    );

    // Cursor element should be present
    const cursor = container.querySelector('[data-testid="stream-cursor"]');
    expect(cursor).not.toBeNull();
  });

  it('should not show cursor when stream is completed', () => {
    const msg = makeMessage({ body: 'Hello complete', status: 'delivered' });

    const { container } = render(
      <ChatMessageBubble
        message={msg}
        streamContent="Hello complete"
        streamState="completed"
      />,
    );

    const cursor = container.querySelector('[data-testid="stream-cursor"]');
    expect(cursor).toBeNull();
  });

  it('should show error state when stream failed', () => {
    const msg = makeMessage({ body: null, status: 'failed' });

    render(
      <ChatMessageBubble
        message={msg}
        streamContent="Partial text"
        streamState="failed"
        streamError="Agent timeout"
      />,
    );

    expect(screen.getByText(/interrupted/i)).toBeDefined();
  });

  it('should call onRegenerate when regenerate button is clicked', () => {
    const msg = makeMessage({ body: null, status: 'failed' });
    const onRegenerate = vi.fn();

    render(
      <ChatMessageBubble
        message={msg}
        streamContent="Partial"
        streamState="failed"
        streamError="Agent timeout"
        onRegenerate={onRegenerate}
      />,
    );

    const button = screen.getByText(/regenerate/i);
    fireEvent.click(button);

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('should show "started" state with empty content', () => {
    const msg = makeMessage({ body: null, status: 'streaming' });

    const { container } = render(
      <ChatMessageBubble
        message={msg}
        streamContent=""
        streamState="started"
      />,
    );

    // Should show the cursor (typing indicator) even with no content
    const cursor = container.querySelector('[data-testid="stream-cursor"]');
    expect(cursor).not.toBeNull();
  });

  it('should render normal message when no stream props', () => {
    const msg = makeMessage({ body: 'Normal message' });

    render(<ChatMessageBubble message={msg} />);

    expect(screen.getByText('Normal message')).toBeDefined();
  });

  it('should prefer streamContent over message body during streaming', () => {
    const msg = makeMessage({ body: 'Old content', status: 'streaming' });

    render(
      <ChatMessageBubble
        message={msg}
        streamContent="New streaming content"
        streamState="streaming"
      />,
    );

    expect(screen.getByText('New streaming content')).toBeDefined();
  });
});
