/**
 * Application layout wrapper.
 *
 * Wraps the AppShell component around a React Router Outlet so that all
 * routes render inside the consistent sidebar + header chrome.
 * Also provides global features: command palette, keyboard shortcuts,
 * and work item creation dialogs.
 *
 * Split into AppLayout (auth guard) and AuthenticatedLayout (hooks + UI)
 * to satisfy React's rules of hooks — no hooks after early returns.
 */
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { LoginForm } from '@/ui/components/auth/login-form';
import { CommandPalette, type SearchResult } from '@/ui/components/command-palette';
import { KeyboardShortcutsHandler } from '@/ui/components/keyboard-shortcuts-handler';
import { AppShell } from '@/ui/components/layout/app-shell';
import type { BreadcrumbItem } from '@/ui/components/layout/breadcrumb';
import { type CreatedWorkItem, QuickAddDialog, WorkItemCreateDialog } from '@/ui/components/work-item-create';
import { useUser } from '@/ui/contexts/user-context';
import { useNotebooks } from '@/ui/hooks/queries/use-notebooks';
import { useNotes } from '@/ui/hooks/queries/use-notes';
import { apiClient } from '@/ui/lib/api-client';
import type { AppBootstrap, Note, Notebook, SearchResponse } from '@/ui/lib/api-types';
import { extractWorkItemId, matchNotesRoute, matchWorkItemsRoute } from '@/ui/lib/route-patterns';
import { readBootstrap } from '@/ui/lib/work-item-utils';

/** Map route pathname segments to sidebar section IDs. */
function pathToSection(pathname: string): string {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/activity')) return 'activity';
  if (pathname.startsWith('/timeline')) return 'timeline';
  if (pathname.startsWith('/contacts')) return 'people';
  if (pathname.startsWith('/communications')) return 'communications';
  if (pathname.startsWith('/notes')) return 'notes';
  if (pathname.startsWith('/notebooks')) return 'notes';
  if (pathname.startsWith('/recipes')) return 'recipes';
  if (pathname.startsWith('/meal-log')) return 'meal-log';
  if (pathname.startsWith('/dev-sessions')) return 'dev-sessions';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/work-items') || pathname.startsWith('/kanban')) return 'projects';
  return 'dashboard';
}

/** Section ID to route path mapping. */
const sectionRoutes: Record<string, string> = {
  dashboard: '/dashboard',
  activity: '/activity',
  projects: '/work-items',
  timeline: '/timeline',
  people: '/contacts',
  communications: '/communications',
  notes: '/notes',
  recipes: '/recipes',
  'meal-log': '/meal-log',
  'dev-sessions': '/dev-sessions',
  settings: '/settings',
};

/**
 * Context for notes breadcrumbs - provides actual names instead of generic labels (#671)
 */
interface NotesBreadcrumbContext {
  noteName?: string;
  notebookName?: string;
}

/**
 * Derive breadcrumbs from the current pathname and bootstrap data.
 * Returns an array of breadcrumb items for the AppShell header.
 */
