/**
 * Tests for TanStack Query hooks.
 *
 * Uses a test QueryClient wrapper to verify query behaviour,
 * cache key structure, and enabled logic.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkItems, useWorkItem, useWorkItemTree, workItemKeys } from '../../src/ui/hooks/queries/use-work-items.ts';
import { useProjects, projectKeys } from '../../src/ui/hooks/queries/use-projects.ts';
import { useActivity, activityKeys } from '../../src/ui/hooks/queries/use-activity.ts';
import { useContacts, contactKeys } from '../../src/ui/hooks/queries/use-contacts.ts';
import { useWorkItemMemories, useMemories, memoryKeys } from '../../src/ui/hooks/queries/use-memories.ts';
import { useNotifications, useUnreadNotificationCount, notificationKeys } from '../../src/ui/hooks/queries/use-notifications.ts';
import {
  useNotes,
  useNote,
  useNoteVersions,
  useNoteVersion,
  useNoteVersionCompare,
  useNoteShares,
  useNotesSharedWithMe,
  noteKeys,
} from '../../src/ui/hooks/queries/use-notes.ts';
import {
  useNotebooks,
  useNotebook,
  useNotebooksTree,
  useNotebookShares,
  useNotebooksSharedWithMe,
  notebookKeys,
} from '../../src/ui/hooks/queries/use-notebooks.ts';

// Save original fetch
const originalFetch = globalThis.fetch;

// Mock user email for authenticated requests
const TEST_USER_EMAIL = 'test@example.com';

// Create a mock UserContext for testing hooks that require authentication
const MockUserContext = React.createContext<{ email: string | null; isLoading: boolean; isAuthenticated: boolean } | null>(null);

// We need to mock the useUserEmail hook to return our test email
vi.mock('../../src/ui/contexts/user-context', () => ({
  useUserEmail: () => TEST_USER_EMAIL,
  useUser: () => ({ email: TEST_USER_EMAIL, isLoading: false, isAuthenticated: true, signalAuthenticated: vi.fn(), logout: vi.fn() }),
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { Wrapper, queryClient };
}

function mockFetchResponse(data: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  });
}

describe('Query Key Factories', () => {
  it('workItemKeys should produce correct key arrays', () => {
    expect(workItemKeys.all).toEqual(['work-items']);
    expect(workItemKeys.lists()).toEqual(['work-items', 'list']);
    expect(workItemKeys.list({ kind: 'project' })).toEqual(['work-items', 'list', { kind: 'project' }]);
    expect(workItemKeys.details()).toEqual(['work-items', 'detail']);
    expect(workItemKeys.detail('abc')).toEqual(['work-items', 'detail', 'abc']);
    expect(workItemKeys.tree()).toEqual(['work-items', 'tree']);
  });

  it('projectKeys should produce correct key arrays', () => {
    expect(projectKeys.all).toEqual(['projects']);
    expect(projectKeys.list()).toEqual(['projects', 'list']);
  });

  it('activityKeys should produce correct key arrays', () => {
    expect(activityKeys.all).toEqual(['activity']);
    expect(activityKeys.list(50)).toEqual(['activity', 'list', 50]);
  });

  it('contactKeys should produce correct key arrays', () => {
    expect(contactKeys.all).toEqual(['contacts']);
    expect(contactKeys.lists()).toEqual(['contacts', 'list']);
    expect(contactKeys.list('john')).toEqual(['contacts', 'list', 'john']);
    expect(contactKeys.detail('id-1')).toEqual(['contacts', 'detail', 'id-1']);
  });

  it('memoryKeys should produce correct key arrays', () => {
    expect(memoryKeys.all).toEqual(['memories']);
    expect(memoryKeys.lists()).toEqual(['memories', 'list']);
    expect(memoryKeys.forWorkItem('wi-1')).toEqual(['memories', 'work-item', 'wi-1']);
  });

  it('notificationKeys should produce correct key arrays', () => {
    expect(notificationKeys.all).toEqual(['notifications']);
    expect(notificationKeys.list()).toEqual(['notifications', 'list']);
    expect(notificationKeys.unread_count()).toEqual(['notifications', 'unread-count']);
  });

  it('noteKeys should produce correct key arrays', () => {
    expect(noteKeys.all).toEqual(['notes']);
    expect(noteKeys.lists()).toEqual(['notes', 'list']);
    expect(noteKeys.list({ notebook_id: 'nb-1' })).toEqual(['notes', 'list', { notebook_id: 'nb-1' }]);
    expect(noteKeys.details()).toEqual(['notes', 'detail']);
    expect(noteKeys.detail('note-1')).toEqual(['notes', 'detail', 'note-1']);
    expect(noteKeys.versions('note-1')).toEqual(['notes', 'versions', 'note-1']);
    expect(noteKeys.version('note-1', 2)).toEqual(['notes', 'versions', 'note-1', 2]);
    expect(noteKeys.versionCompare('note-1', 1, 2)).toEqual(['notes', 'versions', 'note-1', 'compare', 1, 2]);
    expect(noteKeys.shares('note-1')).toEqual(['notes', 'shares', 'note-1']);
    expect(noteKeys.sharedWithMe()).toEqual(['notes', 'shared-with-me']);
  });

  it('notebookKeys should produce correct key arrays', () => {
    expect(notebookKeys.all).toEqual(['notebooks']);
    expect(notebookKeys.lists()).toEqual(['notebooks', 'list']);
    expect(notebookKeys.list({ parent_id: 'parent-1' })).toEqual(['notebooks', 'list', { parent_id: 'parent-1' }]);
    expect(notebookKeys.details()).toEqual(['notebooks', 'detail']);
    expect(notebookKeys.detail('nb-1')).toEqual(['notebooks', 'detail', 'nb-1']);
    expect(notebookKeys.tree()).toEqual(['notebooks', 'tree']);
    expect(notebookKeys.shares('nb-1')).toEqual(['notebooks', 'shares', 'nb-1']);
    expect(notebookKeys.sharedWithMe()).toEqual(['notebooks', 'shared-with-me']);
  });
});

describe('useWorkItems', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch work items successfully', async () => {
    const data = { items: [{ id: '1', title: 'Test', status: 'open', priority: 'medium', task_type: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItems(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
  });

  it('should append filters to query string', async () => {
    const data = { items: [] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useWorkItems({ kind: 'project' }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/work-items?kind=project', expect.any(Object));
    });
  });

  it('should handle error responses', async () => {
    mockFetchResponse({ message: 'Server error' }, 500);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItems(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

describe('useWorkItem', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch a single work item', async () => {
    const data = { id: 'abc', title: 'Test Item', status: 'open', priority: 'P2', kind: 'issue', created_at: '2026-01-01', updated_at: '2026-01-01' };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItem('abc'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItem(''), { wrapper: Wrapper });

    // Should remain in initial state since query is disabled
    expect(result.current.fetchStatus).toBe('idle');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('useWorkItemTree', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch the work item tree', async () => {
    const data = { items: [{ id: '1', title: 'Project', kind: 'project', status: 'open', priority: 'medium', parent_id: null, children_count: 0, children: [] }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItemTree(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
  });
});

describe('useProjects', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch projects (work items with kind=project)', async () => {
    const data = { items: [{ id: '1', title: 'My Project' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProjects(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/work-items?kind=project', expect.any(Object));
  });
});

describe('useActivity', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch activity with default limit', async () => {
    const data = { items: [{ id: '1', type: 'created' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useActivity(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/activity?limit=50', expect.any(Object));
  });

  it('should fetch activity with custom limit', async () => {
    const data = { items: [] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useActivity(10), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/activity?limit=10', expect.any(Object));
    });
  });
});

describe('useContacts', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch contacts without search', async () => {
    const data = { contacts: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useContacts(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/contacts', expect.any(Object));
  });

  it('should fetch contacts with search term', async () => {
    const data = { contacts: [{ id: '1', display_name: 'John' }], total: 1 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useContacts('john'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/contacts?search=john', expect.any(Object));
    });
  });
});

describe('useWorkItemMemories', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch memories for a work item', async () => {
    const data = { memories: [{ id: 'm1', title: 'Note', content: 'test content', memory_type: 'note', importance: 5, confidence: 0.8, tags: [], created_by_human: false, is_active: true, embedding_status: 'pending', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItemMemories('wi-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/work-items/wi-1/memories', expect.any(Object));
  });

  it('should not fetch when work_item_id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkItemMemories(''), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useMemories', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch global memory list', async () => {
    const data = { items: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useMemories(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/memory', expect.any(Object));
  });
});

describe('useNotifications', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch notifications', async () => {
    const data = { notifications: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotifications(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notifications', expect.any(Object));
  });
});

describe('useUnreadNotificationCount', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch unread count', async () => {
    const data = { count: 5 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUnreadNotificationCount(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ count: 5 });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notifications/unread-count', expect.any(Object));
  });
});

// ============================================
// Notes Query Hooks Tests (Issue #653)
// ============================================

describe('useNotes', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch notes without params', async () => {
    const data = { notes: [{ id: 'n1', title: 'Note 1' }], total: 1 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotes(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes?user_email=test%40example.com', expect.any(Object));
  });

  it('should append notebook_id to query string', async () => {
    const data = { notes: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotes({ notebook_id: 'nb-123' }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes?user_email=test%40example.com&notebook_id=nb-123', expect.any(Object));
    });
  });

  it('should append multiple tags to query string', async () => {
    const data = { notes: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotes({ tags: ['tag1', 'tag2'] }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes?user_email=test%40example.com&tags=tag1&tags=tag2', expect.any(Object));
    });
  });

  it('should append visibility filter to query string', async () => {
    const data = { notes: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotes({ visibility: 'private' }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes?user_email=test%40example.com&visibility=private', expect.any(Object));
    });
  });

  it('should append pagination params to query string', async () => {
    const data = { notes: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotes({ limit: 10, offset: 20 }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes?user_email=test%40example.com&limit=10&offset=20', expect.any(Object));
    });
  });

  it('should append sorting params to query string', async () => {
    const data = { notes: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotes({ sort_by: 'title', sort_order: 'asc' }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes?user_email=test%40example.com&sort_by=title&sort_order=asc', expect.any(Object));
    });
  });

  it('should handle error responses', async () => {
    mockFetchResponse({ message: 'Server error' }, 500);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotes(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

describe('useNote', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch a single note by ID', async () => {
    const data = { id: 'note-1', title: 'Test Note', content: 'Content' };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNote('note-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/note-1?user_email=test%40example.com', expect.any(Object));
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNote(''), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('useNoteVersions', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch versions for a note', async () => {
    const data = { versions: [{ id: 'v1', versionNumber: 1 }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersions('note-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/note-1/versions', expect.any(Object));
  });

  it('should append pagination params', async () => {
    const data = { versions: [] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNoteVersions('note-1', { limit: 5, offset: 10 }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/note-1/versions?limit=5&offset=10', expect.any(Object));
    });
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersions(''), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useNoteVersion', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch a specific version', async () => {
    const data = { id: 'v2', versionNumber: 2, title: 'Version 2' };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersion('note-1', 2), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/note-1/versions/2', expect.any(Object));
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersion('', 1), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should not fetch when version is 0 or negative', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersion('note-1', 0), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useNoteVersionCompare', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should compare two versions', async () => {
    const data = { from: { versionNumber: 1 }, to: { versionNumber: 2 }, diff: { titleChanged: true } };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersionCompare('note-1', 1, 2), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/note-1/versions/compare?from=1&to=2', expect.any(Object));
  });

  it('should not fetch when versions are same', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteVersionCompare('note-1', 2, 2), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useNoteShares', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch shares for a note', async () => {
    const data = { noteId: 'note-1', shares: [{ id: 's1', email: 'user@example.com' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteShares('note-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/note-1/shares', expect.any(Object));
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteShares(''), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useNotesSharedWithMe', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch notes shared with current user', async () => {
    const data = { notes: [{ id: 'n1', title: 'Shared Note' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotesSharedWithMe(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notes/shared-with-me', expect.any(Object));
  });
});

// ============================================
// Notebooks Query Hooks Tests (Issue #653)
// ============================================

describe('useNotebooks', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch notebooks without params', async () => {
    const data = { notebooks: [{ id: 'nb1', name: 'Notebook 1' }], total: 1 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebooks(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks?user_email=test%40example.com', expect.any(Object));
  });

  it('should append parent_id to query string', async () => {
    const data = { notebooks: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotebooks({ parent_id: 'parent-1' }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks?user_email=test%40example.com&parent_id=parent-1', expect.any(Object));
    });
  });

  it('should append include_archived to query string', async () => {
    const data = { notebooks: [], total: 0 };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotebooks({ include_archived: true }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks?user_email=test%40example.com&include_archived=true', expect.any(Object));
    });
  });

  it('should handle error responses', async () => {
    mockFetchResponse({ message: 'Server error' }, 500);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebooks(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});

describe('useNotebook', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch a single notebook by ID', async () => {
    const data = { id: 'nb-1', name: 'Test Notebook' };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebook('nb-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks/nb-1?user_email=test%40example.com', expect.any(Object));
  });

  it('should append include options to query string', async () => {
    const data = { id: 'nb-1', name: 'Notebook', notes: [], children: [] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotebook('nb-1', { includeNotes: true, includeChildren: true }), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/notebooks/nb-1?user_email=test%40example.com&includeNotes=true&includeChildren=true',
        expect.any(Object),
      );
    });
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebook(''), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('useNotebooksTree', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch notebooks tree structure', async () => {
    const data = [{ id: 'nb1', name: 'Root', children: [] }];
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebooksTree(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks/tree?user_email=test%40example.com', expect.any(Object));
  });

  it('should append include_note_counts when true', async () => {
    const data = [];
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    renderHook(() => useNotebooksTree(true), { wrapper: Wrapper });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks/tree?user_email=test%40example.com&include_note_counts=true', expect.any(Object));
    });
  });
});

describe('useNotebookShares', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch shares for a notebook', async () => {
    const data = { notebook_id: 'nb-1', shares: [] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebookShares('nb-1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks/nb-1/shares', expect.any(Object));
  });

  it('should not fetch when id is empty', async () => {
    mockFetchResponse({});

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebookShares(''), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useNotebooksSharedWithMe', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch notebooks shared with current user', async () => {
    const data = { notebooks: [{ id: 'nb1', name: 'Shared Notebook' }] };
    mockFetchResponse(data);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNotebooksSharedWithMe(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/notebooks/shared-with-me', expect.any(Object));
  });
});
