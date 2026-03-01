/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatRichCard and ChatActionButton (Epic #1940, Issue #1952).
 *
 * Validates card rendering for all types, action button states,
 * action submission, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

vi.mock('@/ui/lib/api-client.ts', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/ui/lib/api-client.ts';
import { ChatRichCard, type RichCardData } from '@/ui/components/chat/chat-rich-card';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<RichCardData> = {}): RichCardData {
  return {
    type: 'confirmation',
    title: 'Deploy to production?',
    body: 'This will deploy version 2.1.0 to the production environment.',
    actions: [
      { id: 'approve', label: 'Approve', style: 'primary', payload: 'signed-approve-payload' },
      { id: 'reject', label: 'Reject', style: 'destructive', payload: 'signed-reject-payload' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatRichCard', () => {
  it('should render a confirmation card with title and body', () => {
    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    expect(screen.getByText('Deploy to production?')).toBeDefined();
    expect(screen.getByText(/deploy version 2.1.0/i)).toBeDefined();
  });

  it('should render action buttons', () => {
    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    expect(screen.getByText('Approve')).toBeDefined();
    expect(screen.getByText('Reject')).toBeDefined();
  });

  it('should render task_summary card type', () => {
    render(
      <ChatRichCard
        data={makeCard({
          type: 'task_summary',
          title: 'Task: Fix login bug',
          body: '**Status**: In Progress\n**Priority**: High',
          actions: [],
        })}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    expect(screen.getByText('Task: Fix login bug')).toBeDefined();
  });

  it('should render choice card type with multiple options', () => {
    render(
      <ChatRichCard
        data={makeCard({
          type: 'choice',
          title: 'Select an option',
          body: 'Which framework do you prefer?',
          actions: [
            { id: 'react', label: 'React', style: 'default', payload: 'signed-react' },
            { id: 'vue', label: 'Vue', style: 'default', payload: 'signed-vue' },
            { id: 'svelte', label: 'Svelte', style: 'default', payload: 'signed-svelte' },
          ],
        })}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    expect(screen.getByText('React')).toBeDefined();
    expect(screen.getByText('Vue')).toBeDefined();
    expect(screen.getByText('Svelte')).toBeDefined();
  });

  it('should render info card without actions', () => {
    render(
      <ChatRichCard
        data={makeCard({
          type: 'info',
          title: 'System Update',
          body: 'The system will be updated tonight.',
          actions: [],
        })}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    expect(screen.getByText('System Update')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should send action response on button click', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ ok: true });

    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/chat/sessions/sess-1/messages',
        {
          content: JSON.stringify({
            action_id: 'approve',
            card_message_id: 'msg-1',
            payload: 'signed-approve-payload',
          }),
          content_type: 'application/vnd.openclaw.action-response',
          idempotency_key: expect.any(String),
        },
      );
    });
  });

  it('should disable button and show loading state during submission', async () => {
    // Create a promise we control
    let resolvePost: (value: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockImplementationOnce(
      () => new Promise((resolve) => { resolvePost = resolve; }),
    );

    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    const approveBtn = screen.getByText('Approve');
    fireEvent.click(approveBtn);

    // Button should be disabled during loading
    await waitFor(() => {
      const btn = screen.getByTestId('action-btn-approve');
      expect(btn.getAttribute('disabled')).not.toBeNull();
    });

    // Resolve the request
    resolvePost({ ok: true });

    // After resolution, button should show completed state
    await waitFor(() => {
      const btn = screen.getByTestId('action-btn-approve');
      expect(btn.textContent).toContain('Approve');
    });
  });

  it('should prevent double-click on action button', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ok: true });

    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    const approveBtn = screen.getByText('Approve');
    fireEvent.click(approveBtn);
    fireEvent.click(approveBtn);

    // Should only send once
    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledTimes(1);
    });
  });

  it('should handle action submission failure gracefully', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Network error'));

    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => {
      // Button should be re-enabled after failure
      const btn = screen.getByTestId('action-btn-approve');
      expect(btn.getAttribute('disabled')).toBeNull();
    });
  });

  it('should render with fallback for invalid card data', () => {
    render(
      <ChatRichCard
        data={{ type: 'unknown' as RichCardData['type'], title: '', body: '' }}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    // Should render something rather than crash
    expect(screen.getByTestId('rich-card')).toBeDefined();
  });

  it('should have accessible action buttons', () => {
    render(
      <ChatRichCard
        data={makeCard()}
        sessionId="sess-1"
        messageId="msg-1"
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(2);
    buttons.forEach((btn) => {
      expect(btn.getAttribute('type')).toBe('button');
    });
  });
});
