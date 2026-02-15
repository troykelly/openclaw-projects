/**
 * Displays a list of webhooks for a project with CRUD controls.
 */
import * as React from 'react';
import { CopyIcon, TrashIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Switch } from '@/ui/components/ui/switch';
import {
  useProjectWebhooks,
  useDeleteProjectWebhook,
  useUpdateProjectWebhook,
} from '@/ui/hooks/queries/use-project-webhooks';
import type { ProjectWebhook } from '@/ui/lib/api-types';
import { WebhookCreateDialog } from './webhook-create-dialog';

export interface WebhookListProps {
  projectId: string;
}

export function WebhookList({ projectId }: WebhookListProps) {
  const { data, isLoading } = useProjectWebhooks(projectId);
  const deleteMutation = useDeleteProjectWebhook(projectId);
  const updateMutation = useUpdateProjectWebhook(projectId);
  const [showCreate, setShowCreate] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const copyToClipboard = (webhook: ProjectWebhook) => {
    const curlCmd = `curl -X POST ${webhook.ingestion_url} -H "Authorization: Bearer ${webhook.token}" -H "Content-Type: application/json" -d '{"event":"test"}'`;
    navigator.clipboard.writeText(curlCmd);
    setCopiedId(webhook.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleActive = (webhook: ProjectWebhook) => {
    updateMutation.mutate({
      webhookId: webhook.id,
      body: { is_active: !webhook.is_active },
    });
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading webhooks...</div>;
  }

  const webhooks = data?.webhooks ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Webhooks</h3>
        <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
          <PlusIcon className="mr-1 h-3 w-3" />
          Add Webhook
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No webhooks configured. Create one to receive external events.
        </p>
      ) : (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="flex items-center justify-between rounded-md border p-3 text-sm"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{wh.label}</span>
                  <Badge variant={wh.is_active ? 'default' : 'secondary'}>
                    {wh.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {wh.last_received && (
                  <span className="text-xs text-muted-foreground">
                    Last received: {new Date(wh.last_received).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={wh.is_active}
                  onCheckedChange={() => toggleActive(wh)}
                  aria-label={`Toggle ${wh.label}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(wh)}
                  title="Copy curl command"
                >
                  <CopyIcon className="h-3 w-3" />
                  {copiedId === wh.id ? ' Copied' : ''}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(wh.id)}
                  title="Delete webhook"
                >
                  <TrashIcon className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <WebhookCreateDialog
        projectId={projectId}
        open={showCreate}
        onOpenChange={setShowCreate}
      />
    </div>
  );
}
