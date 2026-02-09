/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CloneDialog } from '@/ui/components/clone-dialog';
import type { CloneOptions, WorkItemForClone } from '@/ui/components/clone-dialog/types';

describe('CloneDialog', () => {
  const mockItem: WorkItemForClone = {
    id: 'item-1',
    title: 'Test Item',
    kind: 'epic',
    hasChildren: true,
    hasTodos: true,
  };

  const defaultProps = {
    open: true,
    item: mockItem,
    onClone: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the dialog when open', () => {
      render(<CloneDialog {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows the item title with (Copy) suffix', () => {
      render(<CloneDialog {...defaultProps} />);
      expect(screen.getByDisplayValue('Test Item (Copy)')).toBeInTheDocument();
    });

    it('shows clone options', () => {
      render(<CloneDialog {...defaultProps} />);
      expect(screen.getByText(/clone item only/i)).toBeInTheDocument();
      expect(screen.getByText(/include children/i)).toBeInTheDocument();
      expect(screen.getByText(/include todos/i)).toBeInTheDocument();
    });

    it('disables include children when item has no children', () => {
      const itemNoChildren: WorkItemForClone = { ...mockItem, hasChildren: false };
      render(<CloneDialog {...defaultProps} item={itemNoChildren} />);

      const checkbox = screen.getByRole('checkbox', { name: /include children/i });
      expect(checkbox).toBeDisabled();
    });

    it('disables include todos when item has no todos', () => {
      const itemNoTodos: WorkItemForClone = { ...mockItem, hasTodos: false };
      render(<CloneDialog {...defaultProps} item={itemNoTodos} />);

      const checkbox = screen.getByRole('checkbox', { name: /include todos/i });
      expect(checkbox).toBeDisabled();
    });
  });

  describe('title editing', () => {
    it('allows editing the cloned item title', () => {
      render(<CloneDialog {...defaultProps} />);

      const input = screen.getByDisplayValue('Test Item (Copy)');
      fireEvent.change(input, { target: { value: 'My New Item' } });

      expect(screen.getByDisplayValue('My New Item')).toBeInTheDocument();
    });
  });

  describe('clone options', () => {
    it('toggles include children option', () => {
      render(<CloneDialog {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox', { name: /include children/i });
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it('toggles include todos option', () => {
      render(<CloneDialog {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox', { name: /include todos/i });
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });
  });

  describe('actions', () => {
    it('calls onClone with correct options when Clone button clicked', async () => {
      const onClone = vi.fn();
      render(<CloneDialog {...defaultProps} onClone={onClone} />);

      // Change title
      const input = screen.getByDisplayValue('Test Item (Copy)');
      fireEvent.change(input, { target: { value: 'Cloned Item' } });

      // Enable options
      fireEvent.click(screen.getByRole('checkbox', { name: /include children/i }));
      fireEvent.click(screen.getByRole('checkbox', { name: /include todos/i }));

      // Click Clone
      fireEvent.click(screen.getByRole('button', { name: /^clone$/i }));

      expect(onClone).toHaveBeenCalledWith({
        title: 'Cloned Item',
        includeChildren: true,
        includeTodos: true,
      });
    });

    it('calls onCancel when Cancel button clicked', () => {
      const onCancel = vi.fn();
      render(<CloneDialog {...defaultProps} onCancel={onCancel} />);

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onCancel).toHaveBeenCalled();
    });

    it('disables Clone button when title is empty', () => {
      render(<CloneDialog {...defaultProps} />);

      const input = screen.getByDisplayValue('Test Item (Copy)');
      fireEvent.change(input, { target: { value: '' } });

      expect(screen.getByRole('button', { name: /^clone$/i })).toBeDisabled();
    });

    it('shows loading state during clone', () => {
      render(<CloneDialog {...defaultProps} isCloning />);

      expect(screen.getByRole('button', { name: /cloning/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cloning/i })).toBeDisabled();
    });
  });

  describe('keyboard shortcuts', () => {
    it('submits on Enter key', () => {
      const onClone = vi.fn();
      render(<CloneDialog {...defaultProps} onClone={onClone} />);

      const input = screen.getByDisplayValue('Test Item (Copy)');
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onClone).toHaveBeenCalled();
    });

    it('cancels on Escape key', () => {
      const onCancel = vi.fn();
      render(<CloneDialog {...defaultProps} onCancel={onCancel} />);

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      expect(onCancel).toHaveBeenCalled();
    });
  });
});
