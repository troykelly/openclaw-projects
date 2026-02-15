/**
 * Displays a feed of events for a project (webhook ingestions, etc.).
 */
import { Badge } from '@/ui/components/ui/badge';
import { useProjectEvents } from '@/ui/hooks/queries/use-project-webhooks';
import type { ProjectEvent } from '@/ui/lib/api-types';

export interface ProjectEventListProps {
  projectId: string;
  limit?: number;
}

function EventCard({ event }: { event: ProjectEvent }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{event.event_type}</Badge>
          {event.summary && <span className="text-muted-foreground">{event.summary}</span>}
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(event.created_at).toLocaleString()}
        </span>
      </div>
      {event.raw_payload && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(event.raw_payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ProjectEventList({ projectId, limit = 20 }: ProjectEventListProps) {
  const { data, isLoading } = useProjectEvents(projectId, { limit });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading events...</div>;
  }

  const events = data?.events ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Recent Events</h3>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}
