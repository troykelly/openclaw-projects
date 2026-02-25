/**
 * Session Detail Page with xterm.js (Epic #1667, #1694).
 */
import * as React from 'react';
import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { Button } from '@/ui/components/ui/button';
import { ArrowLeft, History, Loader2 } from 'lucide-react';
import { TerminalEmulator } from '@/ui/components/terminal/terminal-emulator';
import { TerminalToolbar } from '@/ui/components/terminal/terminal-toolbar';
import { SessionInfoSidebar } from '@/ui/components/terminal/session-info-sidebar';
import { SessionStatusOverlay } from '@/ui/components/terminal/session-status-overlay';
import { useTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';
import type { TerminalWsStatus } from '@/ui/hooks/use-terminal-websocket';

export function SessionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [wsStatus, setWsStatus] = useState<TerminalWsStatus>('disconnected');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  const sessionQuery = useTerminalSession(id ?? '');
  const session = sessionQuery.data;

  const handleStatusChange = useCallback((status: TerminalWsStatus) => {
    setWsStatus(status);
  }, []);

  if (sessionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const isTerminated = session.status === 'terminated' || session.status === 'error';

  return (
    <div data-testid="page-session-detail" className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'h-[calc(100vh-4rem)]'}`}>
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/terminal"><ArrowLeft className="mr-1 size-4" /> Terminal</Link>
        </Button>
        <span className="text-sm font-medium">{session.tmux_session_name}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/terminal/sessions/${session.id}/history`}>
            <History className="mr-1 size-4" /> History
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowSidebar(!showSidebar)}>
          {showSidebar ? 'Hide Info' : 'Show Info'}
        </Button>
      </div>

      {/* Toolbar */}
      <TerminalToolbar
        windows={session.windows}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
      />

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Terminal */}
        <div className="relative flex-1 min-w-0">
          {!isTerminated && (
            <TerminalEmulator
              sessionId={session.id}
              onStatusChange={handleStatusChange}
            />
          )}
          <SessionStatusOverlay status={isTerminated ? 'terminated' : wsStatus} />
        </div>

        {/* Sidebar */}
        {showSidebar && <SessionInfoSidebar session={session} />}
      </div>
    </div>
  );
}
