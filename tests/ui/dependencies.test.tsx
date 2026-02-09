/**
 * @vitest-environment jsdom
 * Tests for dependency management components
 * Issue #390: Implement dependency creation UI
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';

// Components to be implemented
import { AddDependencyDialog, type AddDependencyDialogProps } from '@/ui/components/dependencies/add-dependency-dialog';
import { DependencyItem, type DependencyItemProps } from '@/ui/components/dependencies/dependency-item';
import { detectCircularDependency, getDependencyTypeLabel, isValidDependency, type DependencyGraph } from '@/ui/components/dependencies/dependency-utils';
import type { DependencyType, DependencyDirection, WorkItemSummary } from '@/ui/components/dependencies/types';

describe('Dependency Utils', () => {
  describe('detectCircularDependency', () => {
    it('should return false for empty graph', () => {
      const graph: DependencyGraph = new Map();
      expect(detectCircularDependency(graph, 'a', 'b')).toBe(false);
    });

    it('should return true for direct self-reference', () => {
      const graph: DependencyGraph = new Map();
      expect(detectCircularDependency(graph, 'a', 'a')).toBe(true);
    });

    it('should return true for simple cycle (A -> B -> A)', () => {
      const graph: DependencyGraph = new Map([
        ['a', ['b']],
        ['b', []],
      ]);
      // If B blocks A, and A already blocks B, it's circular
      expect(detectCircularDependency(graph, 'b', 'a')).toBe(true);
    });

    it('should return false for valid chain (A -> B -> C)', () => {
      const graph: DependencyGraph = new Map([
        ['a', ['b']],
        ['b', ['c']],
        ['c', []],
      ]);
      // D blocking A is valid
      expect(detectCircularDependency(graph, 'd', 'a')).toBe(false);
    });

    it('should detect longer cycles (A -> B -> C -> A)', () => {
      const graph: DependencyGraph = new Map([
        ['a', ['b']],
        ['b', ['c']],
        ['c', []],
      ]);
      // If C blocks A, it creates A -> B -> C -> A
      expect(detectCircularDependency(graph, 'c', 'a')).toBe(true);
    });

    it('should handle complex graphs with multiple paths', () => {
      const graph: DependencyGraph = new Map([
        ['a', ['b', 'c']],
        ['b', ['d']],
        ['c', ['d']],
        ['d', []],
      ]);
      // E blocking A is valid
      expect(detectCircularDependency(graph, 'e', 'a')).toBe(false);
      // D blocking A creates cycle
      expect(detectCircularDependency(graph, 'd', 'a')).toBe(true);
    });
  });

  describe('getDependencyTypeLabel', () => {
    it('should return correct label for finish-to-start', () => {
      expect(getDependencyTypeLabel('finish_to_start')).toBe('Finish to Start');
    });

    it('should return correct label for start-to-start', () => {
      expect(getDependencyTypeLabel('start_to_start')).toBe('Start to Start');
    });

    it('should return correct label for finish-to-finish', () => {
      expect(getDependencyTypeLabel('finish_to_finish')).toBe('Finish to Finish');
    });

    it('should return correct label for start-to-finish', () => {
      expect(getDependencyTypeLabel('start_to_finish')).toBe('Start to Finish');
    });
  });

  describe('isValidDependency', () => {
    const mockItem: WorkItemSummary = {
      id: 'item-1',
      title: 'Test Item',
      kind: 'issue',
      status: 'not_started',
    };

    it('should return false when item is the same as source', () => {
      expect(isValidDependency(mockItem, 'item-1', [])).toBe(false);
    });

    it('should return false when item is already a dependency', () => {
      expect(isValidDependency(mockItem, 'other-item', ['item-1', 'item-2'])).toBe(false);
    });

    it('should return true for valid new dependency', () => {
      expect(isValidDependency(mockItem, 'source-item', ['other-dep'])).toBe(true);
    });
  });
});

describe('AddDependencyDialog', () => {
  const mockWorkItems: WorkItemSummary[] = [
    { id: '1', title: 'Task A', kind: 'issue', status: 'in_progress' },
    { id: '2', title: 'Task B', kind: 'epic', status: 'not_started' },
    { id: '3', title: 'Project C', kind: 'project', status: 'done' },
  ];

  const defaultProps: AddDependencyDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    sourceItemId: 'source-1',
    sourceItemTitle: 'Source Task',
    availableItems: mockWorkItems,
    existingDependencyIds: [],
    onAddDependency: vi.fn(),
    dependencyGraph: new Map(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<AddDependencyDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should not render dialog when closed', () => {
    render(<AddDependencyDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should display direction selector with blocks and blocked-by options', () => {
    render(<AddDependencyDialog {...defaultProps} />);
    expect(screen.getByText(/blocks/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked by/i)).toBeInTheDocument();
  });

  it('should display search input for filtering items', () => {
    render(<AddDependencyDialog {...defaultProps} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('should filter items based on search query', async () => {
    render(<AddDependencyDialog {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Task A' } });

    await waitFor(() => {
      expect(screen.getByText('Task A')).toBeInTheDocument();
      expect(screen.queryByText('Project C')).not.toBeInTheDocument();
    });
  });

  it('should display available items for selection', () => {
    render(<AddDependencyDialog {...defaultProps} />);
    expect(screen.getByText('Task A')).toBeInTheDocument();
    expect(screen.getByText('Task B')).toBeInTheDocument();
    expect(screen.getByText('Project C')).toBeInTheDocument();
  });

  it('should exclude the source item from available items', () => {
    const items = [...mockWorkItems, { id: 'source-1', title: 'Source Task', kind: 'issue' as const, status: 'not_started' as const }];
    render(<AddDependencyDialog {...defaultProps} availableItems={items} />);
    // The source task should not appear in the selectable list
    // Source task (id: source-1) should not be rendered
    expect(screen.queryByTestId('dependency-option-source-1')).not.toBeInTheDocument();
    // Other items should still be there
    expect(screen.getByTestId('dependency-option-1')).toBeInTheDocument();
  });

  it('should exclude already linked dependencies', () => {
    render(<AddDependencyDialog {...defaultProps} existingDependencyIds={['1']} />);
    // Task A (id: 1) should not be in the list
    expect(screen.queryByTestId('dependency-option-1')).not.toBeInTheDocument();
    // Other items should still be there
    expect(screen.getByTestId('dependency-option-2')).toBeInTheDocument();
  });

  it('should show circular dependency warning when applicable', async () => {
    // Graph: Source (source-1) blocks Task A (1)
    // When we try to add "Source is blocked by Task A" (1 -> source-1), it creates a cycle
    const graph: DependencyGraph = new Map([
      ['source-1', ['1']], // Source already blocks Task A
    ]);
    render(<AddDependencyDialog {...defaultProps} dependencyGraph={graph} initialDirection="blocked_by" />);

    // Task A should show warning because adding 1 -> source-1 would create cycle
    // Multiple elements may match - the banner and the item indicator
    await waitFor(() => {
      const warningElements = screen.getAllByText(/circular/i);
      expect(warningElements.length).toBeGreaterThan(0);
    });
  });

  it('should call onAddDependency with correct params when adding', async () => {
    const onAddDependency = vi.fn();
    render(<AddDependencyDialog {...defaultProps} onAddDependency={onAddDependency} />);

    // Select an item
    const taskAOption = screen.getByTestId('dependency-option-1');
    fireEvent.click(taskAOption);

    // Click add button
    const addButton = screen.getByRole('button', { name: /add dependency/i });
    fireEvent.click(addButton);

    expect(onAddDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: '1',
        direction: expect.any(String),
        type: expect.any(String),
      }),
    );
  });

  it('should close dialog after successful add', async () => {
    const onOpenChange = vi.fn();
    render(<AddDependencyDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const taskAOption = screen.getByTestId('dependency-option-1');
    fireEvent.click(taskAOption);

    const addButton = screen.getByRole('button', { name: /add dependency/i });
    fireEvent.click(addButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should show preview of dependency relationship', async () => {
    render(<AddDependencyDialog {...defaultProps} />);

    // Select an item
    const taskAOption = screen.getByTestId('dependency-option-1');
    fireEvent.click(taskAOption);

    // Should show preview like "Source Task will block Task A"
    expect(screen.getByText(/will block/i)).toBeInTheDocument();
  });

  it('should support dependency type selection', () => {
    render(<AddDependencyDialog {...defaultProps} />);
    // Should show dependency type options
    expect(screen.getByText(/finish to start/i)).toBeInTheDocument();
  });

  it('should disable add button when no item selected', () => {
    render(<AddDependencyDialog {...defaultProps} />);
    const addButton = screen.getByRole('button', { name: /add dependency/i });
    expect(addButton).toBeDisabled();
  });
});

describe('DependencyItem', () => {
  const defaultProps: DependencyItemProps = {
    id: 'dep-1',
    title: 'Blocked Task',
    kind: 'issue',
    status: 'in_progress',
    direction: 'blocks',
    type: 'finish_to_start',
    onClick: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dependency title', () => {
    render(<DependencyItem {...defaultProps} />);
    expect(screen.getByText('Blocked Task')).toBeInTheDocument();
  });

  it('should show correct icon for item kind', () => {
    render(<DependencyItem {...defaultProps} kind="epic" />);
    expect(screen.getByTestId('kind-icon')).toBeInTheDocument();
  });

  it('should show status badge', () => {
    render(<DependencyItem {...defaultProps} />);
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('should show dependency type when provided', () => {
    render(<DependencyItem {...defaultProps} type="start_to_start" />);
    expect(screen.getByText(/start to start/i)).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DependencyItem {...defaultProps} onClick={onClick} />);

    const item = screen.getByTestId('dependency-item');
    fireEvent.click(item);

    expect(onClick).toHaveBeenCalled();
  });

  it('should show remove button', () => {
    render(<DependencyItem {...defaultProps} />);
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('should call onRemove when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<DependencyItem {...defaultProps} onRemove={onRemove} />);

    const removeButton = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeButton);

    expect(onRemove).toHaveBeenCalledWith('dep-1');
  });

  it('should not propagate click event when remove is clicked', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<DependencyItem {...defaultProps} onClick={onClick} onRemove={onRemove} />);

    const removeButton = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeButton);

    expect(onRemove).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('should show direction indicator', () => {
    render(<DependencyItem {...defaultProps} direction="blocked_by" />);
    expect(screen.getByTestId('direction-indicator')).toBeInTheDocument();
  });

  it('should apply satisfied styling when blocker is done', () => {
    const { container } = render(<DependencyItem {...defaultProps} direction="blocked_by" status="done" />);
    expect(container.querySelector('[data-satisfied="true"]')).toBeInTheDocument();
  });
});

describe('Integration', () => {
  it('should prevent adding circular dependencies', async () => {
    const onAddDependency = vi.fn();

    // Graph shows: Source (source-1) blocks Task A (1)
    // Adding "Source blocked by Task A" (1 -> source-1) would create a cycle
    const graph: DependencyGraph = new Map([
      ['source-1', ['1']], // Source blocks Task A
    ]);

    const mockWorkItems: WorkItemSummary[] = [{ id: '1', title: 'Task A', kind: 'issue', status: 'in_progress' }];

    render(
      <AddDependencyDialog
        open={true}
        onOpenChange={vi.fn()}
        sourceItemId="source-1"
        sourceItemTitle="Source"
        availableItems={mockWorkItems}
        existingDependencyIds={[]}
        onAddDependency={onAddDependency}
        dependencyGraph={graph}
        initialDirection="blocked_by"
      />,
    );

    // Task A should be shown as creating a circular dependency
    // Multiple elements may match - the banner and the item indicator
    const circularWarnings = await screen.findAllByText(/circular/i);
    expect(circularWarnings.length).toBeGreaterThan(0);

    // Add button should be disabled because no valid item can be selected
    const addButton = screen.getByRole('button', { name: /add dependency/i });
    expect(addButton).toBeDisabled();
  });
});
