/**
 * Route pattern constants and utilities.
 *
 * Provides a single source of truth for route patterns used in both
 * route configuration (routes.tsx) and breadcrumb derivation (app-layout.tsx).
 *
 * Issue #673: Replace hardcoded regex patterns with shared constants.
 */

/**
 * Route path definitions matching routes.tsx configuration.
 * These are the canonical paths used in React Router.
 */
export const ROUTES = {
  // Root
  root: '/',
  dashboard: '/dashboard',

  // Activity & Timeline
  activity: '/activity',
  timeline: '/timeline',

  // Work Items
  workItems: '/work-items',
  workItemDetail: '/work-items/:id',
  workItemTimeline: '/work-items/:id/timeline',
  workItemGraph: '/work-items/:id/graph',

  // Projects
  project: '/projects/:projectId',
  projectView: '/projects/:projectId/:view',

  // Kanban
  kanban: '/kanban',

  // Notes
  notes: '/notes',
  note: '/notes/:noteId',
  notebooks: '/notebooks/:notebookId',
  notebookNote: '/notebooks/:notebookId/notes/:noteId',

  // Other sections
  contacts: '/contacts',
  communications: '/communications',
  memory: '/memory',
  settings: '/settings',
  search: '/search',
} as const;

/**
 * Pre-compiled regex patterns for route matching.
 *
 * These patterns are used to extract parameters from the current pathname.
 * Each pattern captures relevant IDs in numbered groups.
 */
export const ROUTE_PATTERNS = {
  /** Matches /notebooks/:notebookId/notes/:noteId - Groups: [1]=notebookId, [2]=noteId */
  notebookNote: /^\/notebooks\/([^/]+)\/notes\/([^/]+)\/?$/,

  /** Matches /notebooks/:notebookId - Groups: [1]=notebookId */
  notebook: /^\/notebooks\/([^/]+)\/?$/,

  /** Matches /notes/:noteId - Groups: [1]=noteId */
  note: /^\/notes\/([^/]+)\/?$/,

  /** Matches /work-items/:id - Groups: [1]=id */
  workItemDetail: /^\/work-items\/([^/]+)\/?$/,

  /** Matches /work-items/:id/timeline - Groups: [1]=id */
  workItemTimeline: /^\/work-items\/([^/]+)\/timeline\/?$/,

  /** Matches /work-items/:id/graph - Groups: [1]=id */
  workItemGraph: /^\/work-items\/([^/]+)\/graph\/?$/,

  /** Matches /work-items/:id/* - Groups: [1]=id (for extracting ID from any work-item sub-route) */
  workItemAny: /^\/work-items\/([^/]+)/,
} as const;

/**
 * Result of matching a notes route.
 */
export interface NotesRouteMatch {
  type: 'notebookNote' | 'notebook' | 'note' | 'list';
  notebookId?: string;
  noteId?: string;
}

/**
 * Match a pathname against notes route patterns.
 *
 * @param pathname - The current URL pathname
 * @returns Match result with extracted IDs, or undefined if no match
 */
export function matchNotesRoute(pathname: string): NotesRouteMatch | undefined {
  if (!pathname.startsWith('/notes') && !pathname.startsWith('/notebooks')) {
    return undefined;
  }

  // /notebooks/:notebookId/notes/:noteId
  const notebookNoteMatch = ROUTE_PATTERNS.notebookNote.exec(pathname);
  if (notebookNoteMatch) {
    return {
      type: 'notebookNote',
      notebookId: notebookNoteMatch[1],
      noteId: notebookNoteMatch[2],
    };
  }

  // /notebooks/:notebookId
  const notebookMatch = ROUTE_PATTERNS.notebook.exec(pathname);
  if (notebookMatch) {
    return {
      type: 'notebook',
      notebookId: notebookMatch[1],
    };
  }

  // /notes/:noteId
  const noteMatch = ROUTE_PATTERNS.note.exec(pathname);
  if (noteMatch) {
    return {
      type: 'note',
      noteId: noteMatch[1],
    };
  }

  // /notes (list view)
  return { type: 'list' };
}

/**
 * Result of matching a work items route.
 */
export interface WorkItemsRouteMatch {
  type: 'detail' | 'timeline' | 'graph' | 'list';
  id?: string;
}

/**
 * Match a pathname against work items route patterns.
 *
 * @param pathname - The current URL pathname
 * @returns Match result with extracted ID, or undefined if no match
 */
export function matchWorkItemsRoute(pathname: string): WorkItemsRouteMatch | undefined {
  if (!pathname.startsWith('/work-items')) {
    return undefined;
  }

  // /work-items/:id/timeline
  const timelineMatch = ROUTE_PATTERNS.workItemTimeline.exec(pathname);
  if (timelineMatch) {
    return { type: 'timeline', id: timelineMatch[1] };
  }

  // /work-items/:id/graph
  const graphMatch = ROUTE_PATTERNS.workItemGraph.exec(pathname);
  if (graphMatch) {
    return { type: 'graph', id: graphMatch[1] };
  }

  // /work-items/:id
  const detailMatch = ROUTE_PATTERNS.workItemDetail.exec(pathname);
  if (detailMatch) {
    return { type: 'detail', id: detailMatch[1] };
  }

  // /work-items (list view)
  return { type: 'list' };
}

/**
 * Extract the work item ID from any work-items route.
 *
 * @param pathname - The current URL pathname
 * @returns The work item ID if present, undefined otherwise
 */
export function extractWorkItemId(pathname: string): string | undefined {
  const match = ROUTE_PATTERNS.workItemAny.exec(pathname);
  return match?.[1];
}
