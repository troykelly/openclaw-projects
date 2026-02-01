/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  BulkSelectionProvider,
  useBulkSelection,
} from '@/ui/hooks/use-bulk-selection';
import { BulkActionBar } from '@/ui/components/bulk/bulk-action-bar';

describe('useBulkSelection', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <BulkSelectionProvider>{children}</BulkSelectionProvider>
  );

  it('starts with empty selection', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });

    expect(result.current.count).toBe(0);
    expect(result.current.hasSelection).toBe(false);
  });

  it('selects an item', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });

    act(() => {
      result.current.select('item-1');
    });

    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('item-1')).toBe(true);
    expect(result.current.hasSelection).toBe(true);
  });

  it('deselects an item', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });

    act(() => {
      result.current.select('item-1');
      result.current.deselect('item-1');
    });

    expect(result.current.count).toBe(0);
    expect(result.current.isSelected('item-1')).toBe(false);
  });

  it('toggles selection', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });

    act(() => {
      result.current.toggle('item-1');
    });
    expect(result.current.isSelected('item-1')).toBe(true);

    act(() => {
      result.current.toggle('item-1');
    });
    expect(result.current.isSelected('item-1')).toBe(false);
  });

  it('selects all items', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });

    act(() => {
      result.current.selectAll(['item-1', 'item-2', 'item-3']);
    });

    expect(result.current.count).toBe(3);
    expect(result.current.isSelected('item-1')).toBe(true);
    expect(result.current.isSelected('item-2')).toBe(true);
    expect(result.current.isSelected('item-3')).toBe(true);
  });

  it('deselects all items', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });

    act(() => {
      result.current.selectAll(['item-1', 'item-2', 'item-3']);
      result.current.deselectAll();
    });

    expect(result.current.count).toBe(0);
    expect(result.current.hasSelection).toBe(false);
  });

  it('selects a range of items', () => {
    const { result } = renderHook(() => useBulkSelection(), { wrapper });
    const ids = ['item-1', 'item-2', 'item-3', 'item-4', 'item-5'];

    act(() => {
      result.current.selectRange(ids, 'item-2', 'item-4');
    });

    expect(result.current.count).toBe(3);
    expect(result.current.isSelected('item-1')).toBe(false);
    expect(result.current.isSelected('item-2')).toBe(true);
    expect(result.current.isSelected('item-3')).toBe(true);
    expect(result.current.isSelected('item-4')).toBe(true);
    expect(result.current.isSelected('item-5')).toBe(false);
  });

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useBulkSelection());
    }).toThrow('useBulkSelection must be used within a BulkSelectionProvider');
  });
});

describe('BulkActionBar', () => {
  const renderWithSelection = (itemCount: number, onAction?: (action: string, value?: string | null) => Promise<void>) => {
    const TestComponent = () => {
      const { selectAll } = useBulkSelection();
      React.useEffect(() => {
        const ids = Array.from({ length: itemCount }, (_, i) => `item-${i + 1}`);
        selectAll(ids);
      }, [selectAll]);
      return <BulkActionBar onAction={onAction} />;
    };

    return render(
      <BulkSelectionProvider>
        <TestComponent />
      </BulkSelectionProvider>
    );
  };

  it('is hidden when no items selected', () => {
    render(
      <BulkSelectionProvider>
        <BulkActionBar />
      </BulkSelectionProvider>
    );

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('shows count of selected items', () => {
    renderWithSelection(5);

    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('shows status dropdown', () => {
    renderWithSelection(3);

    expect(screen.getByRole('combobox', { name: /change status/i })).toBeInTheDocument();
  });

  it('shows priority dropdown', () => {
    renderWithSelection(3);

    expect(screen.getByRole('combobox', { name: /change priority/i })).toBeInTheDocument();
  });

  it('shows delete button', () => {
    renderWithSelection(3);

    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('clears selection when X is clicked', () => {
    renderWithSelection(3);

    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }));

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('shows delete confirmation dialog', async () => {
    renderWithSelection(3);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText(/delete 3 items/i)).toBeInTheDocument();
    });
  });

  it('calls onAction with delete when confirmed', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    renderWithSelection(3, onAction);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText(/delete 3 items/i)).toBeInTheDocument();
    });

    // Click the confirm button in the dialog (use findAllByRole to wait for dialog buttons)
    const deleteButtons = await screen.findAllByRole('button', { name: /delete/i });
    const confirmButton = deleteButtons[deleteButtons.length - 1]; // Last delete button is in dialog
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith('delete');
    });
  });

  it('closes dialog when cancel is clicked', async () => {
    renderWithSelection(3);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText(/delete 3 items/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText(/delete 3 items/i)).not.toBeInTheDocument();
    });
  });
});
