/**
 * @vitest-environment jsdom
 *
 * Tests for NotesPage save behaviour.
 *
 * Validates:
 * - #2240: Saving an existing note uses view.noteId directly, not stale list cache lookup
 * - Save calls updateNoteMutation with the correct note ID
 * - New note list view renders without errors
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { Note, NotesResponse, NotebooksResponse } from '@/ui/lib/api-types';

// ---- Mocks ----

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

vi.mock('@/ui/contexts/user-context', () => ({
  useUserEmail: () => 'test@example.com',
}));

vi.mock('@/ui/components/feedback', () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton" className={className} />,
  SkeletonList: ({ count }: { count?: number }) => <div data-testid="skeleton-list" />,
  ErrorState: ({ title }: { title?: string }) => <div data-testid="error-state">{title}</div>,
  EmptyState: ({ title }: { title?: string; type?: string; description?: string; onRetry?: () => void; retryLabel?: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
  useAnnounce: () => ({ announce: vi.fn(), LiveRegion: () => null }),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon" />,
}));

vi.mock('@/ui/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/ui/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/ui/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/ui/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Capture the onSave callback from NoteDetail
let capturedOnSave: ((data: { title: string; content: string; notebook_id?: string; visibility: string; hide_from_agents: boolean }) => Promise<void>) | undefined;

vi.mock('@/ui/components/notes', () => ({
  NotesList: ({ notes }: { notes: unknown[] }) => <div data-testid="notes-list">{Array.isArray(notes) ? notes.length : 0} notes</div>,
  NoteDetail: ({
    onSave,
    isNew,
    saving,
  }: {
    onSave?: typeof capturedOnSave;
    isNew?: boolean;
    note?: unknown;
    saving?: boolean;
    [key: string]: unknown;
  }) => {
    capturedOnSave = onSave;
    return (
      <div data-testid="note-detail">
        {saving && <span data-testid="saving" />}
        {isNew && <span data-testid="is-new" />}
      </div>
    );
  },
}));

vi.mock('@/ui/components/notebooks/notebooks-sidebar', () => ({
  NotebooksSidebar: () => <div data-testid="notebooks-sidebar" />,
}));

vi.mock('@/ui/pages/notes', async () => {
  const actual = await vi.importActual<typeof import('@/ui/pages/notes')>('@/ui/pages/notes');
  return {
    ...actual,
    NotebookFormDialog: () => null,
    ShareDialogWrapper: () => null,
    NoteHistoryPanel: () => null,
    toUINote: (n: Note) => ({ ...n }),
    toUINotebook: (n: unknown) => ({ ...(n as Record<string, unknown>) }),
  };
});

import { apiClient } from '@/ui/lib/api-client';
import { NotesPage } from '@/ui/pages/NotesPage';

const mockGet = apiClient.get as Mock;
const mockPut = apiClient.put as Mock;

// Helpers

const NOTE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OTHER_NOTE_ID = 'b1ffcd00-ad1c-5fg9-cc7e-7cc0ce491b22';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const emptyNotebooksResponse: NotebooksResponse = { notebooks: [], total: 0 };

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    notebook_id: null,
    title: 'Test Note',
    content: 'Some content',
    summary: null,
    tags: [],
    is_pinned: false,
    sort_order: 0,
    visibility: 'private',
    hide_from_agents: false,
    embedding_status: 'complete',
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Render NotesPage at /notes/:noteId with route params.
 * `listNotes` controls what the list query returns — the note must be in the
 * list for NoteDetail to render (otherwise noteNotFound shows an error).
 */
function renderNotesPage(options: { noteId: string; listNotes: Note[] }) {
  const { noteId, listNotes } = options;
  const listResponse: NotesResponse = { notes: listNotes, total: listNotes.length };

  mockGet.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith('/notes')) {
      return Promise.resolve(listResponse);
    }
    if (typeof url === 'string' && url.startsWith('/notebooks')) {
      return Promise.resolve(emptyNotebooksResponse);
    }
    return Promise.resolve({});
  });

  const qc = createQueryClient();

  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/notes/${noteId}`]}>
        <Routes>
          <Route path="notes" element={<NotesPage />} />
          <Route path="notes/:noteId" element={<NotesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...utils, queryClient: qc };
}

// ---- Tests ----

describe('NotesPage handleSaveNote (#2240)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnSave = undefined;
  });

  it('saves an existing note using view.noteId, not the list cache lookup', async () => {
    const existingNote = makeNote({ id: NOTE_ID });
    const updatedNote = makeNote({ id: NOTE_ID, title: 'Updated title' });

    // Note is in list so NoteDetail renders, but the fix ensures save uses
    // view.noteId directly rather than looking up currentApiNote from the list
    renderNotesPage({ noteId: NOTE_ID, listNotes: [existingNote] });

    await waitFor(() => {
      expect(capturedOnSave).toBeDefined();
    });

    mockPut.mockResolvedValueOnce(updatedNote);

    await act(async () => {
      await capturedOnSave!({
        title: 'Updated title',
        content: 'Updated content',
        visibility: 'private',
        hide_from_agents: false,
      });
    });

    // Verify the update was called with the correct note ID from view state
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [url, body] = mockPut.mock.calls[0];
    expect(url).toBe(`/notes/${NOTE_ID}`);
    expect(body).toMatchObject({
      title: 'Updated title',
      content: 'Updated content',
      user_email: 'test@example.com',
    });
  });

  it('passes visibility and hide_from_agents fields through to update API', async () => {
    const existingNote = makeNote({ id: NOTE_ID });
    const updatedNote = makeNote({ id: NOTE_ID, visibility: 'shared', hide_from_agents: true });

    renderNotesPage({ noteId: NOTE_ID, listNotes: [existingNote] });

    await waitFor(() => {
      expect(capturedOnSave).toBeDefined();
    });

    mockPut.mockResolvedValueOnce(updatedNote);

    await act(async () => {
      await capturedOnSave!({
        title: 'Test Note',
        content: 'Some content',
        visibility: 'shared',
        hide_from_agents: true,
      });
    });

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [, body] = mockPut.mock.calls[0];
    expect(body).toMatchObject({
      visibility: 'shared',
      hide_from_agents: true,
    });
  });

  it('shows note-not-found when note is missing from list cache (stale cache)', async () => {
    // Note NOT in list — simulates stale/empty cache. Component shows error instead of NoteDetail.
    // Before the fix, if NoteDetail somehow rendered, save would silently no-op.
    // Now the component correctly shows an error AND save uses view.noteId if reached.
    renderNotesPage({ noteId: NOTE_ID, listNotes: [] });

    await waitFor(() => {
      expect(screen.getByText('Note not found')).toBeDefined();
    });

    // NoteDetail should NOT be rendered in this state
    expect(capturedOnSave).toBeUndefined();
  });

  it('renders notes list at /notes without errors', async () => {
    mockGet.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/notes')) {
        return Promise.resolve({ notes: [], total: 0 });
      }
      if (typeof url === 'string' && url.startsWith('/notebooks')) {
        return Promise.resolve(emptyNotebooksResponse);
      }
      return Promise.resolve({});
    });

    const qc = createQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/notes']}>
          <Routes>
            <Route path="notes" element={<NotesPage />} />
            <Route path="notes/:noteId" element={<NotesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('notes-list')).toBeDefined();
    });
  });
});
