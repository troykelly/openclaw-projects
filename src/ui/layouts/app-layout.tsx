/**
 * Application layout wrapper.
 *
 * Wraps the AppShell component around a React Router Outlet so that all
 * routes render inside the consistent sidebar + header chrome.
 * Also provides global features: command palette, keyboard shortcuts,
 * and work item creation dialogs.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { AppShell } from '@/ui/components/layout/app-shell';
import type { BreadcrumbItem } from '@/ui/components/layout/breadcrumb';
import { CommandPalette, type SearchResult } from '@/ui/components/command-palette';
import { KeyboardShortcutsHandler } from '@/ui/components/keyboard-shortcuts-handler';
import {
  QuickAddDialog,
  WorkItemCreateDialog,
  type CreatedWorkItem,
} from '@/ui/components/work-item-create';
import { apiClient } from '@/ui/lib/api-client';
import type { SearchResponse, AppBootstrap } from '@/ui/lib/api-types';
import { readBootstrap } from '@/ui/lib/work-item-utils';

/** Map route pathname segments to sidebar section IDs. */
function pathToSection(pathname: string): string {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/activity')) return 'activity';
  if (pathname.startsWith('/timeline')) return 'timeline';
  if (pathname.startsWith('/contacts')) return 'people';
  if (pathname.startsWith('/communications')) return 'communications';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/work-items') || pathname.startsWith('/kanban'))
    return 'projects';
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
  settings: '/settings',
};

/**
 * Derive breadcrumbs from the current pathname and bootstrap data.
 * Returns an array of breadcrumb items for the AppShell header.
 */
function deriveBreadcrumbs(
  pathname: string,
  bootstrap: AppBootstrap | null,
): BreadcrumbItem[] {
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

  const crumbs: BreadcrumbItem[] = [
    { id: 'work-items', label: 'Projects', href: '/work-items' },
  ];

  if (pathname.startsWith('/kanban')) {
    crumbs.push({ id: 'kanban', label: 'Kanban Board' });
    return crumbs;
  }

  // /work-items/:id/timeline
  const itemTimeline = /^\/work-items\/([^/]+)\/timeline\/?$/.exec(pathname);
  if (itemTimeline) {
    const id = itemTimeline[1];
    crumbs.push(
      { id: 'detail', label: bootstrap?.workItem?.title || id, href: `/work-items/${id}` },
      { id: 'timeline', label: 'Timeline' },
    );
    return crumbs;
  }

  // /work-items/:id/graph
  const itemGraph = /^\/work-items\/([^/]+)\/graph\/?$/.exec(pathname);
  if (itemGraph) {
    const id = itemGraph[1];
    crumbs.push(
      { id: 'detail', label: bootstrap?.workItem?.title || id, href: `/work-items/${id}` },
      { id: 'graph', label: 'Dependencies' },
    );
    return crumbs;
  }

  // /work-items/:id
  const itemDetail = /^\/work-items\/([^/]+)\/?$/.exec(pathname);
  if (itemDetail) {
    const id = itemDetail[1];
    crumbs.push({ id: 'detail', label: bootstrap?.workItem?.title || id });
    return crumbs;
  }

  return crumbs;
}

/**
 * Root layout component providing AppShell + global UI features.
 * Rendered as the layout element in the route configuration.
 */
export function AppLayout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const bootstrap = readBootstrap<AppBootstrap>();

  // Work item creation state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createContextParentId, setCreateContextParentId] = useState<
    string | undefined
  >(undefined);

  const activeSection = useMemo(
    () => pathToSection(location.pathname),
    [location.pathname],
  );

  const breadcrumbs = useMemo(
    () => deriveBreadcrumbs(location.pathname, bootstrap),
    [location.pathname, bootstrap],
  );

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
  const handleSearch = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      try {
        const data = await apiClient.get<SearchResponse>(
          `/api/search?q=${encodeURIComponent(query)}&limit=10`,
        );
        return data.results.map((r) => ({
          id: r.id,
          type:
            r.type === 'work_item'
              ? 'issue'
              : r.type === 'contact'
                ? 'contact'
                : 'issue',
          title: r.title,
          subtitle: r.description?.slice(0, 80) || undefined,
          href: r.url,
        }));
      } catch {
        return [];
      }
    },
    [],
  );

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
        const href = result.href.startsWith('/app/')
          ? result.href.replace('/app', '')
          : result.href;
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

  // Extract work item ID from current path for context
  const currentWorkItemId = useMemo(() => {
    const match = /^\/work-items\/([^/]+)/.exec(location.pathname);
    return match?.[1];
  }, [location.pathname]);

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
      <KeyboardShortcutsHandler
        onNavigate={handleNavigate}
        onSearch={handleOpenSearch}
        onNewItem={handleNewItem}
        onNewItemFullForm={handleOpenCreateDialog}
      />
      <QuickAddDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onCreated={handleWorkItemCreated}
        defaultParentId={createContextParentId}
      />
      <WorkItemCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleWorkItemCreated}
        defaultParentId={createContextParentId}
      />
      <CommandPalette
        onSearch={handleSearch}
        onSelect={handleSearchSelect}
        onNavigate={handleNavigate}
      />
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
