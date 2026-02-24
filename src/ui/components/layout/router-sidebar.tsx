import * as React from 'react';
import { Bell, Folder, Users, Search, Settings, ChevronLeft, ChevronRight, Plus, Brain, MessageSquare, Package, ChefHat, UtensilsCrossed, Code } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { PrefetchLink } from '@/ui/components/navigation/PrefetchLink';

/** Navigation item definition used by RouterSidebar. */
export interface RouterNavItem {
  /** Unique identifier for the nav item. */
  id: string;
  /** Display label. */
  label: string;
  /** Lucide icon component. */
  icon: React.ComponentType<{ className?: string }>;
  /** Route path relative to the router basename. */
  to: string;
}

const defaultNavItems: RouterNavItem[] = [
  { id: 'activity', label: 'Activity', icon: Bell, to: '/activity' },
  { id: 'projects', label: 'Projects', icon: Folder, to: '/projects' },
  { id: 'people', label: 'People', icon: Users, to: '/contacts' },
  { id: 'memory', label: 'Memory', icon: Brain, to: '/memory' },
  { id: 'communications', label: 'Communications', icon: MessageSquare, to: '/communications' },
  { id: 'recipes', label: 'Recipes', icon: ChefHat, to: '/recipes' },
  { id: 'meal-log', label: 'Meal Log', icon: UtensilsCrossed, to: '/meal-log' },
  { id: 'dev-sessions', label: 'Dev Sessions', icon: Code, to: '/dev-sessions' },
  { id: 'skill-store', label: 'Skill Store', icon: Package, to: '/skill-store' },
];

export interface RouterSidebarProps {
  /** Navigation items to render. Defaults to the standard nav items. */
  items?: RouterNavItem[];
  /** Callback when the "Create" button is clicked. */
  onCreateClick?: () => void;
  /** Callback when the "Search" button is clicked (opens command palette). */
  onSearchClick?: () => void;
  /** Whether the sidebar is collapsed. */
  collapsed?: boolean;
  /** Called when the collapsed state changes. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Additional CSS class name for the sidebar element. */
  className?: string;
}

/**
 * Router-aware sidebar that uses PrefetchLink for active state detection
 * and route chunk prefetching on hover/focus.
 *
 * This replaces the original Sidebar component's button-based navigation
 * with PrefetchLink (a NavLink wrapper). The active state is derived from
 * the current URL automatically by react-router, and hovering over a link
 * triggers preloading of the target page chunk for instant navigation.
 */
export function RouterSidebar({ items = defaultNavItems, onCreateClick, onSearchClick, collapsed = false, onCollapsedChange, className }: RouterSidebarProps) {
  const handleToggleCollapse = () => {
    onCollapsedChange?.(!collapsed);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-testid="router-sidebar"
        data-collapsed={collapsed}
        className={cn(
          'flex h-full flex-col border-r border-border/50 bg-gradient-to-b from-surface to-background transition-all duration-300 ease-out',
          collapsed ? 'w-[68px]' : 'w-60',
          className,
        )}
      >
        {/* Logo / Header */}
        <div className="flex h-14 items-center px-4">
          <div className={cn('flex items-center gap-3', collapsed && 'justify-center w-full')}>
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-sm">
              <span className="text-sm font-bold text-primary-foreground">O</span>
            </div>
            {!collapsed && <span className="text-base font-semibold tracking-tight text-foreground">OpenClaw Projects</span>}
          </div>
          {!collapsed && (
            <button
              onClick={handleToggleCollapse}
              className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
        </div>

        {/* Create Button */}
        {onCreateClick && (
          <div className="px-3 pt-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onCreateClick}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90',
                    collapsed && 'px-0',
                  )}
                  aria-label="Create new work item"
                >
                  <Plus className="size-[18px] shrink-0" />
                  {!collapsed && <span>Create</span>}
                </button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" sideOffset={8} className="font-medium">
                  Create <kbd className="ml-1 text-[10px]">N</kbd>
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        )}

        {/* Navigation Items */}
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="flex flex-col gap-1" role="navigation" aria-label="Main navigation">
            {items.map((item) => {
              const Icon = item.icon;

              const navLink = (
                <PrefetchLink
                  key={item.id}
                  to={item.to}
                  prefetchPath={item.to}
                  className={({ isActive }) =>
                    cn(
                      'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                      collapsed && 'justify-center px-0',
                      isActive ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                  end={item.to === '/activity'}
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('size-[18px] shrink-0 transition-transform duration-150', !isActive && 'group-hover:scale-110')} />
                      {!collapsed && <span>{item.label}</span>}
                    </>
                  )}
                </PrefetchLink>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>{navLink}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8} className="font-medium">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return navLink;
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/50 p-3 space-y-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-0',
                )}
                onClick={onSearchClick}
              >
                <Search className="size-[18px] shrink-0" />
                {!collapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span>Search</span>
                    <kbd className="hidden rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
                      ⌘K
                    </kbd>
                  </span>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8} className="font-medium">
                Search <kbd className="ml-1 text-[10px]">⌘K</kbd>
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <PrefetchLink
                to="/settings"
                prefetchPath="/settings"
                className={({ isActive }) =>
                  cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Settings className="size-[18px] shrink-0" />
                {!collapsed && <span>Settings</span>}
              </PrefetchLink>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" sideOffset={8} className="font-medium">
                Settings
              </TooltipContent>
            )}
          </Tooltip>

          {collapsed && (
            <button
              onClick={handleToggleCollapse}
              className="mt-2 flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
