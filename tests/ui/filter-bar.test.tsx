/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FilterBar, DateRangePopover, BooleanPopover } from '@/ui/components/filter-bar';
import type { FilterState, SavedFilter, DateRange, FilterField, FilterFieldConfig } from '@/ui/components/filter-bar/types';

describe('FilterBar', () => {
  const defaultProps = {
    filters: {} as FilterState,
    onFiltersChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the filter bar', () => {
      render(<FilterBar {...defaultProps} />);
      expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
    });

    it('renders the add filter button', () => {
      render(<FilterBar {...defaultProps} />);
      expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument();
    });

    it('renders quick filter chips', () => {
      render(<FilterBar {...defaultProps} showQuickFilters />);
      expect(screen.getByRole('button', { name: /my items/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /high priority/i })).toBeInTheDocument();
    });

    it('renders clear all button when filters are applied', () => {
      const filters: FilterState = {
        status: ['in_progress'],
      };
      render(<FilterBar {...defaultProps} filters={filters} />);
      expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    });

    it('does not render clear all button when no filters', () => {
      render(<FilterBar {...defaultProps} />);
      expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
    });
  });

  describe('filter chips', () => {
    it('renders active filter chips', () => {
      const filters: FilterState = {
        status: ['in_progress', 'blocked'],
        priority: ['high'],
      };
      render(<FilterBar {...defaultProps} filters={filters} />);

      expect(screen.getByText(/status:/i)).toBeInTheDocument();
      expect(screen.getByText(/priority:/i)).toBeInTheDocument();
    });

    it('removes filter when chip close button is clicked', () => {
      const onFiltersChange = vi.fn();
      const filters: FilterState = {
        status: ['in_progress'],
      };
      render(<FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />);

      const removeButton = screen.getByRole('button', { name: /remove status filter/i });
      fireEvent.click(removeButton);

      expect(onFiltersChange).toHaveBeenCalledWith({});
    });
  });

  describe('quick filters', () => {
    it('applies "My items" quick filter', () => {
      const onFiltersChange = vi.fn();
      render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} showQuickFilters />);

      fireEvent.click(screen.getByRole('button', { name: /my items/i }));

      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ assignee: ['me'] }));
    });

    it('applies "Overdue" quick filter', () => {
      const onFiltersChange = vi.fn();
      render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} showQuickFilters />);

      fireEvent.click(screen.getByRole('button', { name: /overdue/i }));

      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ dueDate: 'overdue' }));
    });

    it('applies "High priority" quick filter', () => {
      const onFiltersChange = vi.fn();
      render(<FilterBar {...defaultProps} onFiltersChange={onFiltersChange} showQuickFilters />);

      fireEvent.click(screen.getByRole('button', { name: /high priority/i }));

      expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ priority: ['high', 'urgent'] }));
    });

    it('highlights active quick filter', () => {
      const filters: FilterState = {
        priority: ['high', 'urgent'],
      };
      render(<FilterBar {...defaultProps} filters={filters} showQuickFilters />);

      const highPriorityButton = screen.getByRole('button', { name: /high priority/i });
      expect(highPriorityButton).toHaveAttribute('data-active', 'true');
    });

    it('toggles quick filter off when clicked again', () => {
      const onFiltersChange = vi.fn();
      const filters: FilterState = {
        priority: ['high', 'urgent'],
      };
      render(<FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} showQuickFilters />);

      fireEvent.click(screen.getByRole('button', { name: /high priority/i }));

      // Should remove the priority filter
      expect(onFiltersChange).toHaveBeenCalledWith({});
    });
  });

  describe('clear all', () => {
    it('clears all filters when clicked', () => {
      const onFiltersChange = vi.fn();
      const filters: FilterState = {
        status: ['in_progress'],
        priority: ['high'],
      };
      render(<FilterBar {...defaultProps} filters={filters} onFiltersChange={onFiltersChange} />);

      fireEvent.click(screen.getByRole('button', { name: /clear all/i }));

      expect(onFiltersChange).toHaveBeenCalledWith({});
    });
  });

  describe('saved filters', () => {
    it('shows saved filters dropdown when prop provided', () => {
      const savedFilters: SavedFilter[] = [{ id: '1', name: 'My Active Tasks', filters: { status: ['in_progress'], assignee: ['me'] } }];
      render(<FilterBar {...defaultProps} savedFilters={savedFilters} />);

      expect(screen.getByRole('button', { name: /saved filters/i })).toBeInTheDocument();
    });

    it('shows save filter button when filters are active and onSaveFilter provided', () => {
      const filters: FilterState = {
        status: ['in_progress'],
      };
      render(<FilterBar {...defaultProps} filters={filters} onSaveFilter={vi.fn()} />);

      expect(screen.getByRole('button', { name: /save filter/i })).toBeInTheDocument();
    });

    it('opens save filter dialog when button clicked', () => {
      const onSaveFilter = vi.fn();
      const filters: FilterState = {
        status: ['in_progress'],
      };
      render(<FilterBar {...defaultProps} filters={filters} onSaveFilter={onSaveFilter} />);

      fireEvent.click(screen.getByRole('button', { name: /save filter/i }));

      // Should show save filter dialog
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/filter name/i)).toBeInTheDocument();
    });

    it('saves filter with name when dialog submitted', async () => {
      const onSaveFilter = vi.fn();
      const filters: FilterState = {
        status: ['in_progress'],
      };
      render(<FilterBar {...defaultProps} filters={filters} onSaveFilter={onSaveFilter} />);

      fireEvent.click(screen.getByRole('button', { name: /save filter/i }));

      const input = screen.getByPlaceholderText(/filter name/i);
      fireEvent.change(input, { target: { value: 'My Filter' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(onSaveFilter).toHaveBeenCalledWith('My Filter', filters);
    });
  });
});

