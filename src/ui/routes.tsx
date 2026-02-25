/**
 * Application route configuration.
 *
 * All routes are relative to the router basename.
 * The root path redirects to `/work-items` as the default landing page.
 * Each page is lazy-loaded with React.lazy + Suspense for code splitting.
 * The AppLayout wraps all routes providing the sidebar, header, command
 * palette, and keyboard shortcuts.
 */
import React, { Suspense } from 'react';
import { Navigate, type RouteObject } from 'react-router';

// Lazy-loaded layout
const AppLayout = React.lazy(() => import('@/ui/layouts/app-layout.js').then((m) => ({ default: m.AppLayout })));

// Lazy-loaded page components for code splitting.
// Each page is loaded on demand, reducing the initial bundle size.
const ActivityPage = React.lazy(() => import('@/ui/pages/ActivityPage.js').then((m) => ({ default: m.ActivityPage })));
const ProjectListPage = React.lazy(() => import('@/ui/pages/ProjectListPage.js').then((m) => ({ default: m.ProjectListPage })));
const WorkItemDetailPage = React.lazy(() => import('@/ui/pages/WorkItemDetailPage.js').then((m) => ({ default: m.WorkItemDetailPage })));
const ItemTimelinePage = React.lazy(() => import('@/ui/pages/ItemTimelinePage.js').then((m) => ({ default: m.ItemTimelinePage })));
const DependencyGraphPage = React.lazy(() => import('@/ui/pages/DependencyGraphPage.js').then((m) => ({ default: m.DependencyGraphPage })));
const KanbanPage = React.lazy(() => import('@/ui/pages/KanbanPage.js').then((m) => ({ default: m.KanbanPage })));
const GlobalTimelinePage = React.lazy(() => import('@/ui/pages/GlobalTimelinePage.js').then((m) => ({ default: m.GlobalTimelinePage })));
const ContactsPage = React.lazy(() => import('@/ui/pages/ContactsPage.js').then((m) => ({ default: m.ContactsPage })));
const MemoryPage = React.lazy(() => import('@/ui/pages/MemoryPage.js').then((m) => ({ default: m.MemoryPage })));
const MemoryDetailPage = React.lazy(() => import('@/ui/pages/MemoryDetailPage.js').then((m) => ({ default: m.MemoryDetailPage })));
const SettingsPage = React.lazy(() => import('@/ui/pages/SettingsPage.js').then((m) => ({ default: m.SettingsPage })));
const ProjectDetailPage = React.lazy(() => import('@/ui/pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })));
const DashboardPage = React.lazy(() => import('@/ui/pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })));
const SearchPage = React.lazy(() => import('@/ui/pages/SearchPage.js').then((m) => ({ default: m.SearchPage })));
const NotFoundPage = React.lazy(() => import('@/ui/pages/NotFoundPage.js').then((m) => ({ default: m.NotFoundPage })));
const NotesPage = React.lazy(() => import('@/ui/pages/NotesPage.js').then((m) => ({ default: m.NotesPage })));
const SkillStorePage = React.lazy(() => import('@/ui/pages/SkillStorePage.js').then((m) => ({ default: m.SkillStorePage })));
const CommunicationsPage = React.lazy(() => import('@/ui/pages/CommunicationsPage.js').then((m) => ({ default: m.CommunicationsPage })));
const ContactDetailPage = React.lazy(() => import('@/ui/pages/ContactDetailPage.js').then((m) => ({ default: m.ContactDetailPage })));
const RecipesPage = React.lazy(() => import('@/ui/pages/RecipesPage.js').then((m) => ({ default: m.RecipesPage })));
const MealLogPage = React.lazy(() => import('@/ui/pages/MealLogPage.js').then((m) => ({ default: m.MealLogPage })));
const DevSessionsPage = React.lazy(() => import('@/ui/pages/DevSessionsPage.js').then((m) => ({ default: m.DevSessionsPage })));
const OAuthCallbackPage = React.lazy(() => import('@/ui/pages/OAuthCallbackPage.js').then((m) => ({ default: m.OAuthCallbackPage })));
const AuthConsumePage = React.lazy(() => import('@/ui/pages/AuthConsumePage.js').then((m) => ({ default: m.AuthConsumePage })));

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
 * Application route tree.
 *
 * Routes match the URL patterns previously handled by main.tsx:
 *   / -> redirect to /work-items
 *   /activity -> ActivityPage
 *   /work-items -> ProjectListPage
 *   /work-items/:id -> WorkItemDetailPage
 *   /work-items/:id/timeline -> ItemTimelinePage
 *   /work-items/:id/graph -> DependencyGraphPage
 *   /projects/:project_id -> ProjectDetailPage (list view)
 *   /projects/:project_id/:view -> ProjectDetailPage (board|tree|calendar view)
 *   /kanban -> KanbanPage
 *   /timeline -> GlobalTimelinePage
 *   /contacts -> ContactsPage
 *   /contacts/:contact_id -> ContactDetailPage
 *   /communications -> CommunicationsPage
 *   /memory -> MemoryPage
 *   /memory/:id -> MemoryDetailPage
 *   /recipes -> RecipesPage
 *   /meal-log -> MealLogPage
 *   /dev-sessions -> DevSessionsPage
 *   /settings -> SettingsPage
 *   /auth/consume -> AuthConsumePage (outside AppLayout, pre-auth)
 *   /settings/oauth/callback -> OAuthCallbackPage
 *   /search -> SearchPage
 *   * -> NotFoundPage
 */
export const routes: RouteObject[] = [
  // Auth routes live outside the AppLayout — the user is not yet authenticated.
  {
    path: 'auth/consume',
    element: lazy(AuthConsumePage),
  },
  {
    element: lazy(AppLayout),
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: lazy(DashboardPage),
      },
      {
        path: 'activity',
        element: lazy(ActivityPage),
      },
      {
        path: 'work-items',
        element: lazy(ProjectListPage),
      },
      {
        path: 'work-items/:id',
        element: lazy(WorkItemDetailPage),
      },
      {
        path: 'work-items/:id/timeline',
        element: lazy(ItemTimelinePage),
      },
      {
        path: 'work-items/:id/graph',
        element: lazy(DependencyGraphPage),
      },
      {
        path: 'projects/:project_id',
        element: lazy(ProjectDetailPage),
      },
      {
        path: 'projects/:project_id/:view',
        element: lazy(ProjectDetailPage),
      },
      {
        path: 'kanban',
        element: lazy(KanbanPage),
      },
      {
        path: 'timeline',
        element: lazy(GlobalTimelinePage),
      },
      {
        path: 'contacts',
        element: lazy(ContactsPage),
      },
      {
        path: 'contacts/:contact_id',
        element: lazy(ContactDetailPage),
      },
      {
        path: 'communications',
        element: lazy(CommunicationsPage),
      },
      {
        path: 'memory',
        element: lazy(MemoryPage),
      },
      {
        path: 'memory/:id',
        element: lazy(MemoryDetailPage),
      },
      // Notes routes - consolidated using nested routes (#669)
      // All routes render NotesPage which handles the different URL patterns
      {
        path: 'notes',
        children: [
          { index: true, element: lazy(NotesPage) },
          { path: ':noteId', element: lazy(NotesPage) },
        ],
      },
      {
        path: 'notebooks/:notebook_id',
        children: [
          { index: true, element: lazy(NotesPage) },
          { path: 'notes/:noteId', element: lazy(NotesPage) },
        ],
      },
      {
        path: 'recipes',
        element: lazy(RecipesPage),
      },
      {
        path: 'meal-log',
        element: lazy(MealLogPage),
      },
      {
        path: 'dev-sessions',
        element: lazy(DevSessionsPage),
      },
      {
        path: 'skill-store',
        element: lazy(SkillStorePage),
      },
      {
        path: 'settings',
        element: lazy(SettingsPage),
      },
      {
        path: 'settings/oauth/callback',
        element: lazy(OAuthCallbackPage),
      },
      {
        path: 'search',
        element: lazy(SearchPage),
      },
      {
        path: '*',
        element: lazy(NotFoundPage),
      },
    ],
  },
];