function deriveBreadcrumbs(pathname: string, bootstrap: AppBootstrap | null, notesContext?: NotesBreadcrumbContext): BreadcrumbItem[] {
  if (pathname.startsWith('/dashboard')) {
    return [{ id: 'dashboard', label: 'Dashboard' }];
  }
  if (pathname.startsWith('/activity')) {
    return [{ id: 'activity', label: 'Activity' }];
  }
  if (pathname.startsWith('/timeline')) {
    return [{ id: 'timeline', label: 'Timeline' }];
  }
  if (pathname.startsWith('/contacts')) {
    return [{ id: 'contacts', label: 'People' }];
  }
  if (pathname.startsWith('/communications')) {
    return [{ id: 'communications', label: 'Communications' }];
  }
  if (pathname.startsWith('/recipes')) {
    return [{ id: 'recipes', label: 'Recipes' }];
  }
  if (pathname.startsWith('/meal-log')) {
    return [{ id: 'meal-log', label: 'Meal Log' }];
  }
  if (pathname.startsWith('/dev-sessions')) {
    return [{ id: 'dev-sessions', label: 'Dev Sessions' }];
  }
  if (pathname.startsWith('/settings')) {
    return [{ id: 'settings', label: 'Settings' }];
  }

  // Notes routes - use shared route patterns (#673) with actual names (#671)
  const notesMatch = matchNotesRoute(pathname);
  if (notesMatch) {
    const notesCrumbs: BreadcrumbItem[] = [{ id: 'notes', label: 'Notes', href: '/notes' }];

    if (notesMatch.type === 'notebookNote') {
      notesCrumbs.push(
        {
          id: 'notebook',
          label: notesContext?.notebookName ?? 'Notebook',
          href: `/notebooks/${notesMatch.notebook_id}`,
        },
        { id: 'note', label: notesContext?.noteName ?? 'Note' },
      );
      return notesCrumbs;
    }

    if (notesMatch.type === 'notebook') {
      notesCrumbs.push({
        id: 'notebook',
        label: notesContext?.notebookName ?? 'Notebook',
      });
      return notesCrumbs;
    }

    if (notesMatch.type === 'note') {
      notesCrumbs.push({ id: 'note', label: notesContext?.noteName ?? 'Note' });
      return notesCrumbs;
    }

    return notesCrumbs;
  }

  const crumbs: BreadcrumbItem[] = [{ id: 'work-items', label: 'Projects', href: '/work-items' }];

  if (pathname.startsWith('/kanban')) {
    crumbs.push({ id: 'kanban', label: 'Kanban Board' });
    return crumbs;
  }

  // Work items routes - use shared route patterns (#673)
  const workItemsMatch = matchWorkItemsRoute(pathname);
  if (workItemsMatch?.id) {
    const id = workItemsMatch.id;

    if (workItemsMatch.type === 'timeline') {
      crumbs.push({ id: 'detail', label: bootstrap?.workItem?.title || id, href: `/work-items/${id}` }, { id: 'timeline', label: 'Timeline' });
      return crumbs;
    }

    if (workItemsMatch.type === 'graph') {
      crumbs.push({ id: 'detail', label: bootstrap?.workItem?.title || id, href: `/work-items/${id}` }, { id: 'graph', label: 'Dependencies' });
      return crumbs;
    }

    if (workItemsMatch.type === 'detail') {
      crumbs.push({ id: 'detail', label: bootstrap?.workItem?.title || id });
      return crumbs;
    }
  }

  return crumbs;
}

/**
 * Root layout component with auth guard.
 * Checks authentication state before rendering the authenticated layout.
 */
