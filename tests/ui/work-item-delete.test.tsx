/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DeleteConfirmDialog, UndoToast, useWorkItemDelete } from '@/ui/components/work-item-delete';

// Mock apiClient for API calls
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { apiClient } from '@/ui/lib/api-client';
const mockDelete = vi.mocked(apiClient.delete);
const mockPost = vi.mocked(apiClient.post);

describe('DeleteConfirmDialog', () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockPost.mockReset();
  });

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    item: {
      id: 'item-1',
      title: 'Test Item',
      kind: 'issue' as const,
      childCount: 0,
    },
    onConfirm: vi.fn(),
    isDeleting: false,
  };

  it('renders dialog with item title', () => {
    render(<DeleteConfirmDialog {...defaultProps} />);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Delete "Test Item"\?/)).toBeInTheDocument();
  });

  it('shows warning about child items when present', () => {
    render(<DeleteConfirmDialog {...defaultProps} item={{ ...defaultProps.item, childCount: 5 }} />);

    expect(screen.getByText(/5 child items/i)).toBeInTheDocument();
  });

  it('calls onConfirm when delete button clicked', async () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    const deleteButton = screen.getByRole('button', { name: /delete/i });
    fireEvent.click(deleteButton);

    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onOpenChange when cancel clicked', async () => {
    const onOpenChange = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables buttons when isDeleting is true', () => {
    render(<DeleteConfirmDialog {...defaultProps} isDeleting={true} />);

    const deleteButton = screen.getByRole('button', { name: /delet/i });
    expect(deleteButton).toBeDisabled();
  });

  it('shows bulk delete info when multiple items', () => {
    render(
      <DeleteConfirmDialog
        {...defaultProps}
        items={[
          { id: '1', title: 'Item 1', kind: 'issue', childCount: 0 },
          { id: '2', title: 'Item 2', kind: 'issue', childCount: 0 },
          { id: '3', title: 'Item 3', kind: 'issue', childCount: 0 },
        ]}
        item={undefined}
      />,
    );

    expect(screen.getByText(/Delete 3 items\?/)).toBeInTheDocument();
  });
});

describe('UndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultProps = {
    visible: true,
    itemTitle: 'Test Item',
    onUndo: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('renders when visible', () => {
    render(<UndoToast {...defaultProps} />);

    expect(screen.getByText(/deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/test item/i)).toBeInTheDocument();
  });

  it('shows undo button', () => {
    render(<UndoToast {...defaultProps} />);

    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('calls onUndo when undo button clicked', () => {
    const onUndo = vi.fn();
    render(<UndoToast {...defaultProps} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    expect(onUndo).toHaveBeenCalled();
  });

  it('auto-dismisses after timeout', async () => {
    const onDismiss = vi.fn();
    render(<UndoToast {...defaultProps} onDismiss={onDismiss} timeout={5000} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not render when not visible', () => {
    render(<UndoToast {...defaultProps} visible={false} />);

    expect(screen.queryByText(/deleted/i)).not.toBeInTheDocument();
  });
});

describe('useWorkItemDelete hook', () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockPost.mockReset();
  });

  // Test component to use the hook
  function TestComponent({ onDeleted, onRestored }: { onDeleted?: () => void; onRestored?: () => void }) {
    const { deleteItem, restoreItem, isDeleting, undoState, dismissUndo } = useWorkItemDelete({
      onDeleted,
      onRestored,
    });

    return (
      <div>
        <button onClick={() => deleteItem({ id: 'test-1', title: 'Test Item' })} disabled={isDeleting} data-testid="delete-btn">
          Delete
        </button>
        <button onClick={() => restoreItem('test-1')} data-testid="restore-btn">
          Restore
        </button>
        {undoState && (
          <div data-testid="undo-state">
            <span>{undoState.itemTitle}</span>
            <button onClick={undoState.onUndo}>Undo</button>
            <button onClick={dismissUndo}>Dismiss</button>
          </div>
        )}
        <span data-testid="is-deleting">{isDeleting ? 'true' : 'false'}</span>
      </div>
    );
  }

  it('calls delete API and shows undo state', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    render(<TestComponent />);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/api/work-items/test-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('undo-state')).toBeInTheDocument();
    });
  });

  it('calls restore API on undo', async () => {
    mockDelete.mockResolvedValueOnce(undefined); // delete
    mockPost.mockResolvedValueOnce({ restored: true }); // restore

    render(<TestComponent />);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('undo-state')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Undo'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/work-items/test-1/restore', {});
    });
  });

  it('sets isDeleting while API call is in progress', async () => {
    mockDelete.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(undefined), 100)));

    render(<TestComponent />);

    expect(screen.getByTestId('is-deleting').textContent).toBe('false');

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('is-deleting').textContent).toBe('true');
    });
  });

  it('calls onDeleted callback after successful delete', async () => {
    const onDeleted = vi.fn();
    mockDelete.mockResolvedValueOnce(undefined);

    render(<TestComponent onDeleted={onDeleted} />);

    fireEvent.click(screen.getByTestId('delete-btn'));

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });
});
