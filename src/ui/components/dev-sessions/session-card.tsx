/**
 * Card displaying a dev session's key info and status.
 */
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { CheckIcon, TrashIcon, GitBranchIcon } from 'lucide-react';
import type { DevSession } from '@/ui/lib/api-types';

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  stalled: 'secondary',
  completed: 'outline',
  errored: 'destructive',
};

export interface SessionCardProps {
  session: DevSession;
  onComplete?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function SessionCard({ session, onComplete, onDelete }: SessionCardProps) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{session.session_name}</span>
          <Badge variant={STATUS_VARIANTS[session.status] ?? 'secondary'}>
            {session.status}
          </Badge>
          {session.context_pct != null && (
            <span className={`text-xs ${session.context_pct < 10 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
              {session.context_pct}% ctx
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {session.status === 'active' && onComplete && (
            <Button variant="ghost" size="sm" onClick={() => onComplete(session.id)} title="Mark complete">
              <CheckIcon className="h-3 w-3" />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(session.id)} title="Delete">
              <TrashIcon className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-1 text-xs text-muted-foreground">
        <span>{session.node}</span>
        {session.repo_org && session.repo_name && (
          <span className="ml-2">{session.repo_org}/{session.repo_name}</span>
        )}
        {session.branch && (
          <span className="ml-2 inline-flex items-center gap-0.5">
            <GitBranchIcon className="h-3 w-3" />
            {session.branch}
          </span>
        )}
      </div>

      {session.task_summary && (
        <p className="mt-1 text-xs">{session.task_summary}</p>
      )}

      {session.linked_issues.length > 0 && (
        <div className="mt-1 flex gap-1">
          {session.linked_issues.map((issue) => (
            <Badge key={issue} variant="outline" className="text-xs">#{issue}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
