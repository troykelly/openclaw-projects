/**
 * Filter panel for activity timeline
 * Issue #396: Implement contact activity timeline
 */
import * as React from 'react';
import { X, Search } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { cn } from '@/ui/lib/utils';
import type { ActivityType, DateRange } from './types';
import { FILTER_CATEGORIES } from './activity-utils';

export interface ActivityFilterProps {
  selectedTypes: ActivityType[];
  dateRange: DateRange | null;
  searchQuery: string;
  onTypeChange: (types: ActivityType[]) => void;
  onDateRangeChange: (range: DateRange | null) => void;
  onSearchChange: (query: string) => void;
  className?: string;
}

export function ActivityFilter({
  selectedTypes,
  dateRange,
  searchQuery,
  onTypeChange,
  onDateRangeChange,
  onSearchChange,
  className,
}: ActivityFilterProps) {
  const hasFilters = selectedTypes.length > 0 || dateRange !== null || searchQuery !== '';

  const toggleType = (types: ActivityType[]) => {
    const allSelected = types.every((t) => selectedTypes.includes(t));

    if (allSelected) {
      // Remove all types in this category
      onTypeChange(selectedTypes.filter((t) => !types.includes(t)));
    } else {
      // Add all types in this category
      const newTypes = [...selectedTypes];
      for (const type of types) {
        if (!newTypes.includes(type)) {
          newTypes.push(type);
        }
      }
      onTypeChange(newTypes);
    }
  };

  const clearFilters = () => {
    onTypeChange([]);
    onDateRangeChange(null);
    onSearchChange('');
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search activities..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Activity type filter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Activity Type</span>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={clearFilters}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTER_CATEGORIES.map((category) => {
            const isSelected = category.types.every((t) => selectedTypes.includes(t));
            return (
              <button
                key={category.label}
                type="button"
                data-selected={isSelected}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                )}
                onClick={() => toggleType(category.types)}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date range filter */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">Date Range</span>
        <div className="flex gap-1.5">
          {[
            { label: 'All Time', value: null },
            { label: 'Today', value: 'today' },
            { label: 'This Week', value: 'week' },
            { label: 'This Month', value: 'month' },
          ].map((option) => {
            const isSelected = option.value === null
              ? dateRange === null
              : dateRange !== null;

            return (
              <button
                key={option.label}
                type="button"
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full transition-colors',
                  isSelected && option.value === null
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                )}
                onClick={() => {
                  if (option.value === null) {
                    onDateRangeChange(null);
                  } else {
                    const now = new Date();
                    const start = new Date();

                    if (option.value === 'today') {
                      start.setHours(0, 0, 0, 0);
                    } else if (option.value === 'week') {
                      start.setDate(start.getDate() - 7);
                    } else if (option.value === 'month') {
                      start.setMonth(start.getMonth() - 1);
                    }

                    onDateRangeChange({ start, end: now });
                  }
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
