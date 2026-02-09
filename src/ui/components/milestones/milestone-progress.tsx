/**
 * Progress bar component for milestones
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { MilestoneProgressProps } from './types';

export function MilestoneProgress({ progress, status = 'upcoming', isAtRisk = false, className }: MilestoneProgressProps) {
  const percentage = Math.round(progress * 100);

  // Determine color based on status and risk
  const getColorClass = () => {
    if (isAtRisk && status !== 'completed' && status !== 'missed') {
      return 'bg-yellow-500';
    }

    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'missed':
        return 'bg-red-500';
      case 'in-progress':
        return 'bg-blue-500';
      case 'upcoming':
      default:
        return 'bg-green-500';
    }
  };

  return (
    <div
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full rounded-full overflow-hidden', getColorClass(), 'bg-opacity-20', className)}
    >
      <div className={cn('h-full transition-all duration-300', getColorClass())} style={{ width: `${percentage}%` }} />
    </div>
  );
}
