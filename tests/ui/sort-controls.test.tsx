/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { SortControls } from '@/ui/components/sort-controls';
import { useSortState, sortItems } from '@/ui/components/sort-controls/use-sort-state';
import type { SortState, SortField } from '@/ui/components/sort-controls/types';

describe('SortControls', () => {
  const defaultProps = {
    sort: { field: 'created', direction: 'desc' } as SortState,
    onSortChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the sort controls', () => {
      render(<SortControls {...defaultProps} />);
      expect(screen.getByTestId('sort-controls')).toBeInTheDocument();
    });

    it('shows current sort field', () => {
      render(<SortControls {...defaultProps} />);
      expect(screen.getByText(/created/i)).toBeInTheDocument();
    });

    it('shows sort by button', () => {
      render(<SortControls {...defaultProps} />);
      expect(screen.getByRole('button', { name: /sort by/i })).toBeInTheDocument();
    });

    it('shows toggle direction button', () => {
      render(<SortControls {...defaultProps} />);
      expect(screen.getByRole('button', { name: /toggle sort direction/i })).toBeInTheDocument();
    });
  });

  describe('direction toggle', () => {
    it('toggles direction when direction button clicked', () => {
      const onSortChange = vi.fn();
      render(<SortControls {...defaultProps} onSortChange={onSortChange} />);

      fireEvent.click(screen.getByRole('button', { name: /toggle sort direction/i }));

      expect(onSortChange).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'asc' })
      );
    });

    it('toggles from asc to desc', () => {
      const onSortChange = vi.fn();
      render(
        <SortControls
          {...defaultProps}
          sort={{ field: 'created', direction: 'asc' }}
          onSortChange={onSortChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /toggle sort direction/i }));

      expect(onSortChange).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'desc' })
      );
    });
  });

  describe('secondary sort', () => {
    it('shows secondary sort when enabled', () => {
      render(<SortControls {...defaultProps} showSecondarySort />);
      expect(screen.getByText(/then by/i)).toBeInTheDocument();
    });

    it('shows then by button', () => {
      render(<SortControls {...defaultProps} showSecondarySort />);
      expect(screen.getByRole('button', { name: /then by/i })).toBeInTheDocument();
    });

    it('does not show secondary sort by default', () => {
      render(<SortControls {...defaultProps} />);
      expect(screen.queryByText(/then by/i)).not.toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('applies compact styles', () => {
      render(<SortControls {...defaultProps} compact />);
      const sortButton = screen.getByRole('button', { name: /sort by/i });
      expect(sortButton).toHaveClass('h-7');
    });
  });
});

describe('useSortState', () => {
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => mockLocalStorage[key] || null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage[key] = value;
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes with default sort', () => {
    const { result } = renderHook(() => useSortState('test-view'));
    expect(result.current.sort.field).toBe('created');
    expect(result.current.sort.direction).toBe('desc');
  });

  it('initializes with custom default sort', () => {
    const { result } = renderHook(() =>
      useSortState('test-view', { field: 'priority', direction: 'asc' })
    );
    expect(result.current.sort.field).toBe('priority');
    expect(result.current.sort.direction).toBe('asc');
  });

  it('updates sort when setSort is called', () => {
    const { result } = renderHook(() => useSortState('test-view'));

    act(() => {
      result.current.setSort({ field: 'priority', direction: 'desc' });
    });

    expect(result.current.sort.field).toBe('priority');
    expect(result.current.sort.direction).toBe('desc');
  });

  it('toggles direction when toggleDirection is called', () => {
    const { result } = renderHook(() => useSortState('test-view'));

    act(() => {
      result.current.toggleDirection();
    });

    expect(result.current.sort.direction).toBe('asc');
  });

  it('sets field when setField is called', () => {
    const { result } = renderHook(() => useSortState('test-view'));

    act(() => {
      result.current.setField('priority');
    });

    expect(result.current.sort.field).toBe('priority');
  });

  it('persists sort to localStorage', () => {
    const { result } = renderHook(() => useSortState('test-view'));

    act(() => {
      result.current.setSort({ field: 'priority', direction: 'desc' });
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'openclaw-sort-test-view',
      expect.any(String)
    );
  });

  it('loads saved sort from localStorage', () => {
    mockLocalStorage['openclaw-sort-test-view'] = JSON.stringify({
      field: 'priority',
      direction: 'asc',
    });

    const { result } = renderHook(() => useSortState('test-view'));
    expect(result.current.sort.field).toBe('priority');
    expect(result.current.sort.direction).toBe('asc');
  });

  it('sets secondary sort', () => {
    const { result } = renderHook(() => useSortState('test-view'));

    act(() => {
      result.current.setSecondarySort('title', 'asc');
    });

    expect(result.current.sort.secondaryField).toBe('title');
    expect(result.current.sort.secondaryDirection).toBe('asc');
  });

  it('clears secondary sort', () => {
    const { result } = renderHook(() => useSortState('test-view'));

    act(() => {
      result.current.setSecondarySort('title', 'asc');
    });

    act(() => {
      result.current.clearSecondarySort();
    });

    expect(result.current.sort.secondaryField).toBeUndefined();
  });

  it('generates query string', () => {
    const { result } = renderHook(() => useSortState('test-view'));
    expect(result.current.queryString).toBe('sort=created:desc');

    act(() => {
      result.current.setSecondarySort('title', 'asc');
    });

    expect(result.current.queryString).toBe('sort=created:desc,title:asc');
  });
});

