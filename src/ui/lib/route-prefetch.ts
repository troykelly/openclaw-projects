/**
 * Route prefetching utilities.
 *
 * Provides a mapping from route paths to dynamic import functions so that
 * route chunks can be preloaded on hover/focus before navigation occurs.
 * This reduces perceived latency for users navigating via the sidebar.
 *
 * Issue #478: Code splitting and performance optimizations
 */

/**
 * Map of route path prefixes to the dynamic import functions that load
 * the corresponding page chunk.  Each entry mirrors the React.lazy() call
 * in routes.tsx so that calling the function populates the browser module
 * cache, making the subsequent lazy() render instantaneous.
 */
const routeImportMap: Record<string, () => Promise<unknown>> = {
  '/activity': () => import('@/ui/pages/ActivityPage.js'),
  '/work-items': () => import('@/ui/pages/ProjectListPage.js'),
  '/kanban': () => import('@/ui/pages/KanbanPage.js'),
  '/timeline': () => import('@/ui/pages/GlobalTimelinePage.js'),
  '/contacts': () => import('@/ui/pages/ContactsPage.js'),
  '/memory': () => import('@/ui/pages/MemoryPage.js'),
  '/settings': () => import('@/ui/pages/SettingsPage.js'),
  '/projects': () => import('@/ui/pages/ProjectDetailPage.js'),
  '/communications': () => import('@/ui/pages/CommunicationsPage.js'),
  '/dashboard': () => import('@/ui/pages/DashboardPage.js'),
};

/** Set of paths already prefetched (or currently being prefetched). */
const prefetched = new Set<string>();

/**
 * Prefetch the JS chunk for a given route path.
 *
 * The import is fire-and-forget; errors are silently swallowed since this
 * is a best-effort optimisation.  Once a path has been prefetched the
 * import will not be triggered again.
 *
 * @param path - The route path (e.g. "/activity", "/work-items").
 */
export function prefetchRoute(path: string): void {
  // Normalise: strip trailing slash
  const normalised = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;

  if (prefetched.has(normalised)) return;

  const importFn = routeImportMap[normalised];
  if (!importFn) return;

  prefetched.add(normalised);
  importFn().catch(() => {
    // Remove from cache on failure so a retry can occur later
    prefetched.delete(normalised);
  });
}

/**
 * Prefetch all route chunks.  Useful for preloading the entire app on
 * idle.  Uses `requestIdleCallback` when available, otherwise falls back
 * to `setTimeout`.
 */
export function prefetchAllRoutes(): void {
  const schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 200);

  schedule(() => {
    for (const path of Object.keys(routeImportMap)) {
      prefetchRoute(path);
    }
  });
}

/**
 * Reset the prefetch cache.  Primarily exposed for testing.
 */
export function resetPrefetchCache(): void {
  prefetched.clear();
}

/**
 * Returns the set of route paths that have import functions registered.
 * Exposed for testing.
 */
export function getRegisteredRoutes(): string[] {
  return Object.keys(routeImportMap);
}
