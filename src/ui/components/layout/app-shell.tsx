import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/ui/lib/utils';
import { Sidebar, type NavItem } from './sidebar';
import { MobileNav } from './mobile-nav';
import { Breadcrumb, type BreadcrumbItem } from './breadcrumb';
import { KeyboardShortcutsModal } from '@/ui/components/keyboard-shortcuts-modal';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

export interface AppShellProps {
  children: React.ReactNode;
  activeSection?: string;
  onSectionChange?: (section: string) => void;
  breadcrumbs?: BreadcrumbItem[];
  onBreadcrumbClick?: (item: BreadcrumbItem, index: number) => void;
  onHomeClick?: () => void;
  header?: React.ReactNode;
  className?: string;
}

export function AppShell({
  children,
  activeSection = 'activity',
  onSectionChange,
  breadcrumbs = [],
  onBreadcrumbClick,
  onHomeClick,
  header,
  className,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });

  const handleCollapsedChange = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, []);

  const handleNavItemClick = useCallback(
    (item: NavItem) => {
      onSectionChange?.(item.id);
    },
    [onSectionChange]
  );

  // Handle keyboard shortcut for search (⌘K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onSectionChange?.('search');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSectionChange]);

  return (
    <div
      data-testid="app-shell"
      className={cn('flex h-screen bg-background', className)}
    >
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          activeItem={activeSection}
          onItemClick={handleNavItemClick}
          collapsed={sidebarCollapsed}
          onCollapsedChange={handleCollapsedChange}
        />
      </div>

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
          {breadcrumbs.length > 0 && (
            <Breadcrumb
              items={breadcrumbs}
              onHomeClick={onHomeClick}
            />
          )}
          {header && <div className="ml-auto flex items-center gap-2">{header}</div>}
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto pb-16 md:pb-0">
          {children}
        </div>
      </main>

      {/* Mobile Navigation */}
      <MobileNav
        activeItem={activeSection}
        onItemClick={handleNavItemClick}
      />

      {/* Keyboard Shortcuts Help Modal (⌘/) */}
      <KeyboardShortcutsModal />
    </div>
  );
}
