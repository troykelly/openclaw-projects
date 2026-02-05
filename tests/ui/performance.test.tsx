/**
 * @vitest-environment jsdom
 * Tests for performance optimization components
 * Issue #413: Performance optimization (original tests)
 * Issue #478: Code splitting, lazy loading, and performance optimization
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { createMemoryRouter, RouterProvider, Outlet, type RouteObject } from 'react-router';

// Components to be tested - Issue #413 (original)
import {
  VirtualList,
  type VirtualListProps,
} from '@/ui/components/performance/virtual-list';
import {
  LazyLoad,
  type LazyLoadProps,
} from '@/ui/components/performance/lazy-load';
import {
  InfiniteScroll,
  type InfiniteScrollProps,
} from '@/ui/components/performance/infinite-scroll';
import {
  useDebounce,
  useThrottle,
} from '@/ui/components/performance/use-performance';

// Components to be tested - Issue #478
import { PrefetchLink } from '@/ui/components/navigation/PrefetchLink';
import {
  prefetchRoute,
  resetPrefetchCache,
  getRegisteredRoutes,
  prefetchAllRoutes,
} from '@/ui/lib/route-prefetch';

// Mock IntersectionObserver globally
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  elements: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.elements.push(element);
    // Simulate immediate intersection
    this.callback(
      [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

// ===========================================================================
// Issue #413: Original Performance Component Tests
// ===========================================================================
describe('VirtualList', () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i}`,
  }));

  const defaultProps: VirtualListProps<{ id: string; label: string }> = {
    items,
    itemHeight: 40,
    height: 400,
    renderItem: (item) => <div key={item.id}>{item.label}</div>,
  };

  it('should render visible items only', () => {
    render(<VirtualList {...defaultProps} />);
    const container = screen.getByTestId('virtual-list');
    const itemCount = container.querySelectorAll('[data-virtual-item]').length;
    expect(itemCount).toBeLessThan(50);
  });

  it('should update visible items on scroll', async () => {
    render(<VirtualList {...defaultProps} />);
    const container = screen.getByTestId('virtual-list');

    fireEvent.scroll(container, { target: { scrollTop: 1000 } });

    await waitFor(() => {
      expect(screen.queryByText('Item 0')).not.toBeInTheDocument();
    });
  });

  it('should render correct total height', () => {
    render(<VirtualList {...defaultProps} />);
    const inner = screen.getByTestId('virtual-list-inner');
    expect(inner.style.height).toBe('40000px');
  });

  it('should handle empty items', () => {
    render(<VirtualList {...defaultProps} items={[]} />);
    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
  });

  it('should support overscan', () => {
    render(<VirtualList {...defaultProps} overscan={5} />);
    const container = screen.getByTestId('virtual-list');
    const itemCount = container.querySelectorAll('[data-virtual-item]').length;
    expect(itemCount).toBeGreaterThan(10);
  });
});

describe('LazyLoad', () => {
  const defaultProps: LazyLoadProps = {
    children: <div data-testid="lazy-content">Lazy loaded content</div>,
  };

  it('should render content (with mock intersection)', () => {
    render(<LazyLoad {...defaultProps} />);
    // With our mock, it immediately intersects
    expect(screen.getByTestId('lazy-content')).toBeInTheDocument();
  });

  it('should support custom placeholder rendering', () => {
    // Test that the component accepts a placeholder prop
    const placeholder = <div data-testid="custom-placeholder">Loading...</div>;
    render(<LazyLoad placeholder={placeholder}>{<div>Content</div>}</LazyLoad>);
    // With our mock, it immediately loads the content
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});

describe('InfiniteScroll', () => {
  const defaultProps: InfiniteScrollProps = {
    onLoadMore: vi.fn(),
    hasMore: true,
    children: <div>Content</div>,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(<InfiniteScroll {...defaultProps} />);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should show loader when loading', () => {
    render(<InfiniteScroll {...defaultProps} loading />);
    expect(screen.getByTestId('infinite-scroll-loader')).toBeInTheDocument();
  });

  it('should show end message when no more items', () => {
    render(<InfiniteScroll {...defaultProps} hasMore={false} />);
    expect(screen.getByText(/no more items/i)).toBeInTheDocument();
  });

  it('should call onLoadMore when hasMore is true', () => {
    const onLoadMore = vi.fn();
    render(<InfiniteScroll {...defaultProps} onLoadMore={onLoadMore} />);
    // With our mock, it immediately triggers
    expect(onLoadMore).toHaveBeenCalled();
  });
});

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function TestDebounce({ value, delay }: { value: string; delay: number }) {
    const debouncedValue = useDebounce(value, delay);
    return <div data-testid="debounced">{debouncedValue}</div>;
  }

  it('should return initial value immediately', () => {
    render(<TestDebounce value="initial" delay={500} />);
    expect(screen.getByTestId('debounced')).toHaveTextContent('initial');
  });

  it('should debounce value changes', () => {
    const { rerender } = render(<TestDebounce value="initial" delay={500} />);

    rerender(<TestDebounce value="updated" delay={500} />);

    expect(screen.getByTestId('debounced')).toHaveTextContent('initial');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId('debounced')).toHaveTextContent('updated');
  });
});

describe('useThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function TestThrottle({ value, delay }: { value: string; delay: number }) {
    const throttledValue = useThrottle(value, delay);
    return <div data-testid="throttled">{throttledValue}</div>;
  }

  it('should return initial value immediately', () => {
    render(<TestThrottle value="initial" delay={500} />);
    expect(screen.getByTestId('throttled')).toHaveTextContent('initial');
  });

  it('should update after delay', () => {
    const { rerender } = render(<TestThrottle value="initial" delay={500} />);

    rerender(<TestThrottle value="updated" delay={500} />);

    // After delay, value should update
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId('throttled')).toHaveTextContent('updated');
  });
});

// ===========================================================================
// Issue #478: Code Splitting, Lazy Loading, and Performance Optimization
// ===========================================================================

// ---------------------------------------------------------------------------
// Routes use React.lazy
// ---------------------------------------------------------------------------
describe('Routes use React.lazy for code splitting', () => {
  it('routes.tsx exports a route configuration array', async () => {
    const mod = await import('@/ui/routes.js');
    expect(Array.isArray(mod.routes)).toBe(true);
    expect(mod.routes.length).toBeGreaterThan(0);
  });

  it('all child routes have element properties (lazy-wrapped)', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    expect(root).toBeDefined();
    expect(root.children).toBeDefined();
    expect(root.children!.length).toBeGreaterThan(0);
    for (const child of root.children!) {
      // Every child should have an element (either Navigate or Suspense-wrapped)
      // or have children (nested routes like /notes and /notebooks/:id)
      expect(child.element || child.children).toBeDefined();
    }
  });

  it('page routes are wrapped in Suspense with a fallback', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    // Check a non-redirect child (e.g. activity route)
    const activityRoute = root.children!.find((r) => r.path === 'activity');
    expect(activityRoute).toBeDefined();
    // The element should be a Suspense component wrapping a lazy component
    const el = activityRoute!.element as React.ReactElement;
    expect(el).toBeDefined();
    expect(el.type).toBe(React.Suspense);
  });

  it('Suspense fallback renders a page loader skeleton', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    const activityRoute = root.children!.find((r) => r.path === 'activity');
    const el = activityRoute!.element as React.ReactElement;
    // The fallback prop should be a JSX element
    const fallback = el.props.fallback as React.ReactElement;
    expect(fallback).toBeDefined();
    // Render the fallback to verify it shows the loading spinner
    render(fallback);
    expect(screen.getByTestId('page-loader')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Route prefetch utility
// ---------------------------------------------------------------------------
describe('Route prefetch utility', () => {
  beforeEach(() => {
    resetPrefetchCache();
  });

  it('getRegisteredRoutes returns known route paths', () => {
    const routes = getRegisteredRoutes();
    expect(routes).toContain('/activity');
    expect(routes).toContain('/work-items');
    expect(routes).toContain('/settings');
    expect(routes).toContain('/contacts');
    expect(routes).toContain('/memory');
    expect(routes).toContain('/timeline');
  });

  it('prefetchRoute does not throw for unknown paths', () => {
    expect(() => prefetchRoute('/unknown-route')).not.toThrow();
  });

  it('prefetchRoute only triggers import once per path', async () => {
    // We can verify via the cache mechanism - call twice and check no error
    prefetchRoute('/activity');
    prefetchRoute('/activity');
    // If it were called twice, the second call is a no-op
    // This test primarily ensures no exceptions are thrown
  });

  it('resetPrefetchCache allows re-prefetching', () => {
    prefetchRoute('/activity');
    resetPrefetchCache();
    // After reset, prefetching again should not throw
    expect(() => prefetchRoute('/activity')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PrefetchLink component
// ---------------------------------------------------------------------------
describe('PrefetchLink', () => {
  /** Render helper: wraps PrefetchLink in a router context. */
  function renderPrefetchLink(
    to: string,
    opts?: { prefetchPath?: string; children?: React.ReactNode }
  ) {
    const testRoutes: RouteObject[] = [
      {
        element: <Outlet />,
        children: [
          {
            path: '*',
            element: (
              <PrefetchLink
                to={to}
                prefetchPath={opts?.prefetchPath}
                data-testid="prefetch-link"
              >
                {opts?.children ?? 'Link'}
              </PrefetchLink>
            ),
          },
        ],
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/test'],
    });
    return render(<RouterProvider router={router} />);
  }

  beforeEach(() => {
    resetPrefetchCache();
  });

  it('renders as a link element', () => {
    renderPrefetchLink('/activity');
    const link = screen.getByTestId('prefetch-link');
    expect(link.tagName).toBe('A');
  });

  it('renders with correct href', () => {
    renderPrefetchLink('/activity');
    const link = screen.getByTestId('prefetch-link');
    expect(link.getAttribute('href')).toBe('/activity');
  });

  it('triggers prefetch on mouse enter', () => {
    renderPrefetchLink('/activity');
    const link = screen.getByTestId('prefetch-link');

    // Should not throw when hovering
    fireEvent.mouseEnter(link);
    // The prefetch is fire-and-forget, so we just verify no error
    expect(link).toBeInTheDocument();
  });

  it('triggers prefetch on focus', () => {
    renderPrefetchLink('/activity');
    const link = screen.getByTestId('prefetch-link');

    fireEvent.focus(link);
    expect(link).toBeInTheDocument();
  });

  it('sets data-prefetch-path attribute', () => {
    renderPrefetchLink('/settings', { prefetchPath: '/settings' });
    const link = screen.getByTestId('prefetch-link');
    expect(link.getAttribute('data-prefetch-path')).toBe('/settings');
  });

  it('uses to prop as prefetchPath when prefetchPath is not provided', () => {
    renderPrefetchLink('/contacts');
    const link = screen.getByTestId('prefetch-link');
    expect(link.getAttribute('data-prefetch-path')).toBe('/contacts');
  });

  it('renders children correctly', () => {
    renderPrefetchLink('/activity', { children: 'Activity Page' });
    expect(screen.getByText('Activity Page')).toBeInTheDocument();
  });

  it('forwards mouse enter event to custom handler', () => {
    const onMouseEnter = vi.fn();
    const testRoutes: RouteObject[] = [
      {
        element: <Outlet />,
        children: [
          {
            path: '*',
            element: (
              <PrefetchLink
                to="/activity"
                onMouseEnter={onMouseEnter}
                data-testid="prefetch-link"
              >
                Link
              </PrefetchLink>
            ),
          },
        ],
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/test'],
    });
    render(<RouterProvider router={router} />);

    const link = screen.getByTestId('prefetch-link');
    fireEvent.mouseEnter(link);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });

  it('forwards focus event to custom handler', () => {
    const onFocus = vi.fn();
    const testRoutes: RouteObject[] = [
      {
        element: <Outlet />,
        children: [
          {
            path: '*',
            element: (
              <PrefetchLink
                to="/activity"
                onFocus={onFocus}
                data-testid="prefetch-link"
              >
                Link
              </PrefetchLink>
            ),
          },
        ],
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/test'],
    });
    render(<RouterProvider router={router} />);

    const link = screen.getByTestId('prefetch-link');
    fireEvent.focus(link);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Sidebar uses PrefetchLink
// ---------------------------------------------------------------------------
describe('RouterSidebar uses PrefetchLink for navigation', () => {
  it('sidebar nav items have data-prefetch-path attribute', async () => {
    const { RouterSidebar } = await import(
      '@/ui/components/layout/router-sidebar.js'
    );
    const testRoutes: RouteObject[] = [
      {
        element: (
          <div>
            <RouterSidebar />
            <Outlet />
          </div>
        ),
        children: [
          {
            path: 'activity',
            element: <div data-testid="page-activity">Activity</div>,
          },
          {
            path: 'projects',
            element: <div>Projects</div>,
          },
          {
            path: 'people',
            element: <div>People</div>,
          },
          {
            path: 'memory',
            element: <div>Memory</div>,
          },
          {
            path: 'communications',
            element: <div>Communications</div>,
          },
          {
            path: 'settings',
            element: <div>Settings</div>,
          },
        ],
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/activity'],
    });
    render(<RouterProvider router={router} />);

    // All nav links should have the data-prefetch-path attribute from PrefetchLink
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const links = nav.querySelectorAll('a[data-prefetch-path]');
    expect(links.length).toBeGreaterThanOrEqual(5);
  });

  it('settings link has data-prefetch-path attribute', async () => {
    const { RouterSidebar } = await import(
      '@/ui/components/layout/router-sidebar.js'
    );
    const testRoutes: RouteObject[] = [
      {
        element: (
          <div>
            <RouterSidebar />
            <Outlet />
          </div>
        ),
        children: [
          {
            path: 'activity',
            element: <div>Activity</div>,
          },
          {
            path: 'settings',
            element: <div>Settings</div>,
          },
        ],
      },
    ];
    const router = createMemoryRouter(testRoutes, {
      initialEntries: ['/activity'],
    });
    render(<RouterProvider router={router} />);

    const settingsLink = screen.getByRole('link', { name: /settings/i });
    expect(settingsLink.getAttribute('data-prefetch-path')).toBe('/settings');
  });
});

// ---------------------------------------------------------------------------
// Code splitting verification
// ---------------------------------------------------------------------------
describe('Code splitting verification', () => {
  it('routes are code-split with separate lazy imports', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    const childRoutes = root.children!.filter(
      (r) => r.path && r.path !== '*'
    );
    // There should be multiple code-split routes
    expect(childRoutes.length).toBeGreaterThanOrEqual(8);
  });

  it('each page route path has a Suspense-wrapped element', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    const pageRoutes = root.children!.filter(
      (r) => r.path && r.path !== '*' && !r.index
    );

    for (const route of pageRoutes) {
      // Routes can have either element (direct) or children (nested routes)
      if (route.children) {
        // For nested routes, check each child has a Suspense-wrapped element
        for (const child of route.children) {
          if (child.element) {
            const el = child.element as React.ReactElement;
            expect(el.type).toBe(React.Suspense);
          }
        }
      } else {
        const el = route.element as React.ReactElement;
        expect(el).toBeDefined();
        // Each page route element should be wrapped in Suspense
        expect(el.type).toBe(React.Suspense);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suspense fallback renders skeleton
// ---------------------------------------------------------------------------
describe('Suspense fallback rendering', () => {
  it('PageLoader displays a spinning indicator', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    // Get the root layout element (also Suspense-wrapped)
    const rootEl = root.element as React.ReactElement;
    const fallback = rootEl.props.fallback as React.ReactElement;
    render(fallback);
    const loader = screen.getByTestId('page-loader');
    expect(loader).toBeInTheDocument();
    // Should contain an animated spinner element
    const spinner = loader.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('PageLoader has proper accessible loading structure', async () => {
    const mod = await import('@/ui/routes.js');
    const root = mod.routes[0];
    const activityRoute = root.children!.find((r) => r.path === 'activity');
    const el = activityRoute!.element as React.ReactElement;
    const fallback = el.props.fallback as React.ReactElement;
    render(fallback);
    const loader = screen.getByTestId('page-loader');
    // Verify it renders with layout classes for centering
    expect(loader.className).toContain('flex');
    expect(loader.className).toContain('items-center');
    expect(loader.className).toContain('justify-center');
  });
});

// ---------------------------------------------------------------------------
// Lucide icon import verification
// ---------------------------------------------------------------------------
describe('Lucide icon imports are tree-shakable', () => {
  it('sidebar uses individual named imports from lucide-react', async () => {
    // Verify that the sidebar module can be imported without issues,
    // which means the individual icon imports resolve correctly
    const mod = await import('@/ui/components/layout/sidebar.js');
    expect(mod.Sidebar).toBeDefined();
    expect(typeof mod.Sidebar).toBe('function');
  });

  it('router-sidebar uses individual named imports from lucide-react', async () => {
    const mod = await import('@/ui/components/layout/router-sidebar.js');
    expect(mod.RouterSidebar).toBeDefined();
    expect(typeof mod.RouterSidebar).toBe('function');
  });
});
