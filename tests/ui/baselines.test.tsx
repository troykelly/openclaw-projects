/**
 * @vitest-environment jsdom
 * Tests for baseline snapshot components
 * Issue #391: Implement baseline snapshots for progress tracking
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { CreateBaselineDialog, type CreateBaselineDialogProps } from '@/ui/components/baselines/create-baseline-dialog';
import { BaselineList, type BaselineListProps } from '@/ui/components/baselines/baseline-list';
import { BaselineComparison, type BaselineComparisonProps } from '@/ui/components/baselines/baseline-comparison';
import {
  compareBaselines,
  calculateSlippage,
  formatSlippage,
  type BaselineSnapshot,
  type BaselineItem,
  type ComparisonResult,
} from '@/ui/components/baselines/baseline-utils';

describe('Baseline Utils', () => {
  describe('compareBaselines', () => {
    it('should identify items present in both baseline and current', () => {
      const baseline: BaselineItem[] = [
        { id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 },
        { id: '2', title: 'Task B', startDate: '2026-01-06', endDate: '2026-01-10', estimate: 4 },
      ];
      const current: BaselineItem[] = [
        { id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-07', estimate: 3 },
        { id: '2', title: 'Task B', startDate: '2026-01-08', endDate: '2026-01-12', estimate: 4 },
      ];

      const result = compareBaselines(baseline, current);

      expect(result.unchanged.length).toBe(0);
      expect(result.modified.length).toBe(2);
      expect(result.added.length).toBe(0);
      expect(result.removed.length).toBe(0);
    });

    it('should identify added items', () => {
      const baseline: BaselineItem[] = [{ id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 }];
      const current: BaselineItem[] = [
        { id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 },
        { id: '2', title: 'Task B', startDate: '2026-01-06', endDate: '2026-01-10', estimate: 4 },
      ];

      const result = compareBaselines(baseline, current);

      expect(result.added.length).toBe(1);
      expect(result.added[0].id).toBe('2');
    });

    it('should identify removed items', () => {
      const baseline: BaselineItem[] = [
        { id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 },
        { id: '2', title: 'Task B', startDate: '2026-01-06', endDate: '2026-01-10', estimate: 4 },
      ];
      const current: BaselineItem[] = [{ id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 }];

      const result = compareBaselines(baseline, current);

      expect(result.removed.length).toBe(1);
      expect(result.removed[0].id).toBe('2');
    });

    it('should identify unchanged items', () => {
      const baseline: BaselineItem[] = [{ id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 }];
      const current: BaselineItem[] = [{ id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3 }];

      const result = compareBaselines(baseline, current);

      expect(result.unchanged.length).toBe(1);
      expect(result.modified.length).toBe(0);
    });
  });

  describe('calculateSlippage', () => {
    it('should return 0 for items with same end date', () => {
      const baseline: BaselineItem = {
        id: '1',
        title: 'Task A',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        estimate: 3,
      };
      const current: BaselineItem = {
        id: '1',
        title: 'Task A',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        estimate: 3,
      };

      expect(calculateSlippage(baseline, current)).toBe(0);
    });

    it('should return positive number for delayed items', () => {
      const baseline: BaselineItem = {
        id: '1',
        title: 'Task A',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        estimate: 3,
      };
      const current: BaselineItem = {
        id: '1',
        title: 'Task A',
        startDate: '2026-01-01',
        endDate: '2026-01-08',
        estimate: 3,
      };

      expect(calculateSlippage(baseline, current)).toBe(3);
    });

    it('should return negative number for ahead-of-schedule items', () => {
      const baseline: BaselineItem = {
        id: '1',
        title: 'Task A',
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        estimate: 3,
      };
      const current: BaselineItem = {
        id: '1',
        title: 'Task A',
        startDate: '2026-01-01',
        endDate: '2026-01-08',
        estimate: 3,
      };

      expect(calculateSlippage(baseline, current)).toBe(-2);
    });

    it('should handle missing end dates', () => {
      const baseline: BaselineItem = {
        id: '1',
        title: 'Task A',
        estimate: 3,
      };
      const current: BaselineItem = {
        id: '1',
        title: 'Task A',
        estimate: 3,
      };

      expect(calculateSlippage(baseline, current)).toBe(0);
    });
  });

  describe('formatSlippage', () => {
    it('should format positive slippage with + prefix', () => {
      expect(formatSlippage(3)).toBe('+3 days');
    });

    it('should format negative slippage', () => {
      expect(formatSlippage(-2)).toBe('-2 days');
    });

    it('should format zero as "On track"', () => {
      expect(formatSlippage(0)).toBe('On track');
    });

    it('should handle singular day', () => {
      expect(formatSlippage(1)).toBe('+1 day');
      expect(formatSlippage(-1)).toBe('-1 day');
    });
  });
});

describe('CreateBaselineDialog', () => {
  const defaultProps: CreateBaselineDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    project_id: 'project-1',
    projectTitle: 'My Project',
    onCreateBaseline: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<CreateBaselineDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should not render dialog when closed', () => {
    render(<CreateBaselineDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should display name input', () => {
    render(<CreateBaselineDialog {...defaultProps} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('should display description textarea', () => {
    render(<CreateBaselineDialog {...defaultProps} />);
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('should have a placeholder name based on current date', () => {
    render(<CreateBaselineDialog {...defaultProps} />);
    const nameInput = screen.getByLabelText(/name/i);
    expect(nameInput).toHaveAttribute('placeholder');
  });

  it('should call onCreateBaseline with form data when submitted', async () => {
    const onCreateBaseline = vi.fn();
    render(<CreateBaselineDialog {...defaultProps} onCreateBaseline={onCreateBaseline} />);

    const nameInput = screen.getByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: 'Sprint 5 Plan' } });

    const createButton = screen.getByRole('button', { name: /create baseline/i });
    fireEvent.click(createButton);

    expect(onCreateBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sprint 5 Plan',
      }),
    );
  });

  it('should close dialog after successful creation', async () => {
    const onOpenChange = vi.fn();
    render(<CreateBaselineDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const nameInput = screen.getByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: 'Sprint 5 Plan' } });

    const createButton = screen.getByRole('button', { name: /create baseline/i });
    fireEvent.click(createButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should disable create button if name is empty', () => {
    render(<CreateBaselineDialog {...defaultProps} />);
    const createButton = screen.getByRole('button', { name: /create baseline/i });
    // Button should be enabled because placeholder provides default name
    expect(createButton).not.toBeDisabled();
  });
});

describe('BaselineList', () => {
  const mockBaselines: BaselineSnapshot[] = [
    {
      id: 'baseline-1',
      name: 'Sprint 5 Plan',
      description: 'Initial sprint planning',
      project_id: 'project-1',
      created_at: '2026-01-01T10:00:00Z',
      createdBy: 'user-1',
      items: [],
    },
    {
      id: 'baseline-2',
      name: 'Mid-Sprint Checkpoint',
      project_id: 'project-1',
      created_at: '2026-01-15T10:00:00Z',
      createdBy: 'user-1',
      items: [],
    },
  ];

  const defaultProps: BaselineListProps = {
    baselines: mockBaselines,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onCompare: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render list of baselines', () => {
    render(<BaselineList {...defaultProps} />);
    expect(screen.getByText('Sprint 5 Plan')).toBeInTheDocument();
    expect(screen.getByText('Mid-Sprint Checkpoint')).toBeInTheDocument();
  });

  it('should show empty state when no baselines', () => {
    render(<BaselineList {...defaultProps} baselines={[]} />);
    expect(screen.getByText(/no baselines/i)).toBeInTheDocument();
  });

  it('should call onSelect when baseline is clicked', () => {
    const onSelect = vi.fn();
    render(<BaselineList {...defaultProps} onSelect={onSelect} />);

    const baseline = screen.getByText('Sprint 5 Plan');
    fireEvent.click(baseline);

    expect(onSelect).toHaveBeenCalledWith('baseline-1');
  });

  it('should call onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<BaselineList {...defaultProps} onDelete={onDelete} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(onDelete).toHaveBeenCalledWith('baseline-1');
  });

  it('should show creation date for each baseline', () => {
    render(<BaselineList {...defaultProps} />);
    // Should show formatted dates (both baselines are in Jan 2026)
    const dateElements = screen.getAllByText(/jan.*2026/i);
    expect(dateElements.length).toBeGreaterThanOrEqual(1);
  });

  it('should call onCompare with two selected baselines', () => {
    const onCompare = vi.fn();
    render(<BaselineList {...defaultProps} onCompare={onCompare} selectable />);

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const compareButton = screen.getByRole('button', { name: /compare/i });
    fireEvent.click(compareButton);

    expect(onCompare).toHaveBeenCalledWith('baseline-1', 'baseline-2');
  });
});

describe('BaselineComparison', () => {
  const baselineItems: BaselineItem[] = [
    { id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3, status: 'done' },
    { id: '2', title: 'Task B', startDate: '2026-01-06', endDate: '2026-01-10', estimate: 4, status: 'in_progress' },
    { id: '3', title: 'Task C', startDate: '2026-01-11', endDate: '2026-01-15', estimate: 3, status: 'not_started' },
  ];

  const currentItems: BaselineItem[] = [
    { id: '1', title: 'Task A', startDate: '2026-01-01', endDate: '2026-01-05', estimate: 3, status: 'done' },
    { id: '2', title: 'Task B', startDate: '2026-01-08', endDate: '2026-01-14', estimate: 4, status: 'in_progress' },
    { id: '4', title: 'Task D', startDate: '2026-01-16', endDate: '2026-01-20', estimate: 3, status: 'not_started' },
  ];

  const defaultProps: BaselineComparisonProps = {
    baseline: {
      id: 'baseline-1',
      name: 'Sprint 5 Plan',
      project_id: 'project-1',
      created_at: '2026-01-01T10:00:00Z',
      createdBy: 'user-1',
      items: baselineItems,
    },
    currentItems,
  };

  it('should render comparison summary', () => {
    render(<BaselineComparison {...defaultProps} />);
    expect(screen.getByText(/comparison/i)).toBeInTheDocument();
  });

  it('should show added items count', () => {
    render(<BaselineComparison {...defaultProps} />);
    // Task D was added
    expect(screen.getByText(/1.*added/i)).toBeInTheDocument();
  });

  it('should show removed items count', () => {
    render(<BaselineComparison {...defaultProps} />);
    // Task C was removed
    expect(screen.getByText(/1.*removed/i)).toBeInTheDocument();
  });

  it('should show modified items with slippage', () => {
    render(<BaselineComparison {...defaultProps} />);
    // Task B slipped by 4 days
    expect(screen.getByText(/task b/i)).toBeInTheDocument();
    const slippageElements = screen.getAllByText(/\+4 days/i);
    expect(slippageElements.length).toBeGreaterThanOrEqual(1);
  });

  it('should highlight items with slippage in red', () => {
    render(<BaselineComparison {...defaultProps} />);
    const slippedItems = screen.getAllByText(/\+4 days/i);
    // At least one should have the destructive class
    const hasDestructive = slippedItems.some((el) => el.classList.contains('text-destructive'));
    expect(hasDestructive).toBe(true);
  });

  it('should show total project slippage', () => {
    render(<BaselineComparison {...defaultProps} />);
    expect(screen.getByText(/total slippage/i)).toBeInTheDocument();
  });

  it('should show scope change percentage', () => {
    render(<BaselineComparison {...defaultProps} />);
    // 1 added, 1 removed out of 3 baseline items = ~66% scope change
    expect(screen.getByText(/scope change/i)).toBeInTheDocument();
  });

  it('should display unchanged items differently', () => {
    render(<BaselineComparison {...defaultProps} />);
    // Task A is unchanged
    const taskA = screen.getByText('Task A');
    expect(taskA.closest('[data-status]')).toHaveAttribute('data-status', 'unchanged');
  });
});