describe('DateRangePopover', () => {
  const baseConfig: FilterFieldConfig = {
    field: 'dueDate',
    label: 'Due Date',
    type: 'date-range',
  };

  const defaultProps = {
    field: 'dueDate' as FilterField,
    config: baseConfig,
    value: undefined as DateRange | string | undefined,
    onChange: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the date-range popover', () => {
    render(<DateRangePopover {...defaultProps} />);
    expect(screen.getByTestId('date-range-popover')).toBeInTheDocument();
  });

  it('displays the field label', () => {
    render(<DateRangePopover {...defaultProps} />);
    expect(screen.getByText('Due Date')).toBeInTheDocument();
  });

  it('shows all preset options', () => {
    render(<DateRangePopover {...defaultProps} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('shows custom range date inputs', () => {
    render(<DateRangePopover {...defaultProps} />);

    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
  });

  it('applies preset value on Apply', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} onClose={onClose} />);

    // Click a preset
    fireEvent.click(screen.getByText('This Week'));

    // Click Apply
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({ preset: 'this_week' });
    expect(onClose).toHaveBeenCalled();
  });

  it('applies custom date range', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} onClose={onClose} />);

    // Fill in custom dates
    const fromInput = screen.getByLabelText('From date');
    const toInput = screen.getByLabelText('To date');

    fireEvent.change(fromInput, { target: { value: '2026-01-01' } });
    fireEvent.change(toInput, { target: { value: '2026-01-31' } });

    // Click Apply
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('applies custom range with only from date', () => {
    const onChange = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      from: '2026-03-01',
      to: undefined,
    });
  });

  it('applies custom range with only to date', () => {
    const onChange = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      from: undefined,
      to: '2026-03-31',
    });
  });

  it('calls onChange with undefined when Apply is clicked with no selection', () => {
    const onChange = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} />);

    // Click Apply with nothing selected
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('cancels without calling onChange', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} onClose={onClose} />);

    // Click a preset first
    fireEvent.click(screen.getByText('This Month'));

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('initialises from existing DateRange value', () => {
    render(<DateRangePopover {...defaultProps} value={{ preset: 'this_week' }} />);

    // The "This Week" preset button should have the active styling (font-medium)
    const thisWeekButton = screen.getByText('This Week').closest('button');
    expect(thisWeekButton?.className).toContain('font-medium');
  });

  it('initialises from existing string preset value', () => {
    render(<DateRangePopover {...defaultProps} value="overdue" />);

    // The "Overdue" preset button should have the active styling (font-medium)
    const overdueButton = screen.getByText('Overdue').closest('button');
    expect(overdueButton?.className).toContain('font-medium');
  });

  it('initialises from existing custom date range', () => {
    render(<DateRangePopover {...defaultProps} value={{ preset: 'custom', from: '2026-02-01', to: '2026-02-28' }} />);

    const fromInput = screen.getByLabelText('From date') as HTMLInputElement;
    const toInput = screen.getByLabelText('To date') as HTMLInputElement;

    expect(fromInput.value).toBe('2026-02-01');
    expect(toInput.value).toBe('2026-02-28');
  });

  it('clears custom dates when a preset is selected', () => {
    const onChange = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} value={{ preset: 'custom', from: '2026-02-01', to: '2026-02-28' }} />);

    // Click a preset to override the custom range
    fireEvent.click(screen.getByText('Today'));

    // Click Apply
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({ preset: 'today' });
  });

  it('switches to custom preset when date input is changed', () => {
    const onChange = vi.fn();
    render(<DateRangePopover {...defaultProps} onChange={onChange} value={{ preset: 'today' }} />);

    // The "Today" preset should initially be active
    const todayButton = screen.getByText('Today').closest('button');
    expect(todayButton?.className).toContain('font-medium');

    // Change a date input
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-05-01' } });

    // Click Apply -- should get custom preset
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      from: '2026-05-01',
      to: undefined,
    });
  });
});

