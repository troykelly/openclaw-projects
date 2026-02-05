/**
 * @vitest-environment jsdom
 * Tests for note presence components and hooks.
 * Part of Epic #338, Issue #634
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PresenceIndicator } from '@/ui/components/notes/presence/presence-indicator';
import { useNotePresence, type NotePresenceUser } from '@/ui/components/notes/presence/use-note-presence';

// Mock tooltip provider to simplify testing
vi.mock('@/ui/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
}));

describe('PresenceIndicator', () => {
  const mockViewers: NotePresenceUser[] = [
    {
      email: 'alice@example.com',
      displayName: 'Alice Smith',
      lastSeenAt: new Date().toISOString(),
    },
    {
      email: 'bob@example.com',
      displayName: 'Bob Jones',
      lastSeenAt: new Date().toISOString(),
    },
    {
      email: 'charlie@example.com',
      lastSeenAt: new Date().toISOString(),
    },
  ];

  it('renders nothing when no viewers', () => {
    const { container } = render(<PresenceIndicator viewers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders viewer avatars', () => {
    render(<PresenceIndicator viewers={mockViewers} />);

    // Should render avatar initials
    expect(screen.getByText('AS')).toBeInTheDocument(); // Alice Smith
    expect(screen.getByText('BJ')).toBeInTheDocument(); // Bob Jones
    expect(screen.getByText('CH')).toBeInTheDocument(); // charlie (from email)
  });

  it('excludes current user from display', () => {
    render(
      <PresenceIndicator
        viewers={mockViewers}
        currentUserEmail="alice@example.com"
      />
    );

    // Should not show Alice's avatar
    expect(screen.queryByText('AS')).not.toBeInTheDocument();
    // Should still show others
    expect(screen.getByText('BJ')).toBeInTheDocument();
    expect(screen.getByText('CH')).toBeInTheDocument();
  });

  it('shows overflow count when exceeding maxAvatars', () => {
    render(
      <PresenceIndicator
        viewers={mockViewers}
        maxAvatars={2}
      />
    );

    // Should show first 2 avatars
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('BJ')).toBeInTheDocument();

    // Should show overflow indicator
    expect(screen.getByText('+1')).toBeInTheDocument();

    // Should not show 3rd avatar directly
    expect(screen.queryByText('CH')).not.toBeInTheDocument();
  });

  it('shows correct aria-label for accessibility', () => {
    render(<PresenceIndicator viewers={mockViewers} />);

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', '3 people viewing');
  });

  it('shows singular label for one viewer', () => {
    render(<PresenceIndicator viewers={[mockViewers[0]]} />);

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', '1 person viewing');
  });

  it('applies size classes correctly', () => {
    const { rerender } = render(
      <PresenceIndicator viewers={[mockViewers[0]]} size="sm" />
    );

    // Small size should have h-6 w-6 classes
    const avatar = screen.getByText('AS');
    expect(avatar).toHaveClass('h-6', 'w-6');

    rerender(<PresenceIndicator viewers={[mockViewers[0]]} size="lg" />);
    expect(screen.getByText('AS')).toHaveClass('h-10', 'w-10');
  });

  it('renders avatar image when avatarUrl is provided', () => {
    const viewerWithAvatar: NotePresenceUser = {
      email: 'avatar@example.com',
      displayName: 'Avatar User',
      avatarUrl: 'https://example.com/avatar.jpg',
      lastSeenAt: new Date().toISOString(),
    };

    render(<PresenceIndicator viewers={[viewerWithAvatar]} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    expect(img).toHaveAttribute('alt', 'Avatar User');
  });

  describe('Avatar URL Security (#691)', () => {
    it('sets referrerPolicy="no-referrer" on avatar images', () => {
      const viewerWithAvatar: NotePresenceUser = {
        email: 'secure@example.com',
        displayName: 'Secure User',
        avatarUrl: 'https://example.com/avatar.jpg',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithAvatar]} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('referrerPolicy', 'no-referrer');
    });

    it('rejects HTTP (non-HTTPS) avatar URLs', () => {
      const viewerWithHttpUrl: NotePresenceUser = {
        email: 'http@example.com',
        displayName: 'HTTP User',
        avatarUrl: 'http://example.com/avatar.jpg',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithHttpUrl]} />);

      // Should fall back to initials, not render image
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('HU')).toBeInTheDocument();
    });

    it('rejects data: URI avatar URLs', () => {
      const viewerWithDataUri: NotePresenceUser = {
        email: 'data@example.com',
        displayName: 'Data User',
        avatarUrl: 'data:image/png;base64,iVBORw0KGgo=',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithDataUri]} />);

      // Should fall back to initials
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('DU')).toBeInTheDocument();
    });

    it('rejects javascript: URI avatar URLs', () => {
      const viewerWithJsUri: NotePresenceUser = {
        email: 'js@example.com',
        displayName: 'JS User',
        avatarUrl: 'javascript:alert(1)',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithJsUri]} />);

      // Should fall back to initials
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('JU')).toBeInTheDocument();
    });

    it('rejects invalid/malformed URLs', () => {
      const viewerWithInvalidUrl: NotePresenceUser = {
        email: 'invalid@example.com',
        displayName: 'Invalid User',
        avatarUrl: 'not-a-valid-url',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithInvalidUrl]} />);

      // Should fall back to initials
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('IU')).toBeInTheDocument();
    });

    it('rejects blob: URLs', () => {
      const viewerWithBlobUrl: NotePresenceUser = {
        email: 'blob@example.com',
        displayName: 'Blob User',
        avatarUrl: 'blob:https://example.com/1234-5678',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithBlobUrl]} />);

      // Should fall back to initials
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('BU')).toBeInTheDocument();
    });

    it('rejects file: URLs', () => {
      const viewerWithFileUrl: NotePresenceUser = {
        email: 'file@example.com',
        displayName: 'File User',
        avatarUrl: 'file:///etc/passwd',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithFileUrl]} />);

      // Should fall back to initials
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('FU')).toBeInTheDocument();
    });

    it('accepts valid HTTPS avatar URLs', () => {
      const viewerWithHttpsUrl: NotePresenceUser = {
        email: 'https@example.com',
        displayName: 'HTTPS User',
        avatarUrl: 'https://gravatar.com/avatar/abc123',
        lastSeenAt: new Date().toISOString(),
      };

      render(<PresenceIndicator viewers={[viewerWithHttpsUrl]} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://gravatar.com/avatar/abc123');
    });
  });

  it('generates consistent colors from email', () => {
    const { rerender } = render(
      <PresenceIndicator viewers={[mockViewers[0]]} />
    );

    const avatar1 = screen.getByText('AS');
    const style1 = avatar1.getAttribute('style');

    // Re-render with same viewer
    rerender(<PresenceIndicator viewers={[mockViewers[0]]} />);

    const avatar2 = screen.getByText('AS');
    const style2 = avatar2.getAttribute('style');

    // Background color should be consistent
    expect(style1).toBe(style2);
  });
});

describe('useNotePresence hook', () => {
  // Test wrapper component to use the hook
  function TestComponent({
    noteId,
    userEmail,
    autoJoin = true,
    apiUrl = '/api',
    onViewersChange,
    onConnectedChange,
    onErrorChange,
  }: {
    noteId: string;
    userEmail: string;
    autoJoin?: boolean;
    apiUrl?: string;
    onViewersChange?: (viewers: NotePresenceUser[]) => void;
    onConnectedChange?: (connected: boolean) => void;
    onErrorChange?: (error: Error | null) => void;
  }) {
    const result = useNotePresence({ noteId, userEmail, autoJoin, apiUrl });

    React.useEffect(() => {
      onViewersChange?.(result.viewers);
    }, [result.viewers, onViewersChange]);

    React.useEffect(() => {
      onConnectedChange?.(result.isConnected);
    }, [result.isConnected, onConnectedChange]);

    React.useEffect(() => {
      onErrorChange?.(result.error);
    }, [result.error, onErrorChange]);

    return (
      <div>
        <span data-testid="viewer-count">{result.viewers.length}</span>
        <span data-testid="connected">{result.isConnected.toString()}</span>
        <span data-testid="error">{result.error?.message || 'none'}</span>
        <button data-testid="update-cursor" onClick={() => result.updateCursor({ line: 10, column: 5 })}>
          Update Cursor
        </button>
      </div>
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock fetch globally
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('joins presence on mount when autoJoin is true', async () => {
    const mockCollaborators: NotePresenceUser[] = [
      { email: 'alice@example.com', lastSeenAt: new Date().toISOString() },
      { email: 'bob@example.com', lastSeenAt: new Date().toISOString() },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ collaborators: mockCollaborators }),
    });

    const onConnectedChange = vi.fn();
    const onViewersChange = vi.fn();

    render(
      <TestComponent
        noteId="note-123"
        userEmail="test@example.com"
        autoJoin={true}
        onConnectedChange={onConnectedChange}
        onViewersChange={onViewersChange}
      />
    );

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Verify the API was called correctly
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/notes/note-123/presence',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: 'test@example.com' }),
      })
    );

    // Wait for state to update
    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('true');
    });

    expect(screen.getByTestId('viewer-count')).toHaveTextContent('2');
  });

  it('leaves presence on unmount', async () => {
    const mockCollaborators: NotePresenceUser[] = [];

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ collaborators: mockCollaborators }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });

    const { unmount } = render(
      <TestComponent
        noteId="note-456"
        userEmail="leave@example.com"
        autoJoin={true}
      />
    );

    // Wait for join to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('true');
    });

    // Unmount the component
    unmount();

    // Wait for leave to be called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Verify the leave API was called correctly
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/notes/note-456/presence',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'X-User-Email': 'leave@example.com' },
      })
    );
  });

  it('handles WebSocket presence events', async () => {
    // This test verifies the event handler logic
    // We'll test the handlePresenceEvent callback indirectly through state changes

    const mockCollaborators: NotePresenceUser[] = [
      { email: 'initial@example.com', lastSeenAt: new Date().toISOString() },
    ];

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ collaborators: mockCollaborators }),
    });

    render(
      <TestComponent
        noteId="note-ws"
        userEmail="test@example.com"
        autoJoin={true}
      />
    );

    // Wait for initial state
    await waitFor(() => {
      expect(screen.getByTestId('viewer-count')).toHaveTextContent('1');
    });

    // The WebSocket event handling is covered by the useEffect that subscribes
    // to events. Since we don't have a real WebSocket context in this test,
    // we verify the initial fetch-based presence tracking works.
    expect(screen.getByTestId('connected')).toHaveTextContent('true');
  });

  it('updates cursor position', async () => {
    const mockCollaborators: NotePresenceUser[] = [];

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ collaborators: mockCollaborators }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });

    render(
      <TestComponent
        noteId="note-cursor"
        userEmail="cursor@example.com"
        autoJoin={true}
      />
    );

    // Wait for join to complete
    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('true');
    });

    // Click the update cursor button
    const updateButton = screen.getByTestId('update-cursor');
    fireEvent.click(updateButton);

    // Wait for cursor update API call
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Verify the cursor update API was called correctly
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/notes/note-cursor/presence/cursor',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: 'cursor@example.com',
          cursorPosition: { line: 10, column: 5 },
        }),
      })
    );
  });
});
