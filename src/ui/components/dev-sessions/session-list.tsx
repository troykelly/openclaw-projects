/**
 * List of dev sessions with status filtering.
 */
import * as React from 'react';
import {
  useDevSessions,
  useCompleteDevSession,
  useDeleteDevSession,
} from '@/ui/hooks/queries/use-dev-sessions';
import { SessionCard } from './session-card';

export interface SessionListProps {
  project_id?: string;
  statusFilter?: string;
  orchestratedFilter?: string;
}

export function SessionList({ project_id, statusFilter, orchestratedFilter }: SessionListProps) {
  const { data, isLoading } = useDevSessions({
    project_id,
    status: statusFilter,
  });
  const completeMutation = useCompleteDevSession();
  const deleteMutation = useDeleteDevSession();

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading sessions...</div>;
  }

  let sessions = Array.isArray(data?.sessions) ? data.sessions : [];

  // Client-side orchestrated filter
  if (orchestratedFilter === 'true') {
    sessions = sessions.filter((s) => s.orchestrated);
  } else if (orchestratedFilter === 'false') {
    sessions = sessions.filter((s) => !s.orchestrated);
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">No dev sessions found.</p>;
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          onComplete={(id) => completeMutation.mutate({ id })}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      ))}
    </div>
  );
}
