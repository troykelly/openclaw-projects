/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectTree, TreeItemRow, type TreeItem } from '@/ui/components/tree';

const mockItem: TreeItem = {
  id: 'project-1',
  title: 'Test Project',
  kind: 'project',
  status: 'in_progress',
  parent_id: null,
  children: [
    {
      id: 'initiative-1',
      title: 'Test Initiative',
      kind: 'initiative',
      status: 'not_started',
      parent_id: 'project-1',
      children: [
        {
          id: 'epic-1',
          title: 'Test Epic',
          kind: 'epic',
          status: 'in_progress',
          parent_id: 'initiative-1',
          children: [
            {
              id: 'issue-1',
              title: 'Test Issue',
              kind: 'issue',
              status: 'done',
              parent_id: 'epic-1',
            },
          ],
        },
      ],
    },
  ],
};

const mockItems: TreeItem[] = [mockItem];

// Wrapper to provide DnD context
function DndWrapper({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

describe('TreeItemRow', () => {
  const defaultProps = {
    item: mockItem,
    depth: 0,
    isExpanded: false,
    isSelected: false,
    onToggleExpand: vi.fn(),
    onSelect: vi.fn(),
  };

  it('renders item title', () => {
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} />
      </DndWrapper>,
    );

    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('shows child count badge when item has children', () => {
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} />
      </DndWrapper>,
    );

    expect(screen.getByText('1')).toBeInTheDocument(); // 1 child (initiative)
  });

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} onSelect={onSelect} />
      </DndWrapper>,
    );

    fireEvent.click(screen.getByTestId('tree-item'));
    expect(onSelect).toHaveBeenCalledWith('project-1');
  });

  it('applies selected styles when isSelected is true', () => {
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} isSelected={true} />
      </DndWrapper>,
    );

    const item = screen.getByTestId('tree-item');
    expect(item.className).toContain('bg-muted');
  });

  it('shows expand chevron rotated when expanded', () => {
    const { container } = render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} isExpanded={true} />
      </DndWrapper>,
    );

    const chevron = container.querySelector('.rotate-90');
    expect(chevron).toBeTruthy();
  });

  it('calls onToggleExpand when expand button is clicked', () => {
    const onToggleExpand = vi.fn();
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} onToggleExpand={onToggleExpand} />
      </DndWrapper>,
    );

    const expandButton = screen.getByLabelText('Expand');
    fireEvent.click(expandButton);
    expect(onToggleExpand).toHaveBeenCalledWith('project-1');
  });

  it('handles keyboard navigation with Enter key', () => {
    const onSelect = vi.fn();
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} onSelect={onSelect} />
      </DndWrapper>,
    );

    const item = screen.getByTestId('tree-item');
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('project-1');
  });

  it('handles keyboard navigation with ArrowRight key', () => {
    const onToggleExpand = vi.fn();
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} onToggleExpand={onToggleExpand} isExpanded={false} />
      </DndWrapper>,
    );

    const item = screen.getByTestId('tree-item');
    fireEvent.keyDown(item, { key: 'ArrowRight' });
    expect(onToggleExpand).toHaveBeenCalledWith('project-1');
  });

  it('handles keyboard navigation with ArrowLeft key', () => {
    const onToggleExpand = vi.fn();
    render(
      <DndWrapper>
        <TreeItemRow {...defaultProps} onToggleExpand={onToggleExpand} isExpanded={true} />
      </DndWrapper>,
    );

    const item = screen.getByTestId('tree-item');
    fireEvent.keyDown(item, { key: 'ArrowLeft' });
    expect(onToggleExpand).toHaveBeenCalledWith('project-1');
  });
});

describe('ProjectTree', () => {
  it('renders all top-level items', () => {
    render(<ProjectTree items={mockItems} />);

    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('expands and shows children when expanded', () => {
    render(<ProjectTree items={mockItems} />);

    // Initially only top-level visible
    expect(screen.queryByText('Test Initiative')).not.toBeInTheDocument();

    // Click expand
    const expandButton = screen.getByLabelText('Expand');
    fireEvent.click(expandButton);

    // Now child is visible
    expect(screen.getByText('Test Initiative')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(<ProjectTree items={[]} />);

    expect(screen.getByText('No projects yet')).toBeInTheDocument();
  });

  it('calls onSelect when item is selected', () => {
    const onSelect = vi.fn();
    render(<ProjectTree items={mockItems} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Test Project'));
    expect(onSelect).toHaveBeenCalledWith('project-1');
  });

  it('supports deep expansion through hierarchy', () => {
    render(<ProjectTree items={mockItems} />);

    // Expand project - click the first tree item's expand button
    // After clicking, project becomes "Collapse" and Initiative shows with "Expand"
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(screen.getByText('Test Initiative')).toBeInTheDocument();

    // Now there should be: Collapse (project) + Expand (initiative)
    // Click the remaining Expand button for initiative
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(screen.getByText('Test Epic')).toBeInTheDocument();

    // Now: Collapse (project) + Collapse (initiative) + Expand (epic)
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(screen.getByText('Test Issue')).toBeInTheDocument();
  });

  it('has proper ARIA attributes', () => {
    render(<ProjectTree items={mockItems} />);

    const tree = screen.getByRole('tree');
    expect(tree).toHaveAttribute('aria-label', 'Project hierarchy');

    const treeItem = screen.getByRole('treeitem');
    expect(treeItem).toHaveAttribute('aria-expanded', 'false');
  });
});
