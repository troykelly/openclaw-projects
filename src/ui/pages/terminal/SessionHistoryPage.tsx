/**
 * Session History Page (Epic #1667, #1695).
 */
import * as React from 'react';
import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router';
import { Button } from '@/ui/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { EntryTimeline } from '@/ui/components/terminal/entry-timeline';
import { EntrySearch } from '@/ui/components/terminal/entry-search';
import { useTerminalSession, useTerminalEntries } from '@/ui/hooks/queries/use-terminal-sessions';

export function SessionHistoryPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const sessionQuery = useTerminalSession(id ?? '');
  const entriesQuery = useTerminalEntries(id ?? '', { kind: kind !== 'all' ? kind : undefined });

  const session = sessionQuery.data;
  const allEntries = Array.isArray(entriesQuery.data?.entries) ? entriesQuery.data.entries : [];

  const filteredEntries = useMemo(() => {
    if (!query) return allEntries;
    const lower = query.toLowerCase();
    return allEntries.filter((e) => e.content.toLowerCase().includes(lower));
  }, [allEntries, query]);

  if (sessionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div data-testid="page-session-history" className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/terminal/sessions/${id}`}><ArrowLeft className="mr-1 size-4" /> Back to Session</Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Session History</h1>
        <p className="text-sm text-muted-foreground">
          {session?.tmux_session_name ?? 'Session'} - {filteredEntries.length} entries
        </p>
      </div>

      <EntrySearch query={query} onQueryChange={setQuery} kind={kind} onKindChange={setKind} />

      {entriesQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <EntryTimeline entries={filteredEntries} />
      )}
    </div>
  );
}
