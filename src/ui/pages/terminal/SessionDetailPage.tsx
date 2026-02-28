/**
 * Session Detail Page with xterm.js (Epic #1667, #1694).
 *
 * Toolbar callbacks wired per Issue #1865:
 *   - Annotate: opens dialog, calls useAnnotateTerminalSession
 *   - Search: navigates to terminal search with session filter
 *   - Split: placeholder (requires SplitPane RPC from #1851)
 *
 * Host-key dialog wired per Issue #1866:
 *   - Shows HostKeyDialog when session status is pending_host_verification
 */

import { ArrowLeft, History, Loader2 } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorBanner } from '@/ui/components/feedback/error-state';
import { HostKeyDialog } from '@/ui/components/terminal/host-key-dialog';
import { SessionInfoSidebar } from '@/ui/components/terminal/session-info-sidebar';
import { SessionStatusOverlay } from '@/ui/components/terminal/session-status-overlay';
import { TerminalEmulator } from '@/ui/components/terminal/terminal-emulator';
import { TerminalToolbar } from '@/ui/components/terminal/terminal-toolbar';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Textarea } from '@/ui/components/ui/textarea';
import { useTerminalHealth } from '@/ui/hooks/queries/use-terminal-health';
import { useApproveTerminalKnownHost, useRejectTerminalKnownHost } from '@/ui/hooks/queries/use-terminal-known-hosts';
import { useAnnotateTerminalSession, useTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';
import type { TerminalWsStatus } from '@/ui/hooks/use-terminal-websocket';

export function SessionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [wsStatus, setWsStatus] = useState<TerminalWsStatus>('disconnected');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [annotateText, setAnnotateText] = useState('');

  const sessionQuery = useTerminalSession(id ?? '');
  const session = sessionQuery.data;
  const healthQuery = useTerminalHealth();
  const workerAvailable = healthQuery.data?.status === 'ok';
  const annotateSession = useAnnotateTerminalSession();
  const approveHostKey = useApproveTerminalKnownHost();
  const rejectHostKey = useRejectTerminalKnownHost();

  const handleStatusChange = useCallback((status: TerminalWsStatus) => {
    setWsStatus(status);
  }, []);

  const handleAnnotate = useCallback(() => {
    setAnnotateOpen(true);
  }, []);

  const handleAnnotateSubmit = useCallback(() => {
    if (!annotateText.trim() || !session) return;
    annotateSession.mutate(
      { sessionId: session.id, content: annotateText.trim() },
      {
        onSuccess: () => {
          setAnnotateText('');
          setAnnotateOpen(false);
        },
      },
    );
  }, [annotateText, session, annotateSession]);

  const handleSearch = useCallback(() => {
    if (!session) return;
    void navigate(`/terminal/search?session_id=${session.id}`);
  }, [session, navigate]);

  const handleSplit = useCallback(() => {
    // Split pane requires SplitPane RPC from Issue #1851 — pending dependency
    // For now this is a no-op until the gRPC RPC is available
  }, []);

  const handleApproveHostKey = useCallback(() => {
    if (!session) return;
    approveHostKey.mutate(
      {
        session_id: session.id,
        host: session.connection?.host ?? '',
        port: session.connection?.port ?? 22,
        key_type: session.error_message?.includes('ssh-rsa') ? 'ssh-rsa' : 'ssh-ed25519',
        fingerprint: session.error_message ?? '',
        public_key: '',
      },
      { onSuccess: () => void sessionQuery.refetch() },
    );
  }, [session, approveHostKey, sessionQuery]);

  const handleRejectHostKey = useCallback(() => {
    if (!session) return;
    rejectHostKey.mutate({ session_id: session.id }, { onSuccess: () => void sessionQuery.refetch() });
  }, [session, rejectHostKey, sessionQuery]);

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
  const isPendingHostVerification = session.status === 'pending_host_verification';

  return (
    <div data-testid="page-session-detail" className={`flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'h-[calc(100vh-4rem)]'}`}>
      {/* Header bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/terminal">
            <ArrowLeft className="mr-1 size-4" /> Terminal
          </Link>
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

      {!workerAvailable && !healthQuery.isLoading && (
        <ErrorBanner message="Terminal worker is not available. Session features may be limited." onRetry={() => healthQuery.refetch()} />
      )}

      {/* Toolbar */}
      <TerminalToolbar
        windows={session.windows}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
        onAnnotate={handleAnnotate}
        onSearch={handleSearch}
        onSplit={handleSplit}
      />

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Terminal */}
        <div className="relative flex-1 min-w-0">
          {!isTerminated && !isPendingHostVerification && <TerminalEmulator sessionId={session.id} onStatusChange={handleStatusChange} />}
          <SessionStatusOverlay status={isTerminated ? 'terminated' : wsStatus} />
        </div>

        {/* Sidebar */}
        {showSidebar && <SessionInfoSidebar session={session} />}
      </div>

      {/* Annotation Dialog (#1865) */}
      <Dialog open={annotateOpen} onOpenChange={setAnnotateOpen}>
        <DialogContent data-testid="annotation-dialog">
          <DialogHeader>
            <DialogTitle>Add Annotation</DialogTitle>
            <DialogDescription>Add a note to this session. Annotations are saved as session entries.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Type your annotation..."
            value={annotateText}
            onChange={(e) => setAnnotateText(e.target.value)}
            rows={4}
            data-testid="annotation-input"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnotateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAnnotateSubmit} disabled={!annotateText.trim() || annotateSession.isPending}>
              {annotateSession.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Host Key Verification Dialog (#1866) */}
      {isPendingHostVerification && (
        <HostKeyDialog
          open={isPendingHostVerification}
          onOpenChange={() => {
            /* controlled by session status */
          }}
          host={session.connection?.host ?? 'unknown'}
          port={session.connection?.port ?? 22}
          keyType={session.error_message?.includes('ssh-rsa') ? 'ssh-rsa' : 'ssh-ed25519'}
          fingerprint={session.error_message ?? 'Unknown'}
          onApprove={handleApproveHostKey}
          onReject={handleRejectHostKey}
          isPending={approveHostKey.isPending || rejectHostKey.isPending}
        />
      )}
    </div>
  );
}
