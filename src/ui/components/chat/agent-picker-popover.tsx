/**
 * Agent picker popover (Issues #2423, #2424, #2425 — AD-4).
 *
 * Shared Popover+Command component for selecting an agent when
 * starting a new conversation. Used by ChatSessionList, ChatHeader,
 * ChatSessionEndedState, and ChatEmptyState.
 *
 * Single-agent optimization: when only one agent is available,
 * clicking the trigger calls onSelect directly (no popover).
 */
import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/ui/components/ui/command';
import { AgentStatusBadge } from './agent-status-badge';
import type { AgentStatus } from './agent-status-badge';
import type { ChatAgent } from '@/ui/lib/api-types';

interface AgentPickerPopoverProps {
  /** Available agents to pick from. */
  agents: ChatAgent[];
  /** Pre-selected agent ID. */
  defaultAgentId: string | null;
  /** Called when an agent is selected. */
  onSelect: (agentId: string) => void;
  /** Trigger element (button). */
  trigger: React.ReactNode;
  /** Disable the trigger. */
  disabled?: boolean;
}

export function AgentPickerPopover({
  agents,
  defaultAgentId,
  onSelect,
  trigger,
  disabled,
}: AgentPickerPopoverProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);

  const handleTriggerClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      // Single agent: skip popover, select directly
      if (agents.length <= 1) {
        e.preventDefault();
        const agentId = agents[0]?.id ?? defaultAgentId;
        if (agentId) onSelect(agentId);
        return;
      }
      // Multiple agents: popover opens via Radix
    },
    [agents, defaultAgentId, onSelect, disabled],
  );

  const handleSelect = React.useCallback(
    (agentId: string) => {
      setOpen(false);
      onSelect(agentId);
    },
    [onSelect],
  );

  // If no agents, render trigger as-is
  if (agents.length === 0) {
    return <>{trigger}</>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No agents available.</CommandEmpty>
            <CommandGroup heading="Select agent">
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={agent.id}
                  onSelect={() => handleSelect(agent.id)}
                  className="flex items-center gap-2"
                >
                  <div
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold',
                    )}
                    aria-hidden="true"
                  >
                    {(agent.display_name ?? agent.name).charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate text-sm">
                    {agent.display_name ?? agent.name}
                  </span>
                  <AgentStatusBadge status={(agent.status ?? 'unknown') as AgentStatus} />
                  {agent.id === defaultAgentId && (
                      <Check className="size-4 text-primary" aria-hidden="true" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
