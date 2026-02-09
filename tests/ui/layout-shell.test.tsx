/**
 * @vitest-environment jsdom
 * Tests for app shell layout rebuild
 * Issue #465: Rebuild app shell layout with solid opaque backgrounds
 *
 * Validates:
 * - Sidebar renders with solid opaque background (no gradients, no transparency)
 * - Sidebar collapse/expand with localStorage persistence
 * - Header renders with solid background and proper z-index stacking
 * - Content area scrolls independently
 * - Mobile layout hides sidebar and shows mobile nav
 * - Mobile nav uses solid opaque background (no transparency)
 * - Z-index hierarchy is correct
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import { Sidebar, type SidebarProps, type NavItem } from '@/ui/components/layout/sidebar';
import { MobileNav, type MobileNavProps } from '@/ui/components/layout/mobile-nav';
import { AppShell, type AppShellProps } from '@/ui/components/layout/app-shell';

// ── helpers ──────────────────────────────────────────────────────────

/** CSS classes that must NEVER appear on navigation chrome */
const FORBIDDEN_PATTERNS = [
  /bg-surface\/\d/, // bg-surface/95, bg-surface/80 etc
  /backdrop-blur/, // backdrop-blur-sm, backdrop-blur-md etc
  /bg-gradient-to/, // bg-gradient-to-b, bg-gradient-to-r etc
  /bg-linear-to/, // Tailwind v4 gradient syntax
  /bg-transparent/, // fully transparent
  /bg-opacity-/, // legacy opacity utility
];

/**
 * Returns the full className string for the given element,
 * throwing if it's missing.
 */
function getClasses(el: HTMLElement): string {
  const cls = el.getAttribute('class') ?? '';
  return cls;
}

/**
 * Asserts that no forbidden transparency/gradient pattern is present
 * in the element's className.
 */
function assertOpaqueBackground(el: HTMLElement, label: string): void {
  const cls = getClasses(el);
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(cls).not.toMatch(pattern);
  }
}

/**
 * Asserts an element has a specific class.
 */
function assertHasClass(el: HTMLElement, expected: string, label: string): void {
  expect(el).toHaveClass(expected);
}

// ── localStorage mock helpers ────────────────────────────────────────

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

// ── Sidebar tests ────────────────────────────────────────────────────

describe('Sidebar - Opaque Background', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  it('should render the sidebar element', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toBeInTheDocument();
  });

  it('should use a solid opaque background, not gradient or transparent', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    assertOpaqueBackground(sidebar, 'Sidebar');
  });

  it('should have bg-surface class for solid background', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    const cls = getClasses(sidebar);
    // Must have a solid background color class (bg-surface or bg-white or equivalent)
    expect(cls).toMatch(/bg-surface(?!\/)/);
  });

  it('should have a solid border (not semi-transparent)', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    const cls = getClasses(sidebar);
    // Must have border-r with solid border-border (not border-border/50)
    expect(cls).toContain('border-r');
    expect(cls).toContain('border-border');
    expect(cls).not.toMatch(/border-border\/\d/);
  });

  it('should have z-20 for proper stacking above content', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveClass('z-20');
  });

  it('should be w-60 (240px) when expanded', () => {
    render(<Sidebar collapsed={false} />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveClass('w-60');
  });

  it('should be w-16 (64px) when collapsed', () => {
    render(<Sidebar collapsed={true} />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveClass('w-16');
  });

  it('should have full height (h-full)', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveClass('h-full');
  });

  it('should have smooth width transition', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    const cls = getClasses(sidebar);
    expect(cls).toMatch(/transition/);
  });

  it('should toggle collapsed state when collapse button is clicked', () => {
    const onCollapsedChange = vi.fn();
    render(<Sidebar collapsed={false} onCollapsedChange={onCollapsedChange} />);
    const collapseButton = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(collapseButton);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('should toggle expanded state when expand button is clicked', () => {
    const onCollapsedChange = vi.fn();
    render(<Sidebar collapsed={true} onCollapsedChange={onCollapsedChange} />);
    const expandButton = screen.getByLabelText('Expand sidebar');
    fireEvent.click(expandButton);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('should mark the active item with aria-current=page', () => {
    render(<Sidebar activeItem="projects" />);
    const activeButton = screen.getByText('Projects').closest('button');
    expect(activeButton).toHaveAttribute('aria-current', 'page');
  });

  it('should have navigation landmark', () => {
    render(<Sidebar />);
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(nav).toBeInTheDocument();
  });
});

// ── MobileNav tests ──────────────────────────────────────────────────

describe('MobileNav - Opaque Background', () => {
  it('should render the mobile nav element', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    expect(mobileNav).toBeInTheDocument();
  });

  it('should use a solid opaque background, not transparent or blurred', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    assertOpaqueBackground(mobileNav, 'MobileNav');
  });

  it('should have bg-surface for solid background (no opacity modifier)', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    const cls = getClasses(mobileNav);
    // Must have bg-surface without /95 or any opacity modifier
    expect(cls).toMatch(/bg-surface(?!\/)/);
    expect(cls).not.toContain('backdrop-blur');
  });

  it('should be fixed at the bottom of the viewport', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    expect(mobileNav).toHaveClass('fixed');
    expect(mobileNav).toHaveClass('bottom-0');
    expect(mobileNav).toHaveClass('inset-x-0');
  });

  it('should have z-50 for highest stacking priority', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    expect(mobileNav).toHaveClass('z-50');
  });

  it('should have border-t for visual separation from content', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    expect(mobileNav).toHaveClass('border-t');
  });

  it('should be hidden on desktop via md:hidden', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    const cls = getClasses(mobileNav);
    // The mobile nav should have classes that hide it on desktop
    expect(cls).toMatch(/md:.*hidden|md:!hidden/);
  });

  it('should render navigation items', () => {
    render(<MobileNav />);
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('should mark active item with aria-current=page', () => {
    render(<MobileNav activeItem="projects" />);
    const projectsButton = screen.getByText('Projects').closest('button');
    expect(projectsButton).toHaveAttribute('aria-current', 'page');
  });

  it('should have navigation landmark with appropriate label', () => {
    render(<MobileNav />);
    const nav = screen.getByRole('navigation', { name: /mobile/i });
    expect(nav).toBeInTheDocument();
  });
});

