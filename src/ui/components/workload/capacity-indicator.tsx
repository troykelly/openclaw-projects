/**
 * Capacity utilization indicator
 * Issue #392: Implement resource allocation and workload view
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { calculateUtilization, formatHours, getUtilizationStatus } from './workload-utils';

export interface CapacityIndicatorProps {
  assignedHours: number;
  capacityHours: number;
  showDetails?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CapacityIndicator({ assignedHours, capacityHours, showDetails = false, size = 'md', className }: CapacityIndicatorProps) {
  const utilization = calculateUtilization(assignedHours, capacityHours);
  const status = getUtilizationStatus(utilization);
  const utilizationDisplay = Math.round(utilization);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  const statusColors = {
    low: 'text-green-600 dark:text-green-400',
    medium: 'text-amber-600 dark:text-amber-400',
    high: 'text-destructive',
  };

  const statusBgColors = {
    low: 'bg-green-100 dark:bg-green-950',
    medium: 'bg-amber-100 dark:bg-amber-950',
    high: 'bg-destructive/10',
  };

  return (
    <div
      data-testid="capacity-indicator"
      data-status={status}
      className={cn('inline-flex items-center gap-2 rounded-md px-2 py-1', statusBgColors[status], className)}
    >
      {/* Percentage */}
      <span className={cn('font-semibold', sizeClasses[size], statusColors[status])}>{utilizationDisplay}%</span>

      {/* Details */}
      {showDetails && (
        <span className="text-muted-foreground text-sm">
          {formatHours(assignedHours)} / {formatHours(capacityHours)}
        </span>
      )}
    </div>
  );
}