describe('sortItems', () => {
  const items = [
    { id: '1', title: 'Alpha', priority: 'low', created: '2024-01-01' },
    { id: '2', title: 'Charlie', priority: 'high', created: '2024-01-03' },
    { id: '3', title: 'Bravo', priority: 'medium', created: '2024-01-02' },
  ];

  it('sorts by title ascending', () => {
    const sorted = sortItems(items, { field: 'title', direction: 'asc' });
    expect(sorted.map((i) => i.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by title descending', () => {
    const sorted = sortItems(items, { field: 'title', direction: 'desc' });
    expect(sorted.map((i) => i.title)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts by priority with correct order', () => {
    const sorted = sortItems(items, { field: 'priority', direction: 'desc' });
    // High > Medium > Low
    expect(sorted.map((i) => i.priority)).toEqual(['high', 'medium', 'low']);
  });

  it('sorts by created date', () => {
    const sorted = sortItems(items, { field: 'created', direction: 'desc' });
    expect(sorted.map((i) => i.created)).toEqual([
      '2024-01-03',
      '2024-01-02',
      '2024-01-01',
    ]);
  });

  it('handles secondary sort', () => {
    const itemsWithSamePriority = [
      { id: '1', title: 'Zebra', priority: 'high', created: '2024-01-01' },
      { id: '2', title: 'Apple', priority: 'high', created: '2024-01-02' },
      { id: '3', title: 'Banana', priority: 'low', created: '2024-01-03' },
    ];

    const sorted = sortItems(itemsWithSamePriority, {
      field: 'priority',
      direction: 'desc',
      secondaryField: 'title',
      secondaryDirection: 'asc',
    });

    // Should be: high items sorted by title (Apple, Zebra), then low (Banana)
    expect(sorted.map((i) => i.title)).toEqual(['Apple', 'Zebra', 'Banana']);
  });

  it('handles null/undefined values', () => {
    const itemsWithNull = [
      { id: '1', title: 'Alpha', priority: 'low', dueDate: '2024-01-01' },
      { id: '2', title: 'Bravo', priority: 'high', dueDate: undefined },
      { id: '3', title: 'Charlie', priority: 'medium', dueDate: '2024-01-02' },
    ];

    const sorted = sortItems(itemsWithNull as any, { field: 'dueDate', direction: 'asc' });
    // Undefined values should sort to end
    expect(sorted[sorted.length - 1].dueDate).toBeUndefined();
  });

  it('does not modify original array', () => {
    const original = [...items];
    sortItems(items, { field: 'title', direction: 'asc' });
    expect(items).toEqual(original);
  });
});
