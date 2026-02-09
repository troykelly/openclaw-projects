/**
 * Collapsible group header component
 */
import * as React from 'react';
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import type { GroupHeaderProps } from './types';

export function GroupHeader({ label, count, isExpanded, onToggle, className }: GroupHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-2 text-sm font-medium',
        'hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
        'rounded-md transition-colors',
        className,
      )}
    >
      {isExpanded ? <ChevronDownIcon className="h-4 w-4 text-muted-foreground" /> : <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />}
      <span className="flex-1 text-left">{label}</span>
      <Badge variant="secondary" className="text-xs">
        {count}
      </Badge>
    </button>
  );
}
