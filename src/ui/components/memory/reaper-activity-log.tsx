/**
 * Reaper activity log — table of reap events.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import * as React from 'react';
import { useState, useMemo } from 'react';
import { Skull } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';

/** A single reaper event entry. */
export interface ReaperEvent {
  id: string;
  timestamp: string;
  namespace: string;
  count: number;
  dry_run: boolean;
  soft_delete: boolean;
}

export interface ReaperActivityLogProps {
  events: ReaperEvent[];
  className?: string;
  pageSize?: number;
}

export function ReaperActivityLog({ events, className, pageSize = 10 }: ReaperActivityLogProps) {
  const [page, setPage] = useState(0);
  const [nsFilter, setNsFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!nsFilter) return events;
    return events.filter((e) => e.namespace === nsFilter);
  }, [events, nsFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const namespaces = useMemo(() => [...new Set(events.map((e) => e.namespace))], [events]);

  if (events.length === 0) {
    return (
      <div role="log" aria-label="Reaper activity" className={cn('py-12 text-center', className)}>
        <Skull className="mx-auto size-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">No reaper activity</p>
      </div>
    );
  }

  return (
    <div role="log" aria-label="Reaper activity" className={cn('space-y-4', className)}>
      {/* Namespace filter */}
      {namespaces.length > 1 && (
        <div className="flex gap-2">
          <Button
            variant={nsFilter === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setNsFilter(null); setPage(0); }}
          >
            All
          </Button>
          {namespaces.map((ns) => (
            <Button
              key={ns}
              variant={nsFilter === ns ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setNsFilter(ns); setPage(0); }}
            >
              {ns}
            </Button>
          ))}
        </div>
      )}

      {/* Event table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" aria-label="Reaper events">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-2 text-left font-medium">Timestamp</th>
              <th className="px-4 py-2 text-left font-medium">Namespace</th>
              <th className="px-4 py-2 text-right font-medium">Count</th>
              <th className="px-4 py-2 text-left font-medium">Mode</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((event) => (
              <tr key={event.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">{new Date(event.timestamp).toLocaleString()}</td>
                <td className="px-4 py-2">{event.namespace}</td>
                <td className="px-4 py-2 text-right">{event.count}</td>
                <td className="px-4 py-2">
                  {event.dry_run ? (
                    <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      Dry run
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
                      Live
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{event.soft_delete ? 'Soft delete' : 'Hard delete'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
