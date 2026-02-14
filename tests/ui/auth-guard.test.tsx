/**
 * @vitest-environment jsdom
 *
 * Tests for the SPA auth guard in AppLayout (issue #1166).
 * Verifies that unauthenticated users see a sign-in prompt instead
 * of the broken dashboard, and authenticated users see normal content.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/ui/routes.js';

// Pre-resolve lazy-loaded components
beforeAll(async () => {
  await Promise.all([
    import('@/ui/layouts/app-layout.js'),
    import('@/ui/pages/DashboardPage.js'),
    import('@/ui/pages/ActivityPage.js'),
    import('@/ui/pages/ProjectListPage.js'),
    import('@/ui/pages/WorkItemDetailPage.js'),
    import('@/ui/pages/ItemTimelinePage.js'),
    import('@/ui/pages/DependencyGraphPage.js'),
    import('@/ui/pages/KanbanPage.js'),
    import('@/ui/pages/GlobalTimelinePage.js'),
    import('@/ui/pages/ContactsPage.js'),
    import('@/ui/pages/SettingsPage.js'),
    import('@/ui/pages/SearchPage.js'),
    import('@/ui/pages/NotFoundPage.js'),
  ]);
});

// Mock command palette to avoid cmdk jsdom rendering issues
vi.mock('@/ui/components/command-palette', () => ({
  CommandPalette: () => null,
}));

// Mock api-client
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    post: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    patch: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
    delete: vi.fn().mockRejectedValue(new Error('Not implemented in test')),
  },
}));

// Controllable user state mock
const mockUserState = {
  email: null as string | null,
  isLoading: false,
  isAuthenticated: false,
};

vi.mock('@/ui/contexts/user-context', () => ({
  useUser: () => mockUserState,
  useUserEmail: () => mockUserState.email,
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const WAIT_OPTS = { timeout: 5_000 };

function renderWithRouter(initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Auth guard (issue #1166)', () => {
  beforeEach(() => {
    // Reset to unauthenticated state
    mockUserState.email = null;
    mockUserState.isLoading = false;
    mockUserState.isAuthenticated = false;
  });

  it('shows loading spinner while auth state is being determined', async () => {
    mockUserState.isLoading = true;
    renderWithRouter('/dashboard');
    await waitFor(() => {
      expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('shows sign-in prompt when user is not authenticated', async () => {
    renderWithRouter('/dashboard');
    await waitFor(() => {
      expect(screen.getByTestId('auth-required')).toBeInTheDocument();
    }, WAIT_OPTS);
    expect(screen.getByText(/you need to sign in/i)).toBeInTheDocument();
    // The sign-in link should point to /app (server-rendered login page)
    const signInLink = screen.getByRole('link', { name: /sign in/i });
    expect(signInLink).toHaveAttribute('href', '/app');
  });

  it('renders page content when user is authenticated', async () => {
    mockUserState.email = 'test@example.com';
    mockUserState.isAuthenticated = true;
    renderWithRouter('/dashboard');
    await waitFor(() => {
      expect(screen.getByTestId('page-dashboard')).toBeInTheDocument();
    }, WAIT_OPTS);
  });

  it('blocks /settings route when unauthenticated', async () => {
    renderWithRouter('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('auth-required')).toBeInTheDocument();
    }, WAIT_OPTS);
    expect(screen.queryByTestId('page-settings')).not.toBeInTheDocument();
  });

  it('blocks /work-items route when unauthenticated', async () => {
    renderWithRouter('/work-items');
    await waitFor(() => {
      expect(screen.getByTestId('auth-required')).toBeInTheDocument();
    }, WAIT_OPTS);
    expect(screen.queryByTestId('page-project-list')).not.toBeInTheDocument();
  });
});
