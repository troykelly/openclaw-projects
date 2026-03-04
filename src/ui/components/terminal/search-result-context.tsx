/**
 * Search result with surrounding context (Epic #1667, #1695).
 *
 * Updated for #2098 to match backend flat item shape with { before, after } context.
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/ui/components/ui/card';
import { ArrowRight } from 'lucide-react';
import type { TerminalSearchItem } from '@/ui/lib/api-types';

interface SearchResultContextProps {
  result: TerminalSearchItem;
}

export function SearchResultContext({ result }: SearchResultContextProps): React.JSX.Element {
  return (
    <Card data-testid="search-result">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{result.kind}</Badge>
          <span className="text-xs text-muted-foreground">
            Score: {(result.similarity * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(result.captured_at).toLocaleString()}
          </span>
        </div>
        <Link
          to={`/terminal/sessions/${result.session_id}/history`}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View session <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Context before */}
        {result.context.before.map((c, i) => (
          <pre key={`before-${i}`} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap px-2 py-0.5">
            {c.content}
          </pre>
        ))}
        {/* Matched entry */}
        <pre className="text-xs font-mono whitespace-pre-wrap bg-primary/5 border-l-2 border-primary px-2 py-1 rounded">
          {result.content}
        </pre>
        {/* Context after */}
        {result.context.after.map((c, i) => (
          <pre key={`after-${i}`} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap px-2 py-0.5">
            {c.content}
          </pre>
        ))}
      </CardContent>
    </Card>
  );
}
