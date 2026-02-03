/**
 * My Tasks widget for dashboard
 * Issue #405: Implement custom dashboard builder
 */
import * as React from 'react';
import { CheckSquare } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { cn } from '@/ui/lib/utils';

export interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
}

export interface MyTasksWidgetProps {
  tasks: TaskItem[];
  onTaskClick: (taskId: string) => void;
  limit?: number;
  className?: string;
}

function getStatusVariant(status: string): 'default' | 'secondary' | 'outline' {
  switch (status.toLowerCase()) {
    case 'in_progress':
    case 'in progress':
      return 'default';
    case 'open':
    case 'todo':
      return 'secondary';
    default:
      return 'outline';
  }
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MyTasksWidget({
  tasks,
  onTaskClick,
  limit = 5,
  className,
}: MyTasksWidgetProps) {
  const displayTasks = tasks.slice(0, limit);
  const remaining = tasks.length - limit;

  if (tasks.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <CheckSquare className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No tasks assigned</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Header with count */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground uppercase font-medium">
          Assigned
        </span>
        <Badge variant="secondary" className="text-xs">
          {tasks.length}
        </Badge>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {displayTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onTaskClick(task.id)}
            className="w-full flex items-center gap-2 p-2 rounded hover:bg-muted text-left transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{task.title}</div>
            </div>
            <Badge variant={getStatusVariant(task.status)} className="text-xs shrink-0">
              {formatStatus(task.status)}
            </Badge>
          </button>
        ))}
      </div>

      {/* Show more */}
      {remaining > 0 && (
        <div className="pt-2 text-center">
          <span className="text-xs text-muted-foreground">
            +{remaining} more tasks
          </span>
        </div>
      )}
    </div>
  );
}
