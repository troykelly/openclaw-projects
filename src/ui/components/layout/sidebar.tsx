import * as React from 'react';
import { Bell, Folder, Calendar, Users, Search, Settings, ChevronLeft, ChevronRight, Plus, StickyNote, Globe } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { useNamespaceSafe } from '@/ui/contexts/namespace-context';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  onClick?: () => void;
}

const defaultNavItems: NavItem[] = [
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'timeline', label: 'Timeline', icon: Calendar },
  { id: 'people', label: 'People', icon: Users },
];

export interface SidebarProps {
  items?: NavItem[];
  activeItem?: string;
  onItemClick?: (item: NavItem) => void;
  onCreateClick?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

export function Sidebar({
  items = defaultNavItems,
  activeItem = 'activity',
  onItemClick,
  onCreateClick,
  collapsed = false,
  onCollapsedChange,
  className,
}: SidebarProps) {
  const handleToggleCollapse = () => {
    onCollapsedChange?.(!collapsed);
  };

  const ns = useNamespaceSafe();
  const grants = ns?.grants ?? [];
  const activeNamespace = ns?.activeNamespace ?? 'default';
  const setActiveNamespace = ns?.setActiveNamespace;
  const hasMultipleNamespaces = ns?.hasMultipleNamespaces ?? false;

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={cn(
          'flex h-full flex-col border-r border-border bg-surface z-20 transition-all duration-300 ease-out',
          collapsed ? 'w-16' : 'w-60',
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

        {/* Namespace Selector */}
        {grants.length > 0 && (
          <div className="px-3 pt-2">
            {hasMultipleNamespaces ? (
              collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex w-full items-center justify-center rounded-md py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      aria-label={`Namespace: ${activeNamespace}`}
                    >
                      <Globe className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8} className="font-medium">
                    {activeNamespace}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Select value={activeNamespace} onValueChange={(v) => setActiveNamespace?.(v)}>
                  <SelectTrigger size="sm" className="w-full text-xs" aria-label="Select namespace">
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {grants.map((g) => (
                      <SelectItem key={g.namespace} value={g.namespace}>
                        {g.namespace}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    <Globe className="size-3.5 shrink-0" />
                    {!collapsed && <span className="truncate">{activeNamespace}</span>}
                  </div>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right" sideOffset={8} className="font-medium">
                    {activeNamespace}
                  </TooltipContent>
                )}
              </Tooltip>
            )}
          </div>
        )}

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
              const is_active = activeItem === item.id;

              const navButton = (
                <button
                  key={item.id}
                  onClick={() => {
                    item.onClick?.();
                    onItemClick?.(item);
                  }}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    collapsed && 'justify-center px-0',
                    is_active ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  aria-current={is_active ? 'page' : undefined}
                >
                  <Icon className={cn('size-[18px] shrink-0 transition-transform duration-150', !is_active && 'group-hover:scale-110')} />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>{navButton}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8} className="font-medium">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return navButton;
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-0',
                )}
                onClick={() => onItemClick?.({ id: 'search', label: 'Search', icon: Search })}
              >
                <Search className="size-[18px] shrink-0" />
                {!collapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span>Search</span>
                    <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
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
              <button
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  collapsed && 'justify-center px-0',
                  activeItem === 'settings' ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => onItemClick?.({ id: 'settings', label: 'Settings', icon: Settings })}
              >
                <Settings className="size-[18px] shrink-0" />
                {!collapsed && <span>Settings</span>}
              </button>
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
