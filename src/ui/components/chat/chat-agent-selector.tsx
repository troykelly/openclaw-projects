/**
 * Agent selector dropdown for chat (Epic #1940, Issue #1950).
 *
 * Dropdown of available agents filtered by visibility preference.
 * Default agent pre-selected. Shows AgentStatusBadge per agent (Issue #2160).
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { useChatAgentPreferences } from './use-chat-agent-preferences';
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
  const { visibleAgents } = useChatAgentPreferences();

  if (visibleAgents.length <= 1) return null;

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
        {visibleAgents.map((agent) => (
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
