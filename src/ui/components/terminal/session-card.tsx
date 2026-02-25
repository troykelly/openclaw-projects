/**
 * Session card for dashboard list (Epic #1667, #1691).
 */
import * as React from 'react';
import { Link } from 'react-router';
import { ArrowRight, Clock } from 'lucide-react';
import { Badge } from '@/ui/components/ui/badge';
import { SessionStatusBadge } from './session-status-badge';
import type { TerminalSession } from '@/ui/lib/api-types';

interface SessionCardProps {
  session: TerminalSession;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function SessionCard({ session }: SessionCardProps): React.JSX.Element {
  return (
    <Link
      to={`/terminal/sessions/${session.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50"
      data-testid="session-card"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {session.tmux_session_name}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <SessionStatusBadge status={session.status} />
          {session.connection && (
            <span className="text-xs text-muted-foreground">
              {session.connection.name}
            </span>
          )}
          {session.tags.length > 0 && session.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {session.last_activity_at && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="size-3" />
            {formatRelativeTime(session.last_activity_at)}
          </span>
        )}
        <ArrowRight className="size-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
