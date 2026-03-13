// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryCard } from '../../../src/ui/components/memory/memory-card';
import type { MemoryItem } from '../../../src/ui/components/memory/types';

function makeMemory(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem-1',
    title: 'Test Memory',
    content: 'Some content here',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('MemoryCard lifecycle indicators (#2445)', () => {
  describe('TTL badge', () => {
    it('shows TTL badge when expires_at is set', () => {
      const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      render(<MemoryCard memory={makeMemory({ expires_at: future })} />);
      expect(screen.getByLabelText(/expires/i)).toBeInTheDocument();
    });

    it('shows red badge when expires_at < 1h remaining', () => {
      const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      render(<MemoryCard memory={makeMemory({ expires_at: soon })} />);
      const badge = screen.getByLabelText(/expires/i);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/red|destructive/);
    });

    it('shows yellow badge when expires_at between 1-24h', () => {
      const hours = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      render(<MemoryCard memory={makeMemory({ expires_at: hours })} />);
      const badge = screen.getByLabelText(/expires/i);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/yellow|warning/);
    });

    it('shows green badge when expires_at > 24h remaining', () => {
      const far = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      render(<MemoryCard memory={makeMemory({ expires_at: far })} />);
      const badge = screen.getByLabelText(/expires/i);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/green|success/);
    });

    it('shows "Expired" badge when expires_at is in the past', () => {
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      render(<MemoryCard memory={makeMemory({ expires_at: past })} />);
      const badge = screen.getByLabelText(/expired/i);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(/red|destructive/);
    });
  });

  describe('pinned indicator', () => {
    it('shows pin icon when pinned=true', () => {
      render(<MemoryCard memory={makeMemory({ pinned: true })} />);
      expect(screen.getByLabelText('Memory is pinned')).toBeInTheDocument();
    });

    it('does not show pin icon when pinned=false', () => {
      render(<MemoryCard memory={makeMemory({ pinned: false })} />);
      expect(screen.queryByLabelText('Memory is pinned')).not.toBeInTheDocument();
    });
  });

  describe('superseded badge', () => {
    it('shows superseded badge when superseded_by is set', () => {
      render(<MemoryCard memory={makeMemory({ superseded_by: 'mem-2' })} />);
      expect(screen.getByText('Superseded')).toBeInTheDocument();
    });

    it('applies muted appearance for superseded memories', () => {
      const { container } = render(
        <MemoryCard memory={makeMemory({ superseded_by: 'mem-2' })} />,
      );
      const card = container.querySelector('[data-testid="memory-card"]');
      expect(card?.className).toMatch(/opacity/);
    });

    it('calls onSupersededClick when superseded link is clicked', () => {
      const onClick = vi.fn();
      render(
        <MemoryCard
          memory={makeMemory({ superseded_by: 'mem-2' })}
          onSupersededClick={onClick}
        />,
      );
      screen.getByText('Superseded').click();
      expect(onClick).toHaveBeenCalledWith('mem-2');
    });
  });

  describe('ephemeral visual treatment', () => {
    it('applies dashed border when expires_at is set', () => {
      const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      const { container } = render(
        <MemoryCard memory={makeMemory({ expires_at: future })} />,
      );
      const card = container.querySelector('[data-testid="memory-card"]');
      expect(card?.className).toMatch(/dashed|border-dashed/);
    });
  });

  describe('tags display', () => {
    it('shows tags as badges', () => {
      render(
        <MemoryCard memory={makeMemory({ tags: ['tag1', 'tag2'] })} />,
      );
      expect(screen.getByText('tag1')).toBeInTheDocument();
      expect(screen.getByText('tag2')).toBeInTheDocument();
    });

    it('shows max 3 tags with overflow indicator', () => {
      render(
        <MemoryCard
          memory={makeMemory({
            tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
          })}
        />,
      );
      expect(screen.getByText('tag1')).toBeInTheDocument();
      expect(screen.getByText('tag2')).toBeInTheDocument();
      expect(screen.getByText('tag3')).toBeInTheDocument();
      expect(screen.queryByText('tag4')).not.toBeInTheDocument();
      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });

    it('applies special styling for day-memory tags', () => {
      render(
        <MemoryCard
          memory={makeMemory({ tags: ['day-memory:2026-03-13'] })}
        />,
      );
      const tag = screen.getByText('day-memory:2026-03-13');
      expect(tag.className).toMatch(/blue/);
    });

    it('applies special styling for week-memory tags', () => {
      render(
        <MemoryCard
          memory={makeMemory({ tags: ['week-memory:2026-W11'] })}
        />,
      );
      const tag = screen.getByText('week-memory:2026-W11');
      expect(tag.className).toMatch(/purple|violet/);
    });

    it('applies special styling for ephemeral tags', () => {
      render(
        <MemoryCard memory={makeMemory({ tags: ['ephemeral'] })} />,
      );
      const tag = screen.getByText('ephemeral');
      expect(tag.className).toMatch(/orange|amber/);
    });
  });

  describe('backward compatibility', () => {
    it('renders normally without lifecycle fields', () => {
      render(<MemoryCard memory={makeMemory()} />);
      expect(screen.getByText('Test Memory')).toBeInTheDocument();
      expect(screen.queryByLabelText(/expires/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Memory is pinned')).not.toBeInTheDocument();
      expect(screen.queryByText('Superseded')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('all lifecycle indicators have aria-labels', () => {
      const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      render(
        <MemoryCard
          memory={makeMemory({
            expires_at: future,
            pinned: true,
            superseded_by: 'mem-2',
          })}
        />,
      );
      expect(screen.getByLabelText(/expires/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Memory is pinned')).toBeInTheDocument();
      expect(screen.getByLabelText(/superseded/i)).toBeInTheDocument();
    });
  });
});
