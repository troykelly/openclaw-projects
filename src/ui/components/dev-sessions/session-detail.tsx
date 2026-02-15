/**
 * Detailed view of a single dev session.
 */
import { Badge } from '@/ui/components/ui/badge';
import { GitBranchIcon } from 'lucide-react';
import { useDevSession } from '@/ui/hooks/queries/use-dev-sessions';

export interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const { data: session, isLoading } = useDevSession(sessionId);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!session) {
    return <div className="text-sm text-muted-foreground">Session not found.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">{session.session_name}</h3>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant={session.status === 'active' ? 'default' : 'secondary'}>{session.status}</Badge>
          <span>{session.node}</span>
          {session.branch && (
            <span className="inline-flex items-center gap-0.5">
              <GitBranchIcon className="h-3 w-3" />
              {session.branch}
            </span>
          )}
        </div>
      </div>

      {session.task_summary && (
        <div>
          <h4 className="text-sm font-medium">Summary</h4>
          <p className="text-sm">{session.task_summary}</p>
        </div>
      )}

      {session.task_prompt && (
        <div>
          <h4 className="text-sm font-medium">Prompt</h4>
          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{session.task_prompt}</pre>
        </div>
      )}

      {session.last_capture && (
        <div>
          <h4 className="text-sm font-medium">
            Last Capture
            {session.last_capture_at && (
              <span className="ml-1 font-normal text-muted-foreground">
                ({new Date(session.last_capture_at).toLocaleString()})
              </span>
            )}
          </h4>
          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{session.last_capture}</pre>
        </div>
      )}

      {session.completion_summary && (
        <div>
          <h4 className="text-sm font-medium">Completion Summary</h4>
          <p className="text-sm">{session.completion_summary}</p>
        </div>
      )}

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Started: {new Date(session.started_at).toLocaleString()}</span>
        {session.completed_at && <span>Completed: {new Date(session.completed_at).toLocaleString()}</span>}
        {session.context_pct != null && <span>Context: {session.context_pct}%</span>}
      </div>

      {(session.linked_issues.length > 0 || session.linked_prs.length > 0) && (
        <div className="flex gap-4 text-xs">
          {session.linked_issues.length > 0 && (
            <div>
              <span className="text-muted-foreground">Issues: </span>
              {session.linked_issues.map((i) => (
                <Badge key={i} variant="outline" className="mr-1">#{i}</Badge>
              ))}
            </div>
          )}
          {session.linked_prs.length > 0 && (
            <div>
              <span className="text-muted-foreground">PRs: </span>
              {session.linked_prs.map((pr) => (
                <Badge key={pr} variant="outline" className="mr-1">#{pr}</Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
