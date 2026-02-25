/**
 * Semantic search filter panel (Epic #1667, #1695).
 */
import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Search, Loader2 } from 'lucide-react';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface TerminalSearchFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  connectionId: string;
  onConnectionIdChange: (id: string) => void;
  kind: string;
  onKindChange: (kind: string) => void;
  connections: TerminalConnection[];
  onSearch: () => void;
  isPending?: boolean;
}

export function TerminalSearchFilters({
  query,
  onQueryChange,
  connectionId,
  onConnectionIdChange,
  kind,
  onKindChange,
  connections,
  onSearch,
  isPending,
}: TerminalSearchFiltersProps): React.JSX.Element {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="terminal-search-filters">
      <div className="space-y-2">
        <Label htmlFor="search-query">Search Query</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            id="search-query"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search terminal history..."
            className="pl-9"
            data-testid="search-query-input"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Connection</Label>
          <Select value={connectionId} onValueChange={onConnectionIdChange}>
            <SelectTrigger>
              <SelectValue placeholder="All connections" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All connections</SelectItem>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>{conn.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Entry Kind</Label>
          <Select value={kind} onValueChange={onKindChange}>
            <SelectTrigger>
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
      </div>

      <Button type="submit" disabled={!query.trim() || isPending}>
        {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
        Search
      </Button>
    </form>
  );
}