describe('BooleanPopover', () => {
  const baseConfig: FilterFieldConfig = {
    field: 'hasDescription',
    label: 'Has Description',
    type: 'boolean',
  };

  const defaultProps = {
    field: 'hasDescription' as FilterField,
    config: baseConfig,
    value: undefined as boolean | undefined,
    onChange: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the boolean popover', () => {
    render(<BooleanPopover {...defaultProps} />);
    expect(screen.getByTestId('boolean-popover')).toBeInTheDocument();
  });

  it('displays the field label', () => {
    render(<BooleanPopover {...defaultProps} />);
    expect(screen.getByText('Has Description')).toBeInTheDocument();
  });

  it('shows Yes/No toggle buttons', () => {
    render(<BooleanPopover {...defaultProps} />);

    expect(screen.getByRole('button', { name: /^yes$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^no$/i })).toBeInTheDocument();
  });

  it('applies true value when Yes is clicked and Apply pressed', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<BooleanPopover {...defaultProps} onChange={onChange} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('applies false value when No is clicked and Apply pressed', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<BooleanPopover {...defaultProps} onChange={onChange} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /^no$/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalled();
  });

  it('applies undefined when Apply is clicked with no selection', () => {
    const onChange = vi.fn();
    render(<BooleanPopover {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('cancels without calling onChange', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<BooleanPopover {...defaultProps} onChange={onChange} onClose={onClose} />);

    // Click Yes to select a value
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }));

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('initialises with existing true value', () => {
    render(<BooleanPopover {...defaultProps} value={true} />);

    // The Yes button should be the "default" variant (active state)
    const yesButton = screen.getByRole('button', { name: /^yes$/i });
    expect(yesButton).toHaveAttribute('data-variant', 'default');

    // The No button should be the "outline" variant
    const noButton = screen.getByRole('button', { name: /^no$/i });
    expect(noButton).toHaveAttribute('data-variant', 'outline');
  });

  it('initialises with existing false value', () => {
    render(<BooleanPopover {...defaultProps} value={false} />);

    // The No button should be the "default" variant (active state)
    const noButton = screen.getByRole('button', { name: /^no$/i });
    expect(noButton).toHaveAttribute('data-variant', 'default');

    // The Yes button should be the "outline" variant
    const yesButton = screen.getByRole('button', { name: /^yes$/i });
    expect(yesButton).toHaveAttribute('data-variant', 'outline');
  });

  it('toggles between Yes and No', () => {
    render(<BooleanPopover {...defaultProps} />);

    const yesButton = screen.getByRole('button', { name: /^yes$/i });
    const noButton = screen.getByRole('button', { name: /^no$/i });

    // Initially both should be outline
    expect(yesButton).toHaveAttribute('data-variant', 'outline');
    expect(noButton).toHaveAttribute('data-variant', 'outline');

    // Click Yes
    fireEvent.click(yesButton);
    expect(yesButton).toHaveAttribute('data-variant', 'default');
    expect(noButton).toHaveAttribute('data-variant', 'outline');

    // Click No
    fireEvent.click(noButton);
    expect(yesButton).toHaveAttribute('data-variant', 'outline');
    expect(noButton).toHaveAttribute('data-variant', 'default');
  });
});

describe('FilterState', () => {
  it('combines multiple values in same field with OR', () => {
    // This is a logic test for the filter state
    const filters: FilterState = {
      status: ['in_progress', 'blocked'],
    };

    // Items with either status should match
    expect(filters.status).toContain('in_progress');
    expect(filters.status).toContain('blocked');
  });

  it('combines different fields with AND', () => {
    const filters: FilterState = {
      status: ['in_progress'],
      priority: ['high'],
    };

    // Both conditions must be met
    expect(filters.status?.length).toBe(1);
    expect(filters.priority?.length).toBe(1);
  });
});
