/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { LabelBadge } from '@/ui/components/labels/label-badge';
import { LabelPicker } from '@/ui/components/labels/label-picker';
import { LabelManager } from '@/ui/components/labels/label-manager';
import { useLabels } from '@/ui/components/labels/use-labels';
import type { Label } from '@/ui/components/labels/types';

// Mock apiClient for API calls
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
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
const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);

describe('LabelBadge', () => {
  const mockLabel: Label = {
    id: 'label-1',
    name: 'bug',
    color: '#d73a4a',
  };

  it('renders label name', () => {
    render(<LabelBadge label={mockLabel} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
  });

  it('applies label color as background', () => {
    render(<LabelBadge label={mockLabel} />);
    const badge = screen.getByText('bug');
    expect(badge).toHaveStyle({ backgroundColor: '#d73a4a' });
  });

  it('shows remove button when onRemove provided', () => {
    const onRemove = vi.fn();
    render(<LabelBadge label={mockLabel} onRemove={onRemove} />);
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('calls onRemove when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<LabelBadge label={mockLabel} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith(mockLabel);
  });

  it('does not show remove button by default', () => {
    render(<LabelBadge label={mockLabel} />);
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('renders small size variant', () => {
    render(<LabelBadge label={mockLabel} size="sm" />);
    const badge = screen.getByText('bug');
    expect(badge.className).toContain('text-xs');
  });

  it('computes readable text color based on background', () => {
    // Dark background should have white text
    const darkLabel = { ...mockLabel, color: '#000000' };
    const { rerender } = render(<LabelBadge label={darkLabel} />);
    const darkBadge = screen.getByText('bug');
    expect(darkBadge).toHaveStyle({ color: '#ffffff' });

    // Light background should have dark text
    const lightLabel = { ...mockLabel, color: '#ffffff' };
    rerender(<LabelBadge label={lightLabel} />);
    const lightBadge = screen.getByText('bug');
    expect(lightBadge).toHaveStyle({ color: '#000000' });
  });
});

describe('LabelPicker', () => {
  const mockLabels: Label[] = [
    { id: 'label-1', name: 'bug', color: '#d73a4a' },
    { id: 'label-2', name: 'enhancement', color: '#a2eeef' },
    { id: 'label-3', name: 'documentation', color: '#0075ca' },
  ];

  const selectedLabels: Label[] = [{ id: 'label-1', name: 'bug', color: '#d73a4a' }];

  const defaultProps = {
    labels: mockLabels,
    selectedLabels,
    onSelect: vi.fn(),
    onDeselect: vi.fn(),
    onCreate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders selected labels', () => {
    render(<LabelPicker {...defaultProps} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
  });

  it('shows dropdown with available labels when clicked', () => {
    render(<LabelPicker {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /add label/i }));

    expect(screen.getByText('enhancement')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
  });

  it('filters labels based on search', () => {
    render(<LabelPicker {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /add label/i }));

    const searchInput = screen.getByPlaceholderText(/search labels/i);
    fireEvent.change(searchInput, { target: { value: 'doc' } });

    expect(screen.getByText('documentation')).toBeInTheDocument();
    expect(screen.queryByText('enhancement')).not.toBeInTheDocument();
  });

  it('calls onSelect when clicking unselected label', () => {
    const onSelect = vi.fn();
    render(<LabelPicker {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /add label/i }));
    fireEvent.click(screen.getByText('enhancement'));

    expect(onSelect).toHaveBeenCalledWith(mockLabels[1]);
  });

  it('shows create option when search does not match', () => {
    render(<LabelPicker {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /add label/i }));

    const searchInput = screen.getByPlaceholderText(/search labels/i);
    fireEvent.change(searchInput, { target: { value: 'new-label' } });

    expect(screen.getByText(/create "new-label"/i)).toBeInTheDocument();
  });

  it('calls onCreate when clicking create option', () => {
    const onCreate = vi.fn();
    render(<LabelPicker {...defaultProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /add label/i }));

    const searchInput = screen.getByPlaceholderText(/search labels/i);
    fireEvent.change(searchInput, { target: { value: 'new-label' } });
    fireEvent.click(screen.getByText(/create "new-label"/i));

    expect(onCreate).toHaveBeenCalledWith('new-label');
  });

  it('removes label when clicking X on badge', () => {
    const onDeselect = vi.fn();
    render(<LabelPicker {...defaultProps} onDeselect={onDeselect} />);

    // Find the selected label badge and click its remove button
    const badge = screen.getByText('bug').closest('[data-label-badge]');
    const removeButton = badge?.querySelector('button');
    if (removeButton) fireEvent.click(removeButton);

    expect(onDeselect).toHaveBeenCalledWith(selectedLabels[0]);
  });
});

