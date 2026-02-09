import * as React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/ui/lib/utils';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  showHome?: boolean;
  onHomeClick?: () => void;
  className?: string;
}

export function Breadcrumb({ items, showHome = true, onHomeClick, className }: BreadcrumbProps) {
  return (
    <nav data-testid="breadcrumb" aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-sm', className)}>
      <ol className="flex items-center gap-1">
        {showHome && (
          <li className="flex items-center">
            <button
              type="button"
              onClick={onHomeClick}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Home"
            >
              <Home className="size-4" />
            </button>
            {items.length > 0 && <ChevronRight className="mx-1 size-4 text-muted-foreground" aria-hidden="true" />}
          </li>
        )}
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} className="flex items-center">
              {isLast ? (
                <span className="font-medium text-foreground" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <>
                  <button type="button" onClick={item.onClick} className="text-muted-foreground hover:text-foreground transition-colors">
                    {item.label}
                  </button>
                  <ChevronRight className="mx-1 size-4 text-muted-foreground" aria-hidden="true" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