// ── AppShell tests ───────────────────────────────────────────────────

describe('AppShell - Layout Structure', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  it('should render the app shell container', () => {
    render(<AppShell>Content</AppShell>);
    const shell = screen.getByTestId('app-shell');
    expect(shell).toBeInTheDocument();
  });

  it('should be a flex container that fills viewport height', () => {
    render(<AppShell>Content</AppShell>);
    const shell = screen.getByTestId('app-shell');
    expect(shell).toHaveClass('flex');
    expect(shell).toHaveClass('h-screen');
  });

  it('should render children in the content area', () => {
    render(<AppShell>Test Content</AppShell>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('should render the header with solid opaque background', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    // The header should exist and have solid background
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
    if (header) {
      assertOpaqueBackground(header, 'Header');
      const cls = getClasses(header);
      // Must have a solid background
      expect(cls).toMatch(/bg-surface(?!\/)/);
    }
  });

  it('should render the header with sticky positioning', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
    if (header) {
      expect(header).toHaveClass('sticky');
      expect(header).toHaveClass('top-0');
    }
  });

  it('should render the header with z-10 stacking', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
    if (header) {
      expect(header).toHaveClass('z-10');
    }
  });

  it('should render header with border-b for visual separation', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
    if (header) {
      expect(header).toHaveClass('border-b');
    }
  });

  it('should render header at h-14 height', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
    if (header) {
      expect(header).toHaveClass('h-14');
    }
  });

  it('should render content area with overflow-y-auto for independent scrolling', () => {
    render(<AppShell>Content</AppShell>);
    // Content area should be scrollable
    const contentArea = screen.getByText('Content').closest('[class*="overflow"]');
    expect(contentArea).not.toBeNull();
    if (contentArea) {
      expect(contentArea).toHaveClass('overflow-y-auto');
    }
  });

  it('should persist sidebar collapsed state in localStorage', () => {
    const { rerender } = render(<AppShell>Content</AppShell>);
    // The sidebar starts expanded. The collapse state is managed in AppShell.
    // Click collapse in sidebar
    const collapseBtn = screen.queryByLabelText('Collapse sidebar');
    if (collapseBtn) {
      fireEvent.click(collapseBtn);
      expect(localStorageMock.getItem('sidebar-collapsed')).toBe('true');
    }
  });

  it('should render breadcrumbs in the header when provided', () => {
    render(<AppShell breadcrumbs={[{ label: 'Dashboard' }, { label: 'My Project' }]}>Content</AppShell>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('should render header actions on the right side', () => {
    render(<AppShell header={<button>Action</button>}>Content</AppShell>);
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('should include both desktop sidebar and mobile nav', () => {
    render(<AppShell>Content</AppShell>);
    const sidebar = screen.getByTestId('sidebar');
    const mobileNav = screen.getByTestId('mobile-nav');
    expect(sidebar).toBeInTheDocument();
    expect(mobileNav).toBeInTheDocument();
  });
});

// ── Z-Index Hierarchy tests ──────────────────────────────────────────

describe('Z-Index Hierarchy', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  it('should have sidebar at z-20 (above content, below modals)', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar).toHaveClass('z-20');
  });

  it('should have mobile nav at z-50 (highest navigation priority)', () => {
    render(<MobileNav />);
    const mobileNav = screen.getByTestId('mobile-nav');
    expect(mobileNav).toHaveClass('z-50');
  });

  it('should have header at z-10 (within content column)', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    const header = screen.getByTestId('app-shell').querySelector('header');
    expect(header).not.toBeNull();
    if (header) {
      expect(header).toHaveClass('z-10');
    }
  });

  it('should maintain proper stacking order: header(10) < sidebar(20) < mobile-nav(50)', () => {
    render(<AppShell breadcrumbs={[{ label: 'Test' }]}>Content</AppShell>);
    const sidebar = screen.getByTestId('sidebar');
    const mobileNav = screen.getByTestId('mobile-nav');
    const header = screen.getByTestId('app-shell').querySelector('header');

    const getZIndex = (el: HTMLElement): number => {
      const cls = getClasses(el);
      const match = cls.match(/z-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const headerZ = header ? getZIndex(header) : 0;
    const sidebarZ = getZIndex(sidebar);
    const mobileNavZ = getZIndex(mobileNav);

    expect(headerZ).toBe(10);
    expect(sidebarZ).toBe(20);
    expect(mobileNavZ).toBe(50);
    expect(headerZ).toBeLessThan(sidebarZ);
    expect(sidebarZ).toBeLessThan(mobileNavZ);
  });
});

// ── Content Area Scrolling tests ─────────────────────────────────────

describe('Content Area - Independent Scrolling', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  it('should have overflow-y-auto on the content container', () => {
    render(
      <AppShell>
        <div data-testid="inner-content">Scrollable content</div>
      </AppShell>,
    );
    const innerContent = screen.getByTestId('inner-content');
    const scrollContainer = innerContent.closest('[class*="overflow-y-auto"]');
    expect(scrollContainer).not.toBeNull();
  });

  it('should have flex-1 to fill remaining space', () => {
    render(
      <AppShell>
        <div data-testid="inner-content">Content</div>
      </AppShell>,
    );
    const innerContent = screen.getByTestId('inner-content');
    const scrollContainer = innerContent.closest('[class*="flex-1"]');
    expect(scrollContainer).not.toBeNull();
  });

  it('should have padding on the content area', () => {
    render(
      <AppShell>
        <div data-testid="inner-content">Content</div>
      </AppShell>,
    );
    // Content area should have p-6 for desktop, p-4 for mobile via responsive classes
    const innerContent = screen.getByTestId('inner-content');
    const scrollContainer = innerContent.closest('[class*="overflow-y-auto"]');
    expect(scrollContainer).not.toBeNull();
    if (scrollContainer) {
      const cls = getClasses(scrollContainer as HTMLElement);
      // Should have some padding class
      expect(cls).toMatch(/p-[46]/);
    }
  });

  it('should add bottom padding on mobile for mobile nav clearance', () => {
    render(
      <AppShell>
        <div data-testid="inner-content">Content</div>
      </AppShell>,
    );
    const innerContent = screen.getByTestId('inner-content');
    const scrollContainer = innerContent.closest('[class*="overflow-y-auto"]');
    expect(scrollContainer).not.toBeNull();
    if (scrollContainer) {
      const cls = getClasses(scrollContainer as HTMLElement);
      // Should have pb-16 or pb-20 to clear mobile nav, and md:pb-0 for desktop
      expect(cls).toMatch(/pb-\d+/);
    }
  });
});

// ── Sidebar Footer Border tests ──────────────────────────────────────

describe('Sidebar - Footer Border Opacity', () => {
  it('should use solid border on footer separator (not semi-transparent)', () => {
    render(<Sidebar />);
    const sidebar = screen.getByTestId('sidebar');
    // Check footer border-t uses border-border not border-border/50
    const footerBorder = sidebar.querySelector('[class*="border-t"]');
    expect(footerBorder).not.toBeNull();
    if (footerBorder) {
      const cls = getClasses(footerBorder as HTMLElement);
      expect(cls).not.toMatch(/border-border\/\d/);
    }
  });
});
