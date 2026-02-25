/**
 * Terminal Activity Page (Epic #1667, #1696).
 */
import * as React from 'react';
import { useState, useMemo } from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Activity, Loader2 } from 'lucide-react';
import { ActivityFilters } from '@/ui/components/terminal/activity-filters';
import { useTerminalActivity } from '@/ui/hooks/queries/use-terminal-activity';

export function TerminalActivityPage(): React.JSX.Element {
  const [actionFilter, setActionFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const activityQuery = useTerminalActivity({
    action: actionFilter !== 'all' ? actionFilter : undefined,
    limit: 100,
  });

  const items = Array.isArray(activityQuery.data?.items) ? activityQuery.data.items : [];

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const lower = searchQuery.toLowerCase();
    return items.filter((item) =>
      item.action.toLowerCase().includes(lower) ||
      item.actor.toLowerCase().includes(lower) ||
      JSON.stringify(item.detail ?? {}).toLowerCase().includes(lower),
    );
  }, [items, searchQuery]);

  return (
    <div data-testid="page-terminal-activity" className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Terminal Activity</h1>
        <p className="text-sm text-muted-foreground">Audit log of terminal actions</p>
      </div>

      <ActivityFilters
        actionFilter={actionFilter}
        onActionFilterChange={setActionFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />

      {activityQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-12 text-center">
          <Activity className="mx-auto size-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">No activity to display.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filteredItems.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3" data-testid="activity-row">
                  <div className="size-2 rounded-full bg-primary mt-2 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{item.action}</Badge>
                      <span className="text-xs text-muted-foreground">{item.actor}</span>
                    </div>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {JSON.stringify(item.detail)}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
