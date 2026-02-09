/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { GroupBySelect } from '@/ui/components/grouping/group-by-select';
import { GroupedList } from '@/ui/components/grouping/grouped-list';
import { GroupHeader } from '@/ui/components/grouping/group-header';
import { useGrouping } from '@/ui/components/grouping/use-grouping';
import { groupItems, GroupField } from '@/ui/components/grouping/group-utils';
import type { GroupState } from '@/ui/components/grouping/types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

interface TestItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  kind: string;
  assigneeId?: string;
  parentId?: string;
  labels?: string[];
  dueDate?: string;
}

const mockItems: TestItem[] = [
  { id: '1', title: 'Item 1', status: 'not_started', priority: 'high', kind: 'issue' },
  { id: '2', title: 'Item 2', status: 'in_progress', priority: 'medium', kind: 'issue' },
  { id: '3', title: 'Item 3', status: 'not_started', priority: 'high', kind: 'epic' },
  { id: '4', title: 'Item 4', status: 'done', priority: 'low', kind: 'issue', assigneeId: 'user-1' },
  { id: '5', title: 'Item 5', status: 'in_progress', priority: 'urgent', kind: 'task', labels: ['bug'] },
];

describe('GroupBySelect', () => {
  const defaultProps = {
    value: 'none' as GroupField,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders group by dropdown', () => {
    render(<GroupBySelect {...defaultProps} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('displays current grouping option', () => {
    render(<GroupBySelect {...defaultProps} value="status" />);
    expect(screen.getByRole('combobox')).toHaveTextContent(/status/i);
  });

  it('shows all grouping options', () => {
    render(<GroupBySelect {...defaultProps} />);
    fireEvent.click(screen.getByRole('combobox'));

    // Use getAllByRole for options in the dropdown
    const options = screen.getAllByRole('option');
    const optionTexts = options.map((o) => o.textContent);

    expect(optionTexts).toContain('None');
    expect(optionTexts).toContain('Status');
    expect(optionTexts).toContain('Priority');
    expect(optionTexts).toContain('Kind');
    expect(optionTexts).toContain('Assignee');
  });

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn();
    render(<GroupBySelect {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText(/status/i));

    expect(onChange).toHaveBeenCalledWith('status');
  });
});

describe('GroupHeader', () => {
  it('renders group label', () => {
    render(<GroupHeader label="In Progress" count={5} isExpanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('renders item count', () => {
    render(<GroupHeader label="Done" count={10} isExpanded={true} onToggle={vi.fn()} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('shows expand icon when collapsed', () => {
    render(<GroupHeader label="Test" count={3} isExpanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows collapse icon when expanded', () => {
    render(<GroupHeader label="Test" count={3} isExpanded={true} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<GroupHeader label="Test" count={3} isExpanded={true} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('groupItems utility', () => {
  it('returns ungrouped when field is none', () => {
    const result = groupItems(mockItems, 'none');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('all');
    expect(result[0].items).toHaveLength(5);
  });

  it('groups by status', () => {
    const result = groupItems(mockItems, 'status');
    expect(result.length).toBeGreaterThan(1);

    const notStarted = result.find((g) => g.key === 'not_started');
    expect(notStarted?.items).toHaveLength(2);

    const inProgress = result.find((g) => g.key === 'in_progress');
    expect(inProgress?.items).toHaveLength(2);
  });

  it('groups by priority', () => {
    const result = groupItems(mockItems, 'priority');

    const high = result.find((g) => g.key === 'high');
    expect(high?.items).toHaveLength(2);
  });

  it('groups by kind', () => {
    const result = groupItems(mockItems, 'kind');

    const issues = result.find((g) => g.key === 'issue');
    expect(issues?.items).toHaveLength(3);
  });

  it('groups by assignee with unassigned group', () => {
    const result = groupItems(mockItems, 'assignee');

    const unassigned = result.find((g) => g.key === 'unassigned');
    expect(unassigned?.items).toHaveLength(4);

    const user1 = result.find((g) => g.key === 'user-1');
    expect(user1?.items).toHaveLength(1);
  });

  it('groups by due date', () => {
    const today = new Date().toISOString().split('T')[0];
    const items = [...mockItems, { id: '6', title: 'Due Today', status: 'not_started', priority: 'high', kind: 'issue', dueDate: today }];

    const result = groupItems(items, 'dueDate');

    const noDate = result.find((g) => g.key === 'no_date');
    expect(noDate?.items).toHaveLength(5);

    const todayGroup = result.find((g) => g.key === 'today');
    expect(todayGroup?.items).toHaveLength(1);
  });

  it('maintains group order', () => {
    const result = groupItems(mockItems, 'status');
    const keys = result.map((g) => g.key);

    // Status groups should be in logical order
    expect(keys.indexOf('not_started')).toBeLessThan(keys.indexOf('in_progress'));
    expect(keys.indexOf('in_progress')).toBeLessThan(keys.indexOf('done'));
  });
});

describe('useGrouping hook', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns default grouping state', () => {
    const { result } = renderHook(() => useGrouping('test-view'));

    expect(result.current.groupBy).toBe('none');
    expect(result.current.collapsedGroups).toEqual(new Set());
  });

  it('can set group by field', () => {
    const { result } = renderHook(() => useGrouping('test-view'));

    act(() => {
      result.current.setGroupBy('status');
    });

    expect(result.current.groupBy).toBe('status');
  });

  it('can toggle group collapse', () => {
    const { result } = renderHook(() => useGrouping('test-view'));

    act(() => {
      result.current.toggleGroup('in_progress');
    });

    expect(result.current.collapsedGroups.has('in_progress')).toBe(true);

    act(() => {
      result.current.toggleGroup('in_progress');
    });

    expect(result.current.collapsedGroups.has('in_progress')).toBe(false);
  });

  it('persists grouping to localStorage', () => {
    const { result } = renderHook(() => useGrouping('test-view'));

    act(() => {
      result.current.setGroupBy('priority');
    });

    const stored = localStorageMock.getItem('grouping-test-view');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.groupBy).toBe('priority');
  });

  it('loads grouping from localStorage', () => {
    localStorageMock.setItem('grouping-test-view', JSON.stringify({ groupBy: 'kind', collapsedGroups: ['epic'] }));

    const { result } = renderHook(() => useGrouping('test-view'));

    expect(result.current.groupBy).toBe('kind');
    expect(result.current.collapsedGroups.has('epic')).toBe(true);
  });
});

describe('GroupedList', () => {
  const mockRenderItem = (item: TestItem) => (
    <div key={item.id} data-testid={`item-${item.id}`}>
      {item.title}
    </div>
  );

  it('renders items without grouping', () => {
    render(<GroupedList items={mockItems} groupBy="none" renderItem={mockRenderItem} />);

    expect(screen.getByTestId('item-1')).toBeInTheDocument();
    expect(screen.getByTestId('item-5')).toBeInTheDocument();
  });

  it('renders grouped items with headers', () => {
    render(<GroupedList items={mockItems} groupBy="status" renderItem={mockRenderItem} />);

    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('shows item counts in headers', () => {
    render(<GroupedList items={mockItems} groupBy="status" renderItem={mockRenderItem} />);

    // 2 items in not_started
    const headers = screen.getAllByRole('button');
    expect(headers.some((h) => h.textContent?.includes('2'))).toBe(true);
  });

  it('collapses groups when clicked', () => {
    render(<GroupedList items={mockItems} groupBy="status" renderItem={mockRenderItem} />);

    // Click on the first group header to collapse
    const firstHeader = screen.getAllByRole('button')[0];
    fireEvent.click(firstHeader);

    // Should still render the header but not the items in that group
    expect(firstHeader).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides empty groups when hideEmpty is true', () => {
    const items = mockItems.filter((i) => i.status !== 'blocked');
    render(<GroupedList items={items} groupBy="status" renderItem={mockRenderItem} hideEmptyGroups />);

    expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
  });
});
