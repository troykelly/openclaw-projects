/**
 * Session info sidebar (Epic #1667, #1694).
 *
 * Displays session metadata, tags, notes, and connection info.
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Server, Clock, Hash, FileText } from 'lucide-react';
import { SessionStatusBadge } from './session-status-badge';
import type { TerminalSession } from '@/ui/lib/api-types';

interface SessionInfoSidebarProps {
  session: TerminalSession;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString();
}

export function SessionInfoSidebar({ session }: SessionInfoSidebarProps): React.JSX.Element {
  return (
    <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-border p-4" data-testid="session-info-sidebar">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Session Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <SessionStatusBadge status={session.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-mono text-xs">{session.tmux_session_name}</span>
          </div>
          {session.connection && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Connection</span>
              <Link to={`/terminal/connections/${session.connection_id}`} className="flex items-center gap-1 text-primary hover:underline">
                <Server className="size-3" />
                {session.connection.name}
              </Link>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Clock className="size-3" /> Started</span>
            <span className="text-xs">{formatDate(session.started_at)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Clock className="size-3" /> Last Active</span>
            <span className="text-xs">{formatDate(session.last_activity_at)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1"><Hash className="size-3" /> Size</span>
            <span className="font-mono text-xs">{session.cols}x{session.rows}</span>
          </div>
        </CardContent>
      </Card>

      {session.tags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {session.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {session.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1"><FileText className="size-3" /> Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{session.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
