/**
 * Component for reviewing pending identity change proposals from agents.
 */
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { CheckIcon, XIcon } from 'lucide-react';
import {
  useAgentIdentityHistory,
  useApproveProposal,
  useRejectProposal,
} from '@/ui/hooks/queries/use-agent-identity';
import type { AgentIdentityHistoryEntry } from '@/ui/lib/api-types';

export interface ProposalReviewProps {
  identityName: string;
}

function ProposalCard({
  entry,
  onApprove,
  onReject,
}: {
  entry: AgentIdentityHistoryEntry;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Proposal</Badge>
          <span className="font-medium">{entry.field_changed}</span>
          <span className="text-xs text-muted-foreground">by {entry.changed_by}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onApprove(entry.id)} title="Approve">
            <CheckIcon className="h-3 w-3 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onReject(entry.id)} title="Reject">
            <XIcon className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </div>
      {entry.change_reason && (
        <p className="mt-1 text-xs text-muted-foreground">Reason: {entry.change_reason}</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        {entry.previous_value && (
          <div>
            <span className="text-muted-foreground">Previous:</span>
            <p className="mt-0.5 rounded bg-muted p-1">{entry.previous_value}</p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Proposed:</span>
          <p className="mt-0.5 rounded bg-muted p-1">{entry.new_value}</p>
        </div>
      </div>
    </div>
  );
}

export function ProposalReview({ identityName }: ProposalReviewProps) {
  const { data } = useAgentIdentityHistory(identityName);
  const approveMutation = useApproveProposal();
  const rejectMutation = useRejectProposal();

  const proposals = (data?.history ?? []).filter((e) => e.change_type === 'propose');

  if (proposals.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending proposals.</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Pending Proposals</h3>
      {proposals.map((entry) => (
        <ProposalCard
          key={entry.id}
          entry={entry}
          onApprove={(id) => approveMutation.mutate(id)}
          onReject={(id) => rejectMutation.mutate({ proposalId: id })}
        />
      ))}
    </div>
  );
}
