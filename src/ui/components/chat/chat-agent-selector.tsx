/**
 * Agent selector dropdown for chat (Epic #1940, Issue #1950).
 *
 * Dropdown of available agents. Default agent pre-selected.
 * Shows AgentStatusBadge per agent (Issue #2160).
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import { useRealtimeOptional } from '@/ui/components/realtime/realtime-context';
import { useQueryClient } from '@tanstack/react-query';
import { chatKeys } from '@/ui/hooks/queries/use-chat';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import { AgentStatusBadge } from './agent-status-badge';
import type { AgentStatus } from './agent-status-badge';

interface ChatAgentSelectorProps {
  value?: string;
  onChange: (agentId: string) => void;
  className?: string;
}

export function ChatAgentSelector({ value, onChange, className }: ChatAgentSelectorProps): React.JSX.Element | null {
  const { data } = useAvailableAgents();
  const realtime = useRealtimeOptional();
  const queryClient = useQueryClient();

  // Subscribe to agent status changes from RealtimeHub
  React.useEffect(() => {
    if (!realtime) return;
    const cleanup = realtime.addEventHandler('agent:status_changed', () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.agents() });
    });
    return cleanup;
  }, [realtime, queryClient]);

  const agents = React.useMemo(
    () => (Array.isArray(data?.agents) ? data.agents : []),
    [data?.agents],
  );

  if (agents.length <= 1) return null;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn('h-7 w-auto gap-1 text-xs', className)}
        aria-label="Select agent"
        data-testid="chat-agent-selector"
      >
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            <span className="inline-flex items-center gap-1.5">
              {agent.display_name ?? agent.name}
              <AgentStatusBadge status={(agent.status ?? 'unknown') as AgentStatus} />
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
