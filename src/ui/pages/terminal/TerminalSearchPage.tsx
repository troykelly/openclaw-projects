/**
 * Terminal Search Page (Epic #1667, #1695).
 *
 * Cross-session semantic search with filters.
 */
import * as React from 'react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Search } from 'lucide-react';
import { TerminalSearchFilters } from '@/ui/components/terminal/terminal-search-filters';
import { SearchResultContext } from '@/ui/components/terminal/search-result-context';
import { useTerminalSearch } from '@/ui/hooks/queries/use-terminal-search';
import { useTerminalConnections } from '@/ui/hooks/queries/use-terminal-connections';

export function TerminalSearchPage(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [connectionId, setConnectionId] = useState('all');
  const [kind, setKind] = useState('all');

  const connectionsQuery = useTerminalConnections();
  const searchMutation = useTerminalSearch();

  const connections = Array.isArray(connectionsQuery.data?.connections) ? connectionsQuery.data.connections : [];
  const results = searchMutation.data?.results ?? [];

  const handleSearch = () => {
    if (!query.trim()) return;
    searchMutation.mutate({
      query,
      connection_id: connectionId !== 'all' ? connectionId : undefined,
      kind: kind !== 'all' ? kind : undefined,
    });
  };

  return (
    <div data-testid="page-terminal-search" className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Terminal Search</h1>
        <p className="text-sm text-muted-foreground">Search across terminal session history using semantic search</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <TerminalSearchFilters
            query={query}
            onQueryChange={setQuery}
            connectionId={connectionId}
            onConnectionIdChange={setConnectionId}
            kind={kind}
            onKindChange={setKind}
            connections={connections}
            onSearch={handleSearch}
            isPending={searchMutation.isPending}
          />
        </CardContent>
      </Card>

      {/* Results */}
      {searchMutation.isSuccess && (
        <div className="space-y-4">
          <CardHeader className="px-0">
            <CardTitle className="text-base">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>

          {results.length === 0 ? (
            <div className="py-8 text-center">
              <Search className="mx-auto size-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No matches found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((result) => (
                <SearchResultContext key={result.entry.id} result={result} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
