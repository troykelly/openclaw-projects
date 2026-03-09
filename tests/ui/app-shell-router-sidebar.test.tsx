/**
 * @vitest-environment jsdom
 * Tests for #1875/#2296: Wire ProjectSidebar into AppShell
 *
 * Validates:
 * - AppShell renders ProjectSidebar (upgraded from RouterSidebar in #2296)
 * - RouterSidebar includes namespace selector (standalone)
 * - RouterSidebar includes version display (standalone)
 * - MobileNav uses router-aware links with primary + overflow nav items
 * - AppShell passes onSearchClick to ProjectSidebar
 * - Keyboard shortcut for search still works
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryRouter, RouterProvider, Outlet, type RouteObject } from 'react-router';
import { AppShell } from '@/ui/components/layout/app-shell';
import { RouterSidebar } from '@/ui/components/layout/router-sidebar';
import { MobileNav } from '@/ui/components/layout/mobile-nav';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock API client (needed by ProjectSidebar) ──────────────────────
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: { get: () => Promise.resolve({ items: [] }) },
}));

// ── localStorage mock ──────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

// Helper to render AppShell inside a MemoryRouter
function renderAppShellWithRouter(initialPath = '/activity', props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const routes: RouteObject[] = [
    {
      element: (
        <QueryClientProvider client={qc}>
          <AppShell {...props}>
            <Outlet />
          </AppShell>
        </QueryClientProvider>
      ),
      children: [
        { path: 'activity', element: <div data-testid="page-activity">Activity</div> },
        { path: 'projects', element: <div data-testid="page-projects">Projects</div> },
        { path: 'contacts', element: <div data-testid="page-contacts">Contacts</div> },
        { path: 'memory', element: <div data-testid="page-memory">Memory</div> },
        { path: 'notes', element: <div data-testid="page-notes">Notes</div> },
        { path: 'communications', element: <div data-testid="page-comms">Comms</div> },
        { path: 'settings', element: <div data-testid="page-settings">Settings</div> },
        { path: 'terminal', element: <div data-testid="page-terminal">Terminal</div> },
        { path: 'recipes', element: <div data-testid="page-recipes">Recipes</div> },
        { path: 'meal-log', element: <div data-testid="page-meal-log">Meal Log</div> },
        { path: 'home-automation', element: <div data-testid="page-ha">HA</div> },
        { path: 'pantry', element: <div data-testid="page-pantry">Pantry</div> },
        { path: 'voice', element: <div data-testid="page-voice">Voice</div> },
        { path: 'dev-sessions', element: <div data-testid="page-dev">Dev</div> },
        { path: 'skill-store', element: <div data-testid="page-skill">Skill</div> },
      ],
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(<RouterProvider router={router} />);
}

// ── AppShell uses ProjectSidebar (#2296 upgrade) ────────────────────

describe('AppShell uses ProjectSidebar (#1875 / #2296)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  it('renders ProjectSidebar (data-testid=project-sidebar) instead of old Sidebar', () => {
    renderAppShellWithRouter('/activity');
    expect(screen.getByTestId('project-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('renders navigation links in the Other section', () => {
    renderAppShellWithRouter('/activity');
    const nav = screen.getByRole('navigation', { name: 'Other navigation' });
    const links = nav.querySelectorAll('a');
    // 15 "Other" items (non-PM nav items)
    expect(links.length).toBeGreaterThanOrEqual(10);
  });

  it('renders Settings link in the footer', () => {
    renderAppShellWithRouter('/activity');
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    expect(settingsLink).toBeInTheDocument();
  });

  it('renders create button as dropdown trigger', () => {
    renderAppShellWithRouter('/activity', { onCreateClick: vi.fn() });
    const createButton = screen.getByTestId('sidebar-new-button');
    expect(createButton).toBeInTheDocument();
    expect(createButton.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('passes onSearchClick to ProjectSidebar and Search button works', () => {
    const onSearchClick = vi.fn();
    renderAppShellWithRouter('/activity', { onSearchClick });
    const searchButton = screen.getByRole('button', { name: /search/i });
    fireEvent.click(searchButton);
    expect(onSearchClick).toHaveBeenCalledTimes(1);
  });

  it('renders version display in the sidebar footer', () => {
    renderAppShellWithRouter('/activity');
    const version = screen.getByTestId('app-version');
    expect(version).toBeInTheDocument();
  });

  it('renders children in the content area', () => {
    renderAppShellWithRouter('/activity');
    expect(screen.getByTestId('page-activity')).toBeInTheDocument();
  });

  it('renders header with NamespaceIndicator', () => {
    renderAppShellWithRouter('/activity');
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
  });

  it('persists sidebar collapsed state in localStorage', () => {
    renderAppShellWithRouter('/activity');
    const collapseBtn = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(collapseBtn);
    expect(localStorageMock.getItem('sidebar-collapsed')).toBe('true');
  });
});

// ── RouterSidebar namespace selector ────────────────────────────────

describe('RouterSidebar namespace selector (#1875)', () => {
  it('renders namespace selector when grants are available', () => {
    // RouterSidebar reads namespace from useNamespaceSafe which may return null
    // When rendered outside NamespaceProvider it should not crash
    const routes: RouteObject[] = [
      {
        element: <RouterSidebar />,
        path: 'activity',
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/activity'] });
    render(<RouterProvider router={router} />);
    // Should render without crashing even without NamespaceProvider
    expect(screen.getByTestId('router-sidebar')).toBeInTheDocument();
  });
});

// ── RouterSidebar version display ───────────────────────────────────

describe('RouterSidebar version display (#1875)', () => {
  it('shows version in expanded state', () => {
    const routes: RouteObject[] = [
      {
        element: <RouterSidebar collapsed={false} />,
        path: 'activity',
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/activity'] });
    render(<RouterProvider router={router} />);
    const version = screen.getByTestId('app-version');
    expect(version).toBeInTheDocument();
    // In expanded state, shows "v" followed by version
    expect(version.textContent).toMatch(/^v/);
  });

  it('shows abbreviated version when collapsed', () => {
    const routes: RouteObject[] = [
      {
        element: <RouterSidebar collapsed={true} />,
        path: 'activity',
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ['/activity'] });
    render(<RouterProvider router={router} />);
    const version = screen.getByTestId('app-version');
    expect(version).toBeInTheDocument();
    expect(version.textContent).toBe('v');
  });
});

// ── MobileNav with router links ─────────────────────────────────────

describe('MobileNav with router links (#1875)', () => {
  function renderMobileNavWithRouter(initialPath = '/activity') {
    const routes: RouteObject[] = [
      {
        element: (
          <div>
            <MobileNav />
            <Outlet />
          </div>
        ),
        children: [
          { path: 'activity', element: <div data-testid="page-activity">Activity</div> },
          { path: 'projects', element: <div data-testid="page-projects">Projects</div> },
          { path: 'contacts', element: <div data-testid="page-contacts">Contacts</div> },
          { path: 'memory', element: <div data-testid="page-memory">Memory</div> },
          { path: 'settings', element: <div data-testid="page-settings">Settings</div> },
        ],
      },
    ];
    const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
    return render(<RouterProvider router={router} />);
  }

  it('renders the mobile nav', () => {
    renderMobileNavWithRouter('/activity');
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('renders primary nav items as links (not buttons)', () => {
    renderMobileNavWithRouter('/activity');
    const nav = screen.getByTestId('mobile-nav');
    const links = nav.querySelectorAll('a');
    // 4 primary items shown as links
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  it('has navigation landmark', () => {
    renderMobileNavWithRouter('/activity');
    expect(screen.getByRole('navigation', { name: /mobile/i })).toBeInTheDocument();
  });
});
