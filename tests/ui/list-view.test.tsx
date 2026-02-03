/**
 * @vitest-environment jsdom
 * Tests for list view with configurable columns
 * Issue #407: Implement list view with configurable columns
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  ListView,
  type ListViewProps,
} from '@/ui/components/list-view/list-view';
import {
  ColumnConfig,
  type ColumnConfigProps,
} from '@/ui/components/list-view/column-config';
import {
  ListHeader,
  type ListHeaderProps,
} from '@/ui/components/list-view/list-header';
import {
  ListRow,
  type ListRowProps,
} from '@/ui/components/list-view/list-row';
import type {
  Column,
  ColumnDefinition,
  ListItem,
} from '@/ui/components/list-view/types';

// Mock data
const mockColumns: ColumnDefinition[] = [
  { id: 'title', label: 'Title', width: 250, sortable: true, required: true },
  { id: 'status', label: 'Status', width: 100, sortable: true },
  { id: 'priority', label: 'Priority', width: 100, sortable: true },
  { id: 'assignee', label: 'Assignee', width: 150, sortable: true },
  { id: 'dueDate', label: 'Due Date', width: 120, sortable: true },
  { id: 'createdAt', label: 'Created', width: 120, sortable: true },
];

const mockItems: ListItem[] = [
  {
    id: 'item-1',
    title: 'Implement feature A',
    status: 'open',
    priority: 'high',
    assignee: 'Alice',
    dueDate: '2026-03-01',
    createdAt: '2026-01-15',
  },
  {
    id: 'item-2',
    title: 'Fix bug in module B',
    status: 'in_progress',
    priority: 'medium',
    assignee: 'Bob',
    dueDate: '2026-02-15',
    createdAt: '2026-01-20',
  },
  {
    id: 'item-3',
    title: 'Write documentation',
    status: 'closed',
    priority: 'low',
    assignee: null,
    dueDate: null,
    createdAt: '2026-01-10',
  },
];

describe('ListView', () => {
  const defaultProps: ListViewProps = {
    items: mockItems,
    columns: mockColumns,
    onRowClick: vi.fn(),
    onSelectionChange: vi.fn(),
    onSort: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render table with items', () => {
    render(<ListView {...defaultProps} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Implement feature A')).toBeInTheDocument();
    expect(screen.getByText('Fix bug in module B')).toBeInTheDocument();
    expect(screen.getByText('Write documentation')).toBeInTheDocument();
  });

  it('should render column headers', () => {
    render(<ListView {...defaultProps} />);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
  });

  it('should call onRowClick when row clicked', () => {
    const onRowClick = vi.fn();
    render(<ListView {...defaultProps} onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText('Implement feature A'));

    expect(onRowClick).toHaveBeenCalledWith(mockItems[0]);
  });

  it('should show checkboxes for selection', () => {
    render(<ListView {...defaultProps} selectable />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('should call onSelectionChange when items selected', () => {
    const onSelectionChange = vi.fn();
    render(
      <ListView
        {...defaultProps}
        selectable
        onSelectionChange={onSelectionChange}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // First item checkbox (0 is header)

    expect(onSelectionChange).toHaveBeenCalledWith(['item-1']);
  });

  it('should support select all', () => {
    const onSelectionChange = vi.fn();
    render(
      <ListView
        {...defaultProps}
        selectable
        onSelectionChange={onSelectionChange}
      />
    );

    const headerCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(headerCheckbox);

    expect(onSelectionChange).toHaveBeenCalledWith(['item-1', 'item-2', 'item-3']);
  });

  it('should show empty state when no items', () => {
    render(<ListView {...defaultProps} items={[]} />);
    expect(screen.getByText(/no items/i)).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(<ListView {...defaultProps} loading />);
    expect(screen.getByTestId('list-loading')).toBeInTheDocument();
  });

  it('should call onSort when column header clicked', () => {
    const onSort = vi.fn();
    render(<ListView {...defaultProps} onSort={onSort} />);

    fireEvent.click(screen.getByText('Title'));

    expect(onSort).toHaveBeenCalledWith('title', 'asc');
  });

  it('should toggle sort direction on repeated clicks', () => {
    const onSort = vi.fn();
    render(
      <ListView
        {...defaultProps}
        onSort={onSort}
        sortColumn="title"
        sortDirection="asc"
      />
    );

    fireEvent.click(screen.getByText('Title'));

    expect(onSort).toHaveBeenCalledWith('title', 'desc');
  });

  it('should show sort indicator on sorted column', () => {
    render(
      <ListView
        {...defaultProps}
        sortColumn="title"
        sortDirection="asc"
      />
    );

    const titleHeader = screen.getByText('Title').closest('th');
    expect(titleHeader).toHaveAttribute('data-sorted', 'true');
  });

  it('should highlight selected rows', () => {
    render(
      <ListView
        {...defaultProps}
        selectable
        selectedIds={['item-1']}
      />
    );

    const row = screen.getByTestId('list-row-item-1');
    expect(row).toHaveAttribute('data-selected', 'true');
  });
});

describe('ListHeader', () => {
  const defaultProps: ListHeaderProps = {
    columns: mockColumns,
    onSort: vi.fn(),
    selectable: false,
    allSelected: false,
    onSelectAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render column headers', () => {
    render(
      <table>
        <ListHeader {...defaultProps} />
      </table>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('should show select all checkbox when selectable', () => {
    render(
      <table>
        <ListHeader {...defaultProps} selectable />
      </table>
    );
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('should call onSelectAll when checkbox clicked', () => {
    const onSelectAll = vi.fn();
    render(
      <table>
        <ListHeader {...defaultProps} selectable onSelectAll={onSelectAll} />
      </table>
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onSelectAll).toHaveBeenCalled();
  });

  it('should show checked state when all selected', () => {
    render(
      <table>
        <ListHeader {...defaultProps} selectable allSelected />
      </table>
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('should call onSort with column id', () => {
    const onSort = vi.fn();
    render(
      <table>
        <ListHeader {...defaultProps} onSort={onSort} />
      </table>
    );

    fireEvent.click(screen.getByText('Status'));

    expect(onSort).toHaveBeenCalledWith('status');
  });

  it('should not call onSort for non-sortable columns', () => {
    const onSort = vi.fn();
    const columnsWithNonSortable = [
      ...mockColumns.slice(0, -1),
      { id: 'actions', label: 'Actions', width: 80, sortable: false },
    ];
    render(
      <table>
        <ListHeader {...defaultProps} columns={columnsWithNonSortable} onSort={onSort} />
      </table>
    );

    fireEvent.click(screen.getByText('Actions'));

    expect(onSort).not.toHaveBeenCalled();
  });
});

describe('ListRow', () => {
  const mockItem = mockItems[0];
  const defaultProps: ListRowProps = {
    item: mockItem,
    columns: mockColumns,
    onClick: vi.fn(),
    selected: false,
    selectable: false,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render item data', () => {
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} />
        </tbody>
      </table>
    );
    expect(screen.getByText('Implement feature A')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} onClick={onClick} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText('Implement feature A'));

    expect(onClick).toHaveBeenCalledWith(mockItem);
  });

  it('should show checkbox when selectable', () => {
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} selectable />
        </tbody>
      </table>
    );
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('should call onSelect when checkbox clicked', () => {
    const onSelect = vi.fn();
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} selectable onSelect={onSelect} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onSelect).toHaveBeenCalledWith(mockItem.id);
  });

  it('should show selected state', () => {
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} selectable selected />
        </tbody>
      </table>
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('should have data-selected attribute when selected', () => {
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} selected />
        </tbody>
      </table>
    );

    const row = screen.getByTestId(`list-row-${mockItem.id}`);
    expect(row).toHaveAttribute('data-selected', 'true');
  });

  it('should handle null values gracefully', () => {
    const itemWithNulls = mockItems[2]; // Has null assignee and dueDate
    render(
      <table>
        <tbody>
          <ListRow {...defaultProps} item={itemWithNulls} />
        </tbody>
      </table>
    );
    expect(screen.getByText('Write documentation')).toBeInTheDocument();
  });
});

describe('ColumnConfig', () => {
  const defaultProps: ColumnConfigProps = {
    columns: mockColumns,
    visibleColumns: ['title', 'status', 'priority', 'assignee'],
    onColumnsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render column config button', () => {
    render(<ColumnConfig {...defaultProps} />);
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument();
  });

  it('should show column list when clicked', () => {
    render(<ColumnConfig {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Due Date')).toBeInTheDocument();
  });

  it('should show checkboxes for column visibility', () => {
    render(<ColumnConfig {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(mockColumns.length);
  });

  it('should show checked state for visible columns', () => {
    render(<ColumnConfig {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    // Find the checkbox for 'status' which is visible
    const statusCheckbox = screen.getByRole('checkbox', { name: /status/i });
    expect(statusCheckbox).toBeChecked();
  });

  it('should call onColumnsChange when toggling column', () => {
    const onColumnsChange = vi.fn();
    render(<ColumnConfig {...defaultProps} onColumnsChange={onColumnsChange} />);

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));
    // Toggle 'dueDate' which is not visible
    const dueDateCheckbox = screen.getByRole('checkbox', { name: /due date/i });
    fireEvent.click(dueDateCheckbox);

    expect(onColumnsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['title', 'status', 'priority', 'assignee', 'dueDate'])
    );
  });

  it('should not allow hiding required columns', () => {
    render(<ColumnConfig {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    // Title is required, its checkbox should be disabled
    const titleCheckbox = screen.getByRole('checkbox', { name: /title/i });
    expect(titleCheckbox).toBeDisabled();
  });

  it('should show reset to default button', () => {
    render(<ColumnConfig {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /columns/i }));

    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});
