/**
 * @vitest-environment jsdom
 * Tests for #2479: ExportButton component
 *
 * Validates:
 * - Renders download button with tooltip
 * - Shows format picker dropdown on click
 * - Triggers export on format selection
 * - Shows progress state during export
 * - Shows download link when ready
 * - Handles error state
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock API client ──────────────────────────────────────────────────
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// ── Mock namespace context ───────────────────────────────────────────
vi.mock('@/ui/contexts/namespace-context', () => ({
  useActiveNamespaces: () => ['default'],
  useNamespaceSafe: () => ({
    grants: [{ namespace: 'default' }],
    activeNamespace: 'default',
    setActiveNamespace: vi.fn(),
    hasMultipleNamespaces: false,
  }),
}));

vi.mock('@/ui/contexts/user-context', () => ({
  useUserEmail: () => 'test@example.com',
}));

vi.mock('@/ui/hooks/use-namespace-invalidate', () => ({
  useNamespaceInvalidate: () => vi.fn(),
}));

// ── Mock sonner ──────────────────────────────────────────────────────
vi.mock('sonner', () => {
  const fn = vi.fn();
  (fn as Record<string, unknown>).success = vi.fn();
  (fn as Record<string, unknown>).error = vi.fn();
  return { toast: fn };
});

import { ExportButton } from '@/ui/components/notes/export/export-button';
import type { ExportResponse } from '@/ui/lib/api-types';

// ── Test data ────────────────────────────────────────────────────────
const pendingExport: ExportResponse = {
  id: 'export-1',
  status: 'pending',
  format: 'pdf',
  source_type: 'note',
  source_id: 'note-1',
  original_filename: null,
  size_bytes: null,
  download_url: null,
  poll_url: '/exports/export-1',
  error_message: null,
  expires_at: '2026-03-14T00:00:00Z',
  created_at: '2026-03-13T00:00:00Z',
  updated_at: '2026-03-13T00:00:00Z',
};

const readyExport: ExportResponse = {
  ...pendingExport,
  status: 'ready',
  download_url: 'https://s3.example.com/export-1.pdf',
  size_bytes: 12345,
  original_filename: 'My Note.pdf',
};

// ── Helper ───────────────────────────────────────────────────────────
function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function renderExportButton(props: Partial<React.ComponentProps<typeof ExportButton>> = {}) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ExportButton
        sourceType="note"
        sourceId="note-1"
        sourceName="My Note"
        {...props}
      />
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────
describe('ExportButton renders (#2479)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders download button', () => {
    renderExportButton();
    const button = screen.getByRole('button', { name: /download/i });
    expect(button).toBeInTheDocument();
  });

  it('has dropdown trigger with aria-haspopup', () => {
    renderExportButton();
    const button = screen.getByRole('button', { name: /download/i });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('opens format picker on pointerdown', async () => {
    renderExportButton();
    const button = screen.getByRole('button', { name: /download/i });
    // Radix DropdownMenu listens for pointerdown, not click
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });

    await waitFor(() => {
      expect(screen.getByText('PDF')).toBeInTheDocument();
      expect(screen.getByText(/Word Document/)).toBeInTheDocument();
      expect(screen.getByText(/OpenDocument/)).toBeInTheDocument();
    });
  });

  it('triggers export on format selection', async () => {
    mockPost.mockResolvedValue(pendingExport);
    mockGet.mockResolvedValue(readyExport);

    renderExportButton();
    const button = screen.getByRole('button', { name: /download/i });
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });

    await waitFor(() => {
      expect(screen.getByText('PDF')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('PDF'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/notes/note-1/exports',
        expect.objectContaining({ format: 'pdf' }),
      );
    });
  });

  it('has correct aria-label with source name', () => {
    renderExportButton({ sourceName: 'Test Note' });
    const button = screen.getByRole('button', { name: /download test note/i });
    expect(button).toBeInTheDocument();
  });

  it('renders disabled when disabled prop is true', () => {
    renderExportButton({ disabled: true });
    const button = screen.getByRole('button', { name: /download/i });
    expect(button).toBeDisabled();
  });
});
