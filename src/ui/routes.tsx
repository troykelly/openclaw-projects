import React, { Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router';

// Lazy-loaded page components for code splitting.
// Each page is loaded on demand, reducing the initial bundle size.
const ActivityPage = React.lazy(() =>
  import('@/ui/pages/ActivityPage.js').then((m) => ({ default: m.ActivityPage }))
);
const ProjectListPage = React.lazy(() =>
  import('@/ui/pages/ProjectListPage.js').then((m) => ({ default: m.ProjectListPage }))
);
const ProjectDetailPage = React.lazy(() =>
  import('@/ui/pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage }))
);
const WorkItemDetailPage = React.lazy(() =>
  import('@/ui/pages/WorkItemDetailPage.js').then((m) => ({ default: m.WorkItemDetailPage }))
);
const ContactsPage = React.lazy(() =>
  import('@/ui/pages/ContactsPage.js').then((m) => ({ default: m.ContactsPage }))
);
const ContactDetailPage = React.lazy(() =>
  import('@/ui/pages/ContactDetailPage.js').then((m) => ({ default: m.ContactDetailPage }))
);
const MemoryPage = React.lazy(() =>
  import('@/ui/pages/MemoryPage.js').then((m) => ({ default: m.MemoryPage }))
);
const CommunicationsPage = React.lazy(() =>
  import('@/ui/pages/CommunicationsPage.js').then((m) => ({ default: m.CommunicationsPage }))
);
const SettingsPage = React.lazy(() =>
  import('@/ui/pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage }))
);
const SearchPage = React.lazy(() =>
  import('@/ui/pages/SearchPage.js').then((m) => ({ default: m.SearchPage }))
);
const NotFoundPage = React.lazy(() =>
  import('@/ui/pages/NotFoundPage.js').then((m) => ({ default: m.NotFoundPage }))
);
const BoardView = React.lazy(() =>
  import('@/ui/pages/project-views/BoardView.js').then((m) => ({ default: m.BoardView }))
);
const ListView = React.lazy(() =>
  import('@/ui/pages/project-views/ListView.js').then((m) => ({ default: m.ListView }))
);
const TreeView = React.lazy(() =>
  import('@/ui/pages/project-views/TreeView.js').then((m) => ({ default: m.TreeView }))
);
const CalendarView = React.lazy(() =>
  import('@/ui/pages/project-views/CalendarView.js').then((m) => ({ default: m.CalendarView }))
);

/** Loading fallback shown while lazy-loaded pages are being fetched. */
function PageLoader(): React.JSX.Element {
  return (
    <div data-testid="page-loader" className="flex items-center justify-center p-12">
      <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

/** Wraps a lazy component in Suspense with the standard loading fallback. */
function lazy(Component: React.LazyExoticComponent<React.ComponentType>): React.JSX.Element {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

/**
 * Application route configuration.
 *
 * All routes are relative to the router basename (`/static/app`).
 * The root path redirects to `/activity` as the default landing page.
 * Each page is lazy-loaded with React.lazy + Suspense for code splitting.
 */
export const routes: RouteObject[] = [
  {
    index: true,
    element: <Navigate to="/activity" replace />,
  },
  {
    path: 'activity',
    element: lazy(ActivityPage),
  },
  {
    path: 'projects',
    element: lazy(ProjectListPage),
  },
  {
    path: 'projects/:projectId',
    element: lazy(ProjectDetailPage),
    children: [
      {
        path: 'board',
        element: lazy(BoardView),
      },
      {
        path: 'list',
        element: lazy(ListView),
      },
      {
        path: 'tree',
        element: lazy(TreeView),
      },
      {
        path: 'calendar',
        element: lazy(CalendarView),
      },
      {
        path: 'items/:itemId',
        element: lazy(WorkItemDetailPage),
      },
    ],
  },
  {
    path: 'people',
    element: lazy(ContactsPage),
  },
  {
    path: 'people/:contactId',
    element: lazy(ContactDetailPage),
  },
  {
    path: 'memory',
    element: lazy(MemoryPage),
  },
  {
    path: 'communications',
    element: lazy(CommunicationsPage),
  },
  {
    path: 'settings',
    element: lazy(SettingsPage),
  },
  {
    path: 'search',
    element: lazy(SearchPage),
  },
  {
    path: '*',
    element: lazy(NotFoundPage),
  },
];
