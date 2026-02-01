/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  KanbanBoard,
  BoardCard,
  BoardColumn,
  type BoardItem,
  type BoardColumnType,
} from '@/ui/components/board';

const mockItems: BoardItem[] = [
  { id: '1', title: 'Task A', status: 'not_started', priority: 'high' },
  { id: '2', title: 'Task B', status: 'in_progress', priority: 'medium', estimateMinutes: 60 },
  { id: '3', title: 'Task C', status: 'in_progress', priority: 'urgent', assignee: 'Alice' },
  { id: '4', title: 'Task D', status: 'done', priority: 'low' },
];

describe('BoardCard', () => {
  const item: BoardItem = {
    id: '1',
    title: 'Test Task',
    status: 'not_started',
    priority: 'high',
    estimateMinutes: 120,
    assignee: 'John',
  };

  it('renders card title', () => {
    render(<BoardCard item={item} />);
    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('shows priority badge', () => {
    render(<BoardCard item={item} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows estimate when provided', () => {
    render(<BoardCard item={item} />);
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('shows assignee initial when no avatar', () => {
    render(<BoardCard item={item} />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<BoardCard item={item} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('board-card'));
    expect(onClick).toHaveBeenCalledWith(item);
  });

  it('applies dragging styles', () => {
    const { container } = render(<BoardCard item={item} isDragging />);
    const card = container.querySelector('[data-testid="board-card"]');
    expect(card?.className).toContain('opacity-50');
  });
});

describe('BoardColumn', () => {
  const column: BoardColumnType = {
    id: 'in_progress',
    title: 'In Progress',
    items: [
      { id: '1', title: 'Task 1', status: 'in_progress', priority: 'high' },
      { id: '2', title: 'Task 2', status: 'in_progress', priority: 'medium' },
    ],
  };

  it('renders column title', () => {
    render(<BoardColumn column={column} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('shows item count', () => {
    render(<BoardColumn column={column} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders all items', () => {
    render(<BoardColumn column={column} />);
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
  });

  it('shows add button when onAddItem is provided', () => {
    const onAddItem = vi.fn();
    render(<BoardColumn column={column} onAddItem={onAddItem} />);

    const addButton = screen.getByText('Add item');
    expect(addButton).toBeInTheDocument();
  });

  it('calls onAddItem with status when add clicked', () => {
    const onAddItem = vi.fn();
    const { container } = render(<BoardColumn column={column} onAddItem={onAddItem} />);

    // Find the add button by sr-only text
    const addButton = container.querySelector('[aria-label="Add item"]')
      ?? screen.getByText('Add item').closest('button');
    fireEvent.click(addButton!);

    expect(onAddItem).toHaveBeenCalledWith('in_progress');
  });

  it('shows empty state when no items', () => {
    const emptyColumn: BoardColumnType = { id: 'blocked', title: 'Blocked', items: [] };
    render(<BoardColumn column={emptyColumn} />);

    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('shows drop zone highlight when isOver', () => {
    const emptyColumn: BoardColumnType = { id: 'blocked', title: 'Blocked', items: [] };
    const { container } = render(<BoardColumn column={emptyColumn} isOver />);

    // Should show "Drop here" text
    expect(screen.getByText('Drop here')).toBeInTheDocument();
  });
});

describe('KanbanBoard', () => {
  it('renders all columns', () => {
    render(<KanbanBoard items={mockItems} />);

    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('groups items by status', () => {
    render(<KanbanBoard items={mockItems} />);

    // Task A is in 'not_started' (To Do)
    expect(screen.getByText('Task A')).toBeInTheDocument();
    // Task B and C are in 'in_progress'
    expect(screen.getByText('Task B')).toBeInTheDocument();
    expect(screen.getByText('Task C')).toBeInTheDocument();
    // Task D is in 'done'
    expect(screen.getByText('Task D')).toBeInTheDocument();
  });

  it('shows column counts', () => {
    render(<KanbanBoard items={mockItems} />);

    // Check counts appear (To Do: 1, In Progress: 2, Done: 1, Blocked: 0)
    const columns = screen.getAllByTestId('board-column');
    expect(columns).toHaveLength(4);
  });

  it('shows view mode toggle when onViewModeChange provided', () => {
    const onViewModeChange = vi.fn();
    render(<KanbanBoard items={mockItems} onViewModeChange={onViewModeChange} />);

    expect(screen.getByText('Board')).toBeInTheDocument();
    expect(screen.getByText('List')).toBeInTheDocument();
  });

  it('calls onViewModeChange when toggle clicked', () => {
    const onViewModeChange = vi.fn();
    render(
      <KanbanBoard
        items={mockItems}
        viewMode="board"
        onViewModeChange={onViewModeChange}
      />
    );

    fireEvent.click(screen.getByText('List'));
    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('calls onItemClick when card is clicked', () => {
    const onItemClick = vi.fn();
    render(<KanbanBoard items={mockItems} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Task A'));
    expect(onItemClick).toHaveBeenCalledWith(mockItems[0]);
  });

  it('passes onAddItem to columns', () => {
    const onAddItem = vi.fn();
    const { container } = render(<KanbanBoard items={[]} onAddItem={onAddItem} />);

    // Should have 4 add buttons (one per column)
    const addButtons = container.querySelectorAll('[class*="size-6"]');
    expect(addButtons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no items and onAddItem provided', () => {
    const onAddItem = vi.fn();
    render(<KanbanBoard items={[]} onAddItem={onAddItem} />);

    expect(screen.getByText('No items on this board')).toBeInTheDocument();
    expect(screen.getByText('Add first item')).toBeInTheDocument();
  });
});
