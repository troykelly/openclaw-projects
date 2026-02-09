/**
 * Card component for displaying a milestone
 */
import * as React from 'react';
import { FlagIcon, CalendarIcon } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import { MilestoneProgress } from './milestone-progress';
import { formatMilestoneDate, isMilestoneAtRisk } from './utils';
import type { MilestoneCardProps, MilestoneStatus } from './types';
import { STATUS_LABELS } from './types';

const STATUS_VARIANT: Record<MilestoneStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  upcoming: 'secondary',
  'in-progress': 'default',
  completed: 'outline',
  missed: 'destructive',
};

export function MilestoneCard({ milestone, onClick, className }: MilestoneCardProps) {
  const percentage = Math.round(milestone.progress * 100);
  const isAtRisk = isMilestoneAtRisk(milestone.progress, milestone.targetDate);

  return (
    <button
      type="button"
      onClick={() => onClick?.(milestone)}
      className={cn('w-full text-left p-4 rounded-lg border bg-card transition-colors', onClick && 'hover:bg-muted/50 cursor-pointer', className)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <FlagIcon className="h-4 w-4 text-primary" />
          <h4 className="font-medium">{milestone.name}</h4>
        </div>
        <Badge variant={STATUS_VARIANT[milestone.status]}>{STATUS_LABELS[milestone.status]}</Badge>
      </div>

      {milestone.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{milestone.description}</p>}

      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <CalendarIcon className="h-4 w-4" />
        <span>{formatMilestoneDate(milestone.targetDate)}</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {milestone.completedItems} / {milestone.totalItems}
          </span>
          <span className="font-medium">{percentage}%</span>
        </div>
        <MilestoneProgress progress={milestone.progress} status={milestone.status} isAtRisk={isAtRisk} />
      </div>
    </button>
  );
}
