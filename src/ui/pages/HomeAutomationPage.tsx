/**
 * Home Automation page.
 *
 * Displays detected routines and anomalies from the Home Assistant integration.
 * Routines can be confirmed, rejected, or edited. Anomalies can be resolved.
 *
 * @see Issue #1752
 */
import React, { useState, useCallback } from 'react';
import { Home, CheckCircle, XCircle, AlertTriangle, Pencil } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Routine {
  id: string;
  title: string;
  description: string | null;
  status: string;
  confidence: number;
  sequence: Array<{ entity_id: string; domain?: string; service?: string }>;
  created_at: string;
  updated_at: string;
}

interface RoutineListResponse {
  data: Routine[];
  total: number;
  limit: number;
  offset: number;
}

interface Anomaly {
  id: string;
  entity_id: string;
  description: string;
  score: number;
  resolved: boolean;
  context: Record<string, unknown>;
  timestamp: string;
}

interface AnomalyListResponse {
  data: Anomaly[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Status badge variant mapping
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  confirmed: 'default',
  tentative: 'secondary',
  rejected: 'destructive',
  archived: 'outline',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeAutomationPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  // Fetch routines
  const routinesQuery = useQuery({
    queryKey: ['ha-routines', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      return apiClient.get<RoutineListResponse>(`/api/ha/routines${qs ? `?${qs}` : ''}`);
    },
  });

  // Fetch anomalies (unresolved)
  const anomaliesQuery = useQuery({
    queryKey: ['ha-anomalies'],
    queryFn: () => apiClient.get<AnomalyListResponse>('/api/ha/anomalies?resolved=false'),
  });

  // Confirm routine
  const confirmMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ data: Routine }>(`/api/ha/routines/${id}/confirm`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ha-routines'] });
    },
  });

  // Reject routine
  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ data: Routine }>(`/api/ha/routines/${id}/reject`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ha-routines'] });
    },
  });

  // Edit routine
  const editMutation = useMutation({
    mutationFn: ({ id, title, description }: { id: string; title: string; description: string }) =>
      apiClient.patch<{ data: Routine }>(`/api/ha/routines/${id}`, { title, description }),
    onSuccess: () => {
      setEditingRoutine(null);
      void queryClient.invalidateQueries({ queryKey: ['ha-routines'] });
    },
  });

  // Delete (archive) routine
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/ha/routines/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ha-routines'] });
    },
  });

  // Resolve anomaly
  const resolveAnomalyMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/api/ha/anomalies/${id}`, { resolved: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ha-anomalies'] });
    },
  });

  const handleEdit = useCallback((routine: Routine) => {
    setEditingRoutine(routine);
    setEditTitle(routine.title);
    setEditDescription(routine.description ?? '');
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingRoutine) return;
    editMutation.mutate({
      id: editingRoutine.id,
      title: editTitle,
      description: editDescription,
    });
  }, [editingRoutine, editTitle, editDescription, editMutation]);

  const routines = Array.isArray(routinesQuery.data?.data) ? routinesQuery.data.data : [];
  const anomalies = Array.isArray(anomaliesQuery.data?.data) ? anomaliesQuery.data.data : [];

  return (
    <div data-testid="page-home-automation" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Home className="size-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Home Automation</h1>
            <p className="text-sm text-muted-foreground">Detected routines and anomalies</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'tentative', 'confirmed', 'rejected'] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === (s === 'all' ? undefined : s) ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s === 'all' ? undefined : s)}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Content grid */}
      <div className="flex-1 grid gap-6 lg:grid-cols-[1fr_350px]">
        {/* Routines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Routines</CardTitle>
          </CardHeader>
          <CardContent>
            {routinesQuery.isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            {!routinesQuery.isLoading && routines.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No routines detected yet.
              </p>
            )}
            <div className="space-y-3">
              {routines.map((routine) => (
                <div
                  key={routine.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-foreground truncate">
                        {routine.title}
                      </span>
                      <Badge variant={STATUS_VARIANT[routine.status] ?? 'secondary'}>
                        {routine.status}
                      </Badge>
                    </div>
                    {routine.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {routine.description}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Confidence: {Math.round(routine.confidence * 100)}%</span>
                      <span>{routine.sequence.length} step(s)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {routine.status === 'tentative' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Confirm"
                          onClick={() => confirmMutation.mutate(routine.id)}
                          disabled={confirmMutation.isPending}
                        >
                          <CheckCircle className="size-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reject"
                          onClick={() => rejectMutation.mutate(routine.id)}
                          disabled={rejectMutation.isPending}
                        >
                          <XCircle className="size-4 text-red-600" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Edit"
                      onClick={() => handleEdit(routine)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Anomalies sidebar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Anomalies
            </CardTitle>
          </CardHeader>
          <CardContent>
            {anomaliesQuery.isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            {!anomaliesQuery.isLoading && anomalies.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No unresolved anomalies.
              </p>
            )}
            <div className="space-y-3">
              {anomalies.map((anomaly) => (
                <div
                  key={anomaly.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {anomaly.entity_id}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {anomaly.description}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        Score: {anomaly.score}/10
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resolveAnomalyMutation.mutate(anomaly.id)}
                      disabled={resolveAnomalyMutation.isPending}
                    >
                      Resolve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editingRoutine !== null} onOpenChange={(open) => !open && setEditingRoutine(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Routine</DialogTitle>
            <DialogDescription>Update the title or description of this routine.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRoutine(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={editMutation.isPending || !editTitle.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
