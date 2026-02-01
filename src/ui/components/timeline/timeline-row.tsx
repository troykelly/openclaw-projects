import * as React from 'react';
import { ChevronRight, Folder, Target, Layers, FileText } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { TimelineItem, TimelineItemKind } from './types';

function getKindIcon(kind: TimelineItemKind) {
  switch (kind) {
    case 'project':
      return <Folder className="size-4" />;
    case 'initiative':
      return <Target className="size-4" />;
    case 'epic':
      return <Layers className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
  }
}

export interface TimelineRowLabelProps {
  item: TimelineItem;
  depth: number;
  isExpanded?: boolean;
  hasChildren?: boolean;
  onToggle?: (id: string) => void;
  onClick?: (item: TimelineItem) => void;
  className?: string;
}

export function TimelineRowLabel({
  item,
  depth,
  isExpanded,
  hasChildren,
  onToggle,
  onClick,
  className,
}: TimelineRowLabelProps) {
  return (
    <div
      data-testid="timeline-row-label"
      className={cn(
        'flex h-8 items-center border-b bg-background',
        'hover:bg-muted/50',
        className
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {/* Expand toggle */}
      {hasChildren ? (
        <button
          className="mr-1 shrink-0"
          onClick={() => onToggle?.(item.id)}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              isExpanded && 'rotate-90'
            )}
          />
        </button>
      ) : (
        <span className="mr-1 w-4" />
      )}

      {/* Kind icon */}
      <span className="mr-2 shrink-0 text-muted-foreground">
        {getKindIcon(item.kind)}
      </span>

      {/* Title */}
      <button
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
        onClick={() => onClick?.(item)}
      >
        {item.title}
      </button>
    </div>
  );
}

export interface TimelineRowProps {
  item: TimelineItem;
  totalWidth: number;
  className?: string;
  children?: React.ReactNode;
}

export function TimelineRow({
  item,
  totalWidth,
  className,
  children,
}: TimelineRowProps) {
  return (
    <div
      data-testid="timeline-row"
      className={cn(
        'relative h-8 border-b',
        className
      )}
      style={{ width: `${totalWidth}px` }}
    >
      {children}
    </div>
  );
}
