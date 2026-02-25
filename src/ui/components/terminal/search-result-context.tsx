/**
 * Search result with surrounding context (Epic #1667, #1695).
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/ui/components/ui/card';
import { ArrowRight } from 'lucide-react';
import type { TerminalSearchResult } from '@/ui/lib/api-types';

interface SearchResultContextProps {
  result: TerminalSearchResult;
}

export function SearchResultContext({ result }: SearchResultContextProps): React.JSX.Element {
  const { entry, score, context } = result;

  return (
    <Card data-testid="search-result">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{entry.kind}</Badge>
          <span className="text-xs text-muted-foreground">
            Score: {(score * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(entry.captured_at).toLocaleString()}
          </span>
        </div>
        <Link
          to={`/terminal/sessions/${entry.session_id}/history`}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View session <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Context before */}
        {context.filter((c) => c.sequence < entry.sequence).map((c) => (
          <pre key={c.id} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap px-2 py-0.5">
            {c.content}
          </pre>
        ))}
        {/* Matched entry */}
        <pre className="text-xs font-mono whitespace-pre-wrap bg-primary/5 border-l-2 border-primary px-2 py-1 rounded">
          {entry.content}
        </pre>
        {/* Context after */}
        {context.filter((c) => c.sequence > entry.sequence).map((c) => (
          <pre key={c.id} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap px-2 py-0.5">
            {c.content}
          </pre>
        ))}
      </CardContent>
    </Card>
  );
}
