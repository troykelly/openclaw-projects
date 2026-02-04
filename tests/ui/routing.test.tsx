/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/ui/routes.js';

/**
 * Helper to render with a MemoryRouter at the given initial path.
 * All paths are relative to the basename, which mirrors production (`/static/app`).
 */
function renderWithRouter(initialPath = '/') {
  const router = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });
  return render(<RouterProvider router={router} />);
}

// ---------------------------------------------------------------------------
// Route rendering tests
// ---------------------------------------------------------------------------
describe('Route configuration', () => {
  it('redirects root to /activity', async () => {
    renderWithRouter('/');
    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    });
  });

  it('renders ActivityPage at /activity', async () => {
    renderWithRouter('/activity');
    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    });
    expect(screen.getByText('Activity')).toBeInTheDocument();
  });

  it('renders ProjectListPage at /projects', async () => {
    renderWithRouter('/projects');
    await waitFor(() => {
      expect(screen.getByTestId('page-project-list')).toBeInTheDocument();
    });
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('renders ProjectDetailPage at /projects/:projectId', async () => {
    renderWithRouter('/projects/abc-123');
    await waitFor(() => {
      expect(screen.getByTestId('page-project-detail')).toBeInTheDocument();
    });
    expect(screen.getByText(/abc-123/)).toBeInTheDocument();
  });

  it('renders BoardView as nested route at /projects/:projectId/board', async () => {
    renderWithRouter('/projects/abc-123/board');
    await waitFor(() => {
      expect(screen.getByTestId('page-project-detail')).toBeInTheDocument();
      expect(screen.getByTestId('view-board')).toBeInTheDocument();
    });
  });

  it('renders ListView as nested route at /projects/:projectId/list', async () => {
    renderWithRouter('/projects/abc-123/list');
    await waitFor(() => {
      expect(screen.getByTestId('view-list')).toBeInTheDocument();
    });
  });

  it('renders TreeView as nested route at /projects/:projectId/tree', async () => {
    renderWithRouter('/projects/abc-123/tree');
    await waitFor(() => {
      expect(screen.getByTestId('view-tree')).toBeInTheDocument();
    });
  });

  it('renders CalendarView as nested route at /projects/:projectId/calendar', async () => {
    renderWithRouter('/projects/abc-123/calendar');
    await waitFor(() => {
      expect(screen.getByTestId('view-calendar')).toBeInTheDocument();
    });
  });

  it('renders WorkItemDetailPage at /projects/:projectId/items/:itemId', async () => {
    renderWithRouter('/projects/proj-1/items/item-42');
    await waitFor(() => {
      expect(screen.getByTestId('page-work-item-detail')).toBeInTheDocument();
    });
    expect(screen.getByText(/item-42/)).toBeInTheDocument();
    // proj-1 appears in both ProjectDetailPage and WorkItemDetailPage
    expect(screen.getAllByText(/proj-1/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders ContactsPage at /people', async () => {
    renderWithRouter('/people');
    await waitFor(() => {
      expect(screen.getByTestId('page-contacts')).toBeInTheDocument();
    });
    expect(screen.getByText('People')).toBeInTheDocument();
  });

  it('renders ContactDetailPage at /people/:contactId', async () => {
    renderWithRouter('/people/contact-99');
    await waitFor(() => {
      expect(screen.getByTestId('page-contact-detail')).toBeInTheDocument();
    });
    expect(screen.getByText(/contact-99/)).toBeInTheDocument();
  });

  it('renders MemoryPage at /memory', async () => {
    renderWithRouter('/memory');
    await waitFor(() => {
      expect(screen.getByTestId('page-memory')).toBeInTheDocument();
    });
    expect(screen.getByText('Memory')).toBeInTheDocument();
  });

  it('renders CommunicationsPage at /communications', async () => {
    renderWithRouter('/communications');
    await waitFor(() => {
      expect(screen.getByTestId('page-communications')).toBeInTheDocument();
    });
    expect(screen.getByText('Communications')).toBeInTheDocument();
  });

  it('renders SettingsPage at /settings', async () => {
    renderWithRouter('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('page-settings')).toBeInTheDocument();
    });
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders SearchPage at /search', async () => {
    renderWithRouter('/search');
    await waitFor(() => {
      expect(screen.getByTestId('page-search')).toBeInTheDocument();
    });
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('renders NotFoundPage for unknown routes', async () => {
    renderWithRouter('/this-does-not-exist');
    await waitFor(() => {
      expect(screen.getByTestId('page-not-found')).toBeInTheDocument();
    });
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText(/this-does-not-exist/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Navigation tests
// ---------------------------------------------------------------------------
describe('Navigation', () => {
  it('NotFoundPage links back to /activity', async () => {
    renderWithRouter('/unknown-page');

    await waitFor(() => {
      expect(screen.getByTestId('page-not-found')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /go to activity/i });
    expect(link).toBeInTheDocument();

    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByTestId('page-activity')).toBeInTheDocument();
    });
  });
});
