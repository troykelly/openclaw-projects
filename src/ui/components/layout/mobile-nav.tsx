import * as React from 'react';
import { useState } from 'react';
import { Bell, Folder, Users, Brain, MessageSquare, ChefHat, UtensilsCrossed, Code, Home, Warehouse, Mic, Terminal, Package, MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { PrefetchLink } from '@/ui/components/navigation/PrefetchLink';

/** Navigation item definition used by MobileNav. */
export interface MobileNavItem {
  /** Unique identifier for the nav item. */
  id: string;
  /** Display label. */
  label: string;
  /** Lucide icon component. */
  icon: React.ComponentType<{ className?: string }>;
  /** Route path relative to the router basename. */
  to: string;
}

/**
 * Primary nav items shown in the main mobile nav bar (4 items + More).
 * Matches RouterSidebar navigation items for consistency.
 */
const primaryNavItems: MobileNavItem[] = [
  { id: 'activity', label: 'Activity', icon: Bell, to: '/activity' },
  { id: 'projects', label: 'Projects', icon: Folder, to: '/work-items' },
  { id: 'people', label: 'People', icon: Users, to: '/contacts' },
  { id: 'memory', label: 'Memory', icon: Brain, to: '/memory' },
];

/**
 * Overflow items shown in the expandable "More" menu.
 * Includes all remaining nav items from RouterSidebar.
 */
const overflowNavItems: MobileNavItem[] = [
  { id: 'communications', label: 'Communications', icon: MessageSquare, to: '/communications' },
  { id: 'recipes', label: 'Recipes', icon: ChefHat, to: '/recipes' },
  { id: 'meal-log', label: 'Meal Log', icon: UtensilsCrossed, to: '/meal-log' },
  { id: 'home-automation', label: 'Home Automation', icon: Home, to: '/home-automation' },
  { id: 'pantry', label: 'Pantry', icon: Warehouse, to: '/pantry' },
  { id: 'voice', label: 'Voice', icon: Mic, to: '/voice' },
  { id: 'terminal', label: 'Terminal', icon: Terminal, to: '/terminal' },
  { id: 'dev-sessions', label: 'Dev Sessions', icon: Code, to: '/dev-sessions' },
  { id: 'skill-store', label: 'Skill Store', icon: Package, to: '/skill-store' },
];

/** Combined items for backwards compatibility */
const defaultNavItems: MobileNavItem[] = [...primaryNavItems, ...overflowNavItems];

export interface MobileNavProps {
  items?: MobileNavItem[];
  className?: string;
}

export function MobileNav({ items = defaultNavItems, className }: MobileNavProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Split items into primary (first 4) and overflow (rest)
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const hasOverflow = overflow.length > 0;

  const handleMoreClick = () => {
    setMoreMenuOpen(!moreMenuOpen);
  };

  return (
    <>
      {/* Overflow menu backdrop */}
      {moreMenuOpen && <div className="fixed inset-0 z-40 bg-black/20 md:hidden" onClick={() => setMoreMenuOpen(false)} aria-hidden="true" />}

      {/* Overflow menu panel */}
      {moreMenuOpen && hasOverflow && (
        <div
          data-testid="mobile-nav-overflow"
          className={cn('fixed inset-x-0 bottom-16 z-50 border-t border-border bg-surface p-2', 'flex flex-wrap gap-2 justify-center md:hidden')}
          role="menu"
          aria-label="More navigation options"
        >
          {overflow.map((item) => {
            const Icon = item.icon;

            return (
              <PrefetchLink
                key={item.id}
                to={item.to}
                prefetchPath={item.to}
                role="menuitem"
                onClick={() => setMoreMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    isActive && 'bg-primary/10 text-primary',
                  )
                }
              >
                <Icon className="size-4" />
                <span className="font-medium">{item.label}</span>
              </PrefetchLink>
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

          return (
            <PrefetchLink
              key={item.id}
              to={item.to}
              prefetchPath={item.to}
              end={item.to === '/activity'}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground',
                  isActive && 'text-primary',
                )
              }
            >
              <Icon className="size-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </PrefetchLink>
          );
        })}

        {/* More button (if overflow items exist) */}
        {hasOverflow && (
          <button
            type="button"
            onClick={handleMoreClick}
            className={cn(
              'flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors hover:text-foreground',
              moreMenuOpen && 'text-primary',
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