export function AppLayout(): React.JSX.Element {
  const { isAuthenticated, isLoading: isAuthLoading } = useUser();

  if (isAuthLoading) {
    return (
      <div data-testid="auth-loading" className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return <AuthenticatedLayout />;
}

/**
 * Inner layout rendered only when the user is authenticated.
 * All hooks are called unconditionally here, satisfying React's rules of hooks.
 */
function AuthenticatedLayout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = readBootstrap<AppBootstrap>();

  // Work item creation state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createContextParentId, setCreateContextParentId] = useState<string | undefined>(undefined);

  // Extract note/notebook IDs from URL for breadcrumb labels (#671) using shared patterns (#673)
  const { noteId, notebook_id } = useMemo(() => {
    const notesMatch = matchNotesRoute(location.pathname);
    if (notesMatch) {
      if (notesMatch.type === 'notebookNote') {
        return { notebook_id: notesMatch.notebook_id, noteId: notesMatch.noteId };
      }
      if (notesMatch.type === 'notebook') {
        return { notebook_id: notesMatch.notebook_id, noteId: undefined };
      }
      if (notesMatch.type === 'note') {
        return { notebook_id: undefined, noteId: notesMatch.noteId };
      }
    }
    return { notebook_id: undefined, noteId: undefined };
  }, [location.pathname]);

  // Fetch notes data only when on notes routes (for breadcrumb names)
  const isNotesRoute = location.pathname.startsWith('/notes') || location.pathname.startsWith('/notebooks');
  const { data: notesData } = useNotes({ notebook_id }, { enabled: isNotesRoute && Boolean(noteId) });
  const { data: notebooksData } = useNotebooks({ include_note_counts: false }, { enabled: isNotesRoute && Boolean(notebook_id) });

  // Build notes context for breadcrumbs
  const notesContext = useMemo<NotesBreadcrumbContext | undefined>(() => {
    if (!isNotesRoute) return undefined;

    const noteName = noteId ? notesData?.notes.find((n: Note) => n.id === noteId)?.title : undefined;
    const notebookName = notebook_id ? notebooksData?.notebooks.find((nb: Notebook) => nb.id === notebook_id)?.name : undefined;

    return { noteName, notebookName };
  }, [isNotesRoute, noteId, notebook_id, notesData?.notes, notebooksData?.notebooks]);

  const activeSection = useMemo(() => pathToSection(location.pathname), [location.pathname]);

  const breadcrumbs = useMemo(() => deriveBreadcrumbs(location.pathname, bootstrap, notesContext), [location.pathname, bootstrap, notesContext]);

  const handleSectionChange = useCallback(
    (section: string) => {
      const route = sectionRoutes[section];
      if (route) {
        navigate(route);
      }
    },
    [navigate],
  );

  // Search handler for the command palette
  const handleSearch = useCallback(async (query: string): Promise<SearchResult[]> => {
    try {
      const data = await apiClient.get<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}&limit=10`);
      return data.results.map((r) => ({
        id: r.id,
        type: r.type === 'work_item' ? 'issue' : r.type === 'contact' ? 'contact' : 'issue',
        title: r.title,
        subtitle: r.description?.slice(0, 80) || undefined,
        href: r.url,
      }));
    } catch {
      return [];
    }
  }, []);

  const handleSearchSelect = useCallback(
    (result: SearchResult | string) => {
      if (typeof result === 'string') {
        if (result === 'create-issue' || result === 'create-project') {
          navigate('/work-items');
        } else if (result === 'view-all') {
          navigate('/search');
        }
      } else if (result.href) {
        const href = result.href.startsWith('/app/') ? result.href.replace('/app', '') : result.href;
        navigate(href);
      } else {
        navigate(`/work-items/${result.id}`);
      }
    },
    [navigate],
  );

  const handleNavigate = useCallback(
    (section: string) => {
      const route = sectionRoutes[section];
      if (route) {
        navigate(route);
      }
    },
    [navigate],
  );

  const handleOpenSearch = useCallback(() => {
    handleSectionChange('search');
  }, [handleSectionChange]);

  // Extract work item ID from current path for context - use shared utility (#673)
  const currentWorkItemId = useMemo(() => extractWorkItemId(location.pathname), [location.pathname]);

  const handleNewItem = useCallback(() => {
    if (currentWorkItemId) {
      setCreateContextParentId(currentWorkItemId);
    } else {
      setCreateContextParentId(undefined);
    }
    setQuickAddOpen(true);
  }, [currentWorkItemId]);

  const handleWorkItemCreated = useCallback(
    (item: CreatedWorkItem) => {
      navigate(`/work-items/${item.id}`);
    },
    [navigate],
  );

  const handleOpenCreateDialog = useCallback(() => {
    if (currentWorkItemId) {
      setCreateContextParentId(currentWorkItemId);
    } else {
      setCreateContextParentId(undefined);
    }
    setCreateDialogOpen(true);
  }, [currentWorkItemId]);

  return (
    <>
      <KeyboardShortcutsHandler onNavigate={handleNavigate} onSearch={handleOpenSearch} onNewItem={handleNewItem} onNewItemFullForm={handleOpenCreateDialog} />
      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} onCreated={handleWorkItemCreated} defaultParentId={createContextParentId} />
      <WorkItemCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleWorkItemCreated}
        defaultParentId={createContextParentId}
      />
      <CommandPalette onSearch={handleSearch} onSelect={handleSearchSelect} onNavigate={handleNavigate} />
      <AppShell
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onCreateClick={handleOpenCreateDialog}
        breadcrumbs={breadcrumbs}
        onHomeClick={() => navigate('/dashboard')}
      >
        <Outlet />
      </AppShell>
    </>
  );
}
