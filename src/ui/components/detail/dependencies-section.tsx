import * as React from 'react';
import { ArrowLeft, ArrowRight, Folder, Target, Layers, FileText, Plus } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import type { WorkItemDependency, WorkItemKind, WorkItemStatus } from './types';

function getKindIcon(kind: WorkItemKind) {
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

function getStatusVariant(status: WorkItemStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'in_progress':
      return 'default';
    case 'done':
      return 'secondary';
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

function getStatusLabel(status: WorkItemStatus): string {
  return status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DependenciesSectionProps {
  dependencies: WorkItemDependency[];
  onDependencyClick?: (dependency: WorkItemDependency) => void;
  onAddDependency?: (direction: 'blocks' | 'blocked_by') => void;
  className?: string;
}

export function DependenciesSection({ dependencies, onDependencyClick, onAddDependency, className }: DependenciesSectionProps) {
  const blockedBy = dependencies.filter((d) => d.direction === 'blocked_by');
  const blocks = dependencies.filter((d) => d.direction === 'blocks');

  const renderDependency = (dep: WorkItemDependency) => (
    <button
      key={dep.id}
      data-testid="dependency-item"
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', 'hover:bg-muted/50', onDependencyClick && 'cursor-pointer')}
      onClick={() => onDependencyClick?.(dep)}
    >
      <span className="text-muted-foreground">{getKindIcon(dep.kind)}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{dep.title}</span>
      <Badge variant={getStatusVariant(dep.status)} className="shrink-0 text-xs">
        {getStatusLabel(dep.status)}
      </Badge>
    </button>
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* Blocked by */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ArrowLeft className="size-4" />
            Blocked by ({blockedBy.length})
          </h4>
          {onAddDependency && (
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onAddDependency('blocked_by')}>
              <Plus className="size-3" />
              <span className="sr-only">Add blocker</span>
            </Button>
          )}
        </div>
        {blockedBy.length > 0 ? (
          <div className="space-y-1">{blockedBy.map(renderDependency)}</div>
        ) : (
          <p className="py-2 text-center text-xs text-muted-foreground">No blockers</p>
        )}
      </div>

      {/* Blocks */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ArrowRight className="size-4" />
            Blocks ({blocks.length})
          </h4>
          {onAddDependency && (
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onAddDependency('blocks')}>
              <Plus className="size-3" />
              <span className="sr-only">Add dependent</span>
            </Button>
          )}
        </div>
        {blocks.length > 0 ? (
          <div className="space-y-1">{blocks.map(renderDependency)}</div>
        ) : (
          <p className="py-2 text-center text-xs text-muted-foreground">No dependents</p>
        )}
      </div>
    </div>
  );
}
