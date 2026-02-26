/**
 * Sessions List Page (Epic #1667, Issue #1864).
 *
 * Lists all terminal sessions with status filtering, search, and
 * terminate actions. Linked from the dashboard "View all sessions" button.
 */
import * as React from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { ArrowLeft, Search, StopCircle, Loader2 } from 'lucide-react';
import { SessionCard } from '@/ui/components/terminal/session-card';
import { SessionStatusBadge } from '@/ui/components/terminal/session-status-badge';
import { useTerminalSessions, useTerminateTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
  { value: 'starting', label: 'Starting' },
  { value: 'disconnected', label: 'Disconnected' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'error', label: 'Error' },
  { value: 'pending_host_verification', label: 'Pending Verification' },
] as const;

export function SessionsListPage(): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filters = statusFilter !== 'all' ? { status: statusFilter } : undefined;
  const sessionsQuery = useTerminalSessions(filters);
  const terminateSession = useTerminateTerminalSession();

  const allSessions = Array.isArray(sessionsQuery.data?.sessions) ? sessionsQuery.data.sessions : [];

  // Client-side search filtering by session name or connection name
  const sessions = searchQuery.trim()
    ? allSessions.filter(
        (s) =>
          s.tmux_session_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.connection?.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : allSessions;

  return (
    <div data-testid="page-sessions-list" className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/terminal">
              <ArrowLeft className="mr-1 size-4" /> Terminal
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Sessions</h1>
            <p className="text-sm text-muted-foreground">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="sessions-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" data-testid="status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Session List */}
      {sessionsQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {searchQuery || statusFilter !== 'all'
              ? 'No sessions match your filters.'
              : 'No sessions yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center gap-2">
              <div className="flex-1">
                <SessionCard session={session} />
              </div>
              {session.status === 'active' || session.status === 'idle' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 shrink-0"
                  onClick={() => terminateSession.mutate(session.id)}
                  disabled={terminateSession.isPending}
                  title="Terminate session"
                  data-testid="terminate-session-btn"
                >
                  <StopCircle className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
