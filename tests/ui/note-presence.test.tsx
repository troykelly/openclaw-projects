/**
 * @vitest-environment jsdom
 * Tests for note presence components and hooks.
 * Part of Epic #338, Issue #634
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PresenceIndicator } from '@/ui/components/notes/presence/presence-indicator';
import type { NotePresenceUser } from '@/ui/components/notes/presence/use-note-presence';

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
  // These tests require more setup for fetch mocking
  // Add integration tests when needed
  it.todo('joins presence on mount when autoJoin is true');
  it.todo('leaves presence on unmount');
  it.todo('handles WebSocket presence events');
  it.todo('updates cursor position');
});
