/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MoveToDialog, useWorkItemMove, canMoveToParent, getValidParentKinds } from '@/ui/components/work-item-move';
import type { TreeItemKind } from '@/ui/components/tree/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Hierarchy validation', () => {
  describe('getValidParentKinds', () => {
    it('returns empty array for project (must be root)', () => {
      expect(getValidParentKinds('project')).toEqual([]);
    });

    it('returns [project] for initiative', () => {
      expect(getValidParentKinds('initiative')).toEqual(['project']);
    });

    it('returns [project, initiative] for epic', () => {
      expect(getValidParentKinds('epic')).toEqual(['project', 'initiative']);
    });

    it('returns [project, initiative, epic] for issue', () => {
      expect(getValidParentKinds('issue')).toEqual(['project', 'initiative', 'epic']);
    });
  });

  describe('canMoveToParent', () => {
    it('allows moving initiative under project', () => {
      expect(canMoveToParent({ id: '1', kind: 'initiative' }, { id: '2', kind: 'project' })).toBe(true);
    });

    it('disallows moving project under anything', () => {
      expect(canMoveToParent({ id: '1', kind: 'project' }, { id: '2', kind: 'project' })).toBe(false);
    });

    it('disallows moving epic under issue', () => {
      expect(canMoveToParent({ id: '1', kind: 'epic' }, { id: '2', kind: 'issue' })).toBe(false);
    });

    it('allows moving epic under project', () => {
      expect(canMoveToParent({ id: '1', kind: 'epic' }, { id: '2', kind: 'project' })).toBe(true);
    });

    it('allows moving epic under initiative', () => {
      expect(canMoveToParent({ id: '1', kind: 'epic' }, { id: '2', kind: 'initiative' })).toBe(true);
    });

    it('allows moving issue under epic', () => {
      expect(canMoveToParent({ id: '1', kind: 'issue' }, { id: '2', kind: 'epic' })).toBe(true);
    });

    it('disallows moving item under itself', () => {
      expect(canMoveToParent({ id: '1', kind: 'issue' }, { id: '1', kind: 'epic' })).toBe(false);
    });

    it('allows moving to null parent (root) for project', () => {
      expect(canMoveToParent({ id: '1', kind: 'project' }, null)).toBe(true);
    });

    it('disallows moving to null parent (root) for non-project', () => {
      expect(canMoveToParent({ id: '1', kind: 'issue' }, null)).toBe(false);
    });
  });
});

describe('MoveToDialog', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const mockPotentialParents = [
    { id: 'proj-1', title: 'Project Alpha', kind: 'project' as TreeItemKind },
    { id: 'init-1', title: 'Initiative Beta', kind: 'initiative' as TreeItemKind },
    { id: 'epic-1', title: 'Epic Gamma', kind: 'epic' as TreeItemKind },
  ];

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    item: {
      id: 'item-1',
      title: 'Test Issue',
      kind: 'issue' as TreeItemKind,
      currentParentId: 'epic-1',
      currentParentTitle: 'Epic Gamma',
    },
    potentialParents: mockPotentialParents,
    onMove: vi.fn(),
    isMoving: false,
  };

  it('renders dialog with item title', () => {
    render(<MoveToDialog {...defaultProps} />);

    expect(screen.getByText(/move.*test issue/i)).toBeInTheDocument();
  });

  it('shows current parent', () => {
    render(<MoveToDialog {...defaultProps} />);

    // Current parent is shown in the description
    expect(screen.getByText(/currently under.*epic gamma/i)).toBeInTheDocument();
  });

  it('shows searchable list of potential parents', () => {
    render(<MoveToDialog {...defaultProps} />);

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Initiative Beta')).toBeInTheDocument();
  });

  it('filters out invalid parent kinds', () => {
    // Issue can be under project, initiative, or epic - all should show
    render(<MoveToDialog {...defaultProps} />);

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Initiative Beta')).toBeInTheDocument();
    expect(screen.getByText('Epic Gamma')).toBeInTheDocument();
  });

  it('filters parents when searching', () => {
    render(<MoveToDialog {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Alpha' } });

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Initiative Beta')).not.toBeInTheDocument();
  });

  it('calls onMove when parent is selected', async () => {
    const onMove = vi.fn();
    render(<MoveToDialog {...defaultProps} onMove={onMove} />);

    const projectOption = screen.getByText('Project Alpha');
    fireEvent.click(projectOption);

    const moveButton = screen.getByRole('button', { name: /move/i });
    fireEvent.click(moveButton);

    expect(onMove).toHaveBeenCalledWith('proj-1');
  });

  it('disables move button when no parent selected', () => {
    render(<MoveToDialog {...defaultProps} />);

    const moveButton = screen.getByRole('button', { name: /move/i });
    expect(moveButton).toBeDisabled();
  });

  it('disables buttons when isMoving is true', () => {
    render(<MoveToDialog {...defaultProps} isMoving={true} />);

    const moveButton = screen.getByRole('button', { name: /mov/i });
    expect(moveButton).toBeDisabled();
  });

  it('filters out current parent from options', () => {
    render(<MoveToDialog {...defaultProps} />);

    // Epic Gamma is the current parent, so it should be marked or filtered
    const epicOption = screen.getByText('Epic Gamma');
    expect(epicOption.closest('[data-current="true"]')).toBeInTheDocument();
  });
});

describe('useWorkItemMove hook', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function TestComponent({ onMoved }: { onMoved?: () => void }) {
    const { moveItem, isMoving } = useWorkItemMove({
      onMoved,
    });

    return (
      <div>
        <button onClick={() => moveItem({ id: 'test-1', title: 'Test Item' }, 'new-parent-id')} disabled={isMoving} data-testid="move-btn">
          Move
        </button>
        <span data-testid="is-moving">{isMoving ? 'true' : 'false'}</span>
      </div>
    );
  }

  it('calls PATCH API to move item', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    render(<TestComponent />);

    fireEvent.click(screen.getByTestId('move-btn'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/work-items/test-1',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('new-parent-id'),
        }),
      );
    });
  });

  it('sets isMoving while API call is in progress', async () => {
    mockFetch.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100)));

    render(<TestComponent />);

    expect(screen.getByTestId('is-moving').textContent).toBe('false');

    fireEvent.click(screen.getByTestId('move-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('is-moving').textContent).toBe('true');
    });
  });

  it('calls onMoved callback after successful move', async () => {
    const onMoved = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true });

    render(<TestComponent onMoved={onMoved} />);

    fireEvent.click(screen.getByTestId('move-btn'));

    await waitFor(() => {
      expect(onMoved).toHaveBeenCalled();
    });
  });
});
