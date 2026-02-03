/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  QuickAddDialog,
  WorkItemCreateDialog,
  type WorkItemKind,
} from '@/ui/components/work-item-create';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('QuickAddDialog', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onCreated: vi.fn(),
    defaultParentId: undefined,
    defaultKind: 'issue' as WorkItemKind,
  };

  it('renders when open', () => {
    render(<QuickAddDialog {...defaultProps} />);

    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument();
  });

  it('shows kind selector with all options', async () => {
    render(<QuickAddDialog {...defaultProps} />);

    // Click the kind selector trigger
    const kindTrigger = screen.getByRole('combobox');
    fireEvent.click(kindTrigger);

    await waitFor(() => {
      // Use getAllByRole to find options, which are more reliable than text matching
      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4);
      expect(options.map((o) => o.textContent)).toEqual(
        expect.arrayContaining(['Project', 'Initiative', 'Epic', 'Issue'])
      );
    });
  });

  it('calls onCreated with new item after successful creation', async () => {
    const onCreated = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'new-id',
          title: 'Test Item',
          kind: 'issue',
        }),
    });

    render(<QuickAddDialog {...defaultProps} onCreated={onCreated} />);

    const titleInput = screen.getByPlaceholderText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'Test Item' } });

    const submitButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-id',
          title: 'Test Item',
          kind: 'issue',
        })
      );
    });
  });

  it('shows error message when creation fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'title is required' }),
    });

    render(<QuickAddDialog {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument();
    });
  });

  it('submits with Enter key', async () => {
    const onCreated = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'new-id',
          title: 'Keyboard Submit',
          kind: 'issue',
        }),
    });

    render(<QuickAddDialog {...defaultProps} onCreated={onCreated} />);

    const titleInput = screen.getByPlaceholderText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'Keyboard Submit' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it('closes with Escape key', async () => {
    const onOpenChange = vi.fn();
    render(<QuickAddDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const titleInput = screen.getByPlaceholderText(/title/i);
    fireEvent.keyDown(titleInput, { key: 'Escape' });

    // The Radix Dialog handles Escape - dialog closure is handled by onOpenChange
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('disables submit button while loading', async () => {
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: true, json: () => Promise.resolve({}) }),
            1000
          )
        )
    );

    render(<QuickAddDialog {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'Test' } });

    const submitButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
  });

  it('uses defaultParentId when provided', async () => {
    const onCreated = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'new-id',
          title: 'Child Item',
          kind: 'issue',
          parent_id: 'parent-123',
        }),
    });

    render(
      <QuickAddDialog
        {...defaultProps}
        defaultParentId="parent-123"
        onCreated={onCreated}
      />
    );

    const titleInput = screen.getByPlaceholderText(/title/i);
    fireEvent.change(titleInput, { target: { value: 'Child Item' } });

    const submitButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/work-items',
        expect.objectContaining({
          body: expect.stringContaining('"parentId":"parent-123"'),
        })
      );
    });
  });
});

describe('WorkItemCreateDialog', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Mock tree fetch for parent selector
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              id: 'project-1',
              title: 'Project 1',
              kind: 'project',
              status: 'in_progress',
              parent_id: null,
              children: [],
            },
          ],
        }),
    });
  });

  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onCreated: vi.fn(),
  };

  it('renders full form with all fields', async () => {
    render(<WorkItemCreateDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/kind/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });
  });

  it('shows estimate field for issues', async () => {
    render(<WorkItemCreateDialog {...defaultProps} defaultKind="issue" />);

    await waitFor(() => {
      expect(screen.getByLabelText(/estimate/i)).toBeInTheDocument();
    });
  });

  it('shows validation error for empty title', async () => {
    render(<WorkItemCreateDialog {...defaultProps} />);

    await waitFor(() => screen.getByLabelText(/title/i));

    const submitButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument();
    });
  });

  it('disables parent selector for project kind', async () => {
    render(<WorkItemCreateDialog {...defaultProps} defaultKind="project" />);

    await waitFor(() => {
      // For projects, parent is not needed, so it may be hidden or disabled
      const parentLabels = screen.queryAllByLabelText(/parent/i);
      if (parentLabels.length > 0) {
        expect(parentLabels[0]).toBeDisabled();
      }
    });
  });

  it('submits form with all filled fields', async () => {
    const onCreated = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [],
        }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'new-id',
          title: 'Full Form Item',
          kind: 'project',
          description: 'A test description',
        }),
    });

    render(
      <WorkItemCreateDialog
        {...defaultProps}
        defaultKind="project"
        onCreated={onCreated}
      />
    );

    await waitFor(() => screen.getByLabelText(/title/i));

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: 'Full Form Item' },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'A test description' },
    });

    const submitButton = screen.getByRole('button', { name: /create/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Full Form Item',
          kind: 'project',
        })
      );
    });
  });
});
