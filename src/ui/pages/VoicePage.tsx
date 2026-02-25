/**
 * Voice & Speech management page.
 *
 * Displays voice routing configuration and conversation history.
 * Config can be edited inline. Conversations can be viewed or deleted.
 *
 * @see Issue #1754
 */
import React, { useState, useCallback } from 'react';
import { Mic, Trash2, Eye, Settings2 } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VoiceConfig {
  id: string;
  namespace: string;
  default_agent_id: string | null;
  timeout_ms: number;
  idle_timeout_s: number;
  retention_days: number;
  device_mapping: Record<string, string>;
  user_mapping: Record<string, string>;
  service_allowlist: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface VoiceConversation {
  id: string;
  namespace: string;
  agent_id: string | null;
  device_id: string | null;
  user_email: string | null;
  created_at: string;
  last_active_at: string;
  metadata: Record<string, unknown>;
}

interface VoiceMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface ConversationDetail extends VoiceConversation {
  messages: VoiceMessage[];
}

interface ConversationsResponse {
  data: VoiceConversation[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoicePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [configEditing, setConfigEditing] = useState(false);
  const [configForm, setConfigForm] = useState({
    timeout_ms: 5000,
    idle_timeout_s: 300,
    retention_days: 30,
    service_allowlist: '',
  });
  const [viewingConversation, setViewingConversation] = useState<string | null>(null);

  // Fetch voice config
  const configQuery = useQuery({
    queryKey: ['voice-config'],
    queryFn: () => apiClient.get<{ data: VoiceConfig | null }>('/api/voice/config'),
  });

  // Fetch conversations
  const conversationsQuery = useQuery({
    queryKey: ['voice-conversations'],
    queryFn: () => apiClient.get<ConversationsResponse>('/api/voice/conversations'),
  });

  // Fetch single conversation detail
  const conversationDetailQuery = useQuery({
    queryKey: ['voice-conversation', viewingConversation],
    queryFn: () =>
      apiClient.get<{ data: ConversationDetail }>(`/api/voice/conversations/${viewingConversation}`),
    enabled: viewingConversation !== null,
  });

  // Update config
  const configMutation = useMutation({
    mutationFn: (body: {
      timeout_ms: number;
      idle_timeout_s: number;
      retention_days: number;
      service_allowlist: string[];
    }) => apiClient.put<{ data: VoiceConfig }>('/api/voice/config', body),
    onSuccess: () => {
      setConfigEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['voice-config'] });
    },
  });

  // Delete conversation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/voice/conversations/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['voice-conversations'] });
    },
  });

  const handleEditConfig = useCallback(() => {
    const config = configQuery.data?.data;
    setConfigForm({
      timeout_ms: config?.timeout_ms ?? 5000,
      idle_timeout_s: config?.idle_timeout_s ?? 300,
      retention_days: config?.retention_days ?? 30,
      service_allowlist: config?.service_allowlist?.join(', ') ?? '',
    });
    setConfigEditing(true);
  }, [configQuery.data]);

  const handleSaveConfig = useCallback(() => {
    configMutation.mutate({
      timeout_ms: configForm.timeout_ms,
      idle_timeout_s: configForm.idle_timeout_s,
      retention_days: configForm.retention_days,
      service_allowlist: configForm.service_allowlist
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }, [configForm, configMutation]);

  const config = configQuery.data?.data ?? null;
  const conversations = Array.isArray(conversationsQuery.data?.data)
    ? conversationsQuery.data.data
    : [];
  const conversationDetail = conversationDetailQuery.data?.data ?? null;

  return (
    <div data-testid="page-voice" className="h-full flex flex-col p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Mic className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Voice & Speech</h1>
          <p className="text-sm text-muted-foreground">Voice configuration and conversation history</p>
        </div>
      </div>

      <div className="flex-1 grid gap-6 lg:grid-cols-2">
        {/* Configuration */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Configuration</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleEditConfig}>
              <Settings2 className="mr-1 size-4" />
              Edit
            </Button>
          </CardHeader>
          <CardContent>
            {configQuery.isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            {!configQuery.isLoading && !config && (
              <p className="text-sm text-muted-foreground">No configuration set. Click Edit to configure.</p>
            )}
            {config && (
              <div className="space-y-3">
                <ConfigRow label="Timeout" value={`${config.timeout_ms}ms`} />
                <ConfigRow label="Idle Timeout" value={`${config.idle_timeout_s}s`} />
                <ConfigRow label="Retention" value={`${config.retention_days} days`} />
                <ConfigRow
                  label="Default Agent"
                  value={config.default_agent_id ?? 'None'}
                />
                <div>
                  <span className="text-sm text-muted-foreground">Service Allowlist:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {config.service_allowlist.length === 0 && (
                      <span className="text-xs text-muted-foreground">Default domains</span>
                    )}
                    {config.service_allowlist.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversation History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Conversation History</CardTitle>
          </CardHeader>
          <CardContent>
            {conversationsQuery.isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}
            {!conversationsQuery.isLoading && conversations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No conversations yet.
              </p>
            )}
            <div className="space-y-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {conv.user_email ?? conv.device_id ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last active: {new Date(conv.last_active_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="View"
                      onClick={() => setViewingConversation(conv.id)}
                    >
                      <Eye className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => deleteMutation.mutate(conv.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Config Edit Dialog */}
      <Dialog open={configEditing} onOpenChange={setConfigEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Voice Configuration</DialogTitle>
            <DialogDescription>Update voice routing settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="voice-timeout">Timeout (ms)</Label>
              <Input
                id="voice-timeout"
                type="number"
                value={configForm.timeout_ms}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, timeout_ms: parseInt(e.target.value, 10) || 0 }))
                }
              />
            </div>
            <div>
              <Label htmlFor="voice-idle">Idle Timeout (s)</Label>
              <Input
                id="voice-idle"
                type="number"
                value={configForm.idle_timeout_s}
                onChange={(e) =>
                  setConfigForm((f) => ({
                    ...f,
                    idle_timeout_s: parseInt(e.target.value, 10) || 0,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="voice-retention">Retention (days)</Label>
              <Input
                id="voice-retention"
                type="number"
                value={configForm.retention_days}
                onChange={(e) =>
                  setConfigForm((f) => ({
                    ...f,
                    retention_days: parseInt(e.target.value, 10) || 0,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="voice-allowlist">Service Allowlist (comma-separated)</Label>
              <Input
                id="voice-allowlist"
                value={configForm.service_allowlist}
                onChange={(e) =>
                  setConfigForm((f) => ({ ...f, service_allowlist: e.target.value }))
                }
                placeholder="light, switch, cover"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigEditing(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveConfig} disabled={configMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversation Detail Dialog */}
      <Dialog
        open={viewingConversation !== null}
        onOpenChange={(open) => !open && setViewingConversation(null)}
      >
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conversation</DialogTitle>
            <DialogDescription>
              {conversationDetail
                ? `With ${conversationDetail.user_email ?? 'Unknown'} - ${new Date(conversationDetail.created_at).toLocaleString()}`
                : 'Loading...'}
            </DialogDescription>
          </DialogHeader>
          {conversationDetailQuery.isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {conversationDetail && (
            <div className="space-y-3 py-2">
              {conversationDetail.messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center">No messages.</p>
              )}
              {conversationDetail.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3 ${
                    msg.role === 'user'
                      ? 'bg-muted ml-8'
                      : 'bg-primary/10 mr-8'
                  }`}
                >
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {msg.role === 'user' ? 'You' : 'Assistant'}
                  </p>
                  <p className="text-sm text-foreground">{msg.text}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfigRow helper
// ---------------------------------------------------------------------------

function ConfigRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
