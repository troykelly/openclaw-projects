/**
 * Dev Sessions page.
 *
 * Displays a filterable list of development sessions with status and
 * project controls. Composes SessionList and related components.
 *
 * @see Issue #1611
 */
import React, { useState } from 'react';
import { Code, Plus } from 'lucide-react';
import { SessionList } from '@/ui/components/dev-sessions';
import { useCreateDevSession } from '@/ui/hooks/queries/use-dev-sessions';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';

const ALL_STATUSES = 'all';

const STATUS_OPTIONS = [
  { value: ALL_STATUSES, label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'completed', label: 'Completed' },
  { value: 'errored', label: 'Errored' },
] as const;

export function DevSessionsPage(): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div data-testid="page-dev-sessions" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Code className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Dev Sessions</h1>
            <p className="text-sm text-muted-foreground">Track coding sessions across agents and environments</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="create-session-button">
          <Plus className="mr-2 size-4" />
          New Session
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" data-testid="status-filter">
            <SelectValue placeholder="All statuses" />
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

      {/* Session list */}
      <Card className="flex-1">
        <CardContent className="p-6">
          <SessionList statusFilter={statusFilter === ALL_STATUSES ? undefined : statusFilter} />
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreateSessionDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateSessionDialog
// ---------------------------------------------------------------------------

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateSessionDialog({ open, onOpenChange }: CreateSessionDialogProps) {
  const createSession = useCreateDevSession();
  const [sessionName, setSessionName] = useState('');
  const [node, setNode] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionName.trim() || !node.trim()) return;

    createSession.mutate(
      { session_name: sessionName.trim(), node: node.trim() },
      {
        onSuccess: () => {
          setSessionName('');
          setNode('');
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="session-create-dialog">
        <DialogHeader>
          <DialogTitle>New Dev Session</DialogTitle>
          <DialogDescription>Start tracking a new development session.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="session-name">Session Name</Label>
            <Input
              id="session-name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. Fix auth bug"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="session-node">Node</Label>
            <Input
              id="session-node"
              value={node}
              onChange={(e) => setNode(e.target.value)}
              placeholder="e.g. claude-code-1"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSession.isPending}>
              Create Session
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