describe('LabelManager', () => {
  const mockLabels: Label[] = [
    { id: 'label-1', name: 'bug', color: '#d73a4a' },
    { id: 'label-2', name: 'enhancement', color: '#a2eeef' },
  ];

  const defaultProps = {
    labels: mockLabels,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays all labels', () => {
    render(<LabelManager {...defaultProps} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('enhancement')).toBeInTheDocument();
  });

  it('shows create label form', () => {
    render(<LabelManager {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /new label/i }));

    expect(screen.getByPlaceholderText(/label name/i)).toBeInTheDocument();
  });

  it('calls onCreate with label data', () => {
    const onCreate = vi.fn();
    render(<LabelManager {...defaultProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /new label/i }));

    const nameInput = screen.getByPlaceholderText(/label name/i);
    fireEvent.change(nameInput, { target: { value: 'new-label' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new-label',
      }),
    );
  });

  it('shows delete button for each label', () => {
    render(<LabelManager {...defaultProps} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons.length).toBe(2);
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<LabelManager {...defaultProps} onDelete={onDelete} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    // Confirm deletion
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onDelete).toHaveBeenCalledWith('label-1');
  });

  it('filters labels by search', () => {
    render(<LabelManager {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search labels/i);
    fireEvent.change(searchInput, { target: { value: 'bug' } });

    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.queryByText('enhancement')).not.toBeInTheDocument();
  });
});

describe('useLabels hook', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('fetches labels on mount', async () => {
    mockGet.mockResolvedValueOnce([{ id: 'label-1', name: 'bug', color: '#d73a4a' }]);

    const { result } = renderHook(() => useLabels());

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockGet).toHaveBeenCalledWith('/api/labels');
    expect(result.current.labels).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('creates a new label', async () => {
    mockGet.mockResolvedValueOnce([]);
    mockPost.mockResolvedValueOnce({ id: 'new-label', name: 'test', color: '#000000' });

    const { result } = renderHook(() => useLabels());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current.createLabel({ name: 'test', color: '#000000' });
    });

    expect(mockPost).toHaveBeenCalledWith('/api/labels', { name: 'test', color: '#000000' });
  });

  it('deletes a label', async () => {
    mockGet.mockResolvedValueOnce([{ id: 'label-1', name: 'bug', color: '#d73a4a' }]);
    mockDelete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useLabels());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current.deleteLabel('label-1');
    });

    expect(mockDelete).toHaveBeenCalledWith('/api/labels/label-1');
  });
});

describe('Color Palette', () => {
  it('provides GitHub-style color options', async () => {
    const { LABEL_COLORS } = await import('@/ui/components/labels/color-palette');

    expect(LABEL_COLORS).toContainEqual(expect.objectContaining({ name: 'bug', hex: '#d73a4a' }));
    expect(LABEL_COLORS).toContainEqual(expect.objectContaining({ name: 'enhancement', hex: '#a2eeef' }));
    expect(LABEL_COLORS.length).toBeGreaterThanOrEqual(10);
  });
});
