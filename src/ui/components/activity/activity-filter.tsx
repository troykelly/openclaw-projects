import * as React from 'react';
import { Filter, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import type { ActivityFilter, ActorType, ActionType, EntityType } from './types';

const TIME_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'all', label: 'All time' },
] as const;

const ACTOR_TYPES = [
  { value: 'agent', label: 'Agents' },
  { value: 'human', label: 'Humans' },
] as const;

const ACTION_TYPES = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'completed', label: 'Completed' },
  { value: 'commented', label: 'Commented' },
  { value: 'status_changed', label: 'Status changed' },
] as const;

export interface ActivityFilterBarProps {
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
  className?: string;
}

export function ActivityFilterBar({
  filter,
  onFilterChange,
  className,
}: ActivityFilterBarProps) {
  const [showFilters, setShowFilters] = React.useState(false);

  const activeFilterCount = [
    filter.actorType,
    filter.actionType,
    filter.entityType,
    filter.timeRange && filter.timeRange !== 'all',
  ].filter(Boolean).length;

  const clearFilters = () => {
    onFilterChange({});
  };

  const toggleFilter = <K extends keyof ActivityFilter>(
    key: K,
    value: ActivityFilter[K]
  ) => {
    if (filter[key] === value) {
      const newFilter = { ...filter };
      delete newFilter[key];
      onFilterChange(newFilter);
    } else {
      onFilterChange({ ...filter, [key]: value });
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      {/* Filter toggle button */}
      <div className="flex items-center gap-2">
        <Button
          variant={showFilters ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <Filter className="size-4" />
          Filter
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-1 text-muted-foreground"
          >
            <X className="size-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Filter options */}
      {showFilters && (
        <div className="space-y-3 rounded-lg border bg-surface p-3">
          {/* Time range */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Time</p>
            <div className="flex flex-wrap gap-1">
              {TIME_RANGES.map(({ value, label }) => (
                <Badge
                  key={value}
                  variant={filter.timeRange === value ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFilter('timeRange', value)}
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Actor type */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Actor</p>
            <div className="flex flex-wrap gap-1">
              {ACTOR_TYPES.map(({ value, label }) => (
                <Badge
                  key={value}
                  variant={filter.actorType === value ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFilter('actorType', value as ActorType)}
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Action type */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Action</p>
            <div className="flex flex-wrap gap-1">
              {ACTION_TYPES.map(({ value, label }) => (
                <Badge
                  key={value}
                  variant={filter.actionType === value ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFilter('actionType', value as ActionType)}
                >
                  {label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
