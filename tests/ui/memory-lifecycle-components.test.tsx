/**
 * @vitest-environment jsdom
 *
 * Tests for digest results view, cluster card, and reaper activity log.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DigestResultsView } from '@/ui/components/memory/digest-results-view';
import { ClusterCard } from '@/ui/components/memory/cluster-card';
import { ReaperActivityLog } from '@/ui/components/memory/reaper-activity-log';
import type { DigestResponse, Memory, MemoryCluster } from '@/ui/lib/api-types';

const mockMemory: Memory = {
  id: 'mem-1',
  title: 'Test Memory',
  content: 'Test content',
  memory_type: 'fact',
  importance: 5,
  confidence: 0.9,
  is_active: true,
  pinned: false,
  tags: [],
  created_by_human: false,
  embedding_status: 'complete',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
};

const mockCluster: MemoryCluster = {
  topic: 'Architecture Decisions',
  centroid_id: 'mem-1',
  size: 3,
  avg_similarity: 0.85,
  time_span: { start: '2025-01-01', end: '2025-06-01' },
  memory_ids: ['mem-1', 'mem-2', 'mem-3'],
  memories: [
    mockMemory,
    { ...mockMemory, id: 'mem-2', title: 'Design Patterns' },
    { ...mockMemory, id: 'mem-3', title: 'Module Structure' },
  ],
};

const mockDigestResponse: DigestResponse = {
  total_memories: 10,
  clusters: [mockCluster],
  orphans: [{ ...mockMemory, id: 'orphan-1', title: 'Orphan Memory' }],
};

describe('DigestResultsView', () => {
  it('renders summary stats', () => {
    render(<DigestResultsView data={mockDigestResponse} />);

    // Summary stats: total memories = 10, clusters = 1, orphans = 1
    const stats = screen.getAllByText('10');
    expect(stats.length).toBeGreaterThanOrEqual(1);
    // Clusters count and orphans count are both "1"
    const ones = screen.getAllByText('1');
    expect(ones.length).toBeGreaterThanOrEqual(2);
  });

  it('renders cluster cards', () => {
    render(<DigestResultsView data={mockDigestResponse} />);

    expect(screen.getByText('Architecture Decisions')).toBeInTheDocument();
  });

  it('renders orphan section', () => {
    render(<DigestResultsView data={mockDigestResponse} />);

    expect(screen.getByText('Orphan Memory')).toBeInTheDocument();
  });

  it('renders empty state when no digest results', () => {
    const emptyData: DigestResponse = {
      total_memories: 0,
      clusters: [],
      orphans: [],
    };
    render(<DigestResultsView data={emptyData} />);

    expect(screen.getByText(/no.*results/i)).toBeInTheDocument();
  });

  it('has promote button that calls onPromote', () => {
    const onPromote = vi.fn();
    render(<DigestResultsView data={mockDigestResponse} onPromoteCluster={onPromote} />);

    const promoteBtn = screen.getByRole('button', { name: /promote/i });
    fireEvent.click(promoteBtn);

    expect(onPromote).toHaveBeenCalledWith(mockCluster);
  });

  it('has dismiss button per cluster', () => {
    const onDismiss = vi.fn();
    render(<DigestResultsView data={mockDigestResponse} onDismissCluster={onDismiss} />);

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledWith(mockCluster);
  });

  it('has aria-labels for accessibility', () => {
    render(<DigestResultsView data={mockDigestResponse} />);

    expect(screen.getByRole('region', { name: /digest results/i })).toBeInTheDocument();
  });
});

describe('ClusterCard', () => {
  it('renders cluster topic and size', () => {
    render(<ClusterCard cluster={mockCluster} />);

    expect(screen.getByText('Architecture Decisions')).toBeInTheDocument();
    expect(screen.getByText(/3 memories/i)).toBeInTheDocument();
  });

  it('shows avg similarity', () => {
    render(<ClusterCard cluster={mockCluster} />);

    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });

  it('shows time span', () => {
    render(<ClusterCard cluster={mockCluster} />);

    expect(screen.getByText(/2025/)).toBeInTheDocument();
  });

  it('expands to show memories', () => {
    render(<ClusterCard cluster={mockCluster} />);

    // Click to expand
    const expandBtn = screen.getByRole('button', { name: /expand|collapse/i });
    fireEvent.click(expandBtn);

    expect(screen.getByText('Test Memory')).toBeInTheDocument();
    expect(screen.getByText('Design Patterns')).toBeInTheDocument();
    expect(screen.getByText('Module Structure')).toBeInTheDocument();
  });

  it('is keyboard navigable', () => {
    render(<ClusterCard cluster={mockCluster} />);

    const expandBtn = screen.getByRole('button', { name: /expand|collapse/i });
    // Verify button is focusable
    expandBtn.focus();
    expect(document.activeElement).toBe(expandBtn);
    // Click to expand (native keyboard Enter handled by browser)
    fireEvent.click(expandBtn);

    expect(screen.getByText('Test Memory')).toBeInTheDocument();
  });

  it('has aria-labels', () => {
    render(<ClusterCard cluster={mockCluster} />);

    expect(screen.getByRole('button', { name: /expand|collapse/i })).toBeInTheDocument();
  });
});

describe('ReaperActivityLog', () => {
  const mockEvents = [
    {
      id: 'event-1',
      timestamp: '2025-06-01T12:00:00Z',
      namespace: 'default',
      count: 5,
      dry_run: false,
      soft_delete: true,
    },
    {
      id: 'event-2',
      timestamp: '2025-06-02T12:00:00Z',
      namespace: 'work',
      count: 3,
      dry_run: true,
      soft_delete: false,
    },
  ];

  it('renders reaper events', () => {
    render(<ReaperActivityLog events={mockEvents} />);

    // Multiple elements contain namespace text (filter buttons + table cells)
    expect(screen.getAllByText('default').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('work').length).toBeGreaterThanOrEqual(1);
  });

  it('shows count reaped', () => {
    render(<ReaperActivityLog events={mockEvents} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows dry_run flag', () => {
    render(<ReaperActivityLog events={mockEvents} />);

    // One event is dry_run=true, one is false
    const dryRunLabels = screen.getAllByText(/dry run/i);
    expect(dryRunLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state', () => {
    render(<ReaperActivityLog events={[]} />);

    expect(screen.getByText(/no reaper activity/i)).toBeInTheDocument();
  });

  it('has role="log" for accessibility', () => {
    render(<ReaperActivityLog events={mockEvents} />);

    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('has aria-labels', () => {
    render(<ReaperActivityLog events={mockEvents} />);

    expect(screen.getByRole('log', { name: /reaper activity/i })).toBeInTheDocument();
  });
});
