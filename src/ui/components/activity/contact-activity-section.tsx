/**
 * Section for contact activity timeline
 * Issue #396: Implement contact activity timeline
 */
import * as React from 'react';
import { Filter, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { ActivityTimeline } from './activity-timeline';
import { ActivityFilter } from './activity-filter';
import { ActivityStats } from './activity-stats';
import type { Activity, ActivityType, DateRange, ActivitySourceType } from './types';

export interface ContactActivitySectionProps {
  contactId: string;
  activities: Activity[];
  loading?: boolean;
  hasMore?: boolean;
  onActivityClick?: (activityId: string, sourceType: ActivitySourceType, sourceId: string) => void;
  onLoadMore?: () => void;
  className?: string;
}

export function ContactActivitySection({
  contactId,
  activities,
  loading = false,
  hasMore,
  onActivityClick,
  onLoadMore,
  className,
}: ContactActivitySectionProps) {
  const [showFilters, setShowFilters] = React.useState(false);
  const [selectedTypes, setSelectedTypes] = React.useState<ActivityType[]>([]);
  const [dateRange, setDateRange] = React.useState<DateRange | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');

  // Filter activities
  const filteredActivities = React.useMemo(() => {
    let result = activities;

    // Filter by type
    if (selectedTypes.length > 0) {
      result = result.filter((a) => selectedTypes.includes(a.type));
    }

    // Filter by date range
    if (dateRange) {
      result = result.filter((a) => {
        const date = new Date(a.timestamp);
        return date >= dateRange.start && date <= dateRange.end;
      });
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.description?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [activities, selectedTypes, dateRange, searchQuery]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Activity</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {activities.length}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3.5 w-3.5 mr-1" />
          Filter
        </Button>
      </div>

      {/* Stats */}
      <ActivityStats activities={activities} />

      {/* Filters */}
      {showFilters && (
        <ActivityFilter
          selectedTypes={selectedTypes}
          dateRange={dateRange}
          searchQuery={searchQuery}
          onTypeChange={setSelectedTypes}
          onDateRangeChange={setDateRange}
          onSearchChange={setSearchQuery}
          className="p-4 rounded-lg border bg-muted/30"
        />
      )}

      {/* Loading state */}
      {loading && activities.length === 0 && (
        <div data-testid="activity-loading" className="py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        </div>
      )}

      {/* Timeline */}
      {!loading || activities.length > 0 ? (
        <ActivityTimeline
          activities={filteredActivities}
          onActivityClick={onActivityClick}
          hasMore={hasMore}
          onLoadMore={onLoadMore}
          loading={loading}
        />
      ) : null}
    </div>
  );
}
