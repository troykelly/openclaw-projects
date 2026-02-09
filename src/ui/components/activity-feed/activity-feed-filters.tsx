/**
 * Comprehensive filter controls for activity feed
 * Issue #403: Implement activity feed filtering and personalization
 */
import * as React from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { cn } from '@/ui/lib/utils';
import {
  ACTOR_TYPES,
  ACTION_TYPES,
  ENTITY_TYPES,
  TIME_RANGES,
  countActiveFilters,
  type ActivityFilters,
  type ActorType,
  type ActionType,
  type EntityType,
  type TimeRange,
} from './types';

export interface ActivityFeedFiltersProps {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
  currentUserId?: string;
  className?: string;
}

export function ActivityFeedFilters({ filters, onChange, currentUserId, className }: ActivityFeedFiltersProps) {
  const activeCount = countActiveFilters(filters);

  const handleActorChange = (actorType: ActorType) => {
    onChange({ ...filters, actorType });
  };

  const handleActionToggle = (action: ActionType) => {
    const current = filters.actionType || [];
    const newActions = current.includes(action) ? current.filter((a) => a !== action) : [...current, action];
    onChange({ ...filters, actionType: newActions.length > 0 ? newActions : undefined });
  };

  const handleEntityToggle = (entity: EntityType) => {
    const current = filters.entityType || [];
    const newEntities = current.includes(entity) ? current.filter((e) => e !== entity) : [...current, entity];
    onChange({ ...filters, entityType: newEntities.length > 0 ? newEntities : undefined });
  };

  const handleTimeChange = (timeRange: TimeRange) => {
    onChange({ ...filters, timeRange });
  };

  const handleMyActivityToggle = () => {
    onChange({ ...filters, myActivityOnly: !filters.myActivityOnly });
  };

  const handleClear = () => {
    onChange({});
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* Actor Type Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Actor
            {filters.actorType && filters.actorType !== 'all' && (
              <Badge variant="secondary" className="ml-1.5 px-1">
                1
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2">
          <div className="space-y-1">
            {ACTOR_TYPES.map((type) => (
              <button
                key={type.value}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-sm',
                  filters.actorType === type.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
                onClick={() => handleActorChange(type.value)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Action Type Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Action
            {filters.actionType && filters.actionType.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 px-1">
                {filters.actionType.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2">
          <div className="space-y-2">
            {ACTION_TYPES.map((type) => (
              <label key={type.value} className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={filters.actionType?.includes(type.value) || false} onCheckedChange={() => handleActionToggle(type.value)} />
                <span className="text-sm">{type.label}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Entity Type Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Entity
            {filters.entityType && filters.entityType.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 px-1">
                {filters.entityType.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2">
          <div className="space-y-2">
            {ENTITY_TYPES.map((type) => (
              <label key={type.value} className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={filters.entityType?.includes(type.value) || false} onCheckedChange={() => handleEntityToggle(type.value)} />
                <span className="text-sm">{type.label}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Time Range Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            Time
            {filters.timeRange && (
              <Badge variant="secondary" className="ml-1.5 px-1">
                1
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-2">
          <div className="space-y-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-sm',
                  filters.timeRange === range.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
                onClick={() => handleTimeChange(range.value)}
              >
                {range.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* My Activity Toggle */}
      {currentUserId && (
        <Button variant={filters.myActivityOnly ? 'secondary' : 'outline'} size="sm" onClick={handleMyActivityToggle}>
          My Activity
        </Button>
      )}

      {/* Active Filter Count & Clear */}
      {activeCount > 0 && (
        <>
          <Badge variant="default" className="h-6">
            {activeCount}
          </Badge>
          <Button variant="ghost" size="sm" onClick={handleClear} aria-label="Clear filters">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </>
      )}
    </div>
  );
}
