/**
 * Card showing team member workload summary
 * Issue #392: Implement resource allocation and workload view
 */
import * as React from 'react';
import { User } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';
import { calculateUtilization, formatHours, getUtilizationStatus, type TeamMember } from './workload-utils';

export interface TeamMemberCardProps {
  member: TeamMember;
  assignedHours: number;
  assignments: Array<{ id: string; title: string; hours: number }>;
  onAssignmentClick?: (assignmentId: string) => void;
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function MemberAvatar({ name, avatar }: { name: string; avatar?: string }) {
  const initials = getInitials(name);

  if (avatar) {
    return <img src={avatar} alt={name} className="h-10 w-10 rounded-full object-cover" />;
  }

  return (
    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
      <span className="text-sm font-medium text-muted-foreground">{initials}</span>
    </div>
  );
}

export function TeamMemberCard({ member, assignedHours, assignments, onAssignmentClick, className }: TeamMemberCardProps) {
  const utilization = calculateUtilization(assignedHours, member.hoursPerWeek);
  const utilizationStatus = getUtilizationStatus(utilization);
  const availableHours = Math.max(0, member.hoursPerWeek - assignedHours);
  const isOverallocated = utilization > 100;

  return (
    <div className={cn('rounded-lg border p-4 transition-colors', isOverallocated && 'border-destructive/50 bg-destructive/5', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <MemberAvatar name={member.name} avatar={member.avatar} />

        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{member.name}</div>
          <div className="text-sm text-muted-foreground">{formatHours(member.hoursPerWeek)} capacity</div>
        </div>

        <div className="text-right">
          <div
            className={cn(
              'text-lg font-semibold',
              utilizationStatus === 'high' && 'text-destructive',
              utilizationStatus === 'medium' && 'text-amber-600 dark:text-amber-400',
              utilizationStatus === 'low' && 'text-green-600 dark:text-green-400',
            )}
          >
            {Math.round(utilization)}%
          </div>
          <div className="text-sm text-muted-foreground">{formatHours(assignedHours)} assigned</div>
        </div>
      </div>

      {/* Capacity bar */}
      <div className="mb-4">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all rounded-full',
              utilizationStatus === 'high' && 'bg-destructive',
              utilizationStatus === 'medium' && 'bg-amber-500',
              utilizationStatus === 'low' && 'bg-green-500',
            )}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
        {!isOverallocated && availableHours > 0 && <div className="text-xs text-muted-foreground mt-1">{formatHours(availableHours)} available</div>}
        {isOverallocated && <div className="text-xs text-destructive mt-1">{formatHours(assignedHours - member.hoursPerWeek)} over capacity</div>}
      </div>

      {/* Assignments */}
      {assignments.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assignments</div>
          {assignments.map((assignment) => (
            <button
              key={assignment.id}
              className={cn(
                'w-full flex items-center justify-between p-2 rounded-md text-sm',
                'hover:bg-muted/50 transition-colors text-left',
                onAssignmentClick && 'cursor-pointer',
              )}
              onClick={() => onAssignmentClick?.(assignment.id)}
            >
              <span className="truncate">{assignment.title}</span>
              <Badge variant="secondary" className="shrink-0 ml-2">
                {formatHours(assignment.hours)}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {assignments.length === 0 && <div className="text-sm text-muted-foreground text-center py-2">No assignments</div>}
    </div>
  );
}
