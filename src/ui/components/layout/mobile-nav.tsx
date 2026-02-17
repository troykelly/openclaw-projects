import * as React from 'react';
import { useState } from 'react';
import { Bell, Folder, Calendar, Users, Search, StickyNote, MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { NavItem } from './sidebar';

/**
 * Primary nav items shown in the main mobile nav bar (4 items + More).
 * Timeline was previously removed (#672) but is now in the overflow menu
 * to maintain a clean 5-item layout while keeping all features accessible.
 */
const primaryNavItems: NavItem[] = [
  { id: 'activity', label: 'Activity', icon: Bell },
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'people', label: 'People', icon: Users },
];

/**
 * Overflow items shown in the expandable "More" menu.
 * Includes Timeline and Search which were removed from the primary nav.
 */
const overflowNavItems: NavItem[] = [
  { id: 'timeline', label: 'Timeline', icon: Calendar },
  { id: 'search', label: 'Search', icon: Search },
];

/** Combined items for backwards compatibility */
const defaultNavItems: NavItem[] = [...primaryNavItems, ...overflowNavItems];

export interface MobileNavProps {
  items?: NavItem[];
  activeItem?: string;
  onItemClick?: (item: NavItem) => void;
  className?: string;
}

export function MobileNav({ items = defaultNavItems, activeItem = 'activity', onItemClick, className }: MobileNavProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Split items into primary (first 4) and overflow (rest)
  // This allows custom items to be passed while maintaining the layout
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const hasOverflow = overflow.length > 0;

  // Check if active item is in overflow menu
  const isOverflowActive = overflow.some((item) => item.id === activeItem);

  const handleMoreClick = () => {
    setMoreMenuOpen(!moreMenuOpen);
  };

  const handleItemClick = (item: NavItem) => {
    item.onClick?.();
    onItemClick?.(item);
    setMoreMenuOpen(false); // Close menu after selection
  };

  return (
    <>
      {/* Overflow menu backdrop */}
      {moreMenuOpen && <div className="fixed inset-0 z-40 bg-black/20 md:hidden" onClick={() => setMoreMenuOpen(false)} aria-hidden="true" />}

      {/* Overflow menu panel (#672) */}
      {moreMenuOpen && hasOverflow && (
        <div
          data-testid="mobile-nav-overflow"
          className={cn('fixed inset-x-0 bottom-16 z-50 border-t border-border bg-surface p-2', 'flex flex-wrap gap-2 justify-center md:hidden')}
          role="menu"
          aria-label="More navigation options"
        >
          {overflow.map((item) => {
            const Icon = item.icon;
            const is_active = activeItem === item.id;

            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(item)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  is_active && 'bg-primary/10 text-primary',
                )}
                aria-current={is_active ? 'page' : undefined}
              >
                <Icon className="size-4" />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main mobile nav bar */}
      <nav
        data-testid="mobile-nav"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 h-16 items-center justify-around border-t border-border bg-surface',
          'flex md:!hidden', // Force hide on desktop
          className,
        )}
        style={{ display: 'var(--mobile-nav-display, flex)' }}
        role="navigation"
        aria-label="Mobile navigation"
      >
        {/* Primary nav items */}
        {primary.map((item) => {
          const Icon = item.icon;
          const is_active = activeItem === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleItemClick(item)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground',
                is_active && 'text-primary',
              )}
              aria-current={is_active ? 'page' : undefined}
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}

        {/* More button (if overflow items exist) */}
        {hasOverflow && (
          <button
            type="button"
            onClick={handleMoreClick}
            className={cn(
              'flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground',
              (moreMenuOpen || isOverflowActive) && 'text-primary',
            )}
            aria-expanded={moreMenuOpen}
            aria-haspopup="menu"
            aria-label="More options"
          >
            {moreMenuOpen ? <X className="size-5" /> : <MoreHorizontal className="size-5" />}
            <span className="text-[10px] font-medium">More</span>
          </button>
        )}
      </nav>
    </>
  );
}
