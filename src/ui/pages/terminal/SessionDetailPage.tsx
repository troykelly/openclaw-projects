/**
 * Session Detail Page with xterm.js (Epic #1667, #1694).
 *
 * Toolbar callbacks wired per Issue #1865:
 *   - Annotate: opens dialog, calls useAnnotateTerminalSession
 *   - Search: navigates to terminal search with session filter
 *   - Split: opens direction dialog, calls SplitPane API (#2110)
 *
 * Host-key dialog wired per Issue #1866:
 *   - Shows HostKeyDialog when session status is pending_host_verification
 *
 * Window/pane sync via Refresh button (#2113).
 * Session recovery state exposed to frontend (#2127).
 */

import { ArrowLeft, History, Loader2 } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useAnnotateTerminalSession, useSplitTerminalPane, useTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';
import type { TerminalWsEvent, TerminalWsStatus } from '@/ui/hooks/use-terminal-websocket';

/** Structured host key info received from a terminal event (Issue #2100). */
interface HostKeyEventInfo {
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  public_key: string;
}

export function SessionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [wsStatus, setWsStatus] = useState<TerminalWsStatus>('disconnected');
  const [wsCloseReason, setWsCloseReason] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [annotateText, setAnnotateText] = useState('');
  const [activeWindowId, setActiveWindowId] = useState<string | undefined>(undefined);
  const [hostKeyInfo, setHostKeyInfo] = useState<HostKeyEventInfo | null>(null);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);

  // Track previous session status to detect recovery (#2127)
  const prevSessionStatusRef = useRef<string | undefined>(undefined);
  const [showRecovery, setShowRecovery] = useState(false);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);

  const sessionQuery = useTerminalSession(id ?? '');
  const session = sessionQuery.data;
  const healthQuery = useTerminalHealth();
  const workerAvailable = healthQuery.data?.status === 'ok';
  const annotateSession = useAnnotateTerminalSession();
  const splitPane = useSplitTerminalPane();
  const approveHostKey = useApproveTerminalKnownHost();
  const rejectHostKey = useRejectTerminalKnownHost();

  // Detect session recovery: status went from disconnected -> active (#2127)
  useEffect(() => {
    if (!session) return;
    const prevStatus = prevSessionStatusRef.current;
    if (prevStatus === 'disconnected' && session.status === 'active') {
      setShowRecovery(true);
      recoveryTimerRef.current = setTimeout(() => setShowRecovery(false), 5000);
    }
    prevSessionStatusRef.current = session.status;
    return () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [session?.status]); // eslint-disable-line react-hooks/exhaustive-deps -- only react to status changes

  const handleStatusChange = useCallback((status: TerminalWsStatus, closeReason?: string) => {
    setWsStatus(status);
    if (closeReason !== undefined) {
      setWsCloseReason(closeReason);
    }
  }, []);

  // Refetch session data on server status events so the UI reacts in
  // real time (e.g., host_key verification dialog appears) (#2088).
  // Only refetch for status_change events to avoid request amplification.
  // Also capture structured host key info from events (#2100).
  const handleEvent = useCallback(
    (event: TerminalWsEvent) => {
      if (event.type === 'status_change') {
        void sessionQuery.refetch();
      }
      // Capture host key info from the event if present (#2100)
      if (event.host_key && typeof event.host_key === 'object') {
        const hk = event.host_key as Record<string, unknown>;
        const port = Number(hk.port);
        setHostKeyInfo({
          host: String(hk.host ?? ''),
          port: Number.isFinite(port) && port > 0 ? port : 22,
          key_type: String(hk.key_type ?? ''),
          fingerprint: String(hk.fingerprint ?? ''),
          public_key: String(hk.public_key ?? ''),
        });
      }
    },
    [sessionQuery],
  );

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

  // #2110: Open split direction dialog
  const handleSplit = useCallback(() => {
    setSplitDialogOpen(true);
  }, []);

  // #2110: Execute split pane with chosen direction
  const handleSplitConfirm = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!session) return;
      const currentWindowId = activeWindowId ?? session.windows?.[0]?.id;
      const currentWindow = session.windows?.find((w) => w.id === currentWindowId);
      if (!currentWindow) return;

      setSplitError(null);
      splitPane.mutate(
        {
          sessionId: session.id,
          windowIndex: currentWindow.window_index,
          direction,
        },
        {
          onSuccess: () => {
            setSplitDialogOpen(false);
            void sessionQuery.refetch();
          },
          onError: (err) => {
            setSplitError(err instanceof Error ? err.message : 'Failed to split pane');
          },
        },
      );
    },
    [session, activeWindowId, splitPane, sessionQuery],
  );

  // #2113: Refresh windows/panes by refetching session data
  const handleRefreshWindows = useCallback(() => {
    void sessionQuery.refetch();
  }, [sessionQuery]);

  const handleApproveHostKey = useCallback(() => {
    if (!session) return;
    // Use structured host key info from event if available (#2100),
    // otherwise fall back to connection/session data.
    approveHostKey.mutate(
      {
        session_id: session.id,
        host: hostKeyInfo?.host || session.connection?.host || '',
        port: hostKeyInfo?.port || session.connection?.port || 22,
        key_type: hostKeyInfo?.key_type || '',
        fingerprint: hostKeyInfo?.fingerprint || '',
        public_key: hostKeyInfo?.public_key || '',
      },
      { onSuccess: () => void sessionQuery.refetch() },
    );
  }, [session, hostKeyInfo, approveHostKey, sessionQuery]);

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

  // #2127: Determine overlay status — show recovery transiently
  const overlayStatus: TerminalWsStatus = showRecovery
    ? 'recovering'
    : isTerminated
      ? 'terminated'
      : wsStatus;

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

      {/* Toolbar (#2109: window tab selection, #2113: refresh windows) */}
      <TerminalToolbar
        windows={session.windows}
        activeWindowId={activeWindowId ?? session.windows?.[0]?.id}
        onWindowSelect={setActiveWindowId}
        isFullscreen={isFullscreen}
        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
        onAnnotate={handleAnnotate}
        onSearch={handleSearch}
        onSplit={handleSplit}
        onRefreshWindows={handleRefreshWindows}
      />

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Terminal */}
        <div className="relative flex-1 min-w-0">
          {!isTerminated && !isPendingHostVerification && (
            <TerminalEmulator
              sessionId={session.id}
              activeWindowId={activeWindowId}
              onStatusChange={handleStatusChange}
              onEvent={handleEvent}
            />
          )}
          <SessionStatusOverlay
            status={overlayStatus}
            closeReason={wsCloseReason}
            isFatal={wsStatus === 'error' && wsCloseReason != null}
          />
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

      {/* Split Pane Direction Dialog (#2110) */}
      <Dialog open={splitDialogOpen} onOpenChange={setSplitDialogOpen}>
        <DialogContent data-testid="split-pane-dialog">
          <DialogHeader>
            <DialogTitle>Split Direction</DialogTitle>
            <DialogDescription>Choose how to split the current pane.</DialogDescription>
          </DialogHeader>
          {splitError && (
            <p className="text-sm text-red-500 text-center" role="alert">{splitError}</p>
          )}
          <div className="flex gap-3 justify-center py-4">
            <Button
              variant="outline"
              onClick={() => handleSplitConfirm('horizontal')}
              disabled={splitPane.isPending}
              aria-label="Horizontal"
            >
              {splitPane.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Horizontal
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSplitConfirm('vertical')}
              disabled={splitPane.isPending}
              aria-label="Vertical"
            >
              {splitPane.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Vertical
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSplitDialogOpen(false)}>
              Cancel
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
          host={hostKeyInfo?.host || session.connection?.host || 'unknown'}
          port={hostKeyInfo?.port || session.connection?.port || 22}
          keyType={hostKeyInfo?.key_type || ''}
          fingerprint={hostKeyInfo?.fingerprint || 'Unknown'}
          onApprove={handleApproveHostKey}
          onReject={handleRejectHostKey}
          isPending={approveHostKey.isPending || rejectHostKey.isPending}
        />
      )}
    </div>
  );
}
