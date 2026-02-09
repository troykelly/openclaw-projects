/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { MilestoneCard } from '@/ui/components/milestones/milestone-card';
import { MilestoneList } from '@/ui/components/milestones/milestone-list';
import { MilestoneDialog } from '@/ui/components/milestones/milestone-dialog';
import { MilestoneProgress } from '@/ui/components/milestones/milestone-progress';
import { useMilestones } from '@/ui/components/milestones/use-milestones';
import { calculateMilestoneStatus } from '@/ui/components/milestones/utils';
import type { Milestone, MilestoneStatus } from '@/ui/components/milestones/types';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockMilestone: Milestone = {
  id: 'ms-1',
  name: 'Q1 Release',
  targetDate: '2024-03-31',
  description: 'First quarter release',
  status: 'upcoming',
  projectId: 'proj-1',
  progress: 0.25,
  totalItems: 8,
  completedItems: 2,
};

describe('MilestoneCard', () => {
  it('renders milestone name', () => {
    render(<MilestoneCard milestone={mockMilestone} />);
    expect(screen.getByText('Q1 Release')).toBeInTheDocument();
  });

  it('renders target date', () => {
    render(<MilestoneCard milestone={mockMilestone} />);
    expect(screen.getByText(/mar.*31.*2024/i)).toBeInTheDocument();
  });

  it('shows progress percentage', () => {
    render(<MilestoneCard milestone={mockMilestone} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('shows item count', () => {
    render(<MilestoneCard milestone={mockMilestone} />);
    expect(screen.getByText('2 / 8')).toBeInTheDocument();
  });

  it('displays correct status badge for upcoming', () => {
    render(<MilestoneCard milestone={mockMilestone} />);
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('displays correct status badge for in-progress', () => {
    const ms = { ...mockMilestone, status: 'in-progress' as MilestoneStatus };
    render(<MilestoneCard milestone={ms} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('displays correct status badge for completed', () => {
    const ms = { ...mockMilestone, status: 'completed' as MilestoneStatus };
    render(<MilestoneCard milestone={ms} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('displays correct status badge for missed', () => {
    const ms = { ...mockMilestone, status: 'missed' as MilestoneStatus };
    render(<MilestoneCard milestone={ms} />);
    expect(screen.getByText('Missed')).toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<MilestoneCard milestone={mockMilestone} onClick={onClick} />);
    fireEvent.click(screen.getByText('Q1 Release'));
    expect(onClick).toHaveBeenCalledWith(mockMilestone);
  });
});

describe('MilestoneProgress', () => {
  it('renders progress bar', () => {
    render(<MilestoneProgress progress={0.5} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows green for on-track', () => {
    render(<MilestoneProgress progress={0.5} status="upcoming" />);
    const bar = screen.getByRole('progressbar');
    // Inner div has the fill color
    expect(bar.firstChild).toHaveClass('bg-green-500');
  });

  it('shows yellow for at-risk', () => {
    render(<MilestoneProgress progress={0.2} status="in-progress" isAtRisk />);
    const bar = screen.getByRole('progressbar');
    expect(bar.firstChild).toHaveClass('bg-yellow-500');
  });

  it('shows red for missed', () => {
    render(<MilestoneProgress progress={0.8} status="missed" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.firstChild).toHaveClass('bg-red-500');
  });
});

describe('MilestoneList', () => {
  const mockMilestones: Milestone[] = [
    mockMilestone,
    {
      id: 'ms-2',
      name: 'Q2 Release',
      targetDate: '2024-06-30',
      status: 'upcoming',
      projectId: 'proj-1',
      progress: 0,
      totalItems: 10,
      completedItems: 0,
    },
  ];

  it('renders all milestones', () => {
    render(<MilestoneList milestones={mockMilestones} />);
    expect(screen.getByText('Q1 Release')).toBeInTheDocument();
    expect(screen.getByText('Q2 Release')).toBeInTheDocument();
  });

  it('filters by status', () => {
    const milestones = [
      { ...mockMilestone, status: 'completed' as MilestoneStatus },
      { ...mockMilestone, id: 'ms-2', name: 'Q2', status: 'upcoming' as MilestoneStatus },
    ];
    render(<MilestoneList milestones={milestones} filterStatus="completed" />);
    expect(screen.getByText('Q1 Release')).toBeInTheDocument();
    expect(screen.queryByText('Q2')).not.toBeInTheDocument();
  });

  it('shows empty state when no milestones', () => {
    render(<MilestoneList milestones={[]} />);
    expect(screen.getByText(/no milestones/i)).toBeInTheDocument();
  });

  it('shows create button', () => {
    render(<MilestoneList milestones={[]} onCreateClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create milestone/i })).toBeInTheDocument();
  });
});

describe('MilestoneDialog', () => {
  const defaultProps = {
    open: true,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    projectId: 'proj-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode', () => {
    render(<MilestoneDialog {...defaultProps} />);
    expect(screen.getByText(/create milestone/i)).toBeInTheDocument();
  });

  it('renders edit mode with milestone data', () => {
    render(<MilestoneDialog {...defaultProps} milestone={mockMilestone} />);
    expect(screen.getByText(/edit milestone/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Q1 Release')).toBeInTheDocument();
  });

  it('requires name to save', () => {
    render(<MilestoneDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onSave with milestone data', () => {
    const onSave = vi.fn();
    render(<MilestoneDialog {...defaultProps} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'New Milestone' },
    });
    fireEvent.change(screen.getByLabelText(/target date/i), {
      target: { value: '2024-12-31' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Milestone',
        targetDate: '2024-12-31',
      }),
    );
  });

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn();
    render(<MilestoneDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('useMilestones hook', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches milestones on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [mockMilestone],
    });

    const { result } = renderHook(() => useMilestones('proj-1'));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/projects/proj-1/milestones');
    expect(result.current.milestones).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('creates a milestone', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-ms', name: 'New' }),
      });

    const { result } = renderHook(() => useMilestones('proj-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current.createMilestone({
        name: 'New Milestone',
        targetDate: '2024-12-31',
      });
    });

    expect(mockFetch).toHaveBeenLastCalledWith('/api/projects/proj-1/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
    });
  });

  it('deletes a milestone', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockMilestone],
      })
      .mockResolvedValueOnce({
        ok: true,
      });

    const { result } = renderHook(() => useMilestones('proj-1'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current.deleteMilestone('ms-1');
    });

    expect(mockFetch).toHaveBeenLastCalledWith('/api/milestones/ms-1', {
      method: 'DELETE',
    });
  });
});

describe('Milestone Status Calculation', () => {
  it('returns upcoming for future milestones', () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);
    expect(calculateMilestoneStatus(0, futureDate.toISOString())).toBe('upcoming');
  });

  it('returns in-progress for milestones with progress', () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);
    expect(calculateMilestoneStatus(0.5, futureDate.toISOString())).toBe('in-progress');
  });

  it('returns completed when progress is 100%', () => {
    expect(calculateMilestoneStatus(1, '2020-01-01')).toBe('completed');
  });

  it('returns missed for past date with incomplete progress', () => {
    expect(calculateMilestoneStatus(0.5, '2020-01-01')).toBe('missed');
  });
});
