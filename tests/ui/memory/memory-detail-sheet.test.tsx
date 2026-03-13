// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryDetailSheet } from '../../../src/ui/components/memory/memory-detail-sheet';
import type { MemoryItem, MemoryLifecycleEvent, SupersessionNode } from '../../../src/ui/components/memory/types';

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

describe('MemoryDetailSheet lifecycle features (#2447)', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  };

  describe('supersession chain', () => {
    it('shows supersession chain when superseded_by is set', () => {
      const chain: SupersessionNode[] = [
        { id: 'mem-0', title: 'Original', exists: true },
        { id: 'mem-1', title: 'Test Memory', exists: true },
        { id: 'mem-2', title: 'Latest', exists: true },
      ];
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory({ superseded_by: 'mem-2' })}
          supersessionChain={chain}
        />,
      );
      expect(screen.getByText('Original')).toBeInTheDocument();
      expect(screen.getByText('Latest')).toBeInTheDocument();
    });

    it('shows placeholder for deleted target in chain', () => {
      const chain: SupersessionNode[] = [
        { id: 'mem-1', title: 'Test Memory', exists: true },
        { id: 'mem-2', title: '', exists: false },
      ];
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory({ superseded_by: 'mem-2' })}
          supersessionChain={chain}
        />,
      );
      expect(screen.getByText('Memory deleted')).toBeInTheDocument();
    });

    it('shows "Supersedes" info when memory supersedes others', () => {
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory({ supersedes: ['mem-0'] })}
          supersessionChain={[
            { id: 'mem-0', title: 'Old Memory', exists: true },
            { id: 'mem-1', title: 'Test Memory', exists: true },
          ]}
        />,
      );
      expect(screen.getByText(/supersedes: 1 memory/i)).toBeInTheDocument();
    });

    it('calls onChainNodeClick when chain node is clicked', () => {
      const onClick = vi.fn();
      const chain: SupersessionNode[] = [
        { id: 'mem-0', title: 'Original', exists: true },
        { id: 'mem-1', title: 'Test Memory', exists: true },
      ];
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory({ supersedes: ['mem-0'] })}
          supersessionChain={chain}
          onChainNodeClick={onClick}
        />,
      );
      screen.getByText('Original').click();
      expect(onClick).toHaveBeenCalledWith('mem-0');
    });
  });

  describe('TTL details', () => {
    it('shows created_at date in meta section', () => {
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory()}
        />,
      );
      // The "Created:" label is in the meta section
      expect(screen.getByText(/Created:/)).toBeInTheDocument();
    });

    it('shows TTL Details section when expires_at is set', () => {
      const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory({ expires_at: future })}
        />,
      );
      expect(screen.getByText('TTL Details')).toBeInTheDocument();
      expect(screen.getByText(/Expires:/)).toBeInTheDocument();
    });

    it('shows "Expired" badge when expires_at is in the past', () => {
      const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory({ expires_at: past })}
        />,
      );
      expect(screen.getByText('Expired')).toBeInTheDocument();
    });
  });

  describe('lifecycle timeline', () => {
    it('shows lifecycle events in timeline', () => {
      const events: MemoryLifecycleEvent[] = [
        { type: 'created', timestamp: new Date('2026-01-01T00:00:00Z') },
        { type: 'updated', timestamp: new Date('2026-01-02T00:00:00Z'), actor: 'agent-1' },
        { type: 'superseded', timestamp: new Date('2026-01-03T00:00:00Z') },
      ];
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory()}
          lifecycleEvents={events}
        />,
      );
      expect(screen.getByText('Lifecycle History')).toBeInTheDocument();
      // "Created" appears in both meta section and timeline, so check for the timeline heading
      expect(screen.getByText('Updated')).toBeInTheDocument();
      expect(screen.getByText('Superseded')).toBeInTheDocument();
    });

    it('shows actor name when available', () => {
      const events: MemoryLifecycleEvent[] = [
        { type: 'updated', timestamp: new Date('2026-01-02T00:00:00Z'), actor: 'agent-1' },
      ];
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory()}
          lifecycleEvents={events}
        />,
      );
      expect(screen.getByText('agent-1')).toBeInTheDocument();
    });
  });

  describe('backward compatibility', () => {
    it('renders without lifecycle props', () => {
      render(
        <MemoryDetailSheet
          {...defaultProps}
          memory={makeMemory()}
        />,
      );
      expect(screen.getByText('Test Memory')).toBeInTheDocument();
    });
  });
});
