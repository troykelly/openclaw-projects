/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet, type RouteObject } from 'react-router';
import { RouterSidebar } from '@/ui/components/layout/router-sidebar.js';

/**
 * Create a test router that renders RouterSidebar inside a layout route
 * alongside route outlets so we can verify both sidebar and page rendering.
 */
function renderSidebarWithRouter(initialPath = '/activity') {
  const testRoutes: RouteObject[] = [
    {
      element: (
        <div className="flex">
          <RouterSidebar />
          <div data-testid="outlet">
            <Outlet />
          </div>
        </div>
      ),
      children: [
        { path: 'activity', element: <div data-testid="page-activity">Activity</div> },
        { path: 'projects', element: <div data-testid="page-projects">Projects</div> },
        { path: 'contacts', element: <div data-testid="page-contacts">Contacts</div> },
        { path: 'memory', element: <div data-testid="page-memory">Memory</div> },
        { path: 'communications', element: <div data-testid="page-communications">Communications</div> },
        { path: 'skill-store', element: <div data-testid="page-skill-store">Skill Store</div> },
        { path: 'settings', element: <div data-testid="page-settings">Settings</div> },
        { path: 'search', element: <div data-testid="page-search">Search</div> },
      ],
    },
  ];

  const router = createMemoryRouter(testRoutes, {
    initialEntries: [initialPath],
  });

  return render(<RouterProvider router={router} />);
}

// ---------------------------------------------------------------------------
// RouterSidebar rendering
// ---------------------------------------------------------------------------
describe('RouterSidebar', () => {
  it('renders the sidebar with navigation links', () => {
    renderSidebarWithRouter('/activity');
    expect(screen.getByTestId('router-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });

  it('renders all default navigation items as links', () => {
    renderSidebarWithRouter('/activity');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const links = nav.querySelectorAll('a');
    // 12 main nav items: Activity, Projects, People, Memory, Communications, Recipes, Meal Log, Home Automation, Pantry, Voice, Dev Sessions, Skill Store
    expect(links.length).toBe(12);
  });

  it('renders Settings link in the footer', () => {
    renderSidebarWithRouter('/activity');
    // Settings NavLink is in the footer, not in main nav
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    expect(settingsLink).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NavLink active state tests
// ---------------------------------------------------------------------------
describe('RouterSidebar NavLink active state', () => {
  it('marks Activity link as active when on /activity', () => {
    renderSidebarWithRouter('/activity');
    const activityLink = screen.getByRole('link', { name: /activity/i });
    // Active NavLinks get the active class
    expect(activityLink.className).toContain('bg-primary/10');
    expect(activityLink.className).toContain('text-primary');
  });

  it('marks Projects link as active when on /projects', () => {
    renderSidebarWithRouter('/projects');
    const projectsLink = screen.getByRole('link', { name: /projects/i });
    expect(projectsLink.className).toContain('bg-primary/10');
  });

  it('marks People link as active when on /contacts', () => {
    renderSidebarWithRouter('/contacts');
    const peopleLink = screen.getByRole('link', { name: /people/i });
    expect(peopleLink.className).toContain('bg-primary/10');
  });

  it('marks Settings link as active when on /settings', () => {
    renderSidebarWithRouter('/settings');
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    expect(settingsLink.className).toContain('bg-primary/10');
  });

  it('does not mark other links as active', () => {
    renderSidebarWithRouter('/activity');
    const projectsLink = screen.getByRole('link', { name: /projects/i });
    expect(projectsLink.className).not.toContain('bg-primary/10');
    expect(projectsLink.className).toContain('text-muted-foreground');
  });
});

// ---------------------------------------------------------------------------
// Navigation via NavLink
// ---------------------------------------------------------------------------
describe('RouterSidebar navigation', () => {
  it('navigates to Projects when clicking the Projects link', async () => {
    renderSidebarWithRouter('/activity');
    expect(screen.getByTestId('page-activity')).toBeInTheDocument();

    const projectsLink = screen.getByRole('link', { name: /projects/i });
    fireEvent.click(projectsLink);

    await waitFor(() => {
      expect(screen.getByTestId('page-projects')).toBeInTheDocument();
    });
  });

  it('navigates to Contacts when clicking the People link', async () => {
    renderSidebarWithRouter('/activity');

    const peopleLink = screen.getByRole('link', { name: /people/i });
    fireEvent.click(peopleLink);

    await waitFor(() => {
      expect(screen.getByTestId('page-contacts')).toBeInTheDocument();
    });
  });

  it('navigates to Settings when clicking the Settings link', async () => {
    renderSidebarWithRouter('/activity');

    const settingsLink = screen.getByRole('link', { name: /settings/i });
    fireEvent.click(settingsLink);

    await waitFor(() => {
      expect(screen.getByTestId('page-settings')).toBeInTheDocument();
    });
  });

  it('updates active state after navigation', async () => {
    renderSidebarWithRouter('/activity');

    // Initially Activity is active
    const activityLink = screen.getByRole('link', { name: /activity/i });
    expect(activityLink.className).toContain('bg-primary/10');

    // Click Projects
    const projectsLink = screen.getByRole('link', { name: /projects/i });
    fireEvent.click(projectsLink);

    await waitFor(() => {
      // Projects should now be active
      expect(projectsLink.className).toContain('bg-primary/10');
      // Activity should no longer be active
      expect(activityLink.className).not.toContain('bg-primary/10');
    });
  });
});

// ---------------------------------------------------------------------------
// Sidebar collapse and create button
// ---------------------------------------------------------------------------
describe('RouterSidebar interactions', () => {
  it('calls onCreateClick when Create button is clicked', () => {
    const onCreateClick = vi.fn();
    const testRoutes: RouteObject[] = [
      {
        element: <RouterSidebar onCreateClick={onCreateClick} />,
        path: 'activity',
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/activity'],
    });
    render(<RouterProvider router={router} />);

    const createButton = screen.getByLabelText('Create new work item');
    fireEvent.click(createButton);
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it('calls onSearchClick when Search button is clicked', () => {
    const onSearchClick = vi.fn();
    const testRoutes: RouteObject[] = [
      {
        element: <RouterSidebar onSearchClick={onSearchClick} />,
        path: 'activity',
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/activity'],
    });
    render(<RouterProvider router={router} />);

    const searchButton = screen.getByRole('button', { name: /search/i });
    fireEvent.click(searchButton);
    expect(onSearchClick).toHaveBeenCalledTimes(1);
  });

  it('calls onCollapsedChange when collapse toggle is clicked', () => {
    const onCollapsedChange = vi.fn();
    const testRoutes: RouteObject[] = [
      {
        element: <RouterSidebar onCollapsedChange={onCollapsedChange} />,
        path: 'activity',
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/activity'],
    });
    render(<RouterProvider router={router} />);

    const collapseButton = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(collapseButton);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});
