/**
 * @vitest-environment jsdom
 * Tests for bulk contact operations
 * Issue #397: Implement bulk contact operations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { BulkSelectionProvider, useBulkSelection } from '@/ui/components/bulk-selection/bulk-selection-context';
import { ContactCheckbox, type ContactCheckboxProps } from '@/ui/components/bulk-selection/contact-checkbox';
import { ContactBulkActionBar, type ContactBulkActionBarProps } from '@/ui/components/bulk-selection/contact-bulk-action-bar';
import { BulkDeleteDialog, type BulkDeleteDialogProps } from '@/ui/components/bulk-selection/bulk-delete-dialog';
import { BulkAddToGroupDialog, type BulkAddToGroupDialogProps } from '@/ui/components/bulk-selection/bulk-add-to-group-dialog';
import { BulkUpdateDialog, type BulkUpdateDialogProps } from '@/ui/components/bulk-selection/bulk-update-dialog';
import type { Contact, ContactGroup } from '@/ui/components/bulk-selection/types';

// Test wrapper component to test hook
function TestHookComponent({ onSelection }: { onSelection: (ids: string[]) => void }) {
  const { selectedIds, toggleSelection, selectAll, deselectAll, isSelected } = useBulkSelection();

  React.useEffect(() => {
    onSelection(selectedIds);
  }, [selectedIds, onSelection]);

  return (
    <div>
      <button onClick={() => toggleSelection('1')}>Toggle 1</button>
      <button onClick={() => toggleSelection('2')}>Toggle 2</button>
      <button onClick={() => selectAll(['1', '2', '3'])}>Select All</button>
      <button onClick={() => deselectAll()}>Deselect All</button>
      <span data-testid="selected-count">{selectedIds.length}</span>
      <span data-testid="is-1-selected">{isSelected('1') ? 'yes' : 'no'}</span>
    </div>
  );
}

describe('BulkSelectionProvider', () => {
  it('should provide selection context', () => {
    const onSelection = vi.fn();
    render(
      <BulkSelectionProvider>
        <TestHookComponent onSelection={onSelection} />
      </BulkSelectionProvider>,
    );

    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });

  it('should toggle selection', () => {
    const onSelection = vi.fn();
    render(
      <BulkSelectionProvider>
        <TestHookComponent onSelection={onSelection} />
      </BulkSelectionProvider>,
    );

    fireEvent.click(screen.getByText('Toggle 1'));

    expect(screen.getByTestId('selected-count')).toHaveTextContent('1');
    expect(screen.getByTestId('is-1-selected')).toHaveTextContent('yes');
  });

  it('should select all items', () => {
    const onSelection = vi.fn();
    render(
      <BulkSelectionProvider>
        <TestHookComponent onSelection={onSelection} />
      </BulkSelectionProvider>,
    );

    fireEvent.click(screen.getByText('Select All'));

    expect(screen.getByTestId('selected-count')).toHaveTextContent('3');
  });

  it('should deselect all items', () => {
    const onSelection = vi.fn();
    render(
      <BulkSelectionProvider>
        <TestHookComponent onSelection={onSelection} />
      </BulkSelectionProvider>,
    );

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText('Deselect All'));

    expect(screen.getByTestId('selected-count')).toHaveTextContent('0');
  });
});

describe('ContactCheckbox', () => {
  const defaultProps: ContactCheckboxProps = {
    contactId: 'contact-1',
    isSelected: false,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render checkbox', () => {
    render(<ContactCheckbox {...defaultProps} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('should be unchecked when not selected', () => {
    render(<ContactCheckbox {...defaultProps} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('should be checked when selected', () => {
    render(<ContactCheckbox {...defaultProps} isSelected />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('should call onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ContactCheckbox {...defaultProps} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onToggle).toHaveBeenCalledWith('contact-1');
  });

  it('should stop propagation to prevent row click', () => {
    const onToggle = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <ContactCheckbox {...defaultProps} onToggle={onToggle} />
      </div>,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onToggle).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('ContactBulkActionBar', () => {
  const defaultProps: ContactBulkActionBarProps = {
    selectedCount: 5,
    onDelete: vi.fn(),
    onAddToGroup: vi.fn(),
    onRemoveFromGroup: vi.fn(),
    onUpdateField: vi.fn(),
    onExport: vi.fn(),
    onDeselectAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show selected count', () => {
    render(<ContactBulkActionBar {...defaultProps} />);
    expect(screen.getByText(/5 selected/i)).toBeInTheDocument();
  });

  it('should show deselect all button', () => {
    render(<ContactBulkActionBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /deselect/i })).toBeInTheDocument();
  });

  it('should call onDeselectAll when clicked', () => {
    const onDeselectAll = vi.fn();
    render(<ContactBulkActionBar {...defaultProps} onDeselectAll={onDeselectAll} />);

    fireEvent.click(screen.getByRole('button', { name: /deselect/i }));

    expect(onDeselectAll).toHaveBeenCalled();
  });

  it('should show delete button', () => {
    render(<ContactBulkActionBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('should call onDelete when delete clicked', () => {
    const onDelete = vi.fn();
    render(<ContactBulkActionBar {...defaultProps} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(onDelete).toHaveBeenCalled();
  });

  it('should show add to group button', () => {
    render(<ContactBulkActionBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /add to group/i })).toBeInTheDocument();
  });

  it('should show export button', () => {
    render(<ContactBulkActionBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('should not render when no items selected', () => {
    const { container } = render(<ContactBulkActionBar {...defaultProps} selectedCount={0} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('BulkDeleteDialog', () => {
  const mockContacts: Contact[] = [
    { id: '1', name: 'Alice Smith', email: 'alice@example.com' },
    { id: '2', name: 'Bob Jones', email: 'bob@example.com' },
  ];

  const defaultProps: BulkDeleteDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    contacts: mockContacts,
    onConfirm: vi.fn(),
    loading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<BulkDeleteDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show contact count', () => {
    render(<BulkDeleteDialog {...defaultProps} />);
    expect(screen.getByText(/2 contacts/i)).toBeInTheDocument();
  });

  it('should show warning message', () => {
    render(<BulkDeleteDialog {...defaultProps} />);
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('should list contacts to be deleted', () => {
    render(<BulkDeleteDialog {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('should call onConfirm when delete confirmed', () => {
    const onConfirm = vi.fn();
    render(<BulkDeleteDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(onConfirm).toHaveBeenCalled();
  });

  it('should close dialog on cancel', () => {
    const onOpenChange = vi.fn();
    render(<BulkDeleteDialog {...defaultProps} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should show loading state', () => {
    render(<BulkDeleteDialog {...defaultProps} loading />);
    expect(screen.getByRole('button', { name: /deleting/i })).toBeDisabled();
  });
});

describe('BulkAddToGroupDialog', () => {
  const mockGroups: ContactGroup[] = [
    { id: 'g1', name: 'VIP Clients', color: '#4f46e5', memberCount: 10 },
    { id: 'g2', name: 'Partners', color: '#10b981', memberCount: 5 },
  ];

  const defaultProps: BulkAddToGroupDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    selectedCount: 3,
    groups: mockGroups,
    onConfirm: vi.fn(),
    loading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<BulkAddToGroupDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show selected count', () => {
    render(<BulkAddToGroupDialog {...defaultProps} />);
    expect(screen.getByText(/3 contacts/i)).toBeInTheDocument();
  });

  it('should list available groups', () => {
    render(<BulkAddToGroupDialog {...defaultProps} />);
    expect(screen.getByText('VIP Clients')).toBeInTheDocument();
    expect(screen.getByText('Partners')).toBeInTheDocument();
  });

  it('should allow selecting a group', () => {
    render(<BulkAddToGroupDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('VIP Clients'));

    const vipOption = screen.getByText('VIP Clients').closest('button');
    expect(vipOption).toHaveAttribute('data-selected', 'true');
  });

  it('should call onConfirm with selected group', () => {
    const onConfirm = vi.fn();
    render(<BulkAddToGroupDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText('VIP Clients'));
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }));

    expect(onConfirm).toHaveBeenCalledWith('g1');
  });

  it('should disable confirm until group selected', () => {
    render(<BulkAddToGroupDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /add to group/i })).toBeDisabled();
  });
});

describe('BulkUpdateDialog', () => {
  const defaultProps: BulkUpdateDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    selectedCount: 4,
    onConfirm: vi.fn(),
    loading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<BulkUpdateDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show selected count', () => {
    render(<BulkUpdateDialog {...defaultProps} />);
    expect(screen.getByText(/4 contacts/i)).toBeInTheDocument();
  });

  it('should show field selector', () => {
    render(<BulkUpdateDialog {...defaultProps} />);
    expect(screen.getByText('Select Field')).toBeInTheDocument();
  });

  it('should show available fields', () => {
    render(<BulkUpdateDialog {...defaultProps} />);
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
  });

  it('should show value input when field selected', () => {
    render(<BulkUpdateDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Organization'));

    expect(screen.getByLabelText(/new value/i)).toBeInTheDocument();
  });

  it('should call onConfirm with field and value', async () => {
    const onConfirm = vi.fn();
    render(<BulkUpdateDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText('Organization'));
    fireEvent.change(screen.getByLabelText(/new value/i), {
      target: { value: 'Acme Corp' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update/i }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('organization', 'Acme Corp');
    });
  });

  it('should disable confirm until field and value provided', () => {
    render(<BulkUpdateDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /update/i })).toBeDisabled();
  });
});
