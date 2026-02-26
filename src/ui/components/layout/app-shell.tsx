import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/ui/lib/utils';
import { RouterSidebar } from './router-sidebar';
import { MobileNav } from './mobile-nav';
import { Breadcrumb, type BreadcrumbItem } from './breadcrumb';
import { KeyboardShortcutsModal } from '@/ui/components/keyboard-shortcuts-modal';
import { NamespaceIndicator } from '@/ui/components/namespace';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

export interface AppShellProps {
  children: React.ReactNode;
  onCreateClick?: () => void;
  onSearchClick?: () => void;
  breadcrumbs?: BreadcrumbItem[];
  onBreadcrumbClick?: (item: BreadcrumbItem, index: number) => void;
  onHomeClick?: () => void;
  header?: React.ReactNode;
  className?: string;
}

export function AppShell({
  children,
  onCreateClick,
  onSearchClick,
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

  // Handle keyboard shortcut for search (⌘K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onSearchClick?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSearchClick]);

  return (
    <div data-testid="app-shell" className={cn('flex h-screen bg-background', className)}>
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <RouterSidebar
          onCreateClick={onCreateClick}
          onSearchClick={onSearchClick}
          collapsed={sidebarCollapsed}
          onCollapsedChange={handleCollapsedChange}
        />
      </div>

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
          {breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs} onHomeClick={onHomeClick} />}
          <div className="ml-auto flex items-center gap-2">
            <NamespaceIndicator />
            {header}
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-0">{children}</div>
      </main>

      {/* Mobile Navigation */}
      <MobileNav />

      {/* Keyboard Shortcuts Help Modal (⌘/) */}
      <KeyboardShortcutsModal />
    </div>
  );
}
