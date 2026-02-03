/**
 * @vitest-environment jsdom
 * Tests for saved views with sharing
 * Issue #406: Implement saved views with sharing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  SaveViewButton,
  type SaveViewButtonProps,
} from '@/ui/components/saved-views/save-view-button';
import {
  SaveViewDialog,
  type SaveViewDialogProps,
} from '@/ui/components/saved-views/save-view-dialog';
import {
  SavedViewsList,
  type SavedViewsListProps,
} from '@/ui/components/saved-views/saved-views-list';
import {
  ViewSwitcher,
  type ViewSwitcherProps,
} from '@/ui/components/saved-views/view-switcher';
import {
  EditViewDialog,
  type EditViewDialogProps,
} from '@/ui/components/saved-views/edit-view-dialog';
import type {
  SavedView,
  ViewConfig,
  ViewType,
} from '@/ui/components/saved-views/types';

describe('SaveViewButton', () => {
  const defaultProps: SaveViewButtonProps = {
    hasActiveFilters: true,
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render save button when filters active', () => {
    render(<SaveViewButton {...defaultProps} />);
    expect(screen.getByRole('button', { name: /save view/i })).toBeInTheDocument();
  });

  it('should not render when no active filters', () => {
    render(<SaveViewButton hasActiveFilters={false} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /save view/i })).not.toBeInTheDocument();
  });

  it('should call onSave when clicked', () => {
    const onSave = vi.fn();
    render(<SaveViewButton {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /save view/i }));

    expect(onSave).toHaveBeenCalled();
  });

  it('should show bookmark icon', () => {
    render(<SaveViewButton {...defaultProps} />);
    expect(screen.getByTestId('save-view-icon')).toBeInTheDocument();
  });
});

describe('SaveViewDialog', () => {
  const mockConfig: ViewConfig = {
    filters: { status: 'open' },
    sort: { field: 'createdAt', direction: 'desc' },
    viewType: 'list',
  };

  const defaultProps: SaveViewDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    config: mockConfig,
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<SaveViewDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show name input', () => {
    render(<SaveViewDialog {...defaultProps} />);
    expect(screen.getByPlaceholderText(/view name/i)).toBeInTheDocument();
  });

  it('should show description input', () => {
    render(<SaveViewDialog {...defaultProps} />);
    expect(screen.getByPlaceholderText(/description/i)).toBeInTheDocument();
  });

  it('should show view type', () => {
    render(<SaveViewDialog {...defaultProps} />);
    expect(screen.getByText(/list/i)).toBeInTheDocument();
  });

  it('should show filter summary', () => {
    render(<SaveViewDialog {...defaultProps} />);
    expect(screen.getByText(/1 filter/i)).toBeInTheDocument();
  });

  it('should disable save when name empty', () => {
    render(<SaveViewDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('should enable save when name entered', () => {
    render(<SaveViewDialog {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText(/view name/i), {
      target: { value: 'My View' },
    });

    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('should call onSave with view data', async () => {
    const onSave = vi.fn();
    render(<SaveViewDialog {...defaultProps} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText(/view name/i), {
      target: { value: 'My View' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My View',
          config: mockConfig,
        })
      );
    });
  });

  it('should close on cancel', () => {
    const onOpenChange = vi.fn();
    render(<SaveViewDialog {...defaultProps} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('SavedViewsList', () => {
  const mockViews: SavedView[] = [
    {
      id: 'view-1',
      name: 'Open Issues',
      description: 'All open issues',
      config: { filters: { status: 'open' }, viewType: 'list' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'view-2',
      name: 'My Tasks',
      config: { filters: { assignee: 'me' }, viewType: 'kanban' },
      createdAt: new Date().toISOString(),
    },
  ];

  const defaultProps: SavedViewsListProps = {
    views: mockViews,
    onSelectView: vi.fn(),
    onEditView: vi.fn(),
    onDeleteView: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all views', () => {
    render(<SavedViewsList {...defaultProps} />);
    expect(screen.getByText('Open Issues')).toBeInTheDocument();
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
  });

  it('should show view descriptions', () => {
    render(<SavedViewsList {...defaultProps} />);
    expect(screen.getByText('All open issues')).toBeInTheDocument();
  });

  it('should show view type badge', () => {
    render(<SavedViewsList {...defaultProps} />);
    expect(screen.getByText(/list/i)).toBeInTheDocument();
    expect(screen.getByText(/kanban/i)).toBeInTheDocument();
  });

  it('should call onSelectView when view clicked', () => {
    const onSelectView = vi.fn();
    render(<SavedViewsList {...defaultProps} onSelectView={onSelectView} />);

    fireEvent.click(screen.getByText('Open Issues'));

    expect(onSelectView).toHaveBeenCalledWith(mockViews[0]);
  });

  it('should show edit button', () => {
    render(<SavedViewsList {...defaultProps} />);
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    expect(editButtons.length).toBe(2);
  });

  it('should call onEditView when edit clicked', () => {
    const onEditView = vi.fn();
    render(<SavedViewsList {...defaultProps} onEditView={onEditView} />);

    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    fireEvent.click(editButtons[0]);

    expect(onEditView).toHaveBeenCalledWith(mockViews[0]);
  });

  it('should show delete button', () => {
    render(<SavedViewsList {...defaultProps} />);
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons.length).toBe(2);
  });

  it('should call onDeleteView when delete clicked', () => {
    const onDeleteView = vi.fn();
    render(<SavedViewsList {...defaultProps} onDeleteView={onDeleteView} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(onDeleteView).toHaveBeenCalledWith('view-1');
  });

  it('should show empty state when no views', () => {
    render(
      <SavedViewsList
        views={[]}
        onSelectView={vi.fn()}
        onEditView={vi.fn()}
        onDeleteView={vi.fn()}
      />
    );
    expect(screen.getByText(/no saved views/i)).toBeInTheDocument();
  });

  it('should highlight active view', () => {
    render(<SavedViewsList {...defaultProps} activeViewId="view-1" />);
    const activeView = screen.getByTestId('saved-view-view-1');
    expect(activeView).toHaveAttribute('data-active', 'true');
  });
});

describe('ViewSwitcher', () => {
  const mockViews: SavedView[] = [
    {
      id: 'view-1',
      name: 'Open Issues',
      config: { viewType: 'list' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'view-2',
      name: 'My Tasks',
      config: { viewType: 'kanban' },
      createdAt: new Date().toISOString(),
    },
  ];

  const defaultProps: ViewSwitcherProps = {
    views: mockViews,
    activeViewId: null,
    onSelectView: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render view switcher button', () => {
    render(<ViewSwitcher {...defaultProps} />);
    expect(screen.getByRole('button', { name: /views/i })).toBeInTheDocument();
  });

  it('should show dropdown when clicked', () => {
    render(<ViewSwitcher {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /views/i }));

    expect(screen.getByText('Open Issues')).toBeInTheDocument();
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
  });

  it('should call onSelectView when view selected', () => {
    const onSelectView = vi.fn();
    render(<ViewSwitcher {...defaultProps} onSelectView={onSelectView} />);

    fireEvent.click(screen.getByRole('button', { name: /views/i }));
    fireEvent.click(screen.getByText('Open Issues'));

    expect(onSelectView).toHaveBeenCalledWith(mockViews[0]);
  });

  it('should show active view name', () => {
    render(<ViewSwitcher {...defaultProps} activeViewId="view-1" />);
    expect(screen.getByText('Open Issues')).toBeInTheDocument();
  });

  it('should show view count badge', () => {
    render(<ViewSwitcher {...defaultProps} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('EditViewDialog', () => {
  const mockView: SavedView = {
    id: 'view-1',
    name: 'Open Issues',
    description: 'All open issues',
    config: { filters: { status: 'open' }, viewType: 'list' },
    createdAt: new Date().toISOString(),
  };

  const defaultProps: EditViewDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    view: mockView,
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<EditViewDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should pre-fill name', () => {
    render(<EditViewDialog {...defaultProps} />);
    expect(screen.getByDisplayValue('Open Issues')).toBeInTheDocument();
  });

  it('should pre-fill description', () => {
    render(<EditViewDialog {...defaultProps} />);
    expect(screen.getByDisplayValue('All open issues')).toBeInTheDocument();
  });

  it('should call onSave with updated data', async () => {
    const onSave = vi.fn();
    render(<EditViewDialog {...defaultProps} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue('Open Issues'), {
      target: { value: 'Updated Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'view-1',
          name: 'Updated Name',
        })
      );
    });
  });
});
