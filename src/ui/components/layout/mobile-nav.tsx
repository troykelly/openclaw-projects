import * as React from 'react';
import { Bell, Folder, Calendar, Users, Search } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { NavItem } from './sidebar';

const defaultNavItems: NavItem[] = [
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'timeline', label: 'Timeline', icon: Calendar },
  { id: 'people', label: 'People', icon: Users },
  { id: 'search', label: 'Search', icon: Search },
];

export interface MobileNavProps {
  items?: NavItem[];
  activeItem?: string;
  onItemClick?: (item: NavItem) => void;
  className?: string;
}

export function MobileNav({
  items = defaultNavItems,
  activeItem = 'activity',
  onItemClick,
  className,
}: MobileNavProps) {
  return (
    <nav
      data-testid="mobile-nav"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 h-16 items-center justify-around border-t border-border bg-surface/95 backdrop-blur-sm',
        'flex md:!hidden', // Force hide on desktop
        className
      )}
      style={{ display: 'var(--mobile-nav-display, flex)' }}
      role="navigation"
      aria-label="Mobile navigation"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeItem === item.id;

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              item.onClick?.();
              onItemClick?.(item);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground',
              isActive && 'text-primary'
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="size-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
