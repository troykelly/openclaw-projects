/**
 * Timeline view of identity version history with rollback support.
 */
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { RotateCcwIcon } from 'lucide-react';
import { useAgentIdentityHistory, useRollbackIdentity } from '@/ui/hooks/queries/use-agent-identity';

const TYPE_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  propose: 'Proposed',
  approve: 'Approved',
  reject: 'Rejected',
  rollback: 'Rolled back',
};

export interface IdentityHistoryProps {
  identityName: string;
}

export function IdentityHistory({ identityName }: IdentityHistoryProps) {
  const { data, isLoading } = useAgentIdentityHistory(identityName);
  const rollbackMutation = useRollbackIdentity();

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading history...</div>;
  }

  const history = data?.history ?? [];

  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No history available.</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Version History</h3>
      <div className="space-y-2">
        {history.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between rounded-md border p-2 text-xs">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{TYPE_LABELS[entry.change_type] ?? entry.change_type}</Badge>
                <span className="text-muted-foreground">v{entry.version}</span>
                {entry.field_changed && <span>field: {entry.field_changed}</span>}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {entry.changed_by} &middot; {new Date(entry.created_at).toLocaleString()}
              </div>
              {entry.change_reason && <p className="mt-0.5">{entry.change_reason}</p>}
            </div>
            {entry.change_type !== 'propose' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => rollbackMutation.mutate({ name: identityName, version: entry.version })}
                title={`Rollback to v${entry.version}`}
              >
                <RotateCcwIcon className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
