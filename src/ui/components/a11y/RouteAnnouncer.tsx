/**
 * RouteAnnouncer component for screen reader users.
 *
 * Announces route changes via an `aria-live="assertive"` region so
 * assistive technology users know when the page content has changed.
 * Also manages focus by moving it to the main content area after
 * each navigation, mimicking the behaviour of a full page load.
 *
 * @see Issue #480 - WCAG 2.1 AA compliance
 */
import * as React from 'react';
import { useLocation } from 'react-router';

/** Map pathname prefixes to human-readable page titles. */
const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/activity': 'Activity',
  '/work-items': 'Projects',
  '/kanban': 'Kanban Board',
  '/timeline': 'Timeline',
  '/contacts': 'People',
  '/communications': 'Communications',
  '/memory': 'Memory',
  '/settings': 'Settings',
};

/**
 * Derive a human-readable page title from the current pathname.
 * Falls back to a capitalised version of the first path segment.
 */
function getPageTitle(pathname: string): string {
  // Exact or prefix match
  for (const [prefix, title] of Object.entries(PAGE_TITLES)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return title;
    }
  }

  // Fallback: capitalise first path segment
  const segment = pathname.split('/').filter(Boolean)[0];
  if (segment) {
    return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
  }
  return 'Page';
}

export interface RouteAnnouncerProps {
  /** Optional app name prepended to the page title. */
  appName?: string;
  /**
   * ID of the main content element to focus on route change.
   * Defaults to "main-content".
   */
  mainContentId?: string;
}

/**
 * Invisible live region that announces page changes to screen readers
 * and moves focus to the main content area.
 */
export function RouteAnnouncer({ appName = 'OpenClaw Projects', mainContentId = 'main-content' }: RouteAnnouncerProps): React.JSX.Element {
  const location = useLocation();
  const [announcement, setAnnouncement] = React.useState('');
  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    // Skip the initial render so we don't announce the first page load
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // Still update document.title on initial load
      const title = getPageTitle(location.pathname);
      document.title = `${title} - ${appName}`;
      return;
    }

    const title = getPageTitle(location.pathname);

    // Update document.title
    document.title = `${title} - ${appName}`;

    // Announce the navigation to screen readers
    setAnnouncement(`Navigated to ${title}`);

    // Move focus to the main content area for keyboard users
    const mainContent = document.getElementById(mainContentId);
    if (mainContent) {
      // Ensure the element can receive focus
      if (!mainContent.hasAttribute('tabindex')) {
        mainContent.setAttribute('tabindex', '-1');
      }
      mainContent.focus({ preventScroll: true });
    }
  }, [location.pathname, appName, mainContentId]);

  return (
    <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="route-announcer">
      {announcement}
    </div>
  );
}

export { getPageTitle };
