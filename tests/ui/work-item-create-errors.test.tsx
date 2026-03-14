/**
 * @vitest-environment jsdom
 *
 * Tests for WorkItemCreateDialog error handling.
 * Issue #2295: Silent API failures should surface as toast notifications.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkItemCreateDialog } from '@/ui/components/work-item-create';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock namespace context
vi.mock('@/ui/contexts/namespace-context', () => ({
  useNamespaceSafe: () => ({
    activeNamespace: 'default',
    namespaces: ['default'],
    setActiveNamespace: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkItemCreateDialog — Error Handling (#2295)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows toast when parent list loading fails', async () => {
    // Simulate parent list fetch failure
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(
      <WorkItemCreateDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultKind="issue"
      />,
    );

    // Wait for the async loadParents to complete and show toast
    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to load parent items'),
        );
      },
    );
  });

  it('shows toast when parent list returns non-OK response', async () => {
    // Simulate a non-OK API response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    });

    render(
      <WorkItemCreateDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        defaultKind="issue"
      />,
    );

    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalled();
      },
    );
  });
});
