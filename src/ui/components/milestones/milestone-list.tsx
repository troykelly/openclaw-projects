/**
 * List component for displaying milestones
 */
import * as React from 'react';
import { PlusIcon, FlagIcon } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { MilestoneCard } from './milestone-card';
import type { MilestoneListProps } from './types';

export function MilestoneList({ milestones, filterStatus, onMilestoneClick, onCreateClick, className }: MilestoneListProps) {
  const filteredMilestones = React.useMemo(() => {
    if (!filterStatus) return milestones;
    return milestones.filter((m) => m.status === filterStatus);
  }, [milestones, filterStatus]);

  // Sort by target date
  const sortedMilestones = React.useMemo(() => {
    return [...filteredMilestones].sort((a, b) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime());
  }, [filteredMilestones]);

  return (
    <div className={cn('space-y-4', className)}>
      {onCreateClick && (
        <div className="flex justify-end">
          <Button onClick={onCreateClick} aria-label="Create milestone">
            <PlusIcon className="h-4 w-4 mr-2" />
            Create Milestone
          </Button>
        </div>
      )}

      {sortedMilestones.length === 0 ? (
        <div className="text-center py-12">
          <FlagIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-1">No milestones</h3>
          <p className="text-sm text-muted-foreground">
            {filterStatus ? `No ${filterStatus} milestones found` : 'Create your first milestone to track major deliverables'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedMilestones.map((milestone) => (
            <MilestoneCard key={milestone.id} milestone={milestone} onClick={onMilestoneClick} />
          ))}
        </div>
      )}
    </div>
  );
}
