/**
 * Client-side entry filter bar (Epic #1667, #1695).
 */
import * as React from 'react';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Search } from 'lucide-react';

interface EntrySearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  kind: string;
  onKindChange: (kind: string) => void;
}

export function EntrySearch({ query, onQueryChange, kind, onKindChange }: EntrySearchProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2" data-testid="entry-search">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter entries..."
          className="pl-9"
          data-testid="entry-search-input"
        />
      </div>
      <Select value={kind} onValueChange={onKindChange}>
        <SelectTrigger className="w-[140px]" data-testid="entry-kind-filter">
          <SelectValue placeholder="All kinds" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All kinds</SelectItem>
          <SelectItem value="command">Commands</SelectItem>
          <SelectItem value="output">Output</SelectItem>
          <SelectItem value="annotation">Annotations</SelectItem>
          <SelectItem value="error">Errors</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
