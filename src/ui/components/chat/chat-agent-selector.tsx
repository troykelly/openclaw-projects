/**
 * Agent selector dropdown for chat (Epic #1940, Issue #1950).
 *
 * Dropdown of available agents. Default agent pre-selected.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { useAvailableAgents } from '@/ui/hooks/queries/use-chat';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';

interface ChatAgentSelectorProps {
  value?: string;
  onChange: (agentId: string) => void;
  className?: string;
}

export function ChatAgentSelector({ value, onChange, className }: ChatAgentSelectorProps): React.JSX.Element | null {
  const { data } = useAvailableAgents();

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
            {agent.display_name ?? agent.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
