/**
 * Terminal activity log filters (Epic #1667, #1696).
 */
import * as React from 'react';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Search } from 'lucide-react';

interface ActivityFiltersProps {
  actionFilter: string;
  onActionFilterChange: (action: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

export function ActivityFilters({ actionFilter, onActionFilterChange, searchQuery, onSearchQueryChange }: ActivityFiltersProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2" data-testid="activity-filters">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Filter activity..."
          className="pl-9"
        />
      </div>
      <Select value={actionFilter} onValueChange={onActionFilterChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actions</SelectItem>
          <SelectItem value="session.create">Session created</SelectItem>
          <SelectItem value="session.terminate">Session terminated</SelectItem>
          <SelectItem value="command.send">Command sent</SelectItem>
          <SelectItem value="tunnel.create">Tunnel created</SelectItem>
          <SelectItem value="tunnel.close">Tunnel closed</SelectItem>
          <SelectItem value="connection.create">Connection created</SelectItem>
          <SelectItem value="enrollment.register">Enrollment</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
