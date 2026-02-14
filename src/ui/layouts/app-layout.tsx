/**
 * Application layout wrapper.
 *
 * Wraps the AppShell component around a React Router Outlet so that all
 * routes render inside the consistent sidebar + header chrome.
 * Also provides global features: command palette, keyboard shortcuts,
 * and work item creation dialogs.
 */
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
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
          href: `/notebooks/${notesMatch.notebookId}`,
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
  if (workItemsMatch && workItemsMatch.id) {
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
 * Root layout component providing AppShell + global UI features.
 * Rendered as the layout element in the route configuration.
 */
export function AppLayout(): React.JSX.Element {
  const { isAuthenticated, isLoading: isAuthLoading } = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = readBootstrap<AppBootstrap>();

  // Auth guard: while checking auth status, show a loading spinner.
  // Once determined unauthenticated, do a full navigation to /app which
  // triggers the server-rendered login page via requireDashboardSession.
  if (isAuthLoading) {
    return (
      <div data-testid="auth-loading" className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div data-testid="auth-required" className="flex min-h-screen flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-3xl font-bold tracking-tight">OpenClaw Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground">You need to sign in to access this page.</p>
          <a href="/app" className="mt-6 inline-block rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            Sign in
          </a>
        </div>
      </div>
    );
  }

  // Work item creation state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createContextParentId, setCreateContextParentId] = useState<string | undefined>(undefined);

  // Extract note/notebook IDs from URL for breadcrumb labels (#671) using shared patterns (#673)
  const { noteId, notebookId } = useMemo(() => {
    const notesMatch = matchNotesRoute(location.pathname);
    if (notesMatch) {
      if (notesMatch.type === 'notebookNote') {
        return { notebookId: notesMatch.notebookId, noteId: notesMatch.noteId };
      }
      if (notesMatch.type === 'notebook') {
        return { notebookId: notesMatch.notebookId, noteId: undefined };
      }
      if (notesMatch.type === 'note') {
        return { notebookId: undefined, noteId: notesMatch.noteId };
      }
    }
    return { notebookId: undefined, noteId: undefined };
  }, [location.pathname]);

  // Fetch notes data only when on notes routes (for breadcrumb names)
  const isNotesRoute = location.pathname.startsWith('/notes') || location.pathname.startsWith('/notebooks');
  const { data: notesData } = useNotes({ notebookId }, { enabled: isNotesRoute && Boolean(noteId) });
  const { data: notebooksData } = useNotebooks({ includeNoteCounts: false }, { enabled: isNotesRoute && Boolean(notebookId) });

  // Build notes context for breadcrumbs
  const notesContext = useMemo<NotesBreadcrumbContext | undefined>(() => {
    if (!isNotesRoute) return undefined;

    const noteName = noteId ? notesData?.notes.find((n: Note) => n.id === noteId)?.title : undefined;
    const notebookName = notebookId ? notebooksData?.notebooks.find((nb: Notebook) => nb.id === notebookId)?.name : undefined;

    return { noteName, notebookName };
  }, [isNotesRoute, noteId, notebookId, notesData?.notes, notebooksData?.notebooks]);

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
          // Navigate to full search page with current query
          // The command palette passes 'view-all' when the user wants to see all results
          navigate('/search');
        }
      } else if (result.href) {
        // Result href may be an absolute /app/ path -- strip prefix for React Router
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
